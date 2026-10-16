//! A scripted MCP client: spawns `kasten-mcp` on a private copy of the dev
//! vault and speaks newline-delimited JSON-RPC over its stdio.

// Each test binary uses a different part of this module.
#![allow(dead_code)]

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten, ulid_at};
use kasten_mcp::tools::call;
use serde_json::{Value, json};

pub struct TempDir(pub PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        // Only the test's own copy under the system temp folder.
        let _ = fs::remove_dir_all(&self.0);
    }
}

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

/// A copy of the dev vault with history on. A test that calls the tools in its own process
/// is not given a browser to draw with, whatever the machine has (a browser started by a
/// test would outlive it); the tests that draw for real run the program, which ends cleanly.
pub fn vault() -> TempDir {
    kasten_mcp::decks::render::pretend_no_browser(true);
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/dev-vault");
    let dir = std::env::temp_dir().join(format!("kasten-mcp-{}", ulid_at(Instant::now().millis)));
    copy_dir(&source, &dir);
    Kasten::open(&dir).unwrap().start_history().unwrap();
    TempDir(dir)
}

pub struct Client {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next: u64,
    /// What the server told the client about the vault when it connected.
    pub instructions: String,
}

impl Drop for Client {
    /// Hangs up as a client does, so the server ends and lets go of the browser it may have
    /// started to draw with; only a server that does not end is killed.
    fn drop(&mut self) {
        drop(self.stdin.take());
        let waited = std::time::Instant::now();
        while waited.elapsed() < std::time::Duration::from_secs(5) {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Client {
    /// Starts the server and does the handshake as `client`.
    pub fn start(vault: &Path, client: &str) -> Client {
        let mut child = Command::new(env!("CARGO_BIN_EXE_kasten-mcp"))
            .args(["--vault", vault.to_str().unwrap()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("kasten-mcp starts");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut c = Client {
            child,
            stdin: Some(stdin),
            stdout,
            next: 1,
            instructions: String::new(),
        };
        let init = c.request(
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": client, "version": "1.0"}
            }),
        );
        assert_eq!(init["serverInfo"]["name"], json!("kasten"), "{init}");
        assert_eq!(init["serverInfo"]["title"], json!("KastenFlow"), "{init}");
        c.instructions = init["instructions"].as_str().unwrap_or_default().to_owned();
        c.send(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}));
        c
    }

    fn send(&mut self, message: Value) {
        let stdin = self.stdin.as_mut().expect("the client is still connected");
        writeln!(stdin, "{message}").unwrap();
        stdin.flush().unwrap();
    }

    /// A request's result (or its error object).
    pub fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next;
        self.next += 1;
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        loop {
            let mut line = String::new();
            let read = self.stdout.read_line(&mut line).unwrap();
            assert!(read > 0, "the server closed its output");
            let message: Value = serde_json::from_str(&line).unwrap();
            if message["id"] == json!(id) {
                return if message.get("error").is_some() {
                    message["error"].clone()
                } else {
                    message["result"].clone()
                };
            }
        }
    }

    /// Calls a tool: Ok with its JSON result, or Err with the tool's error text.
    pub fn call(&mut self, tool: &str, arguments: Value) -> Result<Value, String> {
        let result = self.request("tools/call", json!({"name": tool, "arguments": arguments}));
        let text = result["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        if result["isError"] == json!(true) || result.get("code").is_some() {
            return Err(if text.is_empty() {
                result.to_string()
            } else {
                text
            });
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }

    pub fn tools(&mut self) -> Vec<String> {
        let list = self.request("tools/list", json!({}));
        list["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_owned())
            .collect()
    }
}

/// A Markdown outline of a talk: `create_deck` makes a cover and six slides of it.
pub const OUTLINE: &str = "# Tool use

## What a tool is
A function the model may ask the host to run.

## The loop
- The model asks
- The host runs it
- The result goes back

## Why it matters
Tools turn a talker into a doer.

## Where it fails
Wrong arguments. Silent errors.

## Guardrails
Limits and review.

## Summary
Ask, run, return.
";

/// Makes the deck of `OUTLINE` in a project; returns its path and its slides' ids.
pub fn deck_of_eight(k: &Kasten, s: &Session) -> (String, Vec<String>) {
    let made = call(
        k,
        s,
        "create_deck",
        json!({"outline": OUTLINE, "project": "photo-organiser"}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let path = made["result"]["deck"].as_str().unwrap().to_owned();
    (path.clone(), slide_ids(k, s, &path))
}

pub fn slide_ids(k: &Kasten, s: &Session, deck: &str) -> Vec<String> {
    let got = call(k, s, "get_deck", json!({"deck": deck})).unwrap();
    got["slides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|slide| slide["id"].as_str().unwrap().to_owned())
        .collect()
}
