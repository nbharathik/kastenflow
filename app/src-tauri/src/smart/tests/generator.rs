//! The frame code pictures run in: the runner and the drawing kit are served to a live generator frame
//! and to nothing else, with the same policy as a smart page (no network), and the frame belongs to no
//! page. A person's "Allow to run" for a deck is kept apart from the pages' own.

use kasten_core::Instant;
use kasten_core::history::Actor;
use kasten_core::smart::csp;
use tauri::http::StatusCode;

use super::protocol::{assert_safe_headers, get, get_in, header_of, text};
use super::smart;
use crate::smart::commands::end_disabled_frames;
use crate::smart::generator::{self, ID};
use crate::smart::protocol::live_frame;
use crate::smart::settings;

fn named(file: &str) -> Vec<String> {
    vec![ID.to_owned(), file.to_owned()]
}

#[test]
fn the_runner_and_the_kit_are_served_to_a_generator_frame_with_the_pages_policy() {
    let s = smart();
    let frame = s.rt.open_frame(ID).unwrap();
    for (file, kind, inside) in [
        ("runner.html", "text/html; charset=utf-8", "runner.js"),
        ("runner.js", "text/javascript; charset=utf-8", "__generator"),
        ("kit.js", "text/javascript; charset=utf-8", "createKit"),
    ] {
        let response = get_in(&s, &frame, &format!("/{ID}/{file}"));
        assert_eq!(response.status(), StatusCode::OK, "{file}");
        assert_eq!(
            header_of(&response, tauri::http::header::CONTENT_TYPE),
            kind,
            "{file}"
        );
        assert_safe_headers(&response, &csp(false), file);
        assert!(text(&response).contains(inside), "{file}");
    }
    // No network, whatever the page's own leave: the policy is the strict one.
    let policy = csp(false);
    assert!(
        policy.contains("connect-src 'none'") && policy.contains("default-src 'none'"),
        "{policy}"
    );
}

#[test]
fn a_generator_frame_gets_its_runner_and_nothing_else() {
    let s = smart();
    let frame = s.rt.open_frame(ID).unwrap();
    for path in [
        format!("/{ID}/missing.js"),
        format!("/{ID}/"),
        format!("/{ID}"),
        format!("/{ID}/runner.html/more"),
        format!("/{ID}/../index.html"),
        format!("/{ID}/%2e%2e/index.html"),
        format!("/{ID}/.hidden"),
        format!("/{}/index.html", s.id),
        format!("/{}/app.js", s.id),
        "/kit/1/kit.js".to_owned(),
        "/index.html".to_owned(),
    ] {
        let response = get_in(&s, &frame, &path);
        assert_ne!(response.status(), StatusCode::OK, "{path}");
        assert_safe_headers(&response, &csp(false), &path);
    }
}

#[test]
fn a_pages_frame_cannot_load_the_runner_and_an_ended_or_unknown_frame_gets_nothing() {
    let s = smart();
    assert_eq!(
        get(&s, &format!("/{ID}/runner.html")).status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&s, &format!("/{ID}/kit.js")).status(),
        StatusCode::NOT_FOUND
    );
    let frame = s.rt.open_frame(ID).unwrap();
    assert_eq!(
        get_in(&s, &frame, &format!("/{ID}/kit.js")).status(),
        StatusCode::OK
    );
    // Another secret is no frame's; a frame that ended serves nothing.
    assert_eq!(
        get_in(&s, &"0".repeat(64), &format!("/{ID}/kit.js")).status(),
        StatusCode::NOT_FOUND
    );
    s.rt.close_frame(&frame);
    assert_eq!(
        get_in(&s, &frame, &format!("/{ID}/kit.js")).status(),
        StatusCode::NOT_FOUND
    );
    assert!(!s.rt.frame_is_of(&frame, &s.id));
}

#[test]
fn smart_pages_being_off_does_not_end_a_generator_frame_but_does_end_a_pages() {
    let s = smart();
    let frame = s.rt.open_frame(ID).unwrap();
    assert_eq!(
        live_frame(Some(s.k()), Some(&s.rt), &frame).as_deref(),
        Some(ID)
    );
    assert_eq!(
        live_frame(Some(s.k()), Some(&s.rt), &s.frame).as_deref(),
        Some(s.id.as_str())
    );

    s.k()
        .set_plugin_enabled(&Actor::Human, "smart", false, Instant::now())
        .unwrap();
    assert_eq!(
        live_frame(Some(s.k()), Some(&s.rt), &s.frame),
        None,
        "a page's frame is served nothing"
    );
    assert_eq!(
        live_frame(Some(s.k()), Some(&s.rt), &frame).as_deref(),
        Some(ID)
    );
    end_disabled_frames(s.k(), &s.rt);
    assert!(
        s.rt.frame_page(&s.frame).is_none(),
        "the page's frame is ended"
    );
    assert_eq!(
        s.rt.frame_page(&frame).as_deref(),
        Some(ID),
        "the generator frame lives on"
    );
    // And with no vault open, a generator frame is still known to the runtime, but serves no page.
    assert_eq!(live_frame(None, Some(&s.rt), &frame).as_deref(), Some(ID));
}

