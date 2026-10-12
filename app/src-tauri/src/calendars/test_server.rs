//! A small web server on 127.0.0.1 for the tests, so no real calendar service
//! is ever reached: it answers a set number of requests as a test says.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

pub struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
    /// Leave `Content-Length` off, so only the end of the connection ends the body.
    pub open_ended: bool,
}

pub fn ok(body: &str) -> Reply {
    Reply {
        status: 200,
        headers: vec![("Content-Type", "text/calendar".into())],
        body: body.as_bytes().to_vec(),
        open_ended: false,
    }
}

pub fn status(code: u16) -> Reply {
    Reply {
        status: code,
        headers: vec![],
        body: Vec::new(),
        open_ended: false,
    }
}

/// Answers `count` requests, in turn, as `answer(n, head)` says (`n` counts
/// from 0, `head` is the request line and headers). Returns the address to
/// ask, and a handle that gives each request's head once all are answered.
pub fn serve(
    count: usize,
    answer: impl Fn(usize, &str) -> Reply + Send + 'static,
) -> (String, JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let mut heads = Vec::new();
        for n in 0..count {
            let Ok((mut stream, _)) = listener.accept() else {
                break;
            };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                head.push_str(&line);
            }
            let reply = answer(n, &head);
            heads.push(head);
            let mut out = format!("HTTP/1.1 {} X\r\nConnection: close\r\n", reply.status);
            for (name, value) in &reply.headers {
                out.push_str(&format!("{name}: {value}\r\n"));
            }
            if !reply.open_ended {
                out.push_str(&format!("Content-Length: {}\r\n", reply.body.len()));
            }
            out.push_str("\r\n");
            let _ = stream.write_all(out.as_bytes());
            for piece in reply.body.chunks(64 * 1024) {
                if stream.write_all(piece).is_err() {
                    break;
                }
            }
            let _ = stream.flush();
        }
        heads
    });
    (base, handle)
}

/// A client that ignores any proxy set for this machine.
pub fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

/// Runs a future to its end.
pub fn run<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}
