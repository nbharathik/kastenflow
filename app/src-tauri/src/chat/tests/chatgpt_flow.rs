//! The ways a sign-in fails, in words: the browser comes back with an
//! error, no client, a refusal from the token endpoint, a missing scope or
//! an ID token for another client.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use serde_json::{Value, json};

use super::block_on;
use super::chatgpt::{account, id_token, query_of, token, visit};
use super::http::client;
use super::script::{Step, always, serve_script};
use crate::chat::chatgpt::flow::{self, SignInEnd};
use crate::secrets::MemoryKeys;

/// A sign-in whose browser comes back with `callback` (STATE stands for the
/// state it asked for) against a token endpoint that answers `steps`.
fn attempt(callback: &str, steps: Vec<Step>) -> Option<SignInEnd> {
    let (base, server) = serve_script(steps);
    let keys = Arc::new(MemoryKeys::default());
    let account = account(&keys, &base);
    let end = block_on(async {
        let http = client();
        let prepared = flow::prepare(&account, &http, 0).await.unwrap();
        let q = query_of(&prepared.url);
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
    server.join().unwrap();
    end
}

fn said(end: Option<SignInEnd>) -> String {
    match end {
        Some(SignInEnd::Failed { message }) => message,
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_ways_a_sign_in_fails_are_said_in_words() {
    assert_eq!(
        attempt("error=access_denied&state=STATE", vec![]),
        Some(SignInEnd::Denied)
    );
    assert!(said(attempt("error=server_error&state=STATE", vec![])).contains("(server_error)"));
    // No client came back, and none was kept.
    assert!(said(attempt("code=c&state=STATE", vec![])).contains("setting KastenFlow up"));

    let with_client = "code=c&state=STATE&client_id=oaiapp_1";
    let refused = attempt(
        with_client,
        vec![always(400, r#"{"error":"invalid_grant"}"#)],
    );
    assert!(said(refused).contains("Sign in again"));
    // The plan's scope was not granted.
    let identity_only = json!({"access_token": "a", "refresh_token": "r", "expires_in": 60,
        "scope": "openid profile email offline_access", "id_token": "a.b.c"});
    let end = attempt(with_client, vec![always(200, identity_only.to_string())]);
    assert!(said(end).contains("did not let KastenFlow use your plan"));
    // An ID token for another client is no sign-in.
    let mut wrong: Value = serde_json::from_str(&token("a", "r", 60)).unwrap();
    wrong["id_token"] = json!(id_token("oaiapp_other", "x"));
    let end = attempt(with_client, vec![always(200, wrong.to_string())]);
    assert!(said(end).contains("did not say who signed in"));
}
