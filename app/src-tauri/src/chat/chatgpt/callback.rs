//! Where the browser comes back to after signing in with ChatGPT: a
//! listener on 127.0.0.1 that lives only for one sign-in. It takes a GET of
//! exactly `/auth/callback` with this computer's own address in its Host
//! header (so a web page cannot reach it through a name it controls), at
//! most 8 KB of it, and the sign-in's own `state`, compared in constant
//! time. Anything else gets a refusal and changes nothing, so a stray
//! request cannot end the sign-in. It answers a plain page without scripts
//! and closes itself when the sign-in ends, is stopped or runs out of time.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::Instant;

use super::authorize::{CALLBACK_PATH, DYNAMIC_CLIENT};
use super::pkce;

/// How long the person has to finish signing in.
pub const LIMIT: Duration = Duration::from_secs(300);
/// The most a request's line and headers may hold.
const MAX_REQUEST: usize = 8 * 1024;
/// How long a connection has to send its request.
const READ: Duration = Duration::from_secs(5);
const TICK: Duration = Duration::from_millis(50);

/// How a sign-in's wait ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The browser came back with a code, and maybe the client OpenAI
    /// issued.
    Code {
        code: String,
        client_id: Option<String>,
    },
    /// ChatGPT sent the browser back with an error, such as `access_denied`
    /// when the person said no.
    Error(String),
    Cancelled,
    TimedOut,
}

/// A listener on a port of this computer.
pub struct Listener {
    listener: TcpListener,
    port: u16,
}

impl Listener {
    /// Listens on `port` of 127.0.0.1; 0 takes a free one.
    pub async fn bind(port: u16) -> Result<Listener, String> {
        let listener = TcpListener::bind(("127.0.0.1", port)).await.map_err(|e| {
            format!("KastenFlow could not listen for the sign-in on this computer: {e}")
        })?;
        let port = listener
            .local_addr()
            .map_err(|e| {
                format!("KastenFlow could not listen for the sign-in on this computer: {e}")
            })?
            .port();
        Ok(Listener { listener, port })
    }

    /// The address ChatGPT sends the browser back to.
    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{CALLBACK_PATH}", self.port)
    }

    /// Waits for the browser to come back with `state`, until `cancel` is
    /// set or `limit` passes. The listener closes as this returns.
    pub async fn wait(self, state: &str, cancel: &AtomicBool, limit: Duration) -> Outcome {
        let (done, mut results) = mpsc::channel::<Outcome>(4);
        let deadline = Instant::now() + limit;
        let state: Arc<str> = Arc::from(state);
        loop {
            if let Ok(outcome) = results.try_recv() {
                return outcome;
            }
            if cancel.load(Ordering::SeqCst) {
                return Outcome::Cancelled;
            }
            if Instant::now() >= deadline {
                return Outcome::TimedOut;
            }
            match tokio::time::timeout(TICK, self.listener.accept()).await {
                Ok(Ok((stream, _))) => {
                    tokio::spawn(serve(stream, self.port, Arc::clone(&state), done.clone()));
                }
                Ok(Err(_)) => tokio::time::sleep(TICK).await,
                Err(_) => {}
            }
        }
    }
}

/// What one request gets back, and whether it ends the sign-in.
struct Answer {
    status: u16,
    page: &'static str,
    outcome: Option<Outcome>,
}

const DONE: &str = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>KastenFlow</title><style>:root{color-scheme:light dark}body{font:17px system-ui,sans-serif;max-width:32rem;margin:18vh auto;padding:24px}h1{font-size:26px}</style><h1>You can close this tab</h1><p>KastenFlow is finishing signing in with ChatGPT. Go back to KastenFlow.</p></html>";
const FAILED: &str = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>KastenFlow</title><style>:root{color-scheme:light dark}body{font:17px system-ui,sans-serif;max-width:32rem;margin:18vh auto;padding:24px}h1{font-size:26px}</style><h1>Signing in did not finish</h1><p>You can close this tab. KastenFlow says why.</p></html>";
const REFUSED: &str = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>KastenFlow</title><p>Not found.</p></html>";

fn refuse(status: u16) -> Answer {
    Answer {
        status,
        page: REFUSED,
        outcome: None,
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        405 => "Method Not Allowed",
        431 => "Request Header Fields Too Large",
        _ => "Not Found",
    }
}

/// The value of `name` in `pairs`: None when absent, Err when given twice.
fn one<'a>(pairs: &'a [(String, String)], name: &str) -> Result<Option<&'a str>, ()> {
    let mut found = pairs.iter().filter(|(k, _)| k == name);
    let first = found.next().map(|(_, v)| v.as_str());
    if found.next().is_some() {
        Err(())
    } else {
        Ok(first)
    }
}

