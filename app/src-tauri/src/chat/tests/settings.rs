//! The person's settings on the wire (a thinking budget, a temperature, a
//! longest answer, a reasoning effort). Bodies are as they always were
//! without settings; with them, only what the model takes goes, and the
//! ChatGPT plan's route never gets a field it refuses.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use serde_json::{Value, json};

use super::block_on;
use super::chatgpt::{account, signed_in, token};
use super::http::{client, provider};
use super::responses::ANSWER;
use super::script::{always, serve_script};
use super::streams::{CLAUDE, VLLM};
use crate::chat::capabilities::{Applied, Effort};
use crate::chat::chatgpt::session::Account;
use crate::chat::http::HttpModel;
use crate::chat::model::{Call, Failure, Message, Model, Reply};
use crate::chat::{anthropic, openai};

const EFFORT_REFUSED: &str = "This model doesn't take a reasoning effort; sent without it.";

/// One short question to `model`.
pub(super) fn ask(model: &HttpModel) -> Result<Reply, Box<Failure>> {
    let thread = [Message::User("Hello".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).map_err(Box::new)
}

fn keys(body: &Value) -> Vec<&str> {
    body.as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect()
}

#[test]
fn without_settings_every_body_is_as_it_was() {
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "Be brief.",
        messages: &thread,
        tools: &[],
    };
    let none = Applied::default();
    let claude = anthropic::body("claude-sonnet-4-5", 16_000, &call, &none);
    assert_eq!(
        claude,
        json!({
            "model": "claude-sonnet-4-5",
            "max_tokens": 16_000,
            "messages": [{"role": "user", "content": [{"type": "text", "text": "Hi"}]}],
            "stream": true,
            "system": [{"type": "text", "text": "Be brief.", "cache_control": {"type": "ephemeral"}}]
        })
    );
    let local = openai::body(
        "http://localhost:8000/v1/chat/completions",
        "m",
        4096,
        &call,
        &none,
    );
    assert_eq!(
        local,
        json!({
            "model": "m",
            "messages": [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "Hi"}],
            "stream": true,
            "max_tokens": 4096
        })
    );
    let official = openai::body(
        "https://api.openai.com/v1/chat/completions",
        "m",
        4096,
        &call,
        &none,
    );
    assert!(
        official.get("max_completion_tokens").is_some() && official.get("temperature").is_none()
    );
    assert!(official.get("reasoning_effort").is_none());
}

#[test]
fn a_thinking_budget_goes_with_room_above_it_and_without_a_temperature() {
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    let thinking = Applied {
        thinking_budget: Some(4000),
        max_output: Some(16_000),
        ..Applied::default()
    };
    let body = anthropic::body("claude-sonnet-4-5", 16_000, &call, &thinking);
    assert_eq!(
        body["thinking"],
        json!({"type": "enabled", "budget_tokens": 4000})
    );
    assert!(body["max_tokens"].as_u64().unwrap() > 4000);
    assert!(body.get("temperature").is_none());
    // Even if both were somehow applied, thinking wins and no temperature goes.
    let both = Applied {
        temperature: Some(0.3),
        ..thinking
    };
    assert!(
        anthropic::body("m", 16_000, &call, &both)
            .get("temperature")
            .is_none()
    );
    // A temperature alone, and a longest answer alone.
    let warm = Applied {
        temperature: Some(0.3),
        max_output: Some(2000),
        ..Applied::default()
    };
    let body = anthropic::body("m", 16_000, &call, &warm);
    assert_eq!(
        (body["temperature"].as_f64(), body["max_tokens"].as_u64()),
        (Some(0.3), Some(2000))
    );
    assert!(body.get("thinking").is_none());
}

