//! Renewing the access token must never lose the refresh token the server
//! rotated, never sign anyone out because of a bad connection, and never
//! throw away a good access token because the ID token that came with it
//! could not be checked.

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde_json::json;

use super::block_on;
use super::chatgpt::{account, kept, signed_in, token, token_with};
use super::flaky::{Act, say, serve_acts};
use super::http::client;
use super::script::{Step, always, serve_script};
use crate::chat::chatgpt::oauth;
use crate::chat::chatgpt::session::Account;
use crate::chat::chatgpt::test_keys::{JWKS_A, KID_A, Signer, claims, sign, with};

const CLIENT: &str = "oaiapp_x";

/// A token endpoint that takes `ms` to answer.
fn slow(ms: u64, access: &'static str, refresh: &'static str) -> Step {
    Box::new(move |_| {
        thread::sleep(Duration::from_millis(ms));
        (200, token(access, refresh, 3600))
    })
}

#[test]
fn a_renewal_the_caller_gave_up_on_still_keeps_the_new_refresh_token() {
    let (base, server) = serve_script(vec![slow(400, "at-1", "rt-2")]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        // The caller stops waiting after 50 ms: Stop pressed, or the idle limit.
        let gone = tokio::time::timeout(Duration::from_millis(50), account.access(&http)).await;
        assert!(gone.is_err());
        // The server rotated the token anyway; the renewal finishes on its own.
        tokio::time::sleep(Duration::from_millis(900)).await;
        assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-2");
        // And the next caller needs no second renewal.
        assert_eq!(account.access(&http).await.unwrap(), "at-1");
    });
    assert_eq!(server.join().unwrap().len(), 1);
}

#[test]
fn a_caller_that_comes_while_a_renewal_runs_shares_it_even_when_the_first_left() {
    let (base, server) = serve_script(vec![slow(400, "at-1", "rt-2")]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        let first = tokio::time::timeout(Duration::from_millis(50), account.access(&http)).await;
        assert!(first.is_err());
        assert_eq!(account.access(&http).await.unwrap(), "at-1");
    });
    assert_eq!(
        server.join().unwrap().len(),
        1,
        "one refresh token, spent once"
    );
    assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-2");
}

#[test]
fn six_callers_at_once_spend_one_refresh_token_once() {
    let (base, server) = serve_script(vec![slow(250, "at-1", "rt-2")]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        let ask = |account: Arc<Account>, http: reqwest::Client| {
            tokio::spawn(async move { account.access(&http).await })
        };
        let callers: Vec<_> = (0..6)
            .map(|_| ask(Arc::clone(&account), http.clone()))
            .collect();
        for caller in callers {
            assert_eq!(caller.await.unwrap().unwrap(), "at-1");
        }
    });
    assert_eq!(server.join().unwrap().len(), 1);
}

