//! The HTTP model against a one-request server on 127.0.0.1 that answers
//! as a provider would, in chunks: the request it sends, the stream it
//! reads, errors and stopping. No real provider is reached.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use kasten_core::config::Provider;
use kasten_mcp::tools::specs;
use serde_json::{Value, json};

use super::block_on;
use super::flaky::{Act, serve_acts};
use super::streams::{CLAUDE, VLLM};
use crate::chat::http::HttpModel;
use crate::chat::model::{Call, Message, Model, Stop};

/// What the server was asked: the request line and headers, and the body.
pub(super) struct Asked {
    pub head: String,
    pub body: Value,
}

/// Serves one request: answers `status` with `chunks`, each flushed after
/// a pause of `pause`.
pub(super) fn serve(
    status: u16,
    chunks: Vec<Vec<u8>>,
    pause: Duration,
) -> (String, JoinHandle<Asked>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
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
        let kind = if status == 200 {
            "text/event-stream"
        } else {
            "application/json"
        };
        let _ = write!(
            stream,
            "HTTP/1.1 {status} X\r\nContent-Type: {kind}\r\nConnection: close\r\n\r\n"
        );
        for chunk in chunks {
            if stream
                .write_all(&chunk)
                .and_then(|_| stream.flush())
                .is_err()
            {
                break;
            }
            thread::sleep(pause);
        }
        Asked {
            head,
            // A GET has no body.
            body: serde_json::from_slice(&body).unwrap_or(Value::Null),
        }
    });
    (base, handle)
}

/// A stream in pieces of `size` bytes, which may split a character.
pub(super) fn pieces(stream: &str, size: usize) -> Vec<Vec<u8>> {
    stream.as_bytes().chunks(size).map(<[u8]>::to_vec).collect()
}

pub(super) fn provider(kind: &str, base: &str) -> Provider {
    Provider {
        name: "Test provider".to_owned(),
        kind: kind.to_owned(),
        base_url: base.to_owned(),
        model: "default-model".to_owned(),
    }
}

/// A client that ignores any proxy set for this machine.
pub(super) fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

