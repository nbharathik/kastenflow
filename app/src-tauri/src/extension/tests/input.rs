//! What the door does with a body that is too big, too slow in coming or not
//! exactly JSON, with the limits, with the switch, and with the port. A
//! refusal leaves the vault as it was.

use std::net::TcpListener;
use std::sync::atomic::Ordering;
use std::time::Duration;

use super::super::server::MAX_BODY;
use super::{Door, Setup};

const CAPTURE: &str = r#"{"url":"https://example.com/a","title":"A page","text":"Some words."}"#;

#[test]
fn a_body_over_two_megabytes_is_refused_and_nothing_is_written() {
    let door = Door::new();
    let token = door.pair();
    let commits = door.commits();
    let words = "w".repeat(MAX_BODY);
    let big = format!(r#"{{"url":"https://example.com/a","text":"{words}"}}"#);
    let declared = door.authed("POST", "/v1/capture", &token).json(&big).send();
    assert_eq!(declared.status, 413, "{}", declared.body);
    // With no length declared, the same.
    let chunked = door
        .authed("POST", "/v1/capture", &token)
        .json(&big)
        .send_chunked(64 << 10);
    assert_eq!(chunked.status, 413, "{}", chunked.body);
    // A pairing request is held to it too.
    door.offer("ABCD2345");
    let pair = door
        .req("POST", "/v1/pair")
        .json(&format!(r#"{{"code":"ABCD2345","label":"{words}"}}"#))
        .send();
    assert_eq!(pair.status, 413);
    assert_eq!(door.commits(), commits);
    // The door is still there for a normal request.
    let ok = door
        .authed("POST", "/v1/capture", &token)
        .json(CAPTURE)
        .send();
    assert_eq!(ok.status, 200, "{}", ok.body);
}

#[test]
fn json_that_is_not_exactly_what_the_route_takes_is_refused() {
    let door = Door::new();
    let token = door.pair();
    let commits = door.commits();
    for (what, body) in [
        ("empty", ""),
        ("not json", "url=https://example.com"),
        ("cut short", r#"{"url":"https://example.com""#),
        ("trailing text", r#"{"url":"https://example.com"} x"#),
        ("an array", r#"["https://example.com"]"#),
        ("a string", r#""https://example.com""#),
        ("no url", r#"{"title":"x"}"#),
        ("a url that is not text", r#"{"url":5}"#),
        (
            "a field it does not know",
            r#"{"url":"https://example.com","admin":true}"#,
        ),
        (
            "a field twice",
            r#"{"url":"https://example.com","url":"https://example.org"}"#,
        ),
        (
            "tags that are not a list",
            r#"{"url":"https://example.com","tags":"a"}"#,
        ),
        (
            "a place with a field it does not use",
            r#"{"url":"https://example.com","target":{"kind":"inbox","project":"x"}}"#,
        ),
        (
            "a place that is not one",
            r#"{"url":"https://example.com","target":{"kind":"trash"}}"#,
        ),
        (
            "a place with an extra field",
            r#"{"url":"https://example.com","target":{"kind":"inbox","extra":1}}"#,
        ),
        (
            "a project with no name",
            r#"{"url":"https://example.com","target":{"kind":"project"}}"#,
        ),
        (
            "a page with no path",
            r#"{"url":"https://example.com","target":{"kind":"page"}}"#,
        ),
        (
            "a page above the vault",
            r#"{"url":"https://example.com","target":{"kind":"page","path":"../outside.md"}}"#,
        ),
        (
            "a page that is not Markdown",
            r#"{"url":"https://example.com","target":{"kind":"page","path":"assets/x.png"}}"#,
        ),
    ] {
        let reply = door.authed("POST", "/v1/capture", &token).json(body).send();
        assert_eq!(reply.status, 400, "{what}: {}", reply.body);
        assert!(!reply.error().is_empty(), "{what}");
    }
    assert_eq!(door.commits(), commits);
}

#[test]
fn a_body_that_is_not_declared_as_json_is_refused() {
    let door = Door::new();
    let token = door.pair();
    for kind in [
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
        "",
    ] {
        let reply = door
            .authed("POST", "/v1/capture", &token)
            .bytes(kind, CAPTURE.as_bytes().to_vec())
            .send();
        assert_eq!(reply.status, 415, "{kind:?}");
    }
    // A charset is fine.
    let ok = door
        .authed("POST", "/v1/capture", &token)
        .bytes(
            "application/json; charset=utf-8",
            CAPTURE.as_bytes().to_vec(),
        )
        .send();
    assert_eq!(ok.status, 200, "{}", ok.body);
}

#[test]
fn too_many_requests_wait_and_so_do_too_many_failures() {
    // Four requests in all: the pairing and three more.
    let door = Door::with(Setup {
        requests: 4,
        ..Setup::default()
    });
    let token = door.pair();
    for _ in 0..3 {
        assert_eq!(door.authed("GET", "/v1/targets", &token).send().status, 200);
    }
    let over = door.authed("GET", "/v1/targets", &token).send();
    assert_eq!(over.status, 429);
    assert!(!over.has_cors());

    // Three wrong tokens shut the door to the right one for a while.
    let door = Door::with(Setup {
        failures: 3,
        ..Setup::default()
    });
    let token = door.pair();
    for _ in 0..3 {
        assert_eq!(
            door.authed("GET", "/v1/targets", "wrong").send().status,
            401
        );
    }
    assert_eq!(door.authed("GET", "/v1/targets", &token).send().status, 429);
}

#[test]
fn a_web_page_cannot_use_up_the_limits_that_the_extension_needs() {
    let door = Door::with(Setup {
        requests: 3,
        failures: 3,
        ..Setup::default()
    });
    let token = door.pair();
    for _ in 0..20 {
        assert_eq!(
            door.req("GET", "/v1/targets")
                .origin("https://evil.example")
                .send()
                .status,
            403
        );
        assert_eq!(
            door.req("GET", "/v1/targets")
                .host("evil.example")
                .send()
                .status,
            403
        );
    }
    assert_eq!(door.authed("GET", "/v1/targets", &token).send().status, 200);
}

#[test]
fn the_door_answers_nothing_while_the_switch_is_off() {
    let door = Door::new();
    let token = door.pair();
    door.shared.on.store(false, Ordering::Relaxed);
    let reply = door.authed("GET", "/v1/targets", &token).send();
    assert_eq!(reply.status, 503);
    assert!(reply.error().contains("off"));
    door.shared.on.store(true, Ordering::Relaxed);
    assert_eq!(door.authed("GET", "/v1/targets", &token).send().status, 200);
}

#[test]
fn only_the_main_window_may_ask_for_the_extension_settings_and_it_tells_only_the_main_window() {
    for command in [
        "extension_status",
        "set_extension_enabled",
        "set_extension_port",
        "extension_pair_start",
        "extension_pair_cancel",
        "extension_revoke",
    ] {
        assert!(crate::guard::may_call("main", command), "{command}");
        for window in ["web-t1abc", "capture", "presenter", "other"] {
            assert!(
                !crate::guard::may_call(window, command),
                "{window} {command}"
            );
        }
    }
    // A broadcast would reach a browser tab's page as well.
    let module = include_str!("../mod.rs");
    assert!(module.contains("emit_to(") && !module.contains(".emit("));
}

#[test]
fn stopping_the_server_frees_the_port() {
    let mut door = Door::new();
    let port = door.port;
    door.stop();
    assert!(
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_secs(2)
        )
        .is_err(),
        "nothing listens any more"
    );
    assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
}
