//! A connection that hiccups must not look like a sign-out: the keychain read
//! again and remembered, a sign-in the keychain would not keep said so,
//! sign-in addresses asked for again after a minute, a client made again after
//! a connection failed, and a report of every request that holds no secret.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use serde_json::json;

use super::block_on;
use super::chatgpt::{account, signed_in, token};
use super::flaky::{Act, say, serve_acts};
use super::http::{client, provider};
use super::responses::ANSWER;
use super::retries::local;
use super::settings::ask;
use super::streams::VLLM;
use crate::chat::chatgpt::authorize::Endpoints;
use crate::chat::chatgpt::oauth::Granted;
use crate::chat::chatgpt::saved::{self, Saved};
use crate::chat::chatgpt::session::Account;
use crate::chat::clients::Shared;
use crate::chat::diagnostics::{Diagnostics, Stage};
use crate::chat::errors::FailKind;
use crate::chat::http::HttpModel;
use crate::chat::model::{Call, Message, Model};
use crate::chat::providers::{self, ProviderInput};
use crate::chat::steady::Steady;
use crate::secrets::{KeyStore, MemoryKeys};

/// A keychain that fails reads or writes when told to.
#[derive(Default)]
struct Hiccup {
    inner: MemoryKeys,
    reads_fail: AtomicBool,
    writes_fail: AtomicBool,
}

impl Hiccup {
    fn with(saved: Option<&Saved>) -> Arc<Hiccup> {
        let keys = Arc::new(Hiccup::default());
        if let Some(saved) = saved {
            saved::write(&keys.inner, saved).unwrap();
        }
        keys
    }

    fn signed_in() -> Arc<Hiccup> {
        Hiccup::with(Some(&someone()))
    }

    fn reads(&self, fail: bool) {
        self.reads_fail.store(fail, Ordering::SeqCst);
    }

    fn writes(&self, fail: bool) {
        self.writes_fail.store(fail, Ordering::SeqCst);
    }
}

impl KeyStore for Hiccup {
    fn get(&self, entry: &str) -> Result<Option<String>, String> {
        if self.reads_fail.load(Ordering::SeqCst) {
            return Err("The system keychain is not available: busy".to_owned());
        }
        self.inner.get(entry)
    }

    fn set(&self, entry: &str, key: &str) -> Result<(), String> {
        if self.writes_fail.load(Ordering::SeqCst) {
            return Err("The system keychain is not available: locked".to_owned());
        }
        self.inner.set(entry, key)
    }

    fn delete(&self, entry: &str) -> Result<(), String> {
        self.inner.delete(entry)
    }
}

fn someone() -> Saved {
    Saved {
        refresh_token: "rt-1".to_owned(),
        client_id: "oaiapp_x".to_owned(),
        email: Some("me@example.com".to_owned()),
        sub: Some("user-1".to_owned()),
    }
}

fn chatgpt_input() -> ProviderInput {
    ProviderInput {
        name: "ChatGPT".into(),
        kind: "chatgpt".into(),
        base_url: String::new(),
        model: "gpt-6.1-sol".into(),
    }
}

#[test]
fn a_keychain_that_hiccups_does_not_unsign_chatgpt_in_the_provider_list() {
    let raw = Hiccup::signed_in();
    let keys = Steady::waiting(
        Arc::clone(&raw) as Arc<dyn KeyStore>,
        vec![Duration::ZERO, Duration::ZERO],
    );
    let v = super::vault();
    providers::save(&v.kasten, &keys, chatgpt_input(), None).unwrap();
    assert!(providers::list(&v.kasten, &keys)[0].has_key);
    raw.reads(true);
    assert!(
        providers::list(&v.kasten, &keys)[0].has_key,
        "what was last seen stands while the keychain does not answer"
    );
    // The bare keychain would have said "not signed in": the problem mended.
    assert!(!providers::list(&v.kasten, raw.as_ref())[0].has_key);
}

#[test]
fn an_account_that_has_read_its_sign_in_keeps_it_when_the_keychain_stops_answering() {
    let raw = Hiccup::signed_in();
    let account = Account::new(Arc::clone(&raw) as Arc<dyn KeyStore>);
    block_on(async {
        assert!(account.status().await.signed_in);
        raw.reads(true);
        let status = account.status().await;
        assert!(status.signed_in && status.keychain_error.is_none());
        assert_eq!(status.email.as_deref(), Some("me@example.com"));
    });
}

