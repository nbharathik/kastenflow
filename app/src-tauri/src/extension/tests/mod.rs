//! The extension door's tests: a private copy of the dev vault with history,
//! the real server on a free port of 127.0.0.1, and a client that writes
//! requests by hand, so a wrong Host, a missing Origin or a body that is too
//! big can be sent as a browser never would. Nothing here reaches a network
//! beyond 127.0.0.1.

mod input;
mod limits;
mod pairing;
mod routes;
mod rules;
mod store;

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use kasten_core::{Instant, Kasten, ulid_at};
use serde_json::Value;

use super::limit::Limits;
use super::pairing::Pairing;
use super::server::Server;
use super::shared::{Shared, held};
use super::store::Store;

/// An extension's origin, as Chrome and Edge write it.
pub const ORIGIN: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
/// Another extension's.
pub const OTHER: &str = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba";
/// A pairing code the tests make.
pub const CODE: &str = "ABCD2345";

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// How the door is made for a test.
pub struct Setup {
    pub ttl: Duration,
    pub tries: u8,
    pub requests: usize,
    pub failures: usize,
}

impl Default for Setup {
    fn default() -> Setup {
        Setup {
            ttl: Duration::from_secs(120),
            tries: 5,
            requests: 1000,
            failures: 1000,
        }
    }
}

/// A vault, a settings folder and a door open on a free port.
pub struct Door {
    pub port: u16,
    pub kasten: Arc<Kasten>,
    pub shared: Arc<Shared>,
    /// What the door told the window was written, one list per capture.
    pub told: Arc<Mutex<Vec<Vec<String>>>>,
    /// The settings folder `extension.json` is kept in.
    pub settings: PathBuf,
    vault: PathBuf,
    runtime: tokio::runtime::Runtime,
    server: Option<Server>,
}

impl Door {
    pub fn new() -> Door {
        Door::with(Setup::default())
    }

    pub fn with(setup: Setup) -> Door {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/dev-vault");
        let id = ulid_at(Instant::now().millis);
        let vault = std::env::temp_dir().join(format!("kasten-ext-vault-{id}"));
        let settings = std::env::temp_dir().join(format!("kasten-ext-settings-{id}"));
        copy_dir(&source, &vault);
        let kasten = Arc::new(Kasten::open(&vault).unwrap());
        kasten.start_history().unwrap();
        let told = Arc::new(Mutex::new(Vec::new()));
        let for_vault = Arc::clone(&kasten);
        let for_told = Arc::clone(&told);
        let shared = Arc::new(Shared::new(
            Box::new(move || Ok(Arc::clone(&for_vault))),
            Box::new(move |paths| for_told.lock().unwrap().push(paths)),
            Store::load(Some(settings.clone())),
            Pairing::new(setup.ttl, setup.tries),
            Limits::new(setup.requests, setup.failures, Duration::from_secs(60)),
        ));
        shared.on.store(true, Ordering::Relaxed);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_stack_size(crate::STACK_BYTES)
            .enable_all()
            .build()
            .unwrap();
        let server = runtime
            .block_on(Server::start(0, Arc::clone(&shared)))
            .unwrap();
        Door {
            port: server.port(),
            kasten,
            shared,
            told,
            settings,
            vault,
            runtime,
            server: Some(server),
        }
    }

    /// A request to this door with what the extension sends: this Host, an
    /// extension's Origin, and JSON when there is a body.
    pub fn req(&self, method: &str, path: &str) -> Req {
        Req {
            method: method.to_owned(),
            path: path.to_owned(),
            headers: vec![
                ("Host".to_owned(), format!("127.0.0.1:{}", self.port)),
                ("Origin".to_owned(), ORIGIN.to_owned()),
            ],
            body: Vec::new(),
            port: self.port,
        }
    }

    /// Makes `code` the one waiting.
    pub fn offer(&self, code: &str) {
        held(&self.shared.pairing).start(code.to_owned(), std::time::Instant::now());
    }

