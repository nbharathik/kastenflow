//! "Test connection": one short request down the chat's own path, and what
//! it says back, or why it failed, in words a person can act on.

use std::time::Duration;

use super::block_on;
use super::http::{client, pieces, provider, serve};
use super::streams::VLLM;
use crate::chat::check::check;
use crate::chat::http::HttpModel;

#[test]
fn a_working_provider_answers_and_is_timed() {
    let (base, server) = serve(200, pieces(VLLM, 40), Duration::ZERO);
    let model = HttpModel::new(
        client(),
        &provider("openai", &format!("{base}/v1")),
        None,
        "local-model",
    )
    .unwrap();
    let result = block_on(check(&model, "local-model"));
    assert!(result.ok, "{}", result.message);
    assert_eq!(result.model, "local-model");
    assert!(!result.reply.is_empty());
    assert!(result.message.contains("local-model"), "{}", result.message);
    let asked = server.join().unwrap();
    // A test sends what a chat sends, a function tool among it, as small as
    // one can be: it fails where a chat would.
    let tools = asked.body["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["function"]["name"], "connection_test");
    assert_eq!(
        asked.body["messages"].as_array().unwrap().last().unwrap()["role"],
        "user"
    );
}

#[test]
fn a_refused_key_says_what_to_do() {
    let body = br#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#.to_vec();
    let (base, server) = serve(401, vec![body], Duration::ZERO);
    let model = HttpModel::new(
        client(),
        &provider("anthropic", &base),
        Some("sk-wrong".into()),
        "model-large",
    )
    .unwrap();
    let result = block_on(check(&model, "model-large"));
    server.join().unwrap();
    assert!(!result.ok);
    assert!(result.message.contains("401"), "{}", result.message);
    assert!(
        result.message.contains("invalid x-api-key"),
        "{}",
        result.message
    );
    assert!(
        result.message.contains("Check the API key in Settings"),
        "{}",
        result.message
    );
}

#[test]
fn a_server_that_is_not_there_is_named() {
    // A port nothing listens on.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let model = HttpModel::new(
        client(),
        &provider("openai", &format!("{base}/v1")),
        None,
        "llama",
    )
    .unwrap();
    let result = block_on(check(&model, "llama"));
    assert!(!result.ok);
    assert!(
        result.message.starts_with("Could not reach Test provider"),
        "{}",
        result.message
    );
}
