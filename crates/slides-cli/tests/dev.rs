//! `slides dev` end to end: the real program, a real socket.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Server {
    child: Child,
    port: u16,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start(name: &str) -> (Server, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("slides-dev-e2e-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_slides"))
        .args(["dev", dir.to_str().unwrap(), "--port", "0"])
        .stdout(Stdio::piped())
        .spawn()
        .expect("the slides binary runs");
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let port = loop {
        let line = lines.next().expect("the server says where it is").unwrap();
        if let Some(rest) = line.trim().strip_prefix("http://127.0.0.1:") {
            break rest.trim_end_matches('/').parse().unwrap();
        }
    };
    (Server { child, port }, dir)
}

/// One request; returns the status and the body.
fn ask(server: &Server, method: &str, target: &str, body: &[u8]) -> (u16, String) {
    // A server only just listening may drop a connection on a busy machine: ask again a few times.
    let try_once = || -> std::io::Result<Vec<u8>> {
        let mut stream = TcpStream::connect(("127.0.0.1", server.port))?;
        let head = format!(
            "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Slides: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            server.port,
            body.len()
        );
        stream.write_all(head.as_bytes())?;
        stream.write_all(body)?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw)?;
        Ok(raw)
    };
    let raw = (0..5)
        .find_map(|_| try_once().ok().filter(|raw| !raw.is_empty()))
        .expect("the server answers");
    let text = String::from_utf8_lossy(&raw).into_owned();
    let status = text.split(' ').nth(1).unwrap().parse().unwrap();
    let body = text
        .split_once("\r\n\r\n")
        .map_or(String::new(), |(_, b)| b.to_owned());
    (status, body)
}

#[test]
fn serves_a_folder_of_decks() {
    let (server, dir) = start("serve");
    let (status, body) = ask(&server, "POST", "/api/decks?title=Demo", b"");
    assert_eq!(status, 200, "{body}");
    assert!(dir.join("demo.deck").is_file());
    let (status, body) = ask(&server, "GET", "/api/decks", b"");
    assert_eq!(status, 200);
    assert!(body.contains("\"title\":\"Demo\""), "{body}");
    let (status, _) = ask(&server, "GET", "/api/deck?path=..%2Fx.deck", b"");
    assert_eq!(status, 422);
}

#[test]
fn tells_an_open_page_when_a_deck_changes_on_disk() {
    let (server, dir) = start("events");
    let mut line = String::new();
    // The head, then the ready comment. A server only just listening may drop the first
    // connection on a busy machine: ask again a few times before calling it a failure.
    let mut reader = (0..5)
        .find_map(|_| {
            let mut stream = TcpStream::connect(("127.0.0.1", server.port)).ok()?;
            stream
                .write_all(
                    format!(
                        "GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
                        server.port
                    )
                    .as_bytes(),
                )
                .ok()?;
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .ok()?;
            let mut reader = BufReader::new(stream);
            loop {
                line.clear();
                if reader.read_line(&mut line).ok()? == 0 {
                    return None;
                }
                if line.starts_with(": ready") {
                    return Some(reader);
                }
            }
        })
        .expect("the events stream opens");
    // A deck arrives from outside, as if another program had saved it.
    let (_, made) = ask(&server, "POST", "/api/decks?title=Late", b"");
    assert!(made.contains("late.deck"));
    let started = Instant::now();
    let event = loop {
        line.clear();
        reader.read_line(&mut line).unwrap();
        if line.starts_with("data: ") {
            break line.clone();
        }
        assert!(started.elapsed() < Duration::from_secs(8), "no event came");
    };
    assert!(
        event.contains("\"path\":\"late.deck\"") && event.contains("\"change\":\"added\""),
        "{event}"
    );
    drop(dir);
}
