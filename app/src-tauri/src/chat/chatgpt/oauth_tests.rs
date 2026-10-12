use serde_json::json;

use super::*;

#[test]
fn reads_a_token_response_and_hides_it_when_shown() {
    let body = r#"{"access_token":"at-secret","refresh_token":"rt-secret","id_token":"a.b.c",
        "token_type":"Bearer","expires_in":3600,
        "scope":"chatgpt.tokens.use.direct email offline_access openid profile resource.invoke",
        "earliest_refresh_at":"2026-10-06T10:00:00Z"}"#;
    let grant = read_grant(body).unwrap();
    assert_eq!(grant.access_token, "at-secret");
    assert_eq!(grant.refresh_token.as_deref(), Some("rt-secret"));
    assert_eq!(grant.expires_in, Duration::from_secs(3600));
    assert!(grant.plan_use());
    let shown = format!("{grant:?}");
    assert!(
        !shown.contains("secret") && !shown.contains("a.b.c"),
        "{shown}"
    );

    // A refresh may leave the scope and the new refresh token out.
    let refresh =
        read_grant(r#"{"access_token":"at2","token_type":"bearer","expires_in":60}"#).unwrap();
    assert_eq!((refresh.refresh_token, refresh.scopes), (None, None));

    // Without the plan scope the answer is no use for chat.
    let identity_only =
        read_grant(r#"{"access_token":"a","scope":"openid profile email"}"#).unwrap();
    assert!(!identity_only.plan_use());

    for bad in [
        "{}",
        "nope",
        r#"{"access_token":""}"#,
        r#"{"access_token":"a","token_type":"mac"}"#,
        r#"{"access_token":"a","expires_in":0}"#,
    ] {
        assert!(read_grant(bad).is_err(), "{bad}");
    }
}

#[test]
fn a_refusal_says_whether_signing_in_again_is_the_way_on() {
    for body in [
        r#"{"error":"invalid_grant","error_description":"Refresh token reused."}"#,
        r#"{"error":{"code":"refresh_token_reused","message":"Used already"}}"#,
        r#"{"error":"invalid_client"}"#,
        r#"{"code":"refresh_token_expired"}"#,
    ] {
        let Refused::Invalid(words) = refusal(400, body) else {
            panic!("{body}");
        };
        assert!(words.contains("Sign in again"), "{words}");
    }
    let reused = r#"{"error":"invalid_grant","error_description":"Refresh token reused."}"#;
    let Refused::Invalid(words) = refusal(400, reused) else {
        panic!()
    };
    assert_eq!(
        words,
        "ChatGPT no longer accepts this sign-in (invalid_grant): Refresh token reused. Sign in again"
    );
    // A busy or broken server loses nothing.
    for (status, body) in [
        (503, ""),
        (500, r#"{"error":"server_error"}"#),
        (429, "slow down"),
        (400, r#"{"error":"invalid_request"}"#),
    ] {
        assert!(
            matches!(refusal(status, body), Refused::Unavailable(_)),
            "{status} {body}"
        );
    }
}

fn id_token(claims: &serde_json::Value) -> String {
    let part = |value: &serde_json::Value| URL_SAFE_NO_PAD.encode(value.to_string());
    format!(
        "{}.{}.signature",
        part(&json!({"alg": "RS256"})),
        part(claims)
    )
}

#[test]
fn the_id_token_names_the_account_and_is_checked_for_this_sign_in() {
    let claims = json!({
        "iss": "https://auth.openai.com", "aud": "oaiapp_abc", "sub": "user-1",
        "exp": 2_000_000_000u64, "nonce": "n-1", "email": " me@example.com "
    });
    let token = id_token(&claims);
    let who = identity(&token, "oaiapp_abc", Some("n-1"), 1_900_000_000).unwrap();
    assert_eq!(
        who,
        Identity {
            email: Some("me@example.com".into())
        }
    );
    // Without a nonce to compare (a refresh), the rest is still checked.
    assert!(identity(&token, "oaiapp_abc", None, 1_900_000_000).is_ok());

    let with = |key: &str, value: serde_json::Value| {
        let mut changed = claims.clone();
        changed[key] = value;
        id_token(&changed)
    };
    let cases = [
        (
            "another issuer",
            with("iss", json!("https://evil.example")),
            Some("n-1"),
        ),
        (
            "another client",
            with("aud", json!("oaiapp_other")),
            Some("n-1"),
        ),
        (
            "another client",
            with("aud", json!(["a", "b"])),
            Some("n-1"),
        ),
        ("expired", with("exp", json!(1_000_000_000u64)), Some("n-1")),
        ("another sign-in", token.clone(), Some("n-2")),
        ("no account", with("sub", json!("")), Some("n-1")),
        ("no claims", "only-one-part".to_owned(), None),
        ("unreadable", "a.!!!.c".to_owned(), None),
    ];
    for (why, token, nonce) in cases {
        let err = identity(&token, "oaiapp_abc", nonce, 1_900_000_000).unwrap_err();
        assert!(err.contains(why), "{why}: {err}");
    }
    // An audience list that names this client is fine; no email is fine.
    let listed = id_token(
        &json!({"iss": ISSUER, "aud": ["x", "oaiapp_abc"], "sub": "u", "exp": 2_000_000_000u64}),
    );
    assert_eq!(
        identity(&listed, "oaiapp_abc", None, 1).unwrap().email,
        None
    );
    // A nonce the token lacks fails when one is expected.
    assert!(identity(&listed, "oaiapp_abc", Some("n"), 1).is_err());
}

#[test]
fn encodes_a_form() {
    let pairs = [
        ("client_id", "oaiapp_a"),
        ("redirect_uri", "http://127.0.0.1:1/auth/callback"),
        ("code", "a b&c=d"),
    ];
    assert_eq!(
        form(&pairs),
        "client_id=oaiapp_a&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2Fauth%2Fcallback&code=a+b%26c%3Dd"
    );
}
