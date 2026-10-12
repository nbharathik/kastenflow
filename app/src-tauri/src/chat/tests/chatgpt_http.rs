//! A chat request over a ChatGPT sign-in against a scripted server: the
//! token it carries, its renewal after a 401, a feature the server refuses,
//! and an address a vault's settings cannot change.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use serde_json::json;

use super::block_on;
use super::chatgpt::{account, kept, signed_in, token};
use super::http::{client, provider};
use super::responses::ANSWER;
use super::script::{always, serve_script};
use crate::chat::address;
use crate::chat::chatgpt::session::Account;
use crate::chat::http::HttpModel;
use crate::chat::model::{Call, Failure, Message, Model, Reply, Stop};
use crate::chat::providers::{self, ProviderInput};
use crate::secrets::MemoryKeys;

fn model(account: &Arc<Account>, url: &str) -> HttpModel {
    HttpModel::new(client(), &provider("chatgpt", ""), None, "gpt-6.1-sol")
        .unwrap()
        .with_account(Arc::clone(account))
        .at(url)
}

fn ask(model: &HttpModel, system: &str) -> Result<Reply, Box<Failure>> {
    let thread = [Message::User("Capture this".to_owned())];
    let call = Call {
        system,
        messages: &thread,
        tools: &[],
    };
    block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).map_err(Box::new)
}

#[test]
fn a_chat_request_carries_the_accounts_token_and_streams_back() {
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(200, ANSWER),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let reply = ask(
        &model(&account, &format!("{base}/v1/responses")),
        "Be brief.",
    )
    .unwrap();
    assert_eq!(reply.stop, Stop::Tools);
    assert_eq!(reply.calls[0].name, "capture");
    let asked = server.join().unwrap();
    let request = &asked[1];
    assert!(
        request.head.starts_with("POST /v1/responses HTTP/1.1"),
        "{}",
        request.head
    );
    assert_eq!(request.header("authorization"), Some("Bearer at-1"));
    assert_eq!(request.header("accept"), Some("text/event-stream"));
    assert_eq!(request.header("x-api-key"), None);
    let body = request.json();
    assert_eq!(body["model"], "gpt-6.1-sol");
    assert_eq!(body["instructions"], "Be brief.");
    assert_eq!(
        (body["store"].as_bool(), body["stream"].as_bool()),
        (Some(false), Some(true))
    );
    assert_eq!(body["include"], json!(["reasoning.encrypted_content"]));
    assert_eq!(
        body["input"],
        json!([{"role": "user", "content": "Capture this"}])
    );
    assert!(body.get("max_output_tokens").is_none() && body.get("temperature").is_none());
}

#[test]
fn a_401_renews_the_token_once_and_asks_again() {
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(
            401,
            r#"{"error":{"code":"invalid_token","message":"Expired"}}"#,
        ),
        always(200, token("at-2", "rt-3", 3600)),
        always(200, ANSWER),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let reply = ask(&model(&account, &format!("{base}/v1/responses")), "").unwrap();
    assert_eq!(reply.calls.len(), 2);
    let asked = server.join().unwrap();
    assert_eq!(asked[1].header("authorization"), Some("Bearer at-1"));
    assert_eq!(asked[3].header("authorization"), Some("Bearer at-2"));
    assert_eq!(asked[2].form()["refresh_token"], "rt-2");
    assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-3");
}

#[test]
fn a_second_401_is_an_error_that_says_to_sign_in_again() {
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(401, "{}"),
        always(200, token("at-2", "rt-3", 3600)),
        always(
            401,
            r#"{"error":{"code":"subscription_sharing_invalid_user"}}"#,
        ),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let failure = ask(&model(&account, &format!("{base}/v1/responses")), "").unwrap_err();
    assert_eq!(
        failure.message,
        "Test provider answered 401: Sign in with ChatGPT again in Settings, AI providers."
    );
    assert_eq!(server.join().unwrap().len(), 4, "one renewal, no more");
}

