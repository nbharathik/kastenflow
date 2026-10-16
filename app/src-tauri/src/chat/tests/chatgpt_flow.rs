//! The ways a sign-in fails, in words (the browser comes back with an error,
//! no client, a refusal from the token endpoint, a missing scope), and what
//! the ID token check decides: a token that is not OpenAI's, keys that
//! cannot be had, another account than the one kept.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;

use super::block_on;
use super::chatgpt::{
    account, id_token, kept, legacy, query_of, signed_in, token, token_with, visit,
};
use super::http::client;
use super::script::{Seen, Step, always, serve_script};
use crate::chat::chatgpt::flow::{self, OTHER_ACCOUNT, SignInEnd};
use crate::chat::chatgpt::oauth;
use crate::chat::chatgpt::test_keys::{JWKS_A, KID_A, Signer, claims, sign, with};
use crate::secrets::MemoryKeys;

type Nonce = Arc<Mutex<String>>;

/// A sign-in on `keys` whose browser comes back with `callback` (STATE
/// stands for the state it asked for) against servers that answer the
/// steps `steps` builds, given the nonce the sign-in asked for. What each
/// request asked comes back too.
fn attempt_on(
    keys: &Arc<MemoryKeys>,
    callback: &str,
    steps: impl FnOnce(&Nonce) -> Vec<Step>,
) -> (Option<SignInEnd>, Vec<Seen>) {
    let nonce = Nonce::default();
    let (base, server) = serve_script(steps(&nonce));
    let account = account(keys, &base);
    let end = block_on(async {
        let http = client();
        let prepared = flow::prepare(&account, &http, 0).await.unwrap();
        let q = query_of(&prepared.url);
        *nonce.lock().unwrap() = q["nonce"].clone();
        let finishing = tokio::spawn(async move {
            flow::finish(
                &account,
                &http,
                prepared,
                &AtomicBool::new(false),
                Duration::from_secs(30),
            )
            .await
        });
        visit(&q["redirect_uri"], &callback.replace("STATE", &q["state"])).await;
        finishing.await.unwrap()
    });
    (end, server.join().unwrap())
}

fn attempt(callback: &str, steps: Vec<Step>) -> Option<SignInEnd> {
    let keys = Arc::new(MemoryKeys::default());
    attempt_on(&keys, callback, |_| steps).0
}

/// A token endpoint step whose ID token is `build(nonce)`.
fn exchange(
    nonce: &Nonce,
    refresh: &'static str,
    build: impl Fn(&str) -> String + Send + 'static,
) -> Step {
    let nonce = Arc::clone(nonce);
    Box::new(move |_| {
        let id = build(&nonce.lock().unwrap());
        (200, token_with("at-new", refresh, &id))
    })
}

fn said(end: Option<SignInEnd>) -> String {
    match end {
        Some(SignInEnd::Failed { message }) => message,
        other => panic!("{other:?}"),
    }
}

const WITH_CLIENT: &str = "code=c&state=STATE&client_id=oaiapp_1";

