//! What the `diagrams` scheme serves, and what it refuses.

use std::fs;
use std::path::Path;

use tauri::http::{Method, StatusCode, header};

use super::support::Scratch;
use crate::diagrams::protocol::respond;

/// An installed editor with a few files, and a secret beside it.
fn editor(scratch: &Scratch) -> std::path::PathBuf {
    let dir = scratch.path("1.0.0");
    fs::create_dir_all(dir.join("js")).unwrap();
    fs::create_dir_all(dir.join("styles")).unwrap();
    fs::write(dir.join("index.html"), "<!doctype html><p>stub").unwrap();
    fs::write(dir.join("js/app.min.js"), "window.stub = 1").unwrap();
    fs::write(dir.join("js/sp ace.js"), "spaced").unwrap();
    fs::write(dir.join("js/ü.js"), "umlaut").unwrap();
    fs::write(dir.join("styles/main.css"), "body{}").unwrap();
    fs::write(dir.join("data.bin"), [1, 2, 3]).unwrap();
    fs::write(scratch.path("secret.txt"), "the secret").unwrap();
    dir
}

fn get(dir: Option<&Path>, path: &str) -> tauri::http::Response<Vec<u8>> {
    respond(dir, &Method::GET, path)
}

fn header_of(response: &tauri::http::Response<Vec<u8>>, name: header::HeaderName) -> String {
    response
        .headers()
        .get(name)
        .map(|v| v.to_str().unwrap().to_owned())
        .unwrap_or_default()
}

#[test]
fn serves_a_file_of_the_editor_with_the_type_it_has() {
    let scratch = Scratch::new();
    let dir = editor(&scratch);
    for (path, body, kind) in [
        (
            "/index.html",
            "<!doctype html><p>stub",
            "text/html; charset=utf-8",
        ),
        (
            "/js/app.min.js",
            "window.stub = 1",
            "text/javascript; charset=utf-8",
        ),
        ("/styles/main.css", "body{}", "text/css; charset=utf-8"),
        ("/data.bin", "\u{1}\u{2}\u{3}", "application/octet-stream"),
        // Encoded names come back as the files they are.
        (
            "/js/sp%20ace.js",
            "spaced",
            "text/javascript; charset=utf-8",
        ),
        ("/js/%C3%BC.js", "umlaut", "text/javascript; charset=utf-8"),
        // The query is not part of the path.
    ] {
        let response = get(Some(&dir), path);
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(response.body(), body.as_bytes(), "{path}");
        assert_eq!(header_of(&response, header::CONTENT_TYPE), kind, "{path}");
    }
}

#[test]
fn every_answer_says_what_it_is_and_keeps_the_editor_local() {
    let scratch = Scratch::new();
    let dir = editor(&scratch);
    for path in ["/index.html", "/missing.js", "/../secret.txt", "/"] {
        let response = get(Some(&dir), path);
        assert_eq!(
            header_of(&response, header::X_CONTENT_TYPE_OPTIONS),
            "nosniff",
            "{path}"
        );
        let policy = header_of(&response, header::CONTENT_SECURITY_POLICY);
        assert!(
            policy.contains("connect-src 'self' blob: data:"),
            "{path}: {policy}"
        );
        assert!(
            policy.contains("img-src 'self' data: blob:"),
            "{path}: {policy}"
        );
        // No address on the network appears anywhere in the policy.
        assert!(
            !policy.contains("http:") && !policy.contains("https:") && !policy.contains('*'),
            "{policy}"
        );
        assert!(policy.contains("default-src 'none'") && policy.contains("object-src 'none'"));
    }
}