#[test]
fn a_plan_that_is_used_up_says_where_to_look() {
    let limit =
        r#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Limit"}}"#;
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(429, limit),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let failure = ask(&model(&account, &format!("{base}/v1/responses")), "").unwrap_err();
    assert!(
        failure
            .message
            .starts_with("Test provider answered 429: Your ChatGPT plan's usage limit is reached")
            && failure.message.contains("ChatGPT, Settings, Usage"),
        "{}",
        failure.message
    );
    assert_eq!(server.join().unwrap().len(), 2, "no retry loop on a limit");
}

#[test]
fn a_feature_the_server_refuses_is_dropped_and_remembered() {
    let unsupported = r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"include","message":"Unsupported parameter"}}"#;
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(400, unsupported),
        always(200, ANSWER),
        always(200, ANSWER),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let model = model(&account, &format!("{base}/v1/responses"));
    ask(&model, "").unwrap();
    ask(&model, "").unwrap();
    let asked = server.join().unwrap();
    assert!(asked[1].json().get("include").is_some());
    assert!(
        asked[2].json().get("include").is_none(),
        "the next try leaves out what was refused"
    );
    assert!(
        asked[3].json().get("include").is_none(),
        "and so does the next request"
    );
    assert!(!account.shape().reasoning);
}

#[test]
fn not_signed_in_a_chat_says_how_to_sign_in_without_asking_anyone() {
    let keys = Arc::new(MemoryKeys::default());
    let account = account(&keys, "http://127.0.0.1:9");
    let failure = ask(&model(&account, "http://127.0.0.1:9/v1/responses"), "").unwrap_err();
    assert!(
        failure.message.starts_with("Sign in with ChatGPT first"),
        "{}",
        failure.message
    );
}

#[test]
fn a_shared_vaults_base_url_cannot_redirect_the_token() {
    // A vault someone shared names another server for the sign-in.
    let hostile = provider("chatgpt", "https://collector.example/v1");
    let model = HttpModel::new(client(), &hostile, None, "gpt-6.1-sol").unwrap();
    let shown = format!("{model:?}");
    assert!(
        shown.contains("https://api.openai.com/v1/responses") && !shown.contains("collector"),
        "{shown}"
    );
    assert_eq!(
        address::origin_of(&hostile).unwrap(),
        "https://api.openai.com"
    );
    assert!(address::known_address(&hostile).unwrap());
    let keys = MemoryKeys::default();
    assert_eq!(
        address::key_for(&keys, &hostile).unwrap(),
        None,
        "no API key belongs to it"
    );
    assert!(address::save_key(&keys, &hostile, "sk-x").is_err());

    // Settings refuses to save an address for it, too.
    let input = ProviderInput {
        name: "ChatGPT".into(),
        kind: "chatgpt".into(),
        base_url: "https://collector.example/v1".into(),
        model: "gpt-6.1-sol".into(),
    };
    let v = super::vault();
    let err = providers::save(&v.kasten, &keys, input.clone(), None).unwrap_err();
    assert!(err.contains("fixed address"), "{err}");
    let plain = ProviderInput {
        base_url: String::new(),
        ..input
    };
    let listed = providers::save(&v.kasten, &keys, plain, None).unwrap();
    assert_eq!(
        (
            listed[0].kind.as_str(),
            listed[0].base_url.as_str(),
            listed[0].has_key
        ),
        ("chatgpt", "", false)
    );
    // A key does not make it signed in; the sign-in does.
    assert!(
        providers::save(
            &v.kasten,
            &keys,
            ProviderInput {
                name: "ChatGPT".into(),
                kind: "chatgpt".into(),
                base_url: String::new(),
                model: "m".into()
            },
            Some("sk-x".into())
        )
        .is_err()
    );
    let signed = signed_in("rt");
    assert!(providers::list(&v.kasten, signed.as_ref())[0].has_key);
}