#[test]
fn a_local_server_gets_max_tokens_and_openai_gets_max_completion_tokens() {
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    let set = Applied {
        effort: Some(Effort::Low),
        temperature: Some(0.7),
        max_output: Some(1500),
        ..Applied::default()
    };
    let local = openai::body(
        "http://llm:8000/v1/chat/completions",
        "m",
        4096,
        &call,
        &set,
    );
    assert_eq!(local["max_tokens"], 1500);
    assert!(local.get("max_completion_tokens").is_none());
    assert_eq!(local["temperature"], 0.7);
    let official = openai::body(
        "https://api.openai.com/v1/chat/completions",
        "o3",
        4096,
        &call,
        &set,
    );
    assert_eq!(official["max_completion_tokens"], 1500);
    assert!(official.get("max_tokens").is_none());
    assert_eq!(official["reasoning_effort"], "low");
}

#[test]
fn the_settings_reach_a_server_in_the_request_it_is_sent() {
    // Claude: a budget and room above it.
    let (base, server) = serve_script(vec![always(200, CLAUDE)]);
    let applied = Applied {
        thinking_budget: Some(3000),
        max_output: Some(9000),
        ..Applied::default()
    };
    let model = HttpModel::new(
        client(),
        &provider("anthropic", &base),
        Some("sk-test".into()),
        "claude-sonnet-4-5",
    )
    .unwrap()
    .with_settings(applied);
    ask(&model).unwrap();
    let sent = server.join().unwrap().remove(0).json();
    assert_eq!(sent["thinking"]["budget_tokens"], 3000);
    assert_eq!(sent["max_tokens"], 9000);

    // A local server: a temperature and a longest answer.
    let (base, server) = serve_script(vec![always(200, VLLM)]);
    let applied = Applied {
        temperature: Some(1.2),
        max_output: Some(700),
        ..Applied::default()
    };
    let model = HttpModel::new(client(), &provider("openai", &base), None, "m")
        .unwrap()
        .with_settings(applied);
    ask(&model).unwrap();
    let sent = server.join().unwrap().remove(0).json();
    assert_eq!(
        (sent["temperature"].as_f64(), sent["max_tokens"].as_u64()),
        (Some(1.2), Some(700))
    );
}

fn plan_model(account: &Arc<Account>, url: &str, effort: Option<Effort>) -> HttpModel {
    HttpModel::new(client(), &provider("chatgpt", ""), None, "gpt-6.1-sol")
        .unwrap()
        .with_account(Arc::clone(account))
        .with_settings(Applied {
            effort,
            // Whatever else was applied, the route never gets it.
            thinking_budget: Some(2000),
            temperature: Some(0.5),
            max_output: Some(900),
        })
        .at(url)
}

const REFUSED_EFFORT: &str = r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"reasoning.effort","message":"Unsupported parameter"}}"#;
const REFUSED_INCLUDE: &str = r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"include","message":"Unsupported value: reasoning.encrypted_content"}}"#;

fn refused_fields(sent: &Value) -> Vec<&str> {
    keys(sent)
        .into_iter()
        .filter(|k| {
            [
                "temperature",
                "max_output_tokens",
                "max_tokens",
                "max_completion_tokens",
                "thinking",
                "reasoning_effort",
            ]
            .contains(k)
        })
        .collect()
}

#[test]
fn the_plan_gets_an_effort_the_first_time_and_never_a_field_it_refuses() {
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(200, ANSWER),
    ]);
    let keychain = signed_in("rt-1");
    let account = account(&keychain, &base);
    let model = plan_model(
        &account,
        &format!("{base}/v1/responses"),
        Some(Effort::High),
    );
    ask(&model).unwrap();
    let sent = server.join().unwrap().remove(1).json();
    assert_eq!(sent["reasoning"], json!({"effort": "high"}));
    assert_eq!(refused_fields(&sent), Vec::<&str>::new(), "{sent}");
    // It was taken, so it is known to work for this model.
    assert!(account.effort_works("gpt-6.1-sol") && !account.effort_refused("gpt-6.1-sol"));
    assert_eq!(model.take_notice(), None);
}

