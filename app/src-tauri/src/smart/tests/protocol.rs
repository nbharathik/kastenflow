//! What the `smart` scheme serves, and what it refuses. Every address starts
//! with the secret of a live frame (`/<frame>/<page id>/<file>`); the tests
//! use the frame `Smart` keeps for its page.

use kasten_core::smart::{CSP, csp};
use tauri::http::{Method, Request, Response, StatusCode, header};

use super::{PNG, Smart, add_page, smart};
use crate::smart::protocol::{Serving, respond};

/// Asks for a full address.
pub(super) fn ask(
    s: &Smart,
    method: Method,
    uri: &str,
    origin: Option<&str>,
    web: bool,
) -> Response<Vec<u8>> {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(origin) = origin {
        request = request.header(header::ORIGIN, origin);
    }
    let request = request.body(Vec::new()).unwrap();
    respond(
        &Serving {
            kasten: Some(s.k()),
            frame_page: &|nonce| s.rt.frame_page(nonce),
            web_images: &|_| web,
        },
        &request,
    )
}

/// `path` (starting with `/`) asked for by the frame with the secret `frame`.
pub(super) fn get_in(s: &Smart, frame: &str, path: &str) -> Response<Vec<u8>> {
    ask(
        s,
        Method::GET,
        &format!("smart://localhost/{frame}{path}"),
        None,
        false,
    )
}

/// `path` (starting with `/`) asked for by the page's own frame.
pub(super) fn get(s: &Smart, path: &str) -> Response<Vec<u8>> {
    get_in(s, &s.frame, path)
}

pub(super) fn header_of(response: &Response<Vec<u8>>, name: header::HeaderName) -> String {
    response
        .headers()
        .get(name)
        .map(|v| v.to_str().unwrap().to_owned())
        .unwrap_or_default()
}

pub(super) fn text(response: &Response<Vec<u8>>) -> String {
    String::from_utf8_lossy(response.body()).into_owned()
}

/// What every answer carries, whatever it says.
pub(super) fn assert_safe_headers(response: &Response<Vec<u8>>, policy: &str, what: &str) {
    assert_eq!(
        header_of(response, header::CONTENT_SECURITY_POLICY),
        policy,
        "{what}"
    );
    assert_eq!(
        header_of(response, header::X_CONTENT_TYPE_OPTIONS),
        "nosniff",
        "{what}"
    );
    assert_eq!(
        header_of(response, header::REFERRER_POLICY),
        "no-referrer",
        "{what}"
    );
    assert!(
        !header_of(response, header::CONTENT_TYPE).is_empty(),
        "{what}"
    );
}

#[test]
fn serves_the_files_of_the_pages_folder_with_the_type_they_have() {
    let s = smart();
    for (rel, kind) in [
        ("index.html", "text/html; charset=utf-8"),
        ("app.js", "text/javascript; charset=utf-8"),
        ("data/venues.json", "application/json; charset=utf-8"),
        ("assets/pin.svg", "image/svg+xml"),
        ("assets/p.png", "image/png"),
        ("smart.yaml", "text/plain; charset=utf-8"),
    ] {
        let response = get(&s, &format!("/{}/{rel}", s.id));
        assert_eq!(response.status(), StatusCode::OK, "{rel}");
        assert_eq!(header_of(&response, header::CONTENT_TYPE), kind, "{rel}");
        // A picture or a script carries the policy too: it may be shown on its own.
        assert_safe_headers(&response, CSP, rel);
    }
    assert_eq!(get(&s, &format!("/{}/assets/p.png", s.id)).body(), PNG);
    assert_eq!(
        get(&s, &format!("/{}/app.js", s.id)).body(),
        b"window.app = 1;"
    );
}

