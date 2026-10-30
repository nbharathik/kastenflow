//! A small stand-in for GitHub on this computer, for tests: a listener on
//! `127.0.0.1` (std only) that answers each request with what the test's
//! handler says and remembers what it was asked.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde_json::Value;

/// What a request said.
#[derive(Debug, Clone)]
pub struct Req {
    pub method: String,
    /// The path with its query, as sent.
    pub path: String,
    /// Header names in lower case.
    pub headers: HashMap<String, String>,
    pub body: String,
}

impl Req {
    /// The path without its query.
    pub fn route(&self) -> &str {
        self.path.split('?').next().unwrap_or("")
    }

    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or(Value::Null)
    }
}

/// What to answer.
pub struct Resp {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Resp {
    pub fn json(status: u16, body: Value) -> Resp {
        Resp {
            status,
            headers: Vec::new(),
            body: body.to_string(),
        }
    }

    pub fn empty(status: u16) -> Resp {
        Resp {
            status,
            headers: Vec::new(),
            body: String::new(),
        }
    }

    pub fn header(mut self, name: &str, value: &str) -> Resp {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }
}

type Handler = dyn Fn(&Req) -> Resp + Send + Sync;

pub struct Mock {
    addr: SocketAddr,
    seen: Arc<Mutex<Vec<Req>>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Mock {
    pub fn start(handler: impl Fn(&Req) -> Resp + Send + Sync + 'static) -> Mock {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let handler: Arc<Handler> = Arc::new(handler);
        let (log, done) = (Arc::clone(&seen), Arc::clone(&stop));
        let thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if done.load(Ordering::SeqCst) {
                    return;
                }
                let Ok(mut stream) = stream else { continue };
                if let Some(req) = read_request(&mut stream) {
                    let resp = handler(&req);
                    log.lock().unwrap().push(req);
                    let _ = stream.write_all(&render(&resp));
                }
            }
        });
        Mock {
            addr,
            seen,
            stop,
            thread: Some(thread),
        }
    }

    /// The address to give as GitHub's.
    pub fn base(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Every request so far, oldest first.
    pub fn seen(&self) -> Vec<Req> {
        self.seen.lock().unwrap().clone()
    }

    /// How many requests went to `method route`.
    pub fn count(&self, method: &str, route: &str) -> usize {
        self.seen()
            .iter()
            .filter(|r| r.method == method && r.route() == route)
            .count()
    }
}

impl Drop for Mock {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the listener so it sees the flag.
        let _ = TcpStream::connect(self.addr);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Req> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let path = parts.next()?.to_owned();
    let mut headers = HashMap::new();
    loop {
        let mut header = String::new();
        reader.read_line(&mut header).ok()?;
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.insert(name.trim().to_lowercase(), value.trim().to_owned());
        }
    }
    let length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).ok()?;
    Some(Req {
        method,
        path,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

fn render(resp: &Resp) -> Vec<u8> {
    let mut text = format!(
        "HTTP/1.1 {} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        resp.status,
        resp.body.len()
    );
    for (name, value) in &resp.headers {
        text.push_str(&format!("{name}: {value}\r\n"));
    }
    text.push_str("\r\n");
    text.push_str(&resp.body);
    text.into_bytes()
}

/// Runs a future to its end on a small runtime of its own.
pub fn run<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

/// A client for tests: it never goes through a system proxy.
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}
