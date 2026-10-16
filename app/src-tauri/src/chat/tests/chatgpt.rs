//! Signing in with ChatGPT against a scripted server: the account's tokens
//! through renewals and refusals, a whole sign-in with the browser played
//! by a connection to the listener, and signing out. Nothing reaches
//! OpenAI or a real keychain.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Map, Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::block_on;
use super::http::client;
use super::script::{Step, always, serve_script};
use crate::chat::chatgpt::authorize::Endpoints;
use crate::chat::chatgpt::flow::{self, SignInEnd};
use crate::chat::chatgpt::oauth;
use crate::chat::chatgpt::pkce;
use crate::chat::chatgpt::saved::{ENTRY, Saved};
use crate::chat::chatgpt::session::{Account, HOST_ENTRY};
use crate::chat::chatgpt::test_keys::{self, JWKS_A};
use crate::secrets::{KeyStore, MemoryKeys};

pub(super) fn endpoints(base: &str) -> Endpoints {
    Endpoints {
        authorize: format!("{base}/authorize"),
        token: format!("{base}/token"),
        revoke: Some(format!("{base}/revoke")),
        jwks: format!("{base}/jwks"),
    }
}

/// A token endpoint's answer.
pub(super) fn token(access: &str, refresh: &str, expires: u64) -> String {
    json!({"access_token": access, "refresh_token": refresh, "token_type": "Bearer", "expires_in": expires,
        "scope": "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke"})
    .to_string()
}

/// A keychain that holds a sign-in, as an earlier start left it: for the
/// account `user-1`, whose ID tokens the tests sign.
pub(super) fn signed_in(refresh: &str) -> Arc<MemoryKeys> {
    keychain_with(Saved {
        refresh_token: refresh.into(),
        client_id: "oaiapp_x".into(),
        email: Some("me@example.com".into()),
        sub: Some("user-1".into()),
    })
}

/// A keychain that holds a sign-in from before accounts were checked: it
/// has no `sub`.
pub(super) fn legacy(refresh: &str) -> Arc<MemoryKeys> {
    keychain_with(Saved {
        refresh_token: refresh.into(),
        client_id: "oaiapp_x".into(),
        email: Some("me@example.com".into()),
        sub: None,
    })
}

fn keychain_with(saved: Saved) -> Arc<MemoryKeys> {
    let keys = Arc::new(MemoryKeys::default());
    // Written as the earlier version wrote it, when there is no `sub`.
    let mut text = serde_json::to_value(&saved).unwrap();
    if saved.sub.is_none() {
        text.as_object_mut().unwrap().remove("sub");
    }
    keys.set(ENTRY, &text.to_string()).unwrap();
    keys
}

pub(super) fn account(keys: &Arc<MemoryKeys>, base: &str) -> Arc<Account> {
    Arc::new(Account::at(
        Arc::clone(keys) as Arc<dyn KeyStore>,
        endpoints(base),
    ))
}

pub(super) fn kept(keys: &MemoryKeys) -> Option<Value> {
    keys.get(ENTRY)
        .unwrap()
        .map(|text| serde_json::from_str(&text).unwrap())
}

#[test]
fn a_token_is_renewed_when_it_ends_within_a_minute_and_each_new_refresh_token_is_kept() {
    let (base, server) = serve_script(vec![
        always(200, token("at-1", "rt-2", 30)),
        always(200, token("at-2", "rt-3", 3600)),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        // Nothing in memory yet: the refresh token is spent.
        assert_eq!(account.access(&http).await.unwrap(), "at-1");
        assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-2");
        // 30 seconds left is under the minute: renewed again, from the new one.
        assert_eq!(account.access(&http).await.unwrap(), "at-2");
        assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-3");
        // An hour left: no request.
        assert_eq!(account.access(&http).await.unwrap(), "at-2");
        assert_eq!(account.access(&http).await.unwrap(), "at-2");
    });
    let asked = server.join().unwrap();
    assert_eq!(asked.len(), 2, "the third and fourth needed no request");
    assert_eq!(asked[0].path(), "/token");
    assert_eq!(
        asked[0].header("content-type"),
        Some("application/x-www-form-urlencoded")
    );
    let first = asked[0].form();
    assert_eq!(first["grant_type"], "refresh_token");
    assert_eq!(
        first["client_id"], "oaiapp_x",
        "the issued client, not the registration entry"
    );
    assert_eq!(first["refresh_token"], "rt-1");
    assert_eq!(first["resource"], "https://api.openai.com/v1");
    assert!(!first.contains_key("scope"), "the grant is kept as it was");
    assert_eq!(asked[1].form()["refresh_token"], "rt-2");
}