#[test]
fn the_type_follows_the_ending_and_nothing_is_guessed_from_the_bytes() {
    let s = smart();
    let (_, id) = add_page(
        s.k(),
        "Types",
        &[
            (
                "a.SVG",
                b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>".to_vec(),
            ),
            ("b.Html", b"<p>x</p>".to_vec()),
            // Bytes that look like a page, in a file that says it is a picture or text.
            ("c.png", b"<script>alert(1)</script>".to_vec()),
            ("d.txt", b"<script>alert(1)</script>".to_vec()),
            ("e.json", b"<script>alert(1)</script>".to_vec()),
            (
                "f.jpg",
                b"<!doctype html><script>alert(1)</script>".to_vec(),
            ),
            ("g.webp", b"<html></html>".to_vec()),
        ],
    );
    let frame = s.rt.open_frame(&id).unwrap();
    for (name, kind) in [
        ("a.SVG", "image/svg+xml"),
        ("b.Html", "text/html; charset=utf-8"),
        ("c.png", "image/png"),
        ("d.txt", "text/plain; charset=utf-8"),
        ("e.json", "application/json; charset=utf-8"),
        ("f.jpg", "image/jpeg"),
        ("g.webp", "image/webp"),
    ] {
        let response = get_in(&s, &frame, &format!("/{id}/{name}"));
        assert_eq!(response.status(), StatusCode::OK, "{name}");
        assert_eq!(header_of(&response, header::CONTENT_TYPE), kind, "{name}");
        assert_safe_headers(&response, CSP, name);
    }
}

#[test]
fn every_answer_carries_the_exact_policy_and_says_what_it_is() {
    let s = smart();
    let ours = |rest: &str| format!("/{}{rest}", s.frame);
    let id = &s.id;
    let forged = "0".repeat(64);
    for path in [
        ours(&format!("/{id}/index.html")),
        ours(&format!("/{id}/missing.js")),
        ours(&format!("/{id}/../x")),
        ours("/kit/1/kit.js"),
        ours("/kit/2/kit.js"),
        ours("/"),
        ours("/nobody/index.html"),
        // Not a live frame's, or no frame at all.
        "/".to_owned(),
        "".to_owned(),
        format!("/{forged}/{id}/index.html"),
        format!("/{id}/index.html"),
        "/kit/1/kit.js".to_owned(),
        "/%00".to_owned(),
        "/%ff".to_owned(),
        format!("/{}/{id}/index.html", "x".repeat(10_000)),
    ] {
        let response = ask(
            &s,
            Method::GET,
            &format!("smart://localhost{path}"),
            None,
            false,
        );
        assert_safe_headers(&response, CSP, &path);
    }
    // A refused method and a refused host carry them too.
    for (method, uri) in [
        (Method::POST, format!("smart://localhost/{}/x", s.frame)),
        (Method::GET, format!("smart://evil/{}/x", s.frame)),
        (Method::GET, "smart://localhost:81/x".to_owned()),
    ] {
        let response = ask(&s, method, &uri, None, false);
        assert_safe_headers(&response, CSP, &uri);
    }
    // The policy is the contract's, word for word: no network, no frames, no plugins.
    assert_eq!(
        CSP,
        "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
    );
    for forbidden in ["http:", "https:", "*", "unsafe-eval", "wss:", "ws:"] {
        assert!(!CSP.contains(forbidden), "{forbidden}");
    }
}

#[test]
fn pictures_from_the_web_are_allowed_for_the_page_that_was_given_leave_only() {
    let s = smart();
    let other = add_page(s.k(), "Other", &super::files());
    let other_frame = s.rt.open_frame(&other.1).unwrap();
    let allowed = s.id.clone();
    let request = |frame: &str, id: &str, rel: &str| {
        let r = Request::builder()
            .uri(format!("smart://localhost/{frame}/{id}/{rel}"))
            .body(Vec::new())
            .unwrap();
        respond(
            &Serving {
                kasten: Some(s.k()),
                frame_page: &|nonce| s.rt.frame_page(nonce),
                web_images: &|asked| asked == allowed,
            },
            &r,
        )
    };
    let with = header_of(
        &request(&s.frame, &s.id, "index.html"),
        header::CONTENT_SECURITY_POLICY,
    );
    assert_eq!(with, csp(true));
    assert!(with.contains("img-src 'self' data: blob: https:"));
    // Everything else in the policy is the same.
    assert_eq!(with.replace(" https:", ""), CSP);
    assert_eq!(
        header_of(
            &request(&other_frame, &other.1, "index.html"),
            header::CONTENT_SECURITY_POLICY
        ),
        CSP
    );
    // The page's other files carry the same: a picture shown on its own may load more pictures.
    assert_eq!(
        header_of(
            &request(&s.frame, &s.id, "assets/pin.svg"),
            header::CONTENT_SECURITY_POLICY
        ),
        csp(true)
    );
    // Leave given to one page is not given to another's frame, whoever asks.
    assert_eq!(
        header_of(
            &request(&other_frame, &s.id, "index.html"),
            header::CONTENT_SECURITY_POLICY
        ),
        CSP
    );
    // The kit is not the page's own: no leave.
    let kit = request(&s.frame, "kit", "1/kit.js");
    assert_eq!(kit.status(), StatusCode::OK);
    assert_eq!(header_of(&kit, header::CONTENT_SECURITY_POLICY), CSP);
}

