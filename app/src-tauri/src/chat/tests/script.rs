//! A server on 127.0.0.1 that answers a script: one connection per step, in
//! order, each answered by a function of what it asked. It stands in for
//! OpenAI's sign-in, token and Responses endpoints, whose answers depend on
//! the request before.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::Value;

/// What one connection asked.
#[derive(Debug, Clone)]
pub(super) struct Seen {
    /// The request line and headers.
    pub head: String,
    pub body: String,
}

impl Seen {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or(Value::Null)
    }

    /// The fields of a form body.
    pub fn form(&self) -> HashMap<String, String> {
        reqwest::Url::parse(&format!("http://form.invalid/?{}", self.body))
            .unwrap()
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        super::http::header(&self.head, name)
    }

    pub fn path(&self) -> &str {
        self.head.split(' ').nth(1).unwrap_or_default()
    }
}

/// One step: the status and body to answer with.
pub(super) type Step = Box<dyn Fn(&Seen) -> (u16, String) + Send>;

/// A step that always answers the same.
pub(super) fn always(status: u16, body: impl Into<String>) -> Step {
    let body = body.into();
    Box::new(move |_| (status, body.clone()))
}

/// Serves `steps`, one connection each. The handle gives what each one
/// asked, once the steps are done (or 20 seconds pass with one missing).
pub(super) fn serve_script(steps: Vec<Step>) -> (String, JoinHandle<Vec<Seen>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let mut seen = Vec::new();
        for step in steps {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                    Err(_) => return seen,
                }
            };
            stream.set_nonblocking(false).unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
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
            reader.read_exact(&mut body).unwrap();
            let asked = Seen {
                head,
                body: String::from_utf8_lossy(&body).into_owned(),
            };
            let (status, answer) = step(&asked);
            let kind = if answer.starts_with("event:") || answer.starts_with("data:") {
                "text/event-stream"
            } else {
                "application/json"
            };
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
                answer.len()
            );
            let _ = stream.flush();
            seen.push(asked);
        }
        seen
    });
    (base, handle)
}