#[test]
fn the_ways_a_sign_in_fails_are_said_in_words() {
    assert_eq!(
        attempt("error=access_denied&state=STATE", vec![]),
        Some(SignInEnd::Denied)
    );
    assert!(said(attempt("error=server_error&state=STATE", vec![])).contains("(server_error)"));
    // No client came back, and none was kept.
    assert!(said(attempt("code=c&state=STATE", vec![])).contains("setting KastenFlow up"));

    let refused = attempt(
        WITH_CLIENT,
        vec![always(400, r#"{"error":"invalid_grant"}"#)],
    );
    assert!(said(refused).contains("Sign in again"));
    // The plan's scope was not granted.
    let identity_only = json!({"access_token": "a", "refresh_token": "r", "expires_in": 60,
        "scope": "openid profile email offline_access", "id_token": "a.b.c"});
    let end = attempt(WITH_CLIENT, vec![always(200, identity_only.to_string())]);
    assert!(said(end).contains("did not let KastenFlow use your plan"));
    // No ID token at all: nobody is known to have signed in.
    let end = attempt(WITH_CLIENT, vec![always(200, token("a", "r", 60))]);
    assert!(said(end).contains("did not say who signed in"));
}

#[test]
fn an_id_token_that_is_not_openais_for_this_client_and_sign_in_is_no_sign_in() {
    let keys = Arc::new(MemoryKeys::default());
    let try_token = |build: Box<dyn Fn(&str) -> String + Send>| {
        let (end, sent) = attempt_on(&keys, WITH_CLIENT, |nonce| {
            vec![exchange(nonce, "rt-1", build), always(200, JWKS_A)]
        });
        assert_eq!(sent.len(), 2, "the keys were asked for");
        said(end)
    };
    // For another client.
    let message = try_token(Box::new(|nonce| id_token("oaiapp_other", nonce)));
    assert!(
        message.contains("did not say who signed in (another client)"),
        "{message}"
    );
    // For another sign-in.
    let message = try_token(Box::new(|_| id_token("oaiapp_1", "another-nonce")));
    assert!(message.contains("(another sign-in)"), "{message}");
    // Signed by a key that is not OpenAI's, whatever it claims to be.
    let message = try_token(Box::new(|nonce| {
        sign(
            Signer::B,
            Some(KID_A),
            &claims("oaiapp_1", nonce, oauth::now()),
        )
    }));
    assert!(message.contains("could not be verified"), "{message}");
    // Out of date: the clock, or a replay.
    let message = try_token(Box::new(|nonce| {
        let old = with(
            &claims("oaiapp_1", nonce, oauth::now()),
            "exp",
            json!(oauth::now() - 600),
        );
        sign(Signer::A, Some(KID_A), &old)
    }));
    assert!(
        message.contains("expired") && message.contains("date and time"),
        "{message}"
    );
    assert!(kept(&keys).is_none(), "nothing was kept from any of them");
}

#[test]
fn keys_that_cannot_be_had_fail_the_sign_in_and_keep_nothing() {
    for (answer, why) in [
        (always(503, ""), "503"),
        (always(200, "<html>"), "could not be read"),
        (always(200, r#"{"keys":[]}"#), "no key it can use"),
    ] {
        let keys = Arc::new(MemoryKeys::default());
        let (end, _) = attempt_on(&keys, WITH_CLIENT, |nonce| {
            vec![exchange(nonce, "rt-1", |n| id_token("oaiapp_1", n)), answer]
        });
        let message = said(end);
        assert!(message.contains(why), "{why}: {message}");
        assert!(kept(&keys).is_none());
    }
}

/// A sign-in for the account `sub` on `keys`, with the new refresh token
/// `rt-new`; what the servers were asked comes with how it ended. When
/// `revoked`, the script also answers the request that gives the new
/// tokens back.
fn sign_in_as(
    keys: &Arc<MemoryKeys>,
    sub: &'static str,
    revoked: bool,
) -> (Option<SignInEnd>, Vec<Seen>) {
    let callback = "code=c&state=STATE&client_id=oaiapp_x";
    attempt_on(keys, callback, |nonce| {
        let build = move |n: &str| {
            let body = with(&claims("oaiapp_x", n, oauth::now()), "sub", json!(sub));
            sign(Signer::A, Some(KID_A), &body)
        };
        let mut steps = vec![exchange(nonce, "rt-new", build), always(200, JWKS_A)];
        if revoked {
            steps.push(always(200, ""));
        }
        steps
    })
}

#[test]
fn a_sign_in_for_another_account_leaves_the_kept_one_alone() {
    let keys = signed_in("rt-old");
    let (end, sent) = sign_in_as(&keys, "user-2", true);
    assert_eq!(said(end), OTHER_ACCOUNT);
    assert_eq!(
        OTHER_ACCOUNT,
        "You signed in as another ChatGPT account; sign out first to switch"
    );
    let kept = kept(&keys).unwrap();
    assert_eq!(kept["refresh_token"], "rt-old");
    assert_eq!(kept["sub"], "user-1");
    // The tokens just issued are given back.
    assert_eq!(sent[2].path(), "/revoke");
    assert_eq!(sent[2].form()["token"], "rt-new");
}

#[test]
fn a_sign_in_for_the_same_account_replaces_the_tokens() {
    let keys = signed_in("rt-old");
    let (end, sent) = sign_in_as(&keys, "user-1", false);
    assert!(matches!(end, Some(SignInEnd::Signed { .. })), "{end:?}");
    assert_eq!(sent.len(), 2, "nothing to give back");
    let kept = kept(&keys).unwrap();
    assert_eq!(kept["refresh_token"], "rt-new");
    assert_eq!(kept["sub"], "user-1");
}

#[test]
fn an_old_sign_in_is_confirmed_by_signing_in_again() {
    let keys = legacy("rt-old");
    let (end, _) = sign_in_as(&keys, "user-9", false);
    assert!(matches!(end, Some(SignInEnd::Signed { .. })), "{end:?}");
    let kept = kept(&keys).unwrap();
    assert_eq!(kept["refresh_token"], "rt-new");
    assert_eq!(kept["client_id"], "oaiapp_x");
    assert_eq!(kept["sub"], "user-9");
}
