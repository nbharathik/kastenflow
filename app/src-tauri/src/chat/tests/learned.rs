//! What a ChatGPT request finds out about a model (the route will not take
//! its reasoning effort, or its encrypted reasoning, or tools listed one by
//! one) is about that model and that part only, is said once, and is kept in
//! the cache folder for the account, so it is not found out again at every
//! start.

use std::fs;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use serde_json::{Value, json};

use super::block_on;
use super::chatgpt::{account, signed_in, token};
use super::flaky::{say, serve_acts};
use super::http::{client, provider};
use super::responses::ANSWER;
use crate::chat::capabilities::{Applied, Effort};
use crate::chat::chatgpt::session::Account;
use crate::chat::http::HttpModel;
use crate::chat::model::{Call, Message, Model};
use crate::chat::responses::Shape;

const REFUSED_EFFORT: &str = r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"reasoning.effort","message":"Unsupported parameter"}}"#;
const REFUSED_INCLUDE: &str = r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"include","message":"Unsupported value: reasoning.encrypted_content"}}"#;

fn model(account: &Arc<Account>, base: &str, name: &str) -> HttpModel {
    HttpModel::new(client(), &provider("chatgpt", ""), None, name)
        .unwrap()
        .with_account(Arc::clone(account))
        .with_settings(Applied {
            effort: Some(Effort::High),
            ..Applied::default()
        })
        .at(&format!("{base}/v1/responses"))
}

fn ask(model: &HttpModel) {
    let thread = [Message::User("Hello".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).unwrap();
}

fn sent(request: &super::script::Seen) -> Value {
    request.json()
}

#[test]
fn what_a_model_turned_down_is_not_asked_again_at_the_next_start_or_of_another_model() {
    let dir = std::env::temp_dir().join(format!("kasten-learned-requests-{}", std::process::id()));
    let keys = signed_in("rt-1");

    // One run: the route turns the effort down once.
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 3600)),
        say(400, REFUSED_EFFORT),
        say(200, ANSWER),
    ]);
    let first = account(&keys, &base);
    first.learn_in(dir.clone());
    ask(&model(&first, &base, "gpt-6.1-sol"));
    server.join().unwrap();

    // The next start: the same model goes without it at once, another model does not.
    let (base, server) = serve_acts(vec![
        say(200, token("at-2", "rt-3", 3600)),
        say(200, ANSWER),
        say(200, ANSWER),
    ]);
    let second = account(&keys, &base);
    second.learn_in(dir.clone());
    let same = model(&second, &base, "gpt-6.1-sol");
    ask(&same);
    assert_eq!(same.take_notice(), None, "it is known; nothing to say");
    ask(&model(&second, &base, "gpt-6-luna"));
    let asked = server.join().unwrap();
    assert!(sent(&asked[1]).get("reasoning").is_none());
    assert_eq!(sent(&asked[2])["reasoning"], json!({"effort": "high"}));

    // Someone else signed in on this computer does not inherit it.
    let other = Arc::new(crate::secrets::MemoryKeys::default());
    let someone = crate::chat::chatgpt::saved::Saved {
        refresh_token: "rt-9".into(),
        client_id: "oaiapp_x".into(),
        email: None,
        sub: Some("user-2".into()),
    };
    crate::chat::chatgpt::saved::write(other.as_ref(), &someone).unwrap();
    let (base, server) = serve_acts(vec![
        say(200, token("at-3", "rt-10", 3600)),
        say(200, ANSWER),
    ]);
    let third = account(&other, &base);
    third.learn_in(dir.clone());
    ask(&model(&third, &base, "gpt-6.1-sol"));
    let asked = server.join().unwrap();
    assert_eq!(sent(&asked[1])["reasoning"], json!({"effort": "high"}));
    // Only this test's own folder under the system temp folder.
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn each_part_that_goes_is_said_once_in_plain_words() {
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 3600)),
        say(400, REFUSED_INCLUDE),
        say(200, ANSWER),
        say(200, ANSWER),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let model = model(&account, &base, "gpt-6.1-sol");
    ask(&model);
    let said = model.take_notice().unwrap();
    assert!(
        said.contains("doesn't keep its reasoning between steps"),
        "{said}"
    );
    // Known now: the next request leaves it out at once and says nothing more.
    ask(&model);
    assert_eq!(model.take_notice(), None);
    let asked = server.join().unwrap();
    assert!(sent(&asked[2]).get("include").is_none());
    assert!(sent(&asked[3]).get("include").is_none());
    assert_eq!(sent(&asked[3])["reasoning"], json!({"effort": "high"}));
}

#[test]
fn the_parameter_the_server_names_is_read_before_its_words() {
    // The words speak of tools; the parameter says it is `include`.
    let body = r#"{"error":{"code":"unsupported_parameter","param":"include","message":"Unsupported parameter: include. Tool calls are unaffected."}}"#;
    let next = Shape::default().adapted(body, true).unwrap();
    assert_eq!(
        next,
        Shape {
            reasoning: false,
            ..Shape::default()
        }
    );
    // A parameter that names nothing known leaves the words to say.
    let body = r#"{"error":{"code":"unsupported_parameter","param":"parallel_tool_calls","message":"Unsupported parameter: tools"}}"#;
    assert!(Shape::default().adapted(body, true).unwrap().namespaced);
    // The effort named by its code alone, with no parameter, is still found by its words.
    let body = r#"{"error":{"code":"unknown_parameter","message":"Unknown parameter: 'reasoning.effort'."}}"#;
    assert!(!Shape::default().adapted(body, true).unwrap().effort);
}