pub(super) fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().find_map(|l| {
        let (key, value) = l.split_once(':')?;
        key.eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

#[test]
fn claude_is_asked_with_its_headers_and_streams_back() {
    // Pieces of 13 bytes split "Grüße" inside a character somewhere.
    let (base, server) = serve(200, pieces(CLAUDE, 13), Duration::from_millis(1));
    let model = HttpModel::new(
        client(),
        &provider("anthropic", &base),
        Some(" sk-test ".into()),
        "model-large",
    )
    .unwrap();
    let tools = specs();
    let thread = [Message::User("Remind me to ask the team".to_owned())];
    let call = Call {
        system: "Be brief.",
        messages: &thread,
        tools: &tools,
    };
    let seen = Mutex::new(String::new());
    let reply = block_on(model.reply(
        &call,
        &|t| seen.lock().unwrap().push_str(t),
        &AtomicBool::new(false),
    ))
    .unwrap();
    assert_eq!(*seen.lock().unwrap(), "I'll capture that for you — Grüße.");
    assert_eq!(reply.stop, Stop::Tools);
    assert_eq!(reply.calls[0].name, "capture");

    let asked = server.join().unwrap();
    assert!(
        asked.head.starts_with("POST /v1/messages HTTP/1.1"),
        "{}",
        asked.head
    );
    assert_eq!(header(&asked.head, "x-api-key"), Some("sk-test"));
    assert_eq!(header(&asked.head, "anthropic-version"), Some("2023-06-01"));
    assert_eq!(header(&asked.head, "authorization"), None);
    assert_eq!(asked.body["model"], "model-large");
    assert_eq!(asked.body["max_tokens"], 16_000);
    assert_eq!(asked.body["system"][0]["text"], "Be brief.");
    assert_eq!(
        asked.body["system"][0]["cache_control"]["type"],
        "ephemeral"
    );
    assert_eq!(
        asked.body["messages"],
        json!([{"role": "user", "content": [{"type": "text", "text": "Remind me to ask the team"}]}])
    );
    let advertised = asked.body["tools"].as_array().unwrap();
    let catalogue = kasten_mcp::tools::specs();
    assert_eq!(advertised.len(), catalogue.len());
    for (actual, expected) in advertised.iter().zip(&catalogue) {
        assert_eq!(actual["name"], expected.name.as_str());
    }
}

#[test]
fn a_local_server_needs_no_key() {
    let (base, server) = serve(200, pieces(VLLM, 40), Duration::ZERO);
    let model = HttpModel::new(
        client(),
        &provider("openai", &format!("{base}/v1")),
        None,
        "",
    )
    .unwrap();
    let thread = [Message::User("Find the venue".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    let reply = block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).unwrap();
    assert_eq!(reply.text, "Let me look.");
    assert_eq!(reply.calls.len(), 2);
    let asked = server.join().unwrap();
    assert!(
        asked.head.starts_with("POST /v1/chat/completions HTTP/1.1"),
        "{}",
        asked.head
    );
    assert_eq!(header(&asked.head, "authorization"), None);
    assert_eq!(
        asked.body["model"], "default-model",
        "the provider's own model"
    );
    assert_eq!(asked.body["max_tokens"], 4096);
    assert!(asked.body.get("tools").is_none());
}

#[test]
fn refusals_and_broken_streams_are_errors_in_words() {
    let refusal =
        r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
    let (base, server) = serve(401, vec![refusal.into()], Duration::ZERO);
    let model = HttpModel::new(
        client(),
        &provider("anthropic", &base),
        Some("bad".into()),
        "model-large",
    )
    .unwrap();
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    let failure = block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).unwrap_err();
    assert_eq!(
        failure.message,
        "Test provider answered 401: invalid x-api-key. Check the API key in Settings."
    );
    server.join().unwrap();

    // A stream that ends without saying how it ended keeps what was said.
    let cut = &VLLM[..VLLM.find("\"tool_calls\"").unwrap()];
    let whole = cut.rsplit_once("data:").unwrap().0;
    // It is asked for again, four times in all, and then reported.
    let acts = (0..4).map(|_| Act::Trail(whole.to_owned())).collect();
    let (base, server) = serve_acts(acts);
    let model = HttpModel::new(
        client(),
        &provider("openai", &base),
        Some("sk-local".into()),
        "m",
    )
    .unwrap();
    let failure = block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).unwrap_err();
    assert!(
        failure
            .message
            .contains("closed before the answer was complete"),
        "{}",
        failure.message
    );
    assert_eq!(failure.partial.unwrap().text, "Let me look.");
    let asked = server.join().unwrap();
    assert_eq!(asked.len(), 4);
    assert_eq!(
        header(&asked[0].head, "authorization"),
        Some("Bearer sk-local")
    );

    // Nobody listening.
    let closed = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    let model = HttpModel::new(client(), &provider("openai", &base), None, "m").unwrap();
    let failure = block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).unwrap_err();
    assert!(
        failure
            .message
            .starts_with("Could not reach Test provider: "),
        "{}",
        failure.message
    );
}

#[test]
fn stopping_ends_a_slow_answer_at_once() {
    // The rest of the answer would take ten seconds to come.
    let (base, server) = serve(200, pieces(VLLM, 400), Duration::from_secs(1));
    let model = HttpModel::new(client(), &provider("openai", &base), None, "m").unwrap();
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let stop = Arc::clone(&cancel);
    let started = Instant::now();
    let reply = block_on(model.reply(&call, &move |_| stop.store(true, Ordering::SeqCst), &cancel))
        .unwrap();
    assert_eq!(reply.stop, Stop::Cancelled);
    assert!(reply.text.starts_with("Let me"), "{}", reply.text);
    assert!(reply.calls.is_empty());
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    drop(server);
}

#[test]
fn a_model_needs_a_name_and_claude_a_key() {
    let err =
        HttpModel::new(client(), &provider("anthropic", ""), None, "model-large").unwrap_err();
    assert_eq!(err, "No API key for “Test provider”: add one in Settings");
    let mut nameless = provider("openai", "http://llm-server:8000/v1");
    nameless.model.clear();
    let err = HttpModel::new(client(), &nameless, None, " ").unwrap_err();
    assert_eq!(err, "Choose a model for “Test provider”");
    let err = HttpModel::new(client(), &provider("gemini", ""), None, "m").unwrap_err();
    assert!(err.contains("not “gemini”"), "{err}");
    assert!(HttpModel::new(client(), &provider("openai", ""), None, "m").is_err());
}
