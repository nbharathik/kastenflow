//! "Test connection" sends what a chat sends and names the stage that
//! failed: the sign-in, its renewal, the model list, the request or the
//! stream.

use std::sync::Arc;

use serde_json::json;

use super::block_on;
use super::chatgpt::{account, signed_in, token};
use super::flaky::{Act, say, serve_acts};
use super::http::{client, provider};
use super::responses::ANSWER;
use crate::chat::capabilities::{Applied, Effort};
use crate::chat::chatgpt::session::Account;
use crate::chat::check::check;
use crate::chat::diagnostics::Stage;
use crate::chat::http::HttpModel;
use crate::secrets::MemoryKeys;

const LIST: &str = r#"{"models":[{"slug":"gpt-6.1-sol","visibility":"list"}]}"#;

fn model(account: &Arc<Account>, base: &str) -> HttpModel {
    HttpModel::new(client(), &provider("chatgpt", ""), None, "gpt-6.1-sol")
        .unwrap()
        .with_account(Arc::clone(account))
        .with_settings(Applied {
            effort: Some(Effort::High),
            ..Applied::default()
        })
        .at(&format!("{base}/v1/responses"))
}

#[test]
fn a_test_that_passes_sent_a_tool_the_encrypted_reasoning_and_the_effort() {
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 3600)),
        say(200, LIST),
        say(200, ANSWER),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let result = block_on(check(&model(&account, &base), "gpt-6.1-sol"));
    assert!(result.ok, "{}", result.message);
    assert_eq!((result.stage, result.attempts), (None, 1));
    let asked = server.join().unwrap();
    assert_eq!(
        asked[1].path(),
        "/v1/models",
        "the model list is part of it"
    );
    assert_eq!(asked[1].header("authorization"), Some("Bearer at-1"));
    let sent = asked[2].json();
    assert_eq!(sent["tools"][0]["name"], "connection_test");
    assert_eq!(sent["include"], json!(["reasoning.encrypted_content"]));
    assert_eq!(sent["reasoning"], json!({"effort": "high"}));
}

#[test]
fn not_signed_in_the_stage_is_the_sign_in() {
    let keys = Arc::new(MemoryKeys::default());
    let account = account(&keys, "http://127.0.0.1:9");
    let result = block_on(check(&model(&account, "http://127.0.0.1:9"), "gpt-6.1-sol"));
    assert!(!result.ok);
    assert_eq!(result.stage, Some(Stage::SignIn));
    assert!(
        result.message.starts_with("Sign in with ChatGPT first"),
        "{}",
        result.message
    );
}

#[test]
fn a_refused_renewal_is_the_renewal_stage() {
    let (base, server) = serve_acts(vec![say(
        400,
        r#"{"error":"invalid_grant","error_description":"Token reused."}"#,
    )]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let result = block_on(check(&model(&account, &base), "gpt-6.1-sol"));
    server.join().unwrap();
    assert!(!result.ok);
    assert_eq!(result.stage, Some(Stage::Renewal));
    assert!(
        result
            .message
            .starts_with("Renewing the ChatGPT sign-in failed"),
        "{}",
        result.message
    );
}

#[test]
fn a_model_list_that_cannot_be_read_is_the_model_list_stage() {
    let (base, server) = serve_acts(vec![say(200, token("at-1", "rt-2", 3600)), say(503, "{}")]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let result = block_on(check(&model(&account, &base), "gpt-6.1-sol"));
    server.join().unwrap();
    assert_eq!(result.stage, Some(Stage::ModelList));
    assert!(
        result.message.starts_with("Listing the models failed"),
        "{}",
        result.message
    );
}

#[test]
fn a_request_the_route_refuses_is_the_request_stage() {
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 3600)),
        say(200, LIST),
        say(400, r#"{"error":{"message":"Invalid request"}}"#),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let result = block_on(check(&model(&account, &base), "gpt-6.1-sol"));
    server.join().unwrap();
    assert!(!result.ok);
    assert_eq!(result.stage, Some(Stage::Request));
    assert!(result.message.contains("400"), "{}", result.message);
}

#[test]
fn an_answer_that_keeps_breaking_is_the_stream_stage_after_four_tries() {
    // The stream stops after the text, before the function call.
    let marker = "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"sequence_number\":10";
    let cut = &ANSWER[..ANSWER.find(marker).unwrap()];
    let mut acts = vec![say(200, token("at-1", "rt-2", 3600)), say(200, LIST)];
    acts.extend((0..4).map(|_| Act::Trail(cut.to_owned())));
    let (base, server) = serve_acts(acts);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let result = block_on(check(&model(&account, &base), "gpt-6.1-sol"));
    server.join().unwrap();
    assert!(!result.ok);
    assert_eq!((result.stage, result.attempts), (Some(Stage::Stream), 4));
    assert!(
        result
            .message
            .contains("closed before the answer was complete"),
        "{}",
        result.message
    );
}

#[test]
fn a_test_that_needed_a_second_try_says_so() {
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 3600)),
        say(200, LIST),
        say(503, "{}"),
        say(200, ANSWER),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let result = block_on(check(&model(&account, &base), "gpt-6.1-sol"));
    server.join().unwrap();
    assert!(result.ok, "{}", result.message);
    assert!(
        result.message.contains("after 2 tries"),
        "{}",
        result.message
    );
}
