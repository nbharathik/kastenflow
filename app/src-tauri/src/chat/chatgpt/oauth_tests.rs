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

#[test]
fn only_a_verdict_on_the_token_itself_ends_the_sign_in() {
    // Spent, by its code or in words, as a client error.
    for (status, body) in [
        (400, r#"{"error":"invalid_grant"}"#),
        (401, r#"{"error":"invalid_client"}"#),
        (403, r#"{"error":"invalid_grant"}"#),
        (400, r#"{"error":"unauthorized_client"}"#),
        (
            400,
            r#"{"error":{"code":"refresh_token_revoked","message":"Revoked"}}"#,
        ),
        (
            400,
            r#"{"error":{"message":"Your refresh token has expired. Please sign in again."}}"#,
        ),
        (
            400,
            r#"{"error":{"message":"Your refresh token has already been used to generate a new access token."}}"#,
        ),
    ] {
        assert!(
            matches!(refusal(status, body), Refused::Invalid(_)),
            "{status} {body}"
        );
    }
    // Not a verdict on the token: a page in the way, a rate limit, a server
    // that fails (whatever it calls it), a request that was wrong.
    for (status, body) in [
        (403, "<html><title>Just a moment...</title></html>"),
        (401, ""),
        (408, r#"{"error":"invalid_grant"}"#),
        (429, r#"{"error":"invalid_grant"}"#),
        (500, r#"{"error":"invalid_grant"}"#),
        (503, ""),
        (
            400,
            r#"{"error":"invalid_request","error_description":"Missing parameter"}"#,
        ),
        (
            400,
            r#"{"error":{"message":"The refresh token field is required"}}"#,
        ),
    ] {
        assert!(
            matches!(refusal(status, body), Refused::Unavailable(_)),
            "{status} {body}"
        );
    }
    // A reason in words has no empty brackets.
    let Refused::Invalid(words) = refusal(
        400,
        r#"{"error":{"message":"Your refresh token has expired"}}"#,
    ) else {
        panic!()
    };
    assert!(
        words.starts_with("ChatGPT no longer accepts this sign-in: Your refresh token has expired"),
        "{words}"
    );
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