#[test]
fn a_refused_effort_is_sent_again_without_it_with_a_notice_and_remembered() {
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(400, REFUSED_EFFORT),
        always(200, ANSWER),
        always(200, ANSWER),
    ]);
    let keychain = signed_in("rt-1");
    let account = account(&keychain, &base);
    let model = plan_model(&account, &format!("{base}/v1/responses"), Some(Effort::Low));
    ask(&model).unwrap();
    assert_eq!(model.take_notice().as_deref(), Some(EFFORT_REFUSED));
    assert_eq!(model.take_notice(), None, "said once");
    assert!(account.effort_refused("gpt-6.1-sol") && !account.effort_works("gpt-6.1-sol"));
    // The next request goes without it at once, and says nothing more.
    ask(&model).unwrap();
    assert_eq!(model.take_notice(), None);
    let asked = server.join().unwrap();
    assert_eq!(asked[1].json()["reasoning"], json!({"effort": "low"}));
    assert!(asked[2].json().get("reasoning").is_none());
    assert!(
        asked[2].json().get("include").is_some(),
        "only the effort went: the rest was not refused"
    );
    assert!(asked[3].json().get("reasoning").is_none());
    // What was found is about this model and this part: another model still gets the effort.
    assert!(!account.shape_for("gpt-6.1-sol").effort);
    assert!(account.shape_for("another-model").effort);
    for request in &asked[1..] {
        assert_eq!(refused_fields(&request.json()), Vec::<&str>::new());
    }
}

#[test]
fn a_refusal_about_include_does_not_blame_the_effort() {
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(400, REFUSED_INCLUDE),
        always(200, ANSWER),
    ]);
    let keychain = signed_in("rt-1");
    let account = account(&keychain, &base);
    let model = plan_model(
        &account,
        &format!("{base}/v1/responses"),
        Some(Effort::High),
    );
    ask(&model).unwrap();
    let asked = server.join().unwrap();
    assert!(asked[2].json().get("include").is_none());
    assert_eq!(asked[2].json()["reasoning"], json!({"effort": "high"}));
    assert!(!account.effort_refused("gpt-6.1-sol"));
    assert!(account.effort_works("gpt-6.1-sol"));
    // What went is said once, and it is not the effort.
    let said = model.take_notice().unwrap();
    assert!(said.contains("keep its reasoning"), "{said}");
    assert_eq!(model.take_notice(), None);
}

#[test]
fn an_effort_then_include_then_tools_may_all_be_dropped_in_turn() {
    let namespaced = r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"tools[0]","message":"Unsupported"}}"#;
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(400, REFUSED_EFFORT),
        always(400, REFUSED_INCLUDE),
        always(400, namespaced),
        always(200, ANSWER),
    ]);
    let keychain = signed_in("rt-1");
    let account = account(&keychain, &base);
    let model = plan_model(
        &account,
        &format!("{base}/v1/responses"),
        Some(Effort::High),
    );
    // With tools, so the namespace has something to group.
    let tools = kasten_mcp::tools::specs();
    let thread = [Message::User("Hello".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &tools,
    };
    block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).unwrap();
    let asked = server.join().unwrap();
    assert_eq!(asked.len(), 5);
    let last = asked[4].json();
    assert!(last.get("reasoning").is_none() && last.get("include").is_none());
    assert_eq!(last["tools"][0]["type"], "namespace");
}

#[test]
fn no_effort_set_means_none_is_sent_and_nothing_is_learned() {
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 3600)),
        always(200, ANSWER),
    ]);
    let keychain = signed_in("rt-1");
    let account = account(&keychain, &base);
    ask(&plan_model(&account, &format!("{base}/v1/responses"), None)).unwrap();
    let sent = server.join().unwrap().remove(1).json();
    assert!(sent.get("reasoning").is_none());
    assert_eq!(refused_fields(&sent), Vec::<&str>::new());
    assert!(!account.effort_works("gpt-6.1-sol") && !account.effort_refused("gpt-6.1-sol"));
}
