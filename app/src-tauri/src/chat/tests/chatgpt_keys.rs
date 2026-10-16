//! OpenAI's signing keys against a scripted server (how often they are
//! fetched, and when a new look is allowed), and what a renewal does with
//! the ID token it may bring: the same account carries on, another ends the
//! sign-in, keys that cannot be had do not stop it, and a sign-in from
//! before accounts were checked asks to be signed in again.

use serde_json::json;

use super::block_on;
use super::chatgpt::{account, kept, legacy, signed_in, token_with};
use super::http::client;
use super::script::{Seen, Step, always, serve_script};
use crate::chat::chatgpt::idtoken::Rejected;
use crate::chat::chatgpt::jwks::{Cache, Failed, MAX_BODY};
use crate::chat::chatgpt::oauth;
use crate::chat::chatgpt::test_keys::{
    JWKS_A, JWKS_AB, KID_A, KID_B, Signer, claims, sign, token as signed_token, with,
};

const CLIENT: &str = "oaiapp_x";

async fn check(cache: &Cache, url: &str, token: &str) -> Result<String, Failed> {
    cache
        .identity(&client(), url, token, CLIENT, Some("n"), oauth::now())
        .await
        .map(|who| who.sub)
}

fn by_a() -> String {
    signed_token(CLIENT, "n", oauth::now())
}

fn by_b() -> String {
    sign(Signer::B, Some(KID_B), &claims(CLIENT, "n", oauth::now()))
}

fn nobody() -> String {
    sign(
        Signer::A,
        Some("rotated-away"),
        &claims(CLIENT, "n", oauth::now()),
    )
}

fn serve(steps: Vec<Step>) -> (String, std::thread::JoinHandle<Vec<Seen>>) {
    let (base, server) = serve_script(steps);
    (format!("{base}/jwks"), server)
}

#[test]
fn one_fetch_serves_several_checks() {
    let (url, server) = serve(vec![always(200, JWKS_A)]);
    let cache = Cache::default();
    block_on(async {
        for _ in 0..3 {
            assert_eq!(check(&cache, &url, &by_a()).await.unwrap(), "user-1");
        }
    });
    let asked = server.join().unwrap();
    assert_eq!(asked.len(), 1);
    assert!(asked[0].head.starts_with("GET /jwks "), "{}", asked[0].head);
    assert_eq!(asked[0].header("accept"), Some("application/json"));
}