#[test]
fn a_path_that_could_leave_the_folder_is_refused() {
    let scratch = Scratch::new();
    let dir = editor(&scratch);
    for path in [
        "/../secret.txt",
        "/js/../../secret.txt",
        "/%2e%2e/secret.txt",
        "/%2E%2E/%2e%2e/secret.txt",
        "/js/..%2f..%2fsecret.txt",
        "/js/%2e%2e%2f%2e%2e%2fsecret.txt",
        "/js%5c..%5c..%5csecret.txt",
        "/js\\..\\..\\secret.txt",
        "//secret.txt",
        "/js//app.min.js",
        "/js/./app.min.js",
        "/c:/windows/win.ini",
        "/js/app.min.js:stream",
        "/%00",
        "/js/app.min.js%00.png",
        "/%ff",
    ] {
        let response = get(Some(&dir), path);
        assert!(
            matches!(
                response.status(),
                StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND
            ),
            "{path}: {}",
            response.status()
        );
        assert!(
            !String::from_utf8_lossy(response.body()).contains("secret"),
            "{path}"
        );
    }
}

#[test]
fn a_folder_is_never_listed() {
    let scratch = Scratch::new();
    let dir = editor(&scratch);
    for path in ["/", "", "/js", "/js/", "/styles/"] {
        let response = get(Some(&dir), path);
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path:?}");
        let body = String::from_utf8_lossy(response.body()).into_owned();
        assert!(!body.contains("app.min.js"), "{path:?}: {body}");
    }
}

#[test]
fn nothing_is_served_while_the_editor_is_not_installed() {
    let scratch = Scratch::new();
    let response = get(None, "/index.html");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(String::from_utf8_lossy(response.body()).contains("not installed"));
    assert_eq!(
        header_of(&response, header::X_CONTENT_TYPE_OPTIONS),
        "nosniff"
    );
    // A folder that has gone is the same as none.
    let gone = scratch.path("never-made");
    assert_eq!(
        get(Some(&gone), "/index.html").status(),
        StatusCode::NOT_FOUND
    );
}

#[test]
fn only_reading_is_served() {
    let scratch = Scratch::new();
    let dir = editor(&scratch);
    for method in [
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::PATCH,
        Method::OPTIONS,
    ] {
        let response = respond(Some(&dir), &method, "/index.html");
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method}"
        );
    }
    let head = respond(Some(&dir), &Method::HEAD, "/index.html");
    assert_eq!(head.status(), StatusCode::OK);
    assert!(head.body().is_empty());
    assert_eq!(
        header_of(&head, header::CONTENT_TYPE),
        "text/html; charset=utf-8"
    );
}

#[cfg(unix)]
#[test]
fn a_link_out_of_the_folder_is_not_followed() {
    let scratch = Scratch::new();
    let dir = editor(&scratch);
    std::os::unix::fs::symlink(scratch.path("secret.txt"), dir.join("js/link.txt")).unwrap();
    let response = get(Some(&dir), "/js/link.txt");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(!String::from_utf8_lossy(response.body()).contains("the secret"));
}

#[test]
fn media_types_cover_what_a_web_app_is_made_of() {
    let scratch = Scratch::new();
    let dir = scratch.path("1.0.0");
    fs::create_dir_all(&dir).unwrap();
    for (name, kind) in [
        ("a.svg", "image/svg+xml"),
        ("a.png", "image/png"),
        ("a.JPG", "image/jpeg"),
        ("a.gif", "image/gif"),
        ("a.ico", "image/x-icon"),
        ("a.woff2", "font/woff2"),
        ("a.woff", "font/woff"),
        ("a.ttf", "font/ttf"),
        ("a.json", "application/json; charset=utf-8"),
        ("a.xml", "application/xml; charset=utf-8"),
        ("a.txt", "text/plain; charset=utf-8"),
        ("a.mjs", "text/javascript; charset=utf-8"),
        ("a.map", "application/json; charset=utf-8"),
        ("a.unknown", "application/octet-stream"),
        ("noext", "application/octet-stream"),
    ] {
        fs::write(dir.join(name), "x").unwrap();
        let response = get(Some(&dir), &format!("/{name}"));
        assert_eq!(header_of(&response, header::CONTENT_TYPE), kind, "{name}");
    }
}
