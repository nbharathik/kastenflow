//! What kind of failure each way a request can fail is: told apart by what
//! the provider said, by a server that cannot be reached, by a sign-in that
//! is gone or busy; and that the kind, and a notice about how the request was
//! made, travel to the window with the turn's events.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use super::block_on;
use super::chatgpt::{account, signed_in, token};
use super::http::{client, provider};
use super::script::{always, serve_script};
use super::settings::ask;
use super::{Fake, Step, vault};
use crate::chat::errors::{FailKind, classify};
use crate::chat::http::HttpModel;
use crate::chat::model::{Call, Failure, Model, Reply, Stop};
use crate::chat::threads::{self, Chats};
use crate::chat::{ChatEvent, EventKind, Events};

const EFFORT_REFUSED: &str = "This model doesn't take a reasoning effort; sent without it.";

fn failure_of(status: u16, body: &str, kind: &str) -> Failure {
    // A refusal that passes is asked for again, so the server says it every time.
    let tries = if crate::chat::errors::passes(status, body) {
        4
    } else {
        1
    };
    let (base, server) = serve_script((0..tries).map(|_| always(status, body)).collect());
    let model = HttpModel::new(client(), &provider(kind, &base), Some("sk-x".into()), "m").unwrap();
    let failure = *ask(&model).unwrap_err();
    server.join().unwrap();
    failure
}

const NOT_FOUND: &str =
    r#"{"type":"error","error":{"type":"not_found_error","message":"model: claude-x"}}"#;
const SLOW_DOWN: &str = r#"{"error":{"type":"rate_limit_error","message":"slow down"}}"#;
const BAD_KEY: &str = r#"{"error":{"message":"invalid x-api-key"}}"#;
const TOO_LONG: &str = r#"{"error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}"#;

#[test]
fn a_refused_request_is_told_apart_by_what_the_provider_said() {
    let cases: [(u16, &str, FailKind); 13] = [
        (401, BAD_KEY, FailKind::Permission),
        (
            403,
            r#"{"error":{"message":"forbidden"}}"#,
            FailKind::Permission,
        ),
        (404, NOT_FOUND, FailKind::ModelUnavailable),
        (
            400,
            r#"{"error":{"code":"model_not_found","message":"The model `x` does not exist"}}"#,
            FailKind::ModelUnavailable,
        ),
        (
            403,
            r#"{"error":{"message":"The model `gpt-9` does not exist or you do not have access to it"}}"#,
            FailKind::ModelUnavailable,
        ),
        (429, SLOW_DOWN, FailKind::RateLimited),
        (400, TOO_LONG, FailKind::TooLong),
        (
            400,
            r#"{"error":{"code":"context_length_exceeded","message":"This model's maximum context length is 8192 tokens"}}"#,
            FailKind::TooLong,
        ),
        (413, "", FailKind::TooLong),
        (503, "", FailKind::Connection),
        (
            529,
            r#"{"error":{"type":"overloaded_error"}}"#,
            FailKind::Connection,
        ),
        (500, r#"{"error":{"message":"internal"}}"#, FailKind::Other),
        (
            400,
            r#"{"error":{"message":"messages: roles must alternate"}}"#,
            FailKind::Other,
        ),
    ];
    for (status, body, kind) in cases {
        assert_eq!(classify(status, body), kind, "{status} {body}");
    }
    // Through a real request and its error message.
    let failure = failure_of(404, NOT_FOUND, "anthropic");
    assert_eq!(failure.kind, FailKind::ModelUnavailable);
    assert!(failure.message.contains("404"), "{}", failure.message);
    assert_eq!(
        failure_of(429, SLOW_DOWN, "openai").kind,
        FailKind::RateLimited
    );
    assert_eq!(
        failure_of(401, BAD_KEY, "openai").kind,
        FailKind::Permission
    );
    assert_eq!(
        failure_of(400, TOO_LONG, "anthropic").kind,
        FailKind::TooLong
    );
}

#[test]
fn a_server_that_cannot_be_reached_is_a_connection_failure() {
    let model = HttpModel::new(
        client(),
        &provider("openai", "http://127.0.0.1:9/v1"),
        None,
        "m",
    )
    .unwrap();
    let failure = *ask(&model).unwrap_err();
    assert_eq!(failure.kind, FailKind::Connection);
    assert!(
        failure.message.starts_with("Could not reach"),
        "{}",
        failure.message
    );
}

#[test]
fn the_plans_refusals_are_told_apart_too() {
    let cases = [
        (
            429,
            r#"{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}"#,
            FailKind::RateLimited,
        ),
        (
            403,
            r#"{"error":{"code":"subscription_sharing_user_not_eligible"}}"#,
            FailKind::Permission,
        ),
        // Not a 400, so nothing is dropped and asked again.
        (
            422,
            r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"tools[0]"}}"#,
            FailKind::Other,
        ),
        (
            400,
            r#"{"error":{"code":"model_not_found","message":"gone"}}"#,
            FailKind::ModelUnavailable,
        ),
    ];
    for (status, body, kind) in cases {
        let (base, server) = serve_script(vec![
            always(200, token("at-1", "rt-2", 3600)),
            always(status, body),
        ]);
        let keychain = signed_in("rt-1");
        let account = account(&keychain, &base);
        let model = HttpModel::new(client(), &provider("chatgpt", ""), None, "gpt-6.1-sol")
            .unwrap()
            .with_account(account)
            .at(&format!("{base}/v1/responses"));
        let failure = *ask(&model).unwrap_err();
        assert_eq!(failure.kind, kind, "{body}");
        server.join().unwrap();
    }
}

