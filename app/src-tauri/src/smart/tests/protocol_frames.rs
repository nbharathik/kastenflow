//! A page's frame is known by a secret that is in every address it loads from.
//! The scheme serves nothing for a secret that is not a live frame's, or not
//! the frame of the page the address names, so one page's code, which sees
//! only its own address, can neither load another page's files nor send its
//! frame to another page; and a call for a frame the window no longer has
//! finds the way shut.

use tauri::http::StatusCode;

use super::protocol::{assert_safe_headers, get, get_in, text};
use super::{add_page, files, smart};
use crate::smart::commands::bound;
use crate::smart::runtime::{Runtime, is_nonce};
use kasten_core::smart::CSP;

#[test]
fn a_frame_has_only_so_many_requests_open_and_the_count_comes_back() {
    use crate::smart::runtime::{Busy, MAX_IN_FLIGHT};
    let rt = Runtime::default();
    let mine = rt.open_frame("01PAGE").unwrap();
    let other = rt.open_frame("01OTHER").unwrap();
    let mut open = Vec::new();
    for _ in 0..MAX_IN_FLIGHT {
        open.push(rt.admit(&mine).expect("let in up to the limit"));
    }
    assert!(rt.admit(&mine).err() == Some(Busy), "one more waits");
    // Another frame is not held up by it, and a secret that is no frame's costs nothing.
    assert!(matches!(rt.admit(&other), Ok(Some(_))));
    let unknown = "a".repeat(64);
    for _ in 0..(MAX_IN_FLIGHT * 3) {
        assert!(matches!(rt.admit(&unknown), Ok(None)));
    }
    // A finished request gives its place back.
    open.pop();
    assert!(matches!(rt.admit(&mine), Ok(Some(_))));
    drop(open);
    assert!(matches!(rt.admit(&mine), Ok(Some(_))));
}

#[test]
fn a_secret_is_256_random_bits_in_lower_case_hex_and_never_the_same_twice() {
    let rt = Runtime::default();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..500 {
        let nonce = rt.open_frame("01PAGE").unwrap();
        assert_eq!(nonce.len(), 64, "{nonce}");
        assert!(is_nonce(&nonce), "{nonce}");
        assert!(seen.insert(nonce), "a secret came twice");
    }
    for not in [
        "",
        "kit",
        &"A".repeat(64),
        &"g".repeat(64),
        &"a".repeat(63),
        &"a".repeat(65),
        &format!("{}.", "a".repeat(63)),
        &format!("{}/", "a".repeat(63)),
        "01PAGE",
    ] {
        assert!(!is_nonce(not), "{not}");
    }
}

#[test]
fn an_unknown_or_forged_secret_is_refused_with_the_policy_still_on_the_answer() {
    let s = smart();
    let live = s.frame.clone();
    let mut forged = vec![
        "0".repeat(64),
        "f".repeat(64),
        live.to_uppercase(),
        live[..63].to_owned(),
        format!("{live}0"),
        format!("{live}%00"),
        // Always differs from the secret (appending "0" to the first 63 digits equals it when it ends in 0).
        format!("{}z", &live[..63]),
        s.id.clone(),
        "kit".to_owned(),
        "%2e%2e".to_owned(),
        "..".to_owned(),
        String::new(),
    ];
    // One digit off.
    let mut off = live.clone().into_bytes();
    off[10] = if off[10] == b'0' { b'1' } else { b'0' };
    forged.push(String::from_utf8(off).unwrap());
    for frame in forged {
        for path in [
            format!("/{}/index.html", s.id),
            "/kit/1/kit.js".to_owned(),
            format!("/{}/app.js", s.id),
        ] {
            let response = get_in(&s, &frame, &path);
            assert!(
                matches!(
                    response.status(),
                    StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST
                ),
                "{frame}{path}: {}",
                response.status()
            );
            assert_safe_headers(&response, CSP, &format!("{frame}{path}"));
            let body = text(&response);
            assert!(
                !body.contains("window.app") && !body.contains("kit"),
                "{frame}{path}"
            );
        }
    }
    // The live one still works.
    assert_eq!(
        get(&s, &format!("/{}/index.html", s.id)).status(),
        StatusCode::OK
    );
}

#[test]
fn the_old_form_of_an_address_with_no_secret_serves_nothing() {
    let s = smart();
    for path in [
        format!("/{}/index.html", s.id),
        "/kit/1/kit.js".to_owned(),
        format!("/kit/{}/index.html", s.id),
        format!("/{}", s.id),
        "/".to_owned(),
    ] {
        let response = super::protocol::ask(
            &s,
            tauri::http::Method::GET,
            &format!("smart://localhost{path}"),
            None,
            false,
        );
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_safe_headers(&response, CSP, &path);
    }
}

