//! A server on 127.0.0.1 for the ways a connection goes wrong: it answers one
//! connection per step, in order, and a step may answer with headers of its
//! own (a `Retry-After`), hang up without a word, or send part of a stream
//! and then stop. What each connection asked, and when, is given back.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener};
use std::ops::Deref;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::script::Seen;

/// What the server does with one connection.
pub(super) enum Act {
    /// Answers with this status, these headers and this body.
    Say(u16, Vec<(&'static str, String)>, String),
    /// Takes the request, then closes the connection without a word.
    Hangup,
    /// Answers 200 with the start of a stream and promises more than it
    /// sends, then closes: the body ends in an error.
    Cut(String),
    /// Answers 200 with the start of a stream and just stops, as a server
    /// that closes the connection does: the body ends cleanly but short.
    Trail(String),
    /// Waits this long, then does the other.
    Late(Duration, Box<Act>),
}

/// A plain answer.
pub(super) fn say(status: u16, body: impl Into<String>) -> Act {
    Act::Say(status, Vec::new(), body.into())
}

/// An answer with a `Retry-After` of `seconds`.
pub(super) fn say_after(status: u16, seconds: u64, body: impl Into<String>) -> Act {
    Act::Say(
        status,
        vec![("Retry-After", seconds.to_string())],
        body.into(),
    )
}

/// What one connection asked, and when.
pub(super) struct Taken {
    pub seen: Seen,
    pub at: Instant,
}

impl Deref for Taken {
    type Target = Seen;

    fn deref(&self) -> &Seen {
        &self.seen
    }
}

fn kind_of(body: &str) -> &'static str {
    if body.starts_with("event:") || body.starts_with("data:") {
        "text/event-stream"
    } else {
        "application/json"
    }
}

fn perform(stream: &mut std::net::TcpStream, what: Act) {
    match what {
        Act::Say(status, headers, body) => {
            let mut head = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
                kind_of(&body),
                body.len()
            );
            for (name, value) in headers {
                head.push_str(&format!("{name}: {value}\r\n"));
            }
            let _ = write!(stream, "{head}\r\n{body}");
            let _ = stream.flush();
        }
        Act::Hangup => {}
        Act::Cut(start) => {
            let _ = write!(
                stream,
                "HTTP/1.1 200 X\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{start}",
                start.len() + 4096
            );
            let _ = stream.flush();
        }
        Act::Trail(start) => {
            let _ = write!(
                stream,
                "HTTP/1.1 200 X\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{start}"
            );
            let _ = stream.flush();
        }
        Act::Late(wait, next) => {
            thread::sleep(wait);
            perform(stream, *next);
        }
    }
}

/// Serves `acts`, one connection each. The handle gives what each one
/// asked, once the acts are done (or 20 seconds pass with one missing).
pub(super) fn serve_acts(acts: Vec<Act>) -> (String, JoinHandle<Vec<Taken>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let mut taken = Vec::new();
        for next in acts {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                    Err(_) => return taken,
                }
            };
            stream.set_nonblocking(false).unwrap();
            let at = Instant::now();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    break;
                }
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                head.push_str(&line);
            }
            let length = head
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .unwrap_or(0);
            let mut body = vec![0; length];
            let _ = reader.read_exact(&mut body);
            perform(&mut stream, next);
            let _ = stream.shutdown(Shutdown::Both);
            taken.push(Taken {
                seen: Seen {
                    head,
                    body: String::from_utf8_lossy(&body).into_owned(),
                },
                at,
            });
        }
        taken
    });
    (base, handle)
}