#[test]
fn a_sign_in_that_is_gone_is_a_permission_failure_and_a_busy_one_a_connection_failure() {
    let keychain = Arc::new(crate::secrets::MemoryKeys::default());
    let gone = account(&keychain, "http://127.0.0.1:9");
    let model = HttpModel::new(client(), &provider("chatgpt", ""), None, "gpt-6.1-sol")
        .unwrap()
        .with_account(gone)
        .at("http://127.0.0.1:9/v1/responses");
    assert_eq!(ask(&model).unwrap_err().kind, FailKind::Permission);

    let (base, server) = serve_script(vec![always(503, "")]);
    let keychain = signed_in("rt-1");
    let busy = account(&keychain, &base);
    let model = HttpModel::new(client(), &provider("chatgpt", ""), None, "gpt-6.1-sol")
        .unwrap()
        .with_account(busy)
        .at(&format!("{base}/v1/responses"));
    assert_eq!(ask(&model).unwrap_err().kind, FailKind::Connection);
    server.join().unwrap();
}

/// A model that fails the way it is told to, or answers and has a notice.
struct Scripted {
    fail: Option<FailKind>,
    notice: std::sync::Mutex<Option<String>>,
}

impl Scripted {
    fn failing(kind: FailKind) -> Scripted {
        Scripted {
            fail: Some(kind),
            notice: Default::default(),
        }
    }

    fn answering() -> Scripted {
        Scripted {
            fail: None,
            notice: Default::default(),
        }
    }

    fn saying(self, notice: &str) -> Scripted {
        *self.notice.lock().unwrap() = Some(notice.to_owned());
        self
    }
}

impl Model for Scripted {
    fn take_notice(&self) -> Option<String> {
        self.notice.lock().unwrap().take()
    }

    async fn reply(
        &self,
        _call: &Call<'_>,
        _text: &(dyn Fn(&str) + Sync),
        _cancel: &AtomicBool,
    ) -> Result<Reply, Failure> {
        match self.fail {
            Some(kind) => Err(Failure::new("It failed").of(kind)),
            None => Ok(Reply {
                text: "Done.".to_owned(),
                calls: vec![],
                stop: Stop::End,
                blocks: None,
                items: None,
            }),
        }
    }
}

fn run(model: Scripted) -> Vec<ChatEvent> {
    let v = vault();
    let chats = Chats::default();
    let seen = super::Seen::new();
    let events: Arc<dyn Events> = seen.clone();
    let (_, work) = threads::send(
        &chats,
        Arc::clone(&v.kasten),
        events,
        model,
        super::turns::request("c1", "Hello"),
    )
    .unwrap();
    block_on(work);
    seen.all()
}

#[test]
fn the_kind_of_failure_travels_to_the_window_with_the_error() {
    for kind in [
        FailKind::Connection,
        FailKind::ModelUnavailable,
        FailKind::Permission,
        FailKind::RateLimited,
        FailKind::TooLong,
        FailKind::Refused,
        FailKind::Other,
    ] {
        let events = run(Scripted::failing(kind));
        let last = events.last().unwrap();
        assert_eq!(last.kind, EventKind::Error);
        assert_eq!(last.error_kind, Some(kind));
        assert_eq!(last.error.as_deref(), Some("It failed"));
    }
    // And on the wire, in the window's words.
    let event = run(Scripted::failing(FailKind::TooLong)).pop().unwrap();
    assert_eq!(
        serde_json::to_value(&event).unwrap()["errorKind"],
        "tooLong"
    );
    let done = run(Scripted::answering()).pop().unwrap();
    assert!(
        serde_json::to_value(&done)
            .unwrap()
            .get("errorKind")
            .is_none()
    );
}

#[test]
fn the_turn_that_ends_for_other_reasons_has_its_kind_as_well() {
    let v = vault();
    for (stop, kind) in [
        (Stop::Refusal, FailKind::Refused),
        (Stop::Full, FailKind::TooLong),
    ] {
        let chats = Chats::default();
        let model = Fake::new(vec![Step::Reply("Hm.", vec![], stop)]);
        let seen = super::Seen::new();
        super::turns::turn(
            &chats,
            &v,
            &model,
            &seen,
            super::turns::request("c1", "Hello"),
        );
        let last = seen.last();
        assert_eq!(
            (last.kind, last.error_kind),
            (EventKind::Error, Some(kind)),
            "{stop:?}"
        );
    }
}

#[test]
fn a_notice_from_the_model_reaches_the_window_before_the_end_of_the_turn() {
    let events = run(Scripted::answering().saying(EFFORT_REFUSED));
    let kinds: Vec<EventKind> = events.iter().map(|e| e.kind).collect();
    assert_eq!(
        kinds,
        [EventKind::Round, EventKind::Notice, EventKind::Done]
    );
    assert_eq!(events[1].text.as_deref(), Some(EFFORT_REFUSED));
    assert_eq!(serde_json::to_value(&events[1]).unwrap()["kind"], "notice");
    // Also when the request fails: the person learns what was changed.
    let events = run(Scripted::failing(FailKind::Other).saying("A thing."));
    assert_eq!(events[1].kind, EventKind::Notice);
}
