//! The door's rules, sent to the real server: what is refused and why (the
//! Host, the Origin, the token, the method, the route), and that no answer
//! lets a web page read it. Every refusal leaves the vault as it was.

use super::super::server::extension_origin;
use super::{Door, ORIGIN, OTHER};

const CAPTURE: &str = r#"{"url":"https://example.com/a","title":"A page","text":"Some words."}"#;

#[test]
fn only_a_chrome_edge_or_firefox_extension_origin_has_the_right_shape() {
    for ok in [
        ORIGIN,
        "chrome-extension://pppppppppppppppppppppppppppppppp",
        "moz-extension://6f3b7f2a-1d3c-4a5e-9f55-0a1b2c3d4e5f",
    ] {
        assert!(extension_origin(ok), "{ok}");
    }
    for bad in [
        "",
        "null",
        "https://example.com",
        "http://127.0.0.1:7434",
        "chrome-extension://",
        "chrome-extension://short",
        "chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP",
        "chrome-extension://abcdefghijklmnopabcdefghijklmnopq",
        "chrome-extension://abcdefghijklmnopabcdefghijklmnop/",
        "chrome-extension://qrstuvwxyzqrstuvwxyzqrstuvwxyzqr",
        "moz-extension://nonsense",
        "ms-browser-extension://abcdefghijklmnopabcdefghijklmnop",
    ] {
        assert!(!extension_origin(bad), "{bad}");
    }
}

