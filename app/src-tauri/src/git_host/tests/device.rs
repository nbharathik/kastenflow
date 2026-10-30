//! The device flow and the client id, against the mock.

use serde_json::json;

use super::mock::{Mock, Resp, client, run};
use crate::backup::contract::BackupError;
use crate::git_host::endpoints::Endpoints;
use crate::git_host::github::{Poll, poll, request_code, whoami};

fn flow(answers: &'static [&'static str]) -> Mock {
    let step = std::sync::atomic::AtomicUsize::new(0);
    Mock::start(move |req| match req.route() {
        "/login/device/code" => Resp::json(
            200,
            json!({"device_code":"dev-secret","user_code":"ABCD-1234",
                   "verification_uri":"https://github.com/login/device",
                   "expires_in":900,"interval":5}),
        ),
        "/login/oauth/access_token" => {
            let at = step.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let said = answers[at.min(answers.len() - 1)];
            Resp::json(200, serde_json::from_str(said).unwrap())
        }
        _ => Resp::empty(404),
    })
}

#[test]
fn the_client_id_goes_to_github_and_the_scope_is_repo() {
    let mock = flow(&[]);
    let ep = Endpoints::at(&mock.base());
    let code = run(request_code(&client(), &ep, "Ov23custom")).unwrap();
    assert_eq!(code.user_code, "ABCD-1234");
    let seen = mock.seen();
    assert!(
        seen[0].body.contains("client_id=Ov23custom"),
        "{}",
        seen[0].body
    );
    assert!(seen[0].body.contains("scope=repo"), "{}", seen[0].body);
}

#[test]
fn polling_walks_pending_slow_down_then_a_token() {
    let mock = flow(&[
        r#"{"error":"authorization_pending"}"#,
        r#"{"error":"slow_down"}"#,
        r#"{"access_token":"gho_abc","token_type":"bearer"}"#,
    ]);
    let ep = Endpoints::at(&mock.base());
    let http = client();
    let polls: Vec<Poll> = (0..3).map(|_| run(poll(&http, &ep, "id", "dev"))).collect();
    assert_eq!(
        polls,
        [Poll::Pending, Poll::SlowDown, Poll::Token("gho_abc".into())]
    );
    let sent = &mock.seen()[0].body;
    assert!(sent.contains("device_code=dev"), "{sent}");
    assert!(sent.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"));
}

#[test]
fn expired_denied_and_disabled_are_told_apart() {
    for (said, want) in [
        (r#"{"error":"expired_token"}"#, Poll::Expired),
        (r#"{"error":"access_denied"}"#, Poll::Denied),
        (r#"{"error":"device_flow_disabled"}"#, Poll::Disabled),
    ] {
        let answers: &'static [&'static str] = Box::leak(vec![said].into_boxed_slice());
        let mock = flow(answers);
        let ep = Endpoints::at(&mock.base());
        assert_eq!(run(poll(&client(), &ep, "id", "dev")), want);
    }
}

#[test]
fn a_sign_in_page_that_is_not_githubs_is_refused() {
    let mock = Mock::start(|_| {
        Resp::json(
            200,
            json!({"device_code":"d","user_code":"X","expires_in":900,
                   "verification_uri":"https://github.com.evil.example/login/device"}),
        )
    });
    let ep = Endpoints::at(&mock.base());
    let err = run(request_code(&client(), &ep, "id")).unwrap_err();
    assert!(err.contains("not its own"), "{err}");
}

#[test]
fn the_account_is_read_with_the_token_in_a_header_only() {
    let mock = Mock::start(|req| match req.route() {
        "/user" => Resp::json(200, json!({"login":"ada"})),
        _ => Resp::empty(404),
    });
    let ep = Endpoints::at(&mock.base());
    assert_eq!(run(whoami(&client(), &ep, "gho_tok")).unwrap(), "ada");
    let seen = mock.seen();
    assert_eq!(seen[0].headers["authorization"], "Bearer gho_tok");
    assert!(!seen[0].path.contains("gho_tok"));
}

#[test]
fn a_refused_sign_in_and_a_rate_limit_have_their_own_sentences() {
    let mock = Mock::start(|req| {
        if req.headers["authorization"].contains("old") {
            Resp::json(401, json!({"message":"Bad credentials"}))
        } else {
            Resp::json(403, json!({"message":"API rate limit exceeded"}))
                .header("x-ratelimit-remaining", "0")
                .header("x-ratelimit-reset", "4102444800")
        }
    });
    let ep = Endpoints::at(&mock.base());
    let http = client();
    assert!(matches!(
        run(whoami(&http, &ep, "old")),
        Err(BackupError::SignedOut { .. })
    ));
    let BackupError::RateLimited { message, resets_at } =
        run(whoami(&http, &ep, "new")).unwrap_err()
    else {
        panic!("not a rate limit");
    };
    assert_eq!(resets_at, Some(4_102_444_800_000));
    assert!(message.contains("Try again in about"), "{message}");
}

#[test]
fn nothing_answering_is_an_offline_error_with_a_sentence() {
    // A port nothing listens on.
    let ep = Endpoints::at("http://127.0.0.1:1");
    let err = run(whoami(&client(), &ep, "gho_tok")).unwrap_err();
    assert!(matches!(&err, BackupError::Offline { .. }), "{err:?}");
    assert!(!err.message().contains("gho_tok"));
}