#[test]
fn a_keychain_that_cannot_be_read_yet_is_said_so_and_asked_again() {
    let raw = Hiccup::signed_in();
    raw.reads(true);
    let account = Account::new(Arc::clone(&raw) as Arc<dyn KeyStore>);
    block_on(async {
        let status = account.status().await;
        assert!(!status.signed_in && !status.reauth);
        assert!(status.keychain_error.unwrap().contains("keychain"));
        let err = account.access(&client()).await.unwrap_err();
        assert!(err.contains("system keychain"), "{err}");
        assert!(!err.starts_with("Sign in with ChatGPT first"), "{err}");
        raw.reads(false);
        let status = account.status().await;
        assert!(status.signed_in && status.keychain_error.is_none());
    });
}

fn granted(access: &str, refresh: &str) -> Granted {
    Granted {
        access_token: access.to_owned(),
        refresh_token: Some(refresh.to_owned()),
        id_token: None,
        expires_in: Duration::from_secs(3600),
        scopes: None,
    }
}

#[test]
fn a_keychain_that_will_not_keep_the_sign_in_says_it_lasts_until_kastenflow_closes() {
    let raw = Hiccup::with(None);
    raw.writes(true);
    let account = Account::new(Arc::clone(&raw) as Arc<dyn KeyStore>);
    block_on(async {
        let kept = account.adopt(someone(), &granted("at-1", "rt-1")).await;
        assert!(!kept);
        let status = account.status().await;
        assert!(status.signed_in && status.session_only && !status.remembered);
        let warning = status.warning.unwrap();
        assert!(warning.contains("until KastenFlow closes"), "{warning}");
        assert_eq!(account.access(&client()).await.unwrap(), "at-1");
    });
}

#[test]
fn a_rotated_refresh_token_the_keychain_would_not_keep_is_still_used_by_the_next_renewal() {
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 30)),
        say(200, token("at-2", "rt-3", 3600)),
    ]);
    let raw = Hiccup::signed_in();
    let account = Arc::new(Account::at(
        Arc::clone(&raw) as Arc<dyn KeyStore>,
        super::chatgpt::endpoints(&base),
    ));
    block_on(async {
        let http = client();
        // Reading works (the sign-in is loaded), writing does not.
        assert!(account.status().await.signed_in);
        raw.writes(true);
        assert_eq!(account.access(&http).await.unwrap(), "at-1");
        let status = account.status().await;
        assert!(status.session_only && status.warning.is_some());
        // 30 seconds left is under the minute: renewed again, from the token in memory.
        assert_eq!(account.access(&http).await.unwrap(), "at-2");
    });
    let asked = server.join().unwrap();
    assert_eq!(asked[1].form()["refresh_token"], "rt-2");
}

fn discovery_document() -> String {
    json!({
        "issuer": "https://auth.openai.com",
        "authorization_endpoint": "https://auth.openai.com/api/accounts/authorize",
        "token_endpoint": "https://auth.openai.com/api/accounts/oauth/token",
        "revocation_endpoint": "https://auth.openai.com/api/accounts/oauth/revoke",
        "jwks_uri": "https://auth.openai.com/.well-known/jwks.json"
    })
    .to_string()
}

#[test]
fn a_discovery_document_that_could_not_be_had_is_asked_for_again_after_a_minute() {
    let (base, server) = serve_acts(vec![say(503, ""), say(200, discovery_document())]);
    let keys = Arc::new(MemoryKeys::default());
    let account = Account::discovering_at(keys, &format!("{base}/discovery"));
    block_on(async {
        let http = client();
        let first = account.endpoints(&http).await;
        assert_eq!(first, Endpoints::official());
        assert!(first.revoke.is_none(), "the documented ones cannot revoke");
        // Within the minute nothing is asked (the server has nothing more to say yet).
        assert_eq!(account.endpoints(&http).await, first);
        account.age_fallback();
        let found = account.endpoints(&http).await;
        assert!(found.revoke.is_some());
        // Found once, kept.
        assert_eq!(account.endpoints(&http).await, found);
    });
    assert_eq!(server.join().unwrap().len(), 2);
}

fn counting() -> (Arc<Shared>, Arc<AtomicUsize>) {
    let builds = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&builds);
    let shared = Shared::with(move || {
        counter.fetch_add(1, Ordering::SeqCst);
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|e| e.to_string())
    });
    (Arc::new(shared), builds)
}

#[test]
fn a_client_that_could_not_be_made_is_not_remembered_and_two_failures_make_one_new_client() {
    let tries = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&tries);
    let shared = Shared::with(move || {
        if counter.fetch_add(1, Ordering::SeqCst) == 0 {
            Err("no TLS today".to_owned())
        } else {
            reqwest::Client::builder()
                .no_proxy()
                .build()
                .map_err(|e| e.to_string())
        }
    });
    assert!(shared.client().is_err());
    let (_, first) = shared.get().unwrap();
    // Two requests found the same client dead: the first makes a new one, the second takes it.
    let (_, one) = shared.replace(first).unwrap();
    let (_, two) = shared.replace(first).unwrap();
    assert_eq!((one, two), (first + 1, first + 1));
    assert_eq!(tries.load(Ordering::SeqCst), 3);
}