#[test]
fn a_host_that_is_not_this_address_and_port_is_refused() {
    let door = Door::new();
    let token = door.pair();
    let port = door.port;
    for host in [
        "localhost".to_owned(),
        format!("localhost:{port}"),
        "127.0.0.1".to_owned(),
        format!("127.0.0.1:{}", port.wrapping_add(1)),
        format!("[::1]:{port}"),
        "evil.example".to_owned(),
        format!("evil.example:{port}"),
        format!("127.0.0.1.evil.example:{port}"),
    ] {
        let reply = door.authed("GET", "/v1/targets", &token).host(&host).send();
        assert_eq!(reply.status, 403, "{host:?}");
        assert!(!reply.has_cors());
    }
    // No Host at all is not even HTTP/1.1.
    let none = door.authed("GET", "/v1/targets", &token).no_host().send();
    assert_ne!(none.status, 200);
    // The pairing route holds to it too.
    door.offer("ABCD2345");
    let pair = door
        .req("POST", "/v1/pair")
        .host("localhost")
        .json(r#"{"code":"ABCD2345"}"#)
        .send();
    assert_eq!(pair.status, 403);
    assert_eq!(
        door.authed("GET", "/v1/targets", &token).send().status,
        200,
        "the right Host works"
    );
}

#[test]
fn a_web_page_is_never_let_in_and_only_an_extensions_origin_is() {
    let door = Door::new();
    let token = door.pair();
    let commits = door.commits();
    for origin in [
        "https://example.com",
        "https://evil.example",
        &format!("http://127.0.0.1:{}", door.port),
        &format!("http://localhost:{}", door.port),
        "null",
        "file://",
        "chrome-extension://short",
        "moz-extension://nonsense",
    ] {
        for (method, path) in [
            ("GET", "/v1/targets"),
            ("POST", "/v1/capture"),
            ("POST", "/v1/pair"),
        ] {
            let reply = door
                .authed(method, path, &token)
                .origin(origin)
                .json(CAPTURE)
                .send();
            assert_eq!(reply.status, 403, "{origin} {method} {path}");
            assert!(!reply.has_cors());
        }
    }
    let none = door.authed("GET", "/v1/targets", &token).no_origin().send();
    assert_eq!(
        none.status, 403,
        "a request with no Origin is not the extension"
    );
    assert_eq!(door.commits(), commits, "nothing was written");
}

#[test]
fn a_token_works_only_from_the_origin_it_was_paired_from() {
    let door = Door::new();
    let token = door.pair();
    let other = door
        .authed("GET", "/v1/targets", &token)
        .origin(OTHER)
        .send();
    assert_eq!(other.status, 401);
    assert_eq!(door.authed("GET", "/v1/targets", &token).send().status, 200);
}

#[test]
fn a_missing_wrong_or_oddly_written_token_is_refused() {
    let door = Door::new();
    let token = door.pair();
    let commits = door.commits();
    for req in [
        door.req("GET", "/v1/targets"),
        door.req("GET", "/v1/targets")
            .header("Authorization", "Bearer"),
        door.req("GET", "/v1/targets")
            .header("Authorization", "Bearer "),
        door.req("GET", "/v1/targets").token("not-the-token"),
        door.req("GET", "/v1/targets")
            .header("Authorization", &token),
        door.req("GET", "/v1/targets")
            .header("Authorization", &format!("bearer {token}")),
        door.req("GET", "/v1/targets")
            .header("Authorization", &format!("Basic {token}")),
        // The token twice is not one token.
        door.req("GET", "/v1/targets").token(&token).token(&token),
        // Nor in the address.
        door.req("GET", &format!("/v1/targets?token={token}")),
        door.req("POST", "/v1/capture").json(CAPTURE),
    ] {
        let reply = req.send();
        assert_eq!(reply.status, 401, "{}", reply.body);
        assert!(!reply.has_cors());
    }
    assert_eq!(door.commits(), commits);
}

#[test]
fn options_is_refused_with_no_cors_headers_at_all() {
    let door = Door::new();
    let token = door.pair();
    for path in ["/v1/pair", "/v1/targets", "/v1/capture", "/", "/v1/other"] {
        for req in [
            door.req("OPTIONS", path)
                .header("Access-Control-Request-Method", "POST")
                .header(
                    "Access-Control-Request-Headers",
                    "authorization,content-type",
                ),
            door.authed("OPTIONS", path, &token),
            door.req("OPTIONS", path).origin("https://example.com"),
        ] {
            let reply = req.send();
            assert_eq!(reply.status, 405, "{path}");
            assert!(!reply.has_cors(), "{:?}", reply.headers);
        }
    }
}

#[test]
fn no_answer_carries_a_header_that_would_let_a_web_page_read_it() {
    let door = Door::new();
    let token = door.pair();
    let replies = [
        door.authed("GET", "/v1/targets", &token).send(),
        door.authed("POST", "/v1/capture", &token)
            .json(CAPTURE)
            .send(),
        door.authed("POST", "/v1/capture", &token).json("{").send(),
        door.authed("GET", "/v1/nowhere", &token).send(),
        door.authed("GET", "/v1/capture", &token).send(),
        door.req("GET", "/v1/targets").send(),
        door.req("GET", "/v1/targets")
            .origin("https://example.com")
            .send(),
        door.authed("POST", "/v1/capture", &token)
            .bytes("text/plain", b"x".to_vec())
            .send(),
        door.req("POST", "/v1/pair")
            .json(r#"{"code":"WRONGONE"}"#)
            .send(),
    ];
    let seen: Vec<u16> = replies.iter().map(|r| r.status).collect();
    assert_eq!(seen, [200, 200, 400, 404, 405, 401, 403, 415, 403]);
    for reply in &replies {
        assert!(!reply.has_cors(), "{:?}", reply.headers);
        let header = |name: &str| {
            reply
                .headers
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(header("content-type"), Some("application/json"));
        assert_eq!(header("cache-control"), Some("no-store"));
        assert_eq!(header("x-content-type-options"), Some("nosniff"));
    }
}

#[test]
fn a_route_that_is_not_there_or_takes_another_method_is_refused() {
    let door = Door::new();
    let token = door.pair();
    for (method, path, status) in [
        ("GET", "/", 404),
        ("GET", "/v1", 404),
        ("GET", "/v1/notes", 404),
        ("GET", "/mcp", 404),
        ("GET", "/v1/targets/extra", 404),
        ("GET", "/v1/capture", 405),
        ("GET", "/v1/pair", 405),
        ("POST", "/v1/targets", 405),
        ("PUT", "/v1/capture", 405),
        ("DELETE", "/v1/capture", 405),
        ("PATCH", "/v1/capture", 405),
        ("HEAD", "/v1/targets", 405),
    ] {
        let reply = door.authed(method, path, &token).send();
        assert_eq!(reply.status, status, "{method} {path}");
    }
}