#[test]
fn a_frame_gets_the_files_of_its_own_page_and_no_other_page_is_reachable_from_it() {
    let s = smart();
    let (_, other) = add_page(
        s.k(),
        "Neighbour",
        &[
            ("index.html", b"<p>neighbour</p>".to_vec()),
            ("secret.json", b"{\"secret\": true}".to_vec()),
            ("assets/p.png", super::PNG.to_vec()),
        ],
    );
    let other_frame = s.rt.open_frame(&other).unwrap();
    // Each frame gets its own page.
    assert_eq!(
        text(&get_in(&s, &other_frame, &format!("/{other}/index.html"))),
        "<p>neighbour</p>"
    );
    assert_eq!(
        get(&s, &format!("/{}/index.html", s.id)).status(),
        StatusCode::OK
    );
    // The first page's code asks for the neighbour's files by its id: nothing, whatever the file.
    for rel in ["index.html", "secret.json", "assets/p.png", "smart.yaml"] {
        let response = get(&s, &format!("/{other}/{rel}"));
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{rel}");
        assert_safe_headers(&response, CSP, rel);
        assert!(!text(&response).contains("secret"), "{rel}");
    }
    // And the other way round.
    let response = get_in(&s, &other_frame, &format!("/{}/index.html", s.id));
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    // It cannot send its frame there either: the address it would navigate to is a secret it does not know,
    // and a secret it does know names its own page.
    assert_eq!(
        get_in(&s, &s.frame, &format!("/{other}/index.html")).status(),
        StatusCode::NOT_FOUND
    );
    // Climbing out of its own page's part of the path leads nowhere.
    for path in [
        format!("/{}/../{other}/index.html", s.id),
        format!("/{}/%2e%2e/{other}/index.html", s.id),
        format!("/../{}/{other}/index.html", s.frame),
        format!("/{}/{other}/index.html", s.id),
    ] {
        let response = get(&s, &path);
        assert!(
            matches!(
                response.status(),
                StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST
            ),
            "{path}: {}",
            response.status()
        );
        assert!(!text(&response).contains("neighbour"), "{path}");
    }
    // The kit is for every live frame.
    assert_eq!(get(&s, "/kit/1/kit.js").status(), StatusCode::OK);
    assert_eq!(
        get_in(&s, &other_frame, "/kit/1/kit.js").status(),
        StatusCode::OK
    );
}

#[test]
fn a_secret_ends_when_its_frame_does_and_the_other_frames_of_the_page_go_on() {
    let s = smart();
    let second = s.rt.open_frame(&s.id).unwrap();
    assert_ne!(second, s.frame, "two frames of one page have two secrets");
    let page = format!("/{}/index.html", s.id);
    assert_eq!(get(&s, &page).status(), StatusCode::OK);
    assert_eq!(get_in(&s, &second, &page).status(), StatusCode::OK);
    s.rt.close_frame(&s.frame);
    for path in [page.as_str(), "/kit/1/kit.js", &format!("/{}/app.js", s.id)] {
        let response = get(&s, path);
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_safe_headers(&response, CSP, path);
    }
    assert_eq!(get_in(&s, &second, &page).status(), StatusCode::OK);
    // Ending it again, or ending one that never was, is nothing.
    s.rt.close_frame(&s.frame);
    s.rt.close_frame("nothing");
    s.rt.close_frame(&"0".repeat(64));
    assert_eq!(get_in(&s, &second, &page).status(), StatusCode::OK);
    s.rt.close_frame(&second);
    assert_eq!(get_in(&s, &second, &page).status(), StatusCode::NOT_FOUND);
}

#[test]
fn an_old_secret_is_not_given_back_to_a_new_frame_and_a_flood_of_frames_cannot_fill_the_app() {
    let rt = Runtime::default();
    let first = rt.open_frame("01PAGE").unwrap();
    assert!(rt.frame_is_of(&first, "01PAGE"));
    assert!(!rt.frame_is_of(&first, "01OTHER"));
    assert!(!rt.frame_is_of(&first, ""));
    let mut last = String::new();
    for _ in 0..1_000 {
        last = rt.open_frame("01PAGE").unwrap();
    }
    // The oldest are forgotten past a limit (a window that reloaded cannot close what it had); the newest are not.
    assert_eq!(rt.frame_page(&first), None);
    assert_eq!(rt.frame_page(&last).as_deref(), Some("01PAGE"));
    rt.close_frame(&last);
    assert_eq!(rt.frame_page(&last), None);
    // Anything that is not the form of a secret finds nothing.
    assert_eq!(rt.frame_page("01PAGE"), None);
    assert_eq!(rt.frame_page(""), None);
}

#[test]
fn a_call_is_for_a_live_frame_of_the_page_it_names_or_it_is_refused() {
    let s = smart();
    let rt = &s.rt;
    // The page's own frame.
    assert_eq!(bound(s.k(), rt, &s.path, &s.frame).unwrap(), s.id);
    // Another page's frame, one that is gone, and nonsense.
    let (other_path, other) = add_page(s.k(), "Other", &files());
    let other_frame = rt.open_frame(&other).unwrap();
    assert!(bound(s.k(), rt, &s.path, &other_frame).is_err());
    assert!(bound(s.k(), rt, &other_path, &s.frame).is_err());
    assert!(bound(s.k(), rt, &other_path, &other_frame).is_ok());
    let gone = rt.open_frame(&s.id).unwrap();
    rt.close_frame(&gone);
    for frame in [gone.as_str(), "", "kit", &"0".repeat(64), &s.id] {
        let error = bound(s.k(), rt, &s.path, frame).unwrap_err();
        assert!(error.contains("not showing"), "{frame}: {error}");
    }
    // A path that is no smart page of the vault gives no id to bind.
    for path in [
        "projects/photo-organiser/pages/photo-organiser-roadmap.md",
        "nothing.md",
        "../x.md",
        ".kasten/config.yaml",
    ] {
        assert!(bound(s.k(), rt, path, &s.frame).is_err(), "{path}");
    }
}
