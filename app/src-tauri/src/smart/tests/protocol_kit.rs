//! The kit the scheme serves to every live frame, and how a page's references
//! to it are written into the address of the frame that asked.

use kasten_core::smart::CSP;
use tauri::http::{Method, StatusCode, header};

use super::protocol::{ask, assert_safe_headers, get, get_in, header_of, text};
use super::{add_page, smart};

#[test]
fn a_pages_references_to_the_kit_name_the_address_it_was_reached_at_with_its_frames_secret() {
    let s = smart();
    for (scheme_host, base) in [
        ("smart://localhost", "smart://localhost"),
        ("http://smart.localhost", "http://smart.localhost"),
    ] {
        let uri = format!("{scheme_host}/{}/{}/index.html", s.frame, s.id);
        let response = ask(&s, Method::GET, &uri, None, false);
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        let body = text(&response);
        let kit = format!("{base}/{}/kit/1", s.frame);
        assert!(body.contains(&format!("href=\"{kit}/kit.css\"")), "{body}");
        assert!(body.contains(&format!("src=\"{kit}/kit.js\"")), "{body}");
        assert!(!body.contains("smart://kit/"), "{body}");
        // The page's own files are left as they are, relative, and so keep the secret.
        assert!(body.contains("src=\"app.js\""));
    }
    // Another frame of the same page gets its own secret in the same references.
    let second = s.rt.open_frame(&s.id).unwrap();
    let body = text(&get_in(&s, &second, &format!("/{}/index.html", s.id)));
    assert!(body.contains(&format!("/{second}/kit/1/kit.js")), "{body}");
    assert!(!body.contains(&s.frame), "{body}");
    // The address the rewritten reference names is served to that frame.
    assert_eq!(
        get_in(&s, &second, "/kit/1/kit.js").status(),
        StatusCode::OK
    );
    // Only a page's markup and styles are rewritten, never its code.
    let (_, id) = add_page(
        s.k(),
        "Code",
        &[("app.js", b"var u = 'smart://kit/1/kit.js';".to_vec())],
    );
    let frame = s.rt.open_frame(&id).unwrap();
    assert_eq!(
        get_in(&s, &frame, &format!("/{id}/app.js")).body(),
        b"var u = 'smart://kit/1/kit.js';"
    );
}

#[test]
fn serves_the_kit_files_and_only_those() {
    let s = smart();
    for (path, kind) in [
        ("/kit/1/kit.js", "text/javascript; charset=utf-8"),
        ("/kit/1/kit.css", "text/css; charset=utf-8"),
        ("/kit/1/kit-visual.css", "text/css; charset=utf-8"),
        ("/kit/1/lib/dom.js", "text/javascript; charset=utf-8"),
        (
            "/kit/1/components/charts.js",
            "text/javascript; charset=utf-8",
        ),
        (
            "/kit/1/data/world-110m.js",
            "text/javascript; charset=utf-8",
        ),
    ] {
        let response = get(&s, path);
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(header_of(&response, header::CONTENT_TYPE), kind, "{path}");
        assert!(!response.body().is_empty(), "{path}");
        assert_safe_headers(&response, CSP, path);
    }
    for path in [
        "/kit/2/kit.js",
        "/kit/1/kit.test.ts",
        "/kit/1/bridge.test.ts",
        "/kit/1/test-support/env.ts",
        "/kit/1/starters/dashboard/index.html",
        "/kit/1/starters/dashboard/app.js",
        "/kit/1/docs/kit.md",
        "/kit/1/examples/dashboard.html",
        "/kit/1/data/world-110m.json",
        "/kit/1/data/build-world.mjs",
        "/kit/1/lib",
        "/kit/1/lib/",
        "/kit/1",
        "/kit",
        "/kit/",
        "/kit/1/Kit.js",
        "/kit/1/../kit.js",
        "/kit/1/%2e%2e/kit.js",
        "/kit/1/lib%2fdom.js",
    ] {
        let response = get(&s, path);
        let status = response.status();
        assert!(
            matches!(status, StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST),
            "{path}: {status}"
        );
        assert_safe_headers(&response, CSP, path);
    }
    // A page cannot call itself `kit`, and the kit is not a page's folder.
    assert_eq!(
        get(&s, &format!("/kit/{}/index.html", s.id)).status(),
        StatusCode::NOT_FOUND
    );
}
