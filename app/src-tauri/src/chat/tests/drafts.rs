//! Setting up a provider before it is saved: the models it offers, listed
//! from its own API, and what to check when it cannot be reached.

use std::time::Duration;

use super::block_on;
use super::http::{client, header, provider, serve};
use crate::chat::drafts::{list_models, models_url, parse_models};
use crate::chat::errors::reach_hint;
use crate::chat::http::Kind;

#[test]
fn asks_each_kind_of_api_where_it_lists_models() {
    assert_eq!(
        models_url(Kind::Anthropic, "").unwrap(),
        "https://api.anthropic.com/v1/models?limit=100"
    );
    assert_eq!(
        models_url(Kind::Anthropic, "https://gateway.example/claude/v1/").unwrap(),
        "https://gateway.example/claude/v1/models?limit=100"
    );
    assert_eq!(
        models_url(Kind::OpenAi, "http://localhost:11434/v1").unwrap(),
        "http://localhost:11434/v1/models"
    );
    assert_eq!(
        models_url(
            Kind::OpenAi,
            "https://openrouter.ai/api/v1/chat/completions"
        )
        .unwrap(),
        "https://openrouter.ai/api/v1/models"
    );
    assert!(models_url(Kind::OpenAi, " ").is_err());
    // A ChatGPT sign-in lists at OpenAI's address, whatever the settings say.
    assert_eq!(
        models_url(Kind::ChatGpt, "https://collector.example/v1").unwrap(),
        "https://api.openai.com/v1/models"
    );
}

#[test]
fn reads_model_ids_once_each_in_the_order_given() {
    let body = r#"{"data": [{"id": "big"}, {"id": "small", "display_name": "Small"}, {"id": "big"}, {"id": ""}, {"name": "x"}], "has_more": false}"#;
    assert_eq!(parse_models(body), ["big", "small"]);
    assert!(parse_models("not json").is_empty());
}

#[test]
fn lists_a_local_servers_models_without_a_key() {
    let body =
        br#"{"object": "list", "data": [{"id": "llama3.2"}, {"id": "qwen2.5-coder"}]}"#.to_vec();
    let (base, server) = serve(200, vec![body], Duration::ZERO);
    let models = block_on(list_models(
        &client(),
        &provider("openai", &format!("{base}/v1")),
        None,
    ))
    .unwrap();
    assert_eq!(models, ["llama3.2", "qwen2.5-coder"]);
    let asked = server.join().unwrap();
    assert!(
        asked.head.starts_with("GET /v1/models HTTP/1.1"),
        "{}",
        asked.head
    );
    assert_eq!(header(&asked.head, "authorization"), None);
}

#[test]
fn asks_anthropic_with_its_key_and_version() {
    let body =
        br#"{"data": [{"id": "claude-large", "type": "model"}], "has_more": false}"#.to_vec();
    let (base, server) = serve(200, vec![body], Duration::ZERO);
    let models = block_on(list_models(
        &client(),
        &provider("anthropic", &base),
        Some("sk-test"),
    ))
    .unwrap();
    assert_eq!(models, ["claude-large"]);
    let asked = server.join().unwrap();
    assert!(
        asked.head.starts_with("GET /v1/models?limit=100 HTTP/1.1"),
        "{}",
        asked.head
    );
    assert_eq!(header(&asked.head, "x-api-key"), Some("sk-test"));
    assert_eq!(header(&asked.head, "anthropic-version"), Some("2023-06-01"));
    // Anthropic always wants a key: none, and nothing is sent.
    let err = block_on(list_models(&client(), &provider("anthropic", &base), None)).unwrap_err();
    assert!(err.contains("API key"), "{err}");
}

#[test]
fn says_what_to_check_when_listing_fails() {
    let (base, server) = serve(
        401,
        vec![br#"{"error": {"message": "invalid x-api-key"}}"#.to_vec()],
        Duration::ZERO,
    );
    let err = block_on(list_models(
        &client(),
        &provider("openai", &format!("{base}/v1")),
        Some("bad"),
    ))
    .unwrap_err();
    assert!(
        err.contains("401")
            && err.contains("invalid x-api-key")
            && err.contains("Check the API key"),
        "{err}"
    );
    server.join().unwrap();

    // Nothing listening on this computer: probably a local server not started.
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let err = block_on(list_models(
        &client(),
        &provider("openai", &format!("http://127.0.0.1:{port}/v1")),
        None,
    ))
    .unwrap_err();
    assert!(err.contains("Is Ollama or LM Studio running?"), "{err}");
}

#[test]
fn hints_at_what_to_check_for_each_kind_of_failure() {
    let local = "http://localhost:1234/v1/models";
    let far = "https://llm.example/v1/models";
    assert!(
        reach_hint(
            local,
            "tcp connect error: Connection refused (os error 111)"
        )
        .contains("Is Ollama or LM Studio running?")
    );
    assert!(
        reach_hint(far, "tcp connect error: Connection refused").contains("Check the base URL")
    );
    assert!(reach_hint(far, "invalid peer certificate: UnknownIssuer").contains("certificate"));
    assert!(reach_hint(far, "operation timed out").contains("took too long"));
    assert!(reach_hint(far, "dns error: failed to lookup address information").contains("online"));
    assert_eq!(reach_hint(far, "something else"), "");
}
