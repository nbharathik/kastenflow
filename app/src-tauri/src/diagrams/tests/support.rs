//! A fake WAR, a raw ZIP builder for archives that a writer would not make,
//! a temporary folder and a small web server.

use std::fs;
use std::io::{BufRead, BufReader, Cursor, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use sha2::{Digest, Sha256};
use zip::CompressionMethod;
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

use crate::diagrams::pinned::Source;

/// A folder of its own under the system's temporary one.
pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new() -> Scratch {
        let dir = std::env::temp_dir().join(format!(
            "kasten-diagrams-{}",
            kasten_core::ulid_at(kasten_core::Instant::now().millis)
        ));
        fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        // Only the test's own folder under the system's temporary one.
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// What the editor's web app holds in a WAR, as small files.
pub const INDEX: &str =
    "<!doctype html><title>stub editor</title><script src=\"js/app.min.js\"></script>";

/// A WAR as the release has it: a ZIP, deflated, with the web app at its top
/// and the server's own files beside it.
pub fn fake_war() -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let files: [(&str, &[u8]); 10] = [
        ("index.html", INDEX.as_bytes()),
        ("js/app.min.js", b"window.stub = true;"),
        ("styles/grapheditor.css", b"body { margin: 0 }"),
        ("images/logo.png", b"\x89PNG not really"),
        ("resources/dia.txt", b"hello"),
        ("WEB-INF/web.xml", b"<web-app/>"),
        ("WEB-INF/classes/Server.class", b"\xca\xfe\xba\xbe"),
        ("META-INF/MANIFEST.MF", b"Manifest-Version: 1.0"),
        ("META-INF/LICENSE", b"Apache License"),
        ("NOTICE", b"draw.io notice"),
    ];
    for (name, data) in files {
        zip.start_file(name, options).unwrap();
        zip.write_all(data).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

/// The release a fake WAR stands for.
pub fn source_for(url: &str, war: &[u8]) -> Source {
    Source {
        version: "1.0.0".to_owned(),
        url: url.to_owned(),
        sha256: sha256(war),
        size: war.len() as u64,
    }
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// A ZIP written by hand, entries stored as they are, with the names exactly
/// as given and each entry's Unix mode (`0` for none): what a writer that
/// cleans names would never make.
pub fn raw_zip(entries: &[(&str, &[u8], u32)]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for (name, data, mode) in entries {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let size = data.len() as u32;
        let len = name.len() as u16;
        out.extend(0x0403_4b50u32.to_le_bytes());
        out.extend([20u16, 0, 0, 0, 0x21].iter().flat_map(|v| v.to_le_bytes()));
        out.extend(crc.to_le_bytes());
        out.extend(size.to_le_bytes());
        out.extend(size.to_le_bytes());
        out.extend(len.to_le_bytes());
        out.extend(0u16.to_le_bytes());
        out.extend(name.as_bytes());
        out.extend(*data);

        central.extend(0x0201_4b50u32.to_le_bytes());
        central.extend(0x031eu16.to_le_bytes());
        central.extend([20u16, 0, 0, 0, 0x21].iter().flat_map(|v| v.to_le_bytes()));
        central.extend(crc.to_le_bytes());
        central.extend(size.to_le_bytes());
        central.extend(size.to_le_bytes());
        central.extend(len.to_le_bytes());
        central.extend([0u16, 0, 0, 0].iter().flat_map(|v| v.to_le_bytes()));
        central.extend((mode << 16).to_le_bytes());
        central.extend(offset.to_le_bytes());
        central.extend(name.as_bytes());
    }
    let at = out.len() as u32;
    out.extend(&central);
    out.extend(0x0605_4b50u32.to_le_bytes());
    out.extend([0u16, 0].iter().flat_map(|v| v.to_le_bytes()));
    out.extend((entries.len() as u16).to_le_bytes());
    out.extend((entries.len() as u16).to_le_bytes());
    out.extend((central.len() as u32).to_le_bytes());
    out.extend(at.to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out
}

/// How the test server answers a path.
#[derive(Clone)]
pub enum Reply {
    /// 200 with these bytes, written in pieces of `piece` with `pause` between.
    Body {
        bytes: Vec<u8>,
        piece: usize,
        pause: Duration,
    },
    /// 302 to this address.
    Redirect(String),
    /// This status and no content.
    Status(u16),
}

impl Reply {
    pub fn body(bytes: Vec<u8>) -> Reply {
        Reply::Body {
            bytes,
            piece: usize::MAX,
            pause: Duration::ZERO,
        }
    }
}

/// A web server on 127.0.0.1 that answers every request for `path` with
/// `reply` (and 404 to the rest) until the test ends; returns its address.
pub fn serve(routes: Vec<(&'static str, Reply)>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let routes = routes.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                if reader.read_line(&mut first).is_err() {
                    return;
                }
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
                        break;
                    }
                }
                let path = first.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let reply = routes
                    .iter()
                    .find(|(p, _)| *p == path)
                    .map_or(Reply::Status(404), |(_, r)| r.clone());
                match reply {
                    Reply::Redirect(to) => {
                        let _ = write!(
                            stream,
                            "HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        );
                    }
                    Reply::Status(code) => {
                        let _ = write!(
                            stream,
                            "HTTP/1.1 {code} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        );
                    }
                    Reply::Body {
                        bytes,
                        piece,
                        pause,
                    } => {
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            bytes.len()
                        );
                        for chunk in bytes.chunks(piece.min(bytes.len().max(1))) {
                            if stream
                                .write_all(chunk)
                                .and_then(|()| stream.flush())
                                .is_err()
                            {
                                break;
                            }
                            thread::sleep(pause);
                        }
                    }
                }
            });
        }
    });
    base
}

/// A client that accepts only this computer, over plain HTTP: the tests'
/// stand-in for "only GitHub".
pub fn local(url: &reqwest::Url) -> bool {
    url.host_str() == Some("127.0.0.1")
}

/// Runs a future to its end on a runtime of its own.
pub fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}