#[test]
fn a_dropped_connection_gets_a_fresh_client_and_a_busy_server_does_not() {
    let (shared, builds) = counting();
    let (base, server) = serve_acts(vec![Act::Hangup, say(200, VLLM)]);
    let model = local(&base)
        .with_clients(Arc::clone(&shared))
        .with_report(Arc::new(Diagnostics::default()));
    ask(&model).unwrap();
    server.join().unwrap();
    assert_eq!(
        builds.load(Ordering::SeqCst),
        2,
        "made on first use, and again after the connection dropped"
    );
    let line = model.last_outcome().unwrap();
    assert!(line.ok && line.rebuilt && line.attempts == 2, "{line:?}");

    let (shared, builds) = counting();
    let (base, server) = serve_acts(vec![say(503, "{}"), say(200, VLLM)]);
    let model = local(&base).with_clients(shared);
    ask(&model).unwrap();
    server.join().unwrap();
    assert_eq!(builds.load(Ordering::SeqCst), 1, "the connection was fine");
    assert!(!model.last_outcome().unwrap().rebuilt);
}

fn say_hello(
    model: &HttpModel,
    prompt: &str,
) -> Result<crate::chat::model::Reply, Box<crate::chat::model::Failure>> {
    let thread = [Message::User(prompt.to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).map_err(Box::new)
}

#[test]
fn the_connection_report_has_numbers_and_words_and_never_a_secret() {
    let secret_body = r#"{"error":{"message":"Account me@example.com is busy, token at-SECRET"}}"#;
    let (base, server) = serve_acts(vec![
        say(200, token("at-SECRET", "rt-SECRET2", 3600)),
        say(503, secret_body),
        say(200, ANSWER),
        say(503, secret_body),
        say(503, secret_body),
        say(503, secret_body),
        say(503, secret_body),
    ]);
    let keys = signed_in("rt-SECRET1");
    let account = account(&keys, &base);
    let report = Arc::new(Diagnostics::default());
    let model = HttpModel::new(client(), &provider("chatgpt", ""), None, "gpt-6.1-sol")
        .unwrap()
        .with_account(Arc::clone(&account))
        .with_report(Arc::clone(&report))
        .at(&format!("{base}/v1/responses"));
    say_hello(&model, "my private prompt").unwrap();
    let failure = *say_hello(&model, "my private prompt").unwrap_err();
    assert_eq!(failure.kind, FailKind::Connection);
    server.join().unwrap();

    let lines = report.recent();
    assert_eq!(
        lines.len(),
        2,
        "one line for each request, the newest first"
    );
    let (failed, worked) = (&lines[0], &lines[1]);
    assert!(worked.ok && worked.stage == Stage::Stream && worked.status == Some(200));
    assert_eq!(
        (worked.provider.as_str(), worked.model.as_str()),
        ("chatgpt", "gpt-6.1-sol")
    );
    assert_eq!(worked.attempts, 2, "one 503, then the answer");
    assert!(worked.renewed && !worked.rebuilt);
    assert!(worked.first_byte_ms.is_some());
    assert!(worked.route.ends_with("/v1/responses") && !worked.route.contains("http"));
    assert!(!failed.ok && failed.stage == Stage::Request);
    assert_eq!(
        (failed.status, failed.kind),
        (Some(503), Some(FailKind::Connection))
    );
    assert_eq!((failed.attempts, failed.reason.as_str()), (4, "http 503"));
    assert!(!failed.renewed, "the token held was still good");

    let written = serde_json::to_string(&lines).unwrap();
    for secret in [
        "at-SECRET",
        "rt-SECRET",
        "me@example.com",
        "my private prompt",
        "capture",
        "Bearer",
    ] {
        assert!(!written.contains(secret), "{secret} in {written}");
    }
}

#[test]
fn the_last_outcome_of_a_model_is_the_latest_request() {
    let (base, server) = serve_acts(vec![say(200, VLLM)]);
    let model = local(&base).with_report(Arc::new(Diagnostics::default()));
    assert!(model.last_outcome().is_none());
    ask(&model).unwrap();
    server.join().unwrap();
    let line = model.last_outcome().unwrap();
    assert!(line.ok && line.attempts == 1 && line.kind.is_none() && line.reason.is_empty());
    assert_eq!(line.provider, "openai");
}