/// Whether OpenAI's issued client looks like one: not the registration
/// entry point, and nothing that could carry anything else.
fn client_id_ok(id: &str) -> bool {
    id != DYNAMIC_CLIENT
        && (1..=200).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A short error code, kept to what a code is made of.
fn error_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        .take(60)
        .collect()
}

/// What to answer a request whose line and headers are `head`.
fn answer(head: &str, port: u16, state: &str) -> Answer {
    let mut lines = head.split("\r\n");
    let mut line = lines.next().unwrap_or_default().split(' ');
    let (method, target, version) = (line.next(), line.next(), line.next());
    if line.next().is_some() || !version.is_some_and(|v| v.starts_with("HTTP/1.")) {
        return refuse(400);
    }
    if method != Some("GET") {
        return refuse(405);
    }
    let host = format!("127.0.0.1:{port}");
    let mut hosts = lines.filter_map(|l| {
        let (name, value) = l.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("host")
            .then(|| value.trim())
    });
    if hosts.next() != Some(host.as_str()) || hosts.next().is_some() {
        return refuse(404);
    }
    let target = target.unwrap_or_default();
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return refuse(404);
    }
    let Ok(url) = Url::parse(&format!("http://{host}/?{query}")) else {
        return refuse(400);
    };
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    // A request without this sign-in's state is somebody else's: it ends
    // nothing.
    let Ok(Some(given)) = one(&pairs, "state") else {
        return refuse(400);
    };
    if !pkce::same(given, state) {
        return refuse(400);
    }
    let finished = |outcome: Outcome| Answer {
        status: 200,
        page: if matches!(outcome, Outcome::Code { .. }) {
            DONE
        } else {
            FAILED
        },
        outcome: Some(outcome),
    };
    if let Ok(Some(error)) = one(&pairs, "error") {
        return finished(Outcome::Error(error_code(error)));
    }
    let (Ok(code), Ok(client)) = (one(&pairs, "code"), one(&pairs, "client_id")) else {
        return refuse(400);
    };
    let Some(code) = code.filter(|c| !c.is_empty() && c.len() <= 4096) else {
        return finished(Outcome::Error("missing_code".to_owned()));
    };
    if client.is_some_and(|c| !client_id_ok(c)) {
        return finished(Outcome::Error("registration_incomplete".to_owned()));
    }
    finished(Outcome::Code {
        code: code.to_owned(),
        client_id: client.map(str::to_owned),
    })
}

enum Head {
    Whole(String),
    TooBig,
    Closed,
}

/// Reads up to the blank line that ends a request's headers.
async fn read_head(stream: &mut TcpStream) -> Head {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            if end + 4 > MAX_REQUEST {
                return Head::TooBig;
            }
            return Head::Whole(String::from_utf8_lossy(&buffer[..end]).into_owned());
        }
        if buffer.len() > MAX_REQUEST {
            return Head::TooBig;
        }
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => return Head::Closed,
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
        }
    }
}

async fn write_answer(stream: &mut TcpStream, answer: &Answer) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'\r\nConnection: close\r\n\r\n",
        answer.status,
        reason(answer.status),
        answer.page.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(answer.page.as_bytes()).await?;
    stream.flush().await
}

/// One connection: reads its request, answers it, and only then reports
/// an end of the sign-in, so the person sees the page first.
async fn serve(mut stream: TcpStream, port: u16, state: Arc<str>, done: mpsc::Sender<Outcome>) {
    let read = tokio::time::timeout(READ, read_head(&mut stream)).await;
    let answer = match read {
        Ok(Head::Whole(head)) => answer(&head, port, &state),
        Ok(Head::TooBig) => refuse(431),
        Ok(Head::Closed) | Err(_) => return,
    };
    let _ = write_answer(&mut stream, &answer).await;
    let _ = stream.shutdown().await;
    if let Some(outcome) = answer.outcome {
        let _ = done.send(outcome).await;
    }
    // A request cut off at the limit may have more coming: read it away, so
    // closing is not a reset that takes the answer with it.
    let sink = async {
        let mut sink = [0u8; 1024];
        while matches!(stream.read(&mut sink).await, Ok(n) if n > 0) {}
    };
    let _ = tokio::time::timeout(Duration::from_millis(200), sink).await;
}

#[cfg(test)]
#[path = "callback_tests.rs"]
mod tests;