    /// Pairs an extension from `origin` through the door and gives its token.
    pub fn pair_from(&self, origin: &str) -> String {
        self.offer(CODE);
        let reply = self
            .req("POST", "/v1/pair")
            .origin(origin)
            .json(&format!(r#"{{"code":"{CODE}","label":"Edge"}}"#))
            .send();
        assert_eq!(reply.status, 200, "{}", reply.body);
        reply.json()["token"].as_str().unwrap().to_owned()
    }

    /// Pairs the usual extension and gives its token.
    pub fn pair(&self) -> String {
        self.pair_from(ORIGIN)
    }

    /// A request carrying `token`.
    pub fn authed(&self, method: &str, path: &str, token: &str) -> Req {
        self.req(method, path).token(token)
    }

    /// The commits so far, newest first, by summary.
    pub fn commits(&self) -> Vec<String> {
        self.kasten
            .log(None, 500)
            .unwrap()
            .into_iter()
            .map(|c| c.summary)
            .collect()
    }

    pub fn stop(&mut self) {
        if let Some(server) = self.server.take() {
            self.runtime.block_on(server.stop());
        }
    }
}

impl Drop for Door {
    fn drop(&mut self) {
        self.stop();
        // Only this test's own copies under the system temp folder.
        let _ = fs::remove_dir_all(&self.vault);
        let _ = fs::remove_dir_all(&self.settings);
    }
}

/// A request written by hand.
pub struct Req {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    port: u16,
}

impl Req {
    fn without(mut self, name: &str) -> Req {
        self.headers.retain(|(n, _)| !n.eq_ignore_ascii_case(name));
        self
    }

    pub fn header(mut self, name: &str, value: &str) -> Req {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }

    pub fn host(self, value: &str) -> Req {
        self.without("Host").header("Host", value)
    }

    pub fn no_host(self) -> Req {
        self.without("Host")
    }

    pub fn origin(self, value: &str) -> Req {
        self.without("Origin").header("Origin", value)
    }

    pub fn no_origin(self) -> Req {
        self.without("Origin")
    }

    pub fn token(self, token: &str) -> Req {
        self.header("Authorization", &format!("Bearer {token}"))
    }

    pub fn content_type(self, value: &str) -> Req {
        self.without("Content-Type").header("Content-Type", value)
    }

    /// A JSON body, sent as such.
    pub fn json(self, text: &str) -> Req {
        let mut req = self.content_type("application/json");
        req.body = text.as_bytes().to_vec();
        req
    }

    /// A body of these bytes, with the type said.
    pub fn bytes(self, kind: &str, body: Vec<u8>) -> Req {
        let mut req = self.content_type(kind);
        req.body = body;
        req
    }

    /// Writes the request, with the connection closing after the reply, and
    /// reads the whole answer.
    pub fn send(self) -> Reply {
        self.send_as(None)
    }

    /// As `send`, with the body written in chunks of this size, as a body
    /// with no length says it ends.
    pub fn send_chunked(self, chunk: usize) -> Reply {
        self.send_as(Some(chunk))
    }

    fn send_as(self, chunked: Option<usize>) -> Reply {
        let mut head = format!("{} {} HTTP/1.1\r\n", self.method, self.path);
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("Connection: close\r\n");
        let mut out = Vec::new();
        match chunked {
            None => {
                if !self.body.is_empty() || self.method == "POST" {
                    head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
                }
                head.push_str("\r\n");
                out.extend_from_slice(head.as_bytes());
                out.extend_from_slice(&self.body);
            }
            Some(size) => {
                head.push_str("Transfer-Encoding: chunked\r\n\r\n");
                out.extend_from_slice(head.as_bytes());
                for piece in self.body.chunks(size) {
                    out.extend_from_slice(format!("{:x}\r\n", piece.len()).as_bytes());
                    out.extend_from_slice(piece);
                    out.extend_from_slice(b"\r\n");
                }
                out.extend_from_slice(b"0\r\n\r\n");
            }
        }
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(20)))
            .unwrap();
        // The server may answer and close before a big body is all sent.
        let _ = stream.write_all(&out);
        let _ = stream.flush();
        let mut raw = Vec::new();
        let _ = stream.read_to_end(&mut raw);
        Reply::parse(&raw)
    }
}

/// An answer, read whole.
#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    /// Header names in lower case.
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Reply {
    fn parse(raw: &[u8]) -> Reply {
        let text = String::from_utf8_lossy(raw).into_owned();
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
        let mut lines = head.lines();
        let status = lines
            .next()
            .and_then(|l| l.split(' ').nth(1))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let headers = lines
            .filter_map(|l| l.split_once(':'))
            .map(|(n, v)| (n.trim().to_ascii_lowercase(), v.trim().to_owned()))
            .collect();
        Reply {
            status,
            headers,
            body: body.to_owned(),
        }
    }

    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or(Value::Null)
    }

    pub fn error(&self) -> String {
        self.json()["error"].as_str().unwrap_or_default().to_owned()
    }

    /// Whether any header is one that would let a web page read the answer.
    pub fn has_cors(&self) -> bool {
        self.headers
            .iter()
            .any(|(n, _)| n.starts_with("access-control-"))
    }
}