#[test]
fn a_connection_that_fails_never_signs_anyone_out() {
    // Nothing listening, a server that hangs up, and answers that are not a refusal of the token.
    let keys = signed_in("rt-1");
    let account_down = account(&keys, "http://127.0.0.1:9");
    block_on(async {
        let err = account_down.access(&client()).await.unwrap_err();
        assert!(err.contains("Could not reach ChatGPT"), "{err}");
        assert!(account_down.status().await.signed_in);
    });
    assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-1");

    let (base, server) = serve_acts(vec![Act::Hangup]);
    let keys = signed_in("rt-1");
    let account_hung = account(&keys, &base);
    block_on(async {
        assert!(account_hung.access(&client()).await.is_err());
        assert!(account_hung.status().await.signed_in);
    });
    server.join().unwrap();
    assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-1");

    for (status, body) in [
        (503, ""),
        (500, r#"{"error":"server_error"}"#),
        (429, r#"{"error":"rate_limited"}"#),
        (403, "<html><title>Just a moment...</title></html>"),
        (
            400,
            r#"{"error":"invalid_request","error_description":"Missing parameter"}"#,
        ),
        (401, ""),
    ] {
        let (base, server) = serve_script(vec![always(status, body)]);
        let keys = signed_in("rt-1");
        let account = account(&keys, &base);
        block_on(async {
            assert!(account.access(&client()).await.is_err(), "{status}");
            assert!(account.status().await.signed_in, "{status}");
        });
        server.join().unwrap();
        assert_eq!(
            kept(&keys).unwrap()["refresh_token"],
            "rt-1",
            "{status} {body}"
        );
    }
}

#[test]
fn only_a_refusal_of_the_token_itself_signs_out() {
    for (status, body) in [
        (
            400,
            r#"{"error":"invalid_grant","error_description":"Token reused"}"#,
        ),
        (
            400,
            r#"{"error":{"code":"refresh_token_reused","message":"Your refresh token has already been used"}}"#,
        ),
        (401, r#"{"error":"invalid_client"}"#),
        (400, r#"{"error":"unauthorized_client"}"#),
        (
            400,
            r#"{"error":{"message":"Your refresh token has expired. Please sign in again."}}"#,
        ),
    ] {
        let (base, server) = serve_script(vec![always(status, body)]);
        let keys = signed_in("rt-1");
        let account = account(&keys, &base);
        block_on(async {
            let err = account.access(&client()).await.unwrap_err();
            assert!(err.contains("Settings, AI providers"), "{body}: {err}");
            assert!(!account.status().await.signed_in, "{body}");
        });
        server.join().unwrap();
        assert!(kept(&keys).is_none(), "{body}");
    }
}

/// A renewal's answer with this ID token, and the keys to check it with.
fn renewal(id_token: &str, keys_asked: usize) -> Vec<Step> {
    let mut steps = vec![always(200, token_with("at-1", "rt-2", id_token))];
    steps.extend((0..keys_asked).map(|_| always(200, JWKS_A)));
    steps
}

#[test]
fn an_id_token_that_cannot_be_checked_does_not_cost_the_access_token() {
    let now = oauth::now();
    let good = claims(CLIENT, "x", now);
    let cases = [
        (
            "someone else's signature",
            sign(Signer::B, Some(KID_A), &good),
            1,
        ),
        (
            "a clock that is hours off",
            sign(Signer::A, Some(KID_A), &claims(CLIENT, "x", now - 7200)),
            1,
        ),
        (
            "a key that was rotated away",
            sign(Signer::A, Some("rotated-away"), &good),
            2,
        ),
        (
            "another client",
            sign(Signer::A, Some(KID_A), &claims("oaiapp_other", "x", now)),
            1,
        ),
        (
            "no account in it",
            sign(Signer::A, Some(KID_A), &with(&good, "sub", json!(""))),
            1,
        ),
        ("something that is not a token", "not.a.token".to_owned(), 1),
    ];
    for (why, id_token, asked) in cases {
        let (base, _server) = serve_script(renewal(&id_token, asked));
        let keys = signed_in("rt-1");
        let account = account(&keys, &base);
        block_on(async {
            assert_eq!(
                account.access(&client()).await.unwrap(),
                "at-1",
                "{why}: the token came over TLS from OpenAI and works"
            );
            assert!(account.status().await.signed_in, "{why}");
        });
        assert_eq!(
            kept(&keys).unwrap()["refresh_token"],
            "rt-2",
            "{why}: the new refresh token is kept"
        );
    }
}

#[test]
fn a_different_account_that_was_verified_still_ends_the_sign_in() {
    let other = with(&claims(CLIENT, "x", oauth::now()), "sub", json!("user-2"));
    let id_token = sign(Signer::A, Some(KID_A), &other);
    let mut steps = renewal(&id_token, 1);
    steps.push(always(200, ""));
    let (base, server) = serve_script(steps);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let err = account.access(&client()).await.unwrap_err();
        assert!(err.contains("another account"), "{err}");
        assert!(!account.status().await.signed_in);
    });
    assert!(kept(&keys).is_none());
    assert_eq!(server.join().unwrap()[2].path(), "/revoke");
}

#[test]
fn signing_out_while_a_renewal_runs_is_not_undone_by_it() {
    let (base, _server) = serve_script(vec![slow(400, "at-1", "rt-2"), always(200, "")]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        let running = {
            let (account, http) = (Arc::clone(&account), http.clone());
            tokio::spawn(async move { account.access(&http).await })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        account.sign_out(&http).await;
        let _ = running.await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!account.status().await.signed_in);
    });
    assert!(kept(&keys).is_none(), "the renewal did not bring it back");
}

#[test]
fn a_busy_token_server_is_asked_again_by_the_next_request_and_a_hangup_is_not_a_refusal() {
    let (base, server) = serve_acts(vec![
        say(503, ""),
        Act::Hangup,
        say(200, token("at-1", "rt-2", 3600)),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        assert!(account.access(&http).await.is_err());
        assert!(account.access(&http).await.is_err());
        assert_eq!(account.access(&http).await.unwrap(), "at-1");
    });
    assert_eq!(server.join().unwrap().len(), 3);
}