#[test]
fn after_a_rotation_an_unknown_key_earns_one_new_look() {
    let (url, server) = serve(vec![always(200, JWKS_A), always(200, JWKS_AB)]);
    let cache = Cache::default();
    block_on(async {
        assert!(check(&cache, &url, &by_a()).await.is_ok());
        // B was added since: one new fetch, and it is known from then on.
        assert!(check(&cache, &url, &by_b()).await.is_ok());
        assert!(check(&cache, &url, &by_b()).await.is_ok());
        assert!(check(&cache, &url, &by_a()).await.is_ok());
    });
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn a_key_that_stays_unknown_fails_and_is_not_asked_about_again_for_a_minute() {
    let (url, server) = serve(vec![
        always(200, JWKS_A),
        always(200, JWKS_A),
        always(200, JWKS_A),
    ]);
    let cache = Cache::default();
    block_on(async {
        let unknown = Failed::Token(Rejected::UnknownKey("rotated-away".into()));
        // The first fetch, then the one new look the unknown key earns.
        assert_eq!(check(&cache, &url, &nobody()).await, Err(unknown.clone()));
        // Within the minute: refused without a request (a request would
        // find no server, and say the keys could not be had).
        assert_eq!(check(&cache, &url, &nobody()).await, Err(unknown.clone()));
        assert_eq!(check(&cache, &url, &nobody()).await, Err(unknown.clone()));
        // Known keys are not affected.
        assert!(check(&cache, &url, &by_a()).await.is_ok());
        // A minute later it may look once more.
        cache.forget_last_look().await;
        assert_eq!(check(&cache, &url, &nobody()).await, Err(unknown));
    });
    assert_eq!(server.join().unwrap().len(), 3);
}

#[test]
fn keys_are_fetched_again_when_their_lifetime_ends() {
    let (url, server) = serve(vec![always(200, JWKS_A), always(200, JWKS_AB)]);
    let cache = Cache::default();
    block_on(async {
        assert!(check(&cache, &url, &by_a()).await.is_ok());
        cache.expire().await;
        // The new set has B, which the old one did not.
        assert!(check(&cache, &url, &by_b()).await.is_ok());
    });
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn keys_that_cannot_be_had_are_said_so_and_nothing_is_believed() {
    let big = format!("{}{}", JWKS_A, " ".repeat(MAX_BODY));
    for (answer, why) in [
        (always(503, ""), "503"),
        (always(200, "<html>"), "could not be read"),
        (always(200, big), "larger than expected"),
        (
            always(200, r#"{"keys":[{"kty":"EC","kid":"x"}]}"#),
            "no key it can use",
        ),
    ] {
        let (url, server) = serve(vec![answer]);
        let cache = Cache::default();
        let err = block_on(check(&cache, &url, &by_a())).unwrap_err();
        let Failed::Keys(message) = err else {
            panic!("{err:?}")
        };
        assert!(message.contains(why), "{why}: {message}");
        server.join().unwrap();
    }
    // Nothing listening at all.
    let err = block_on(check(&Cache::default(), "http://127.0.0.1:9/jwks", &by_a())).unwrap_err();
    assert!(
        matches!(&err, Failed::Keys(m) if m.contains("Could not reach ChatGPT")),
        "{err:?}"
    );
}

/// A renewal's answer carrying an ID token with `body` as its claims.
fn renewal(body: serde_json::Value) -> Step {
    always(
        200,
        token_with("at-1", "rt-2", &sign(Signer::A, Some(KID_A), &body)),
    )
}

#[test]
fn a_renewal_for_the_same_account_carries_on() {
    let (base, server) = serve_script(vec![
        renewal(claims(CLIENT, "ignored", oauth::now())),
        always(200, JWKS_A),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        assert_eq!(account.access(&client()).await.unwrap(), "at-1");
    });
    assert_eq!(server.join().unwrap()[1].path(), "/jwks");
    assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-2");
}

#[test]
fn a_renewal_for_another_account_ends_the_sign_in() {
    let other = with(
        &claims(CLIENT, "ignored", oauth::now()),
        "sub",
        json!("user-2"),
    );
    let (base, server) = serve_script(vec![renewal(other), always(200, JWKS_A), always(200, "")]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let err = account.access(&client()).await.unwrap_err();
        assert!(
            err.contains("another account") && err.contains("Sign in with ChatGPT again"),
            "{err}"
        );
        let status = account.status().await;
        assert!(!status.signed_in && !status.reauth && status.email.is_none());
    });
    assert!(kept(&keys).is_none(), "the sign-in is forgotten");
    let asked = server.join().unwrap();
    assert_eq!(asked[2].path(), "/revoke");
    assert_eq!(
        asked[2].form()["token"],
        "rt-2",
        "the tokens that came are given back"
    );
}

#[test]
fn a_renewal_does_not_stop_for_keys_that_cannot_be_had_and_checks_at_the_next() {
    let good = claims(CLIENT, "ignored", oauth::now());
    let (base, server) = serve_script(vec![
        // Renewal one: the keys are down.
        renewal(good.clone()),
        always(503, ""),
        // Renewal two (the first token ends at once): the keys are back, and
        // this time the ID token is for someone else.
        always(
            200,
            token_with(
                "at-2",
                "rt-3",
                &sign(Signer::A, Some(KID_A), &with(&good, "sub", json!("user-2"))),
            ),
        ),
        always(200, JWKS_A),
        always(200, ""),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        assert_eq!(account.access(&http).await.unwrap(), "at-1");
        // Make the next ask renew: after a rejection of the token held.
        let err = account.after_rejection(&http, "at-1").await.unwrap_err();
        assert!(err.contains("another account"), "{err}");
    });
    server.join().unwrap();
    assert!(kept(&keys).is_none());
}

// Before: an ID token that did not check out at a renewal threw the access token away, although the
// refresh token was already spent, so every request renewed and failed again. The answer came over TLS
// from OpenAI: its access token is used, the problem is remembered for Settings, and the check is made
// again at the next renewal. (Signing in stays strict: see chatgpt_flow.rs.)
#[test]
fn a_renewal_whose_id_token_is_not_openais_still_gives_access_and_says_so_until_a_good_one_comes() {
    let forged = sign(Signer::B, Some(KID_A), &claims(CLIENT, "x", oauth::now()));
    let good = sign(Signer::A, Some(KID_A), &claims(CLIENT, "x", oauth::now()));
    let (base, server) = serve_script(vec![
        always(200, token_with("at-1", "rt-2", &forged)),
        always(200, JWKS_A),
        // The next renewal brings a good ID token; the keys are held by now.
        always(200, token_with("at-2", "rt-3", &good)),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    block_on(async {
        let http = client();
        assert_eq!(account.access(&http).await.unwrap(), "at-1");
        let status = account.status().await;
        assert!(status.signed_in, "the sign-in itself stands");
        assert!(status.identity_unverified);
        let warning = status.warning.unwrap();
        assert!(
            warning.contains("could not be verified") && warning.contains("checked again"),
            "{warning}"
        );
        assert_eq!(
            account.after_rejection(&http, "at-1").await.unwrap(),
            "at-2"
        );
        let status = account.status().await;
        assert!(!status.identity_unverified && status.warning.is_none());
    });
    server.join().unwrap();
    assert_eq!(kept(&keys).unwrap()["refresh_token"], "rt-3");
}

#[test]
fn a_sign_in_from_before_accounts_were_checked_waits_to_be_confirmed() {
    let keys = legacy("rt-old");
    // No server at all: nothing may be asked.
    let account = account(&keys, "http://127.0.0.1:9");
    block_on(async {
        let status = account.status().await;
        assert!(!status.signed_in && status.reauth);
        assert_eq!(status.email.as_deref(), Some("me@example.com"));
        let err = account.access(&client()).await.unwrap_err();
        assert!(
            err.starts_with("Sign in with ChatGPT again to confirm the account"),
            "{err}"
        );
        let err = account.after_rejection(&client(), "x").await.unwrap_err();
        assert!(
            err.starts_with("Sign in with ChatGPT again to confirm"),
            "{err}"
        );
    });
    // The refresh token and the client stay until a new sign-in succeeds.
    let saved = kept(&keys).unwrap();
    assert_eq!(saved["refresh_token"], "rt-old");
    assert_eq!(saved["client_id"], "oaiapp_x");
    assert!(
        !crate::chat::chatgpt::signed_in(keys.as_ref()),
        "providers do not show it as signed in"
    );
    // A chat says what to do, without asking anyone.
    let err = block_on(account.access(&client())).unwrap_err();
    assert!(err.contains("choose Sign in again"), "{err}");
}