#[test]
fn only_reading_is_served_and_only_at_the_schemes_own_address() {
    let s = smart();
    let uri = format!("smart://localhost/{}/{}/index.html", s.frame, s.id);
    for method in [
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::PATCH,
        Method::OPTIONS,
        Method::TRACE,
        Method::CONNECT,
    ] {
        let response = ask(&s, method.clone(), &uri, None, false);
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method}"
        );
        assert!(!text(&response).contains("<link"));
    }
    let head = ask(&s, Method::HEAD, &uri, None, false);
    assert_eq!(head.status(), StatusCode::OK);
    assert!(head.body().is_empty());
    assert_eq!(
        header_of(&head, header::CONTENT_TYPE),
        "text/html; charset=utf-8"
    );
    assert_safe_headers(&head, CSP, "HEAD");
    let (frame, id) = (&s.frame, &s.id);
    for other in [
        format!("smart://evil/{frame}/{id}/index.html"),
        format!("smart://localhost:8080/{frame}/{id}/index.html"),
        format!("smart://user@localhost/{frame}/{id}/index.html"),
        format!("smart://user:pw@localhost/{frame}/{id}/index.html"),
        format!("http://smart.localhost/{frame}/{id}/index.html").replace("http:", "https:"),
        format!("http://localhost/{frame}/{id}/index.html"),
        format!("http://smart.localhost.evil.example/{frame}/{id}/index.html"),
        format!("http://smart.localhost:9000/{frame}/{id}/index.html"),
        format!("http://user@smart.localhost/{frame}/{id}/index.html"),
        format!("ftp://smart.localhost/{frame}/{id}/index.html"),
        format!("smart://LOCALHOST.evil/{frame}/{id}/index.html"),
        format!("/{frame}/{id}/index.html"),
    ] {
        let response = ask(&s, Method::GET, &other, None, false);
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{other}");
        assert!(!text(&response).contains("<link"), "{other}");
        assert_safe_headers(&response, CSP, &other);
    }
}

#[test]
fn nothing_is_served_while_no_vault_is_open() {
    let s = smart();
    let serve = |uri: String| {
        let request = Request::builder().uri(uri).body(Vec::new()).unwrap();
        respond(
            &Serving {
                kasten: None,
                frame_page: &|nonce| s.rt.frame_page(nonce),
                web_images: &|_| true,
            },
            &request,
        )
    };
    let page = serve(format!("smart://localhost/{}/{}/index.html", s.frame, s.id));
    assert_eq!(page.status(), StatusCode::NOT_FOUND);
    // The kit needs no vault, but still a live frame.
    let kit = serve(format!("smart://localhost/{}/kit/1/kit.js", s.frame));
    assert_eq!(kit.status(), StatusCode::OK);
    let no_frame = serve(format!("smart://localhost/{}/kit/1/kit.js", "0".repeat(64)));
    assert_eq!(no_frame.status(), StatusCode::NOT_FOUND);
}

#[test]
fn a_sandboxed_frame_may_read_what_it_asked_for_and_nobody_else_may() {
    let s = smart();
    let uri = format!("smart://localhost/{}/{}/app.js", s.frame, s.id);
    let framed = ask(&s, Method::GET, &uri, Some("null"), false);
    assert_eq!(
        header_of(&framed, header::ACCESS_CONTROL_ALLOW_ORIGIN),
        "null"
    );
    for origin in [
        None,
        Some("https://evil.example"),
        Some("http://tauri.localhost"),
        Some("*"),
    ] {
        let other = ask(&s, Method::GET, &uri, origin, false);
        assert!(
            other
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none(),
            "{origin:?}"
        );
    }
    // A refusal is not readable by a frame either.
    let refused = ask(
        &s,
        Method::GET,
        &format!("smart://localhost/{}/{}/app.js", "0".repeat(64), s.id),
        Some("null"),
        false,
    );
    assert_eq!(refused.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        header_of(&refused, header::ACCESS_CONTROL_ALLOW_ORIGIN),
        "",
        "an error answer is not shared with the page"
    );
}