#[test]
fn two_requests_at_once_spend_a_refresh_token_once() {
    let (base, server) = serve_script(vec![always(200, token("at-1", "rt-2", 3600))]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        let ask = |account: Arc<Account>, http: reqwest::Client| {
            tokio::spawn(async move { account.access(&http).await })
        };
        let (one, two) = (
            ask(Arc::clone(&account), http.clone()),
            ask(Arc::clone(&account), http),
        );
        assert_eq!(one.await.unwrap().unwrap(), "at-1");
        assert_eq!(two.await.unwrap().unwrap(), "at-1");
    });
    assert_eq!(server.join().unwrap().len(), 1);
}

#[test]
fn a_refusal_that_ends_the_sign_in_forgets_it_and_a_busy_server_does_not() {
    let (base, server) = serve_script(vec![
        always(503, ""),
        always(
            400,
            r#"{"error":"invalid_grant","error_description":"Refresh token reused."}"#,
        ),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        let err = account.access(&http).await.unwrap_err();
        assert!(err.contains("503") && err.contains("Try again"), "{err}");
        assert!(kept(&keys).is_some(), "nothing is lost to a busy server");
        assert!(account.status().await.signed_in);

        let err = account.access(&http).await.unwrap_err();
        assert!(
            err.contains("Sign in again") && err.contains("Settings, AI providers"),
            "{err}"
        );
        assert!(
            kept(&keys).is_none(),
            "a token that will never work is forgotten"
        );
        let status = account.status().await;
        assert!(!status.signed_in && status.email.is_none());
        // Signed out: the next request says what to do, without asking.
        let err = account.access(&http).await.unwrap_err();
        assert!(err.starts_with("Sign in with ChatGPT first"), "{err}");
    });
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn the_keychain_holds_the_refresh_token_the_client_the_email_and_the_account_only() {
    let keys = MemoryKeys::default();
    let saved = Saved {
        refresh_token: "r".repeat(1000),
        client_id: "oaiapp_".to_owned() + &"c".repeat(40),
        email: Some(format!("{}@example.com", "e".repeat(80))),
        sub: Some(format!("auth0|{}", "s".repeat(64))),
    };
    keys.set(ENTRY, &serde_json::to_string(&saved).unwrap())
        .unwrap();
    let text = keys.get(ENTRY).unwrap().unwrap();
    assert!(
        text.len() < 2048,
        "{} bytes: one credential holds little",
        text.len()
    );
    let fields: Vec<String> = serde_json::from_str::<Map<String, Value>>(&text)
        .unwrap()
        .keys()
        .cloned()
        .collect();
    assert_eq!(fields, ["refresh_token", "client_id", "email", "sub"]);
    assert!(
        !format!("{saved:?}").contains("rrrr"),
        "shown without the refresh token"
    );
    assert!(crate::chat::chatgpt::signed_in(&keys));
}

/// The browser's part: the callback request the sign-in page would send.
pub(super) async fn visit(redirect: &str, query: &str) -> String {
    let port: u16 = redirect
        .split(':')
        .nth(2)
        .unwrap()
        .split('/')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let request = format!(
        "GET /auth/callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut out = Vec::new();
    let _ = stream.read_to_end(&mut out).await;
    String::from_utf8_lossy(&out).into_owned()
}

pub(super) fn query_of(url: &str) -> HashMap<String, String> {
    reqwest::Url::parse(url)
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

/// An ID token for `client`, as OpenAI would issue it for a sign-in with
/// `nonce`: signed by the test key A, for the account `user-1`.
pub(super) fn id_token(client: &str, nonce: &str) -> String {
    test_keys::token(client, nonce, oauth::now())
}

/// A token endpoint's answer that carries `id_token`.
pub(super) fn token_with(access: &str, refresh: &str, id_token: &str) -> String {
    let mut grant: Value = serde_json::from_str(&token(access, refresh, 3600)).unwrap();
    grant["id_token"] = json!(id_token);
    grant.to_string()
}

#[test]
fn a_whole_sign_in_registers_a_client_keeps_the_refresh_token_and_shows_the_email() {
    let nonce = Arc::new(Mutex::new(String::new()));
    let exchange: Step = {
        let nonce = Arc::clone(&nonce);
        Box::new(move |_| {
            let mut grant: Value = serde_json::from_str(&token("at-1", "rt-1", 3600)).unwrap();
            grant["id_token"] = json!(id_token("oaiapp_issued", &nonce.lock().unwrap()));
            (200, grant.to_string())
        })
    };
    // The token endpoint, then OpenAI's keys to check the ID token with.
    let (base, server) = serve_script(vec![exchange, always(200, JWKS_A)]);
    let keys = Arc::new(MemoryKeys::default());
    let account = account(&keys, &base);
    let end = block_on(async {
        let http = client();
        let prepared = flow::prepare(&account, &http, 0).await.unwrap();
        let q = query_of(&prepared.url);
        assert!(prepared.url.starts_with(&format!("{base}/authorize?")));
        assert_eq!(q["client_id"], "dynamic_agent_client");
        assert_eq!(q["agent_name_hint"], "KastenFlow");
        assert_eq!(q["code_challenge_method"], "S256");
        assert!(
            q["redirect_uri"].starts_with("http://127.0.0.1:")
                && q["redirect_uri"].ends_with("/auth/callback")
        );
        // The host id is made once and kept for every later sign-in.
        assert!(q["ext_agent_host_id"].starts_with("urn:uuid:"));
        assert_eq!(
            keys.get(HOST_ENTRY).unwrap().unwrap(),
            q["ext_agent_host_id"]
        );
        *nonce.lock().unwrap() = q["nonce"].clone();

        let finishing = {
            let (account, http) = (Arc::clone(&account), http.clone());
            tokio::spawn(async move {
                flow::finish(
                    &account,
                    &http,
                    prepared,
                    &AtomicBool::new(false),
                    Duration::from_secs(30),
                )
                .await
            })
        };
        // A request with another state is somebody else's, then the real one.
        assert!(
            visit(&q["redirect_uri"], "code=stolen&state=wrong")
                .await
                .starts_with("HTTP/1.1 400")
        );
        let real = format!("code=the-code&state={}&client_id=oaiapp_issued", q["state"]);
        let page = visit(&q["redirect_uri"], &real).await;
        assert!(page.contains("You can close this tab"));
        let end = finishing.await.unwrap();

        // The verifier that went to the token endpoint is the one the page
        // was asked to challenge.
        let sent = server.join().unwrap();
        let form = sent[0].form();
        assert_eq!(pkce::challenge(&form["code_verifier"]), q["code_challenge"]);
        assert_eq!(form["grant_type"], "authorization_code");
        assert_eq!(
            (form["client_id"].as_str(), form["code"].as_str()),
            ("oaiapp_issued", "the-code")
        );
        assert_eq!(form["redirect_uri"], q["redirect_uri"]);
        assert_eq!(form["resource"], "https://api.openai.com/v1");
        assert!(!form.contains_key("client_secret"));
        assert_eq!(
            sent[1].path(),
            "/jwks",
            "the ID token is checked against OpenAI's keys"
        );
        // Signed in: the status says whom, and the token is in memory.
        let status = account.status().await;
        assert_eq!(
            (status.signed_in, status.email.as_deref(), status.remembered),
            (true, Some("me@example.com"), true)
        );
        assert_eq!(account.access(&http).await.unwrap(), "at-1");
        end
    });
    assert_eq!(
        end,
        Some(SignInEnd::Signed {
            email: Some("me@example.com".into()),
            remembered: true
        })
    );
    assert_eq!(
        kept(&keys).unwrap(),
        json!({"refresh_token": "rt-1", "client_id": "oaiapp_issued", "email": "me@example.com", "sub": "user-1"}),
        "access and ID tokens stay in memory"
    );
}

#[test]
fn a_later_sign_in_reuses_the_issued_client_and_starts_from_the_email() {
    let keys = signed_in("rt-old");
    let account = account(&keys, "http://127.0.0.1:9");
    let prepared = block_on(flow::prepare(&account, &client(), 0)).unwrap();
    let q = query_of(&prepared.url);
    assert_eq!(q["client_id"], "oaiapp_x");
    assert!(!q.contains_key("agent_name_hint"));
    assert_eq!(q["login_hint"], "me@example.com");
}

#[test]
fn signing_out_forgets_at_once_and_asks_openai_to_end_the_sign_in() {
    let (base, server) = serve_script(vec![always(200, "")]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    assert!(block_on(account.sign_out(&client())));
    assert!(kept(&keys).is_none());
    let asked = server.join().unwrap();
    assert_eq!(asked[0].path(), "/revoke");
    let form = asked[0].form();
    assert_eq!(
        (
            form["token"].as_str(),
            form["token_type_hint"].as_str(),
            form["client_id"].as_str()
        ),
        ("rt-1", "refresh_token", "oaiapp_x")
    );
    // Nothing to end the second time.
    assert!(!block_on(account.sign_out(&client())));
}