#[test]
fn the_files_are_the_three_of_the_runner_and_only_under_the_generator_folder() {
    for file in ["runner.html", "runner.js", "kit.js"] {
        let (name, bytes) = generator::file(&named(file)).unwrap_or_else(|| panic!("{file}"));
        assert_eq!(name, file);
        assert!(!bytes.is_empty());
    }
    for rest in [
        vec![],
        vec![ID.to_owned()],
        vec!["kit".to_owned(), "kit.js".to_owned()],
        vec!["other".to_owned(), "kit.js".to_owned()],
        named("kit.css"),
        vec![ID.to_owned(), "a".to_owned(), "kit.js".to_owned()],
    ] {
        assert!(generator::file(&rest).is_none(), "{rest:?}");
    }
}

#[test]
fn the_runner_and_the_kit_reach_for_nothing_outside_the_frame() {
    for file in ["runner.js", "kit.js"] {
        let (_, bytes) = generator::file(&named(file)).unwrap();
        let source = String::from_utf8(bytes).unwrap();
        // Comments say what the code must not do; only the code is looked at.
        // The runner names the ways out only to take them away from the code (`WAYS_OUT`, `takeAway`).
        let code: String = source
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .filter(|l| !l.contains("var WAYS_OUT =") && !l.contains("takeAway("))
            .collect::<Vec<_>>()
            .join("\n");
        for forbidden in [
            "fetch(",
            "XMLHttpRequest",
            "WebSocket",
            "EventSource",
            "sendBeacon",
            "importScripts",
            "new Worker",
            "eval(",
            "new Function",
            "localStorage",
            "document.cookie",
            "window.top",
            "window.open",
            "location.",
            "import(",
            "innerHTML",
        ] {
            assert!(!code.contains(forbidden), "{file} has {forbidden}");
        }
    }
    // The only way out of the frame is the one message to the window that holds it.
    let (_, runner) = generator::file(&named("runner.js")).unwrap();
    let runner = String::from_utf8(runner).unwrap();
    assert_eq!(runner.matches("postMessage").count(), 1, "one way out");
    // And the peer connections, which the page's policy does not hold, are taken from the code.
    assert!(runner.contains("takeAway(window, name)") && runner.contains("\"RTCPeerConnection\""));
    assert!(
        runner.contains("event.source !== window.parent"),
        "only the holder may speak to it"
    );
}

fn scratch() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "kasten-generator-{}",
        kasten_core::ulid_at(Instant::now().millis)
    ))
}

#[test]
fn a_persons_allow_is_kept_by_deck_and_code_and_apart_from_the_pages_own() {
    let dir = scratch();
    let code = settings::code_hash("return kit.svg(10, 10, '');");
    let other = settings::code_hash("return kit.svg(20, 20, '');");
    assert_ne!(code, other);
    assert_eq!(code.len(), 64, "a SHA-256 in hex");
    // The window hashes the same code the same way (a known SHA-256 vector).
    assert_eq!(
        settings::code_hash("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert!(
        !settings::generator_allowed(Some(&dir), "library/talk.deck", &code),
        "nothing is allowed at first"
    );
    assert!(
        !settings::generator_allowed(None, "library/talk.deck", &code),
        "no place to look says no"
    );
    settings::set_allowed(&dir, "01PAGE").unwrap();
    settings::set_generator_allowed(&dir, "library/talk.deck", &code).unwrap();
    assert!(settings::generator_allowed(
        Some(&dir),
        "library/talk.deck",
        &code
    ));
    assert!(
        !settings::generator_allowed(Some(&dir), "library/talk.deck", &other),
        "other code in the same deck is not what the person saw"
    );
    assert!(!settings::generator_allowed(
        Some(&dir),
        "library/other.deck",
        &code
    ));
    assert!(
        !settings::generator_allowed(Some(&dir), "01PAGE", &code),
        "a page's allow is not a deck's"
    );
    assert!(
        settings::allowed(Some(&dir), "01PAGE"),
        "and a deck's is not a page's"
    );
    assert!(!settings::allowed(Some(&dir), "library/talk.deck"));
    // Allowing twice changes nothing.
    settings::set_generator_allowed(&dir, "library/talk.deck", &code).unwrap();
    assert!(settings::generator_allowed(
        Some(&dir),
        "library/talk.deck",
        &code
    ));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn nothing_is_kept_for_a_code_picture_that_is_in_no_deck() {
    let dir = scratch();
    let code = settings::code_hash("return kit.svg(10, 10, '');");
    for deck in ["", "   "] {
        let why = settings::set_generator_allowed(&dir, deck, &code).unwrap_err();
        assert!(why.contains("not in a deck"), "{why}");
        assert!(!settings::generator_allowed(Some(&dir), deck, &code));
    }
    // A hash that is not one is not kept either, and an allow made for a deck does not pass to no deck.
    assert!(settings::set_generator_allowed(&dir, "library/talk.deck", "").is_err());
    settings::set_generator_allowed(&dir, "library/talk.deck", &code).unwrap();
    assert!(!settings::generator_allowed(Some(&dir), "", &code));
    let _ = std::fs::remove_dir_all(dir);
}
