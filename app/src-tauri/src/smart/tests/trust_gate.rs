//! The gate and the switch under attack: frames opened before smart pages are
//! turned off serve and answer nothing afterwards, the permission file is
//! tolerant of garbage, and renaming or copying a page an agent made does not
//! pass for the person's "Allow to run".

use std::fs;
use std::path::Path;

use kasten_core::Instant;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::smart::CSP;
use tauri::http::{Method, Request, Response, StatusCode};

use super::protocol::{assert_safe_headers, text};
use super::trust::{approved, data, made_by};
use super::{set_mode, smart};
use crate::smart::commands::bound;
use crate::smart::protocol::{Serving, live_frame, respond};
use crate::smart::settings;
use crate::smart::trust::{may_open, trust};

/// Asks the scheme for `path` as the app's handler does: the switch is read from `dir` per request.
fn serve(s: &super::Smart, dir: &Path, frame: &str, path: &str) -> Response<Vec<u8>> {
    let request = Request::builder()
        .method(Method::GET)
        .uri(format!("smart://localhost/{frame}{path}"))
        .body(Vec::new())
        .unwrap();
    respond(
        &Serving {
            kasten: Some(s.k()),
            frame_page: &|nonce| live_frame(Some(dir), Some(&s.rt), nonce),
            web_images: &|_| false,
        },
        &request,
    )
}

#[test]
fn frames_open_before_the_switch_goes_off_serve_nothing_afterwards_and_come_back_on_when_it_is_on()
{
    let s = smart();
    let dir = data("kill");
    let page = format!("/{}/index.html", s.id);
    let other = s.rt.open_frame(&s.id).unwrap();
    assert_eq!(serve(&s, &dir, &s.frame, &page).status(), StatusCode::OK);
    assert_eq!(
        serve(&s, &dir, &other, "/kit/1/kit.js").status(),
        StatusCode::OK
    );

    // The switch is written first, then the frames end (as the command does):
    // between the two, and after, an old secret gets nothing.
    settings::set_run_enabled(&dir, false).unwrap();
    for (frame, path) in [(&s.frame, page.as_str()), (&other, "/kit/1/kit.js")] {
        let response = serve(&s, &dir, frame, path);
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_safe_headers(&response, CSP, path);
        assert!(!text(&response).contains("window.app"), "{path}");
    }
    s.rt.close_all();
    assert!(
        bound(s.k(), &s.rt, &s.path, &s.frame).is_err(),
        "no call is answered"
    );
    for frame in [&s.frame, &other] {
        let response = serve(&s, &dir, frame, &page);
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_safe_headers(&response, CSP, "after");
    }
    // A frame cannot begin while it is off.
    let note = s.k().read(&s.path).unwrap();
    assert!(may_open(s.k(), &note, Some(&dir), Instant::now()).is_err());

    // On again: the old secrets stay dead (the window makes new frames), new ones work.
    settings::set_run_enabled(&dir, true).unwrap();
    assert_eq!(
        serve(&s, &dir, &s.frame, &page).status(),
        StatusCode::NOT_FOUND
    );
    let fresh = s.rt.open_frame(&s.id).unwrap();
    assert_eq!(serve(&s, &dir, &fresh, &page).status(), StatusCode::OK);
    assert!(may_open(s.k(), &note, Some(&dir), Instant::now()).is_ok());
}

#[test]
fn the_permission_file_is_tolerant_of_garbage_locks_and_a_missing_folder() {
    let dir = data("garbage");
    fs::create_dir_all(&dir).unwrap();
    for junk in [
        "",
        "null",
        "[]",
        "{\"allowed\": 5}",
        "{\"allowed\": [1, 2]}",
        "\u{0}\u{0}",
    ] {
        fs::write(dir.join("smart-pages.json"), junk).unwrap();
        assert!(!settings::allowed(Some(&dir), "01AAA"), "{junk:?}");
        assert!(settings::run_enabled(Some(&dir)), "{junk:?}");
        // A choice made over junk writes a good file.
        settings::set_allowed(&dir, "01AAA").unwrap();
        assert!(settings::allowed(Some(&dir), "01AAA"), "{junk:?}");
    }
    // A data folder that is not there yet is made; one that cannot be made says so.
    let deep = dir.join("not/made/yet");
    settings::set_allowed(&deep, "01BBB").unwrap();
    assert!(settings::allowed(Some(&deep), "01BBB"));
    let blocked = dir.join("smart-pages.json");
    assert!(settings::set_allowed(&blocked, "01CCC").is_err());
    // A directory where the file should be reads as "no", never as a permission.
    let in_the_way = data("in-the-way");
    fs::create_dir_all(in_the_way.join("smart-pages.json")).unwrap();
    assert!(!settings::allowed(Some(&in_the_way), "01AAA"));
    assert!(settings::run_enabled(Some(&in_the_way)));
}

#[test]
fn a_page_an_agent_made_stays_held_when_a_person_renames_or_copies_it() {
    let s = smart();
    set_mode(s.k(), AgentMode::Review, &[]);
    let (path, id) = made_by(s.k(), &approved("claude-code"), "Agent made");
    let dir = data("rename");
    let now = Instant::now();
    let renamed = s
        .k()
        .rename(&Actor::Human, &path, "Organised by me", now)
        .unwrap()
        .note;
    assert_ne!(renamed.meta.path, path);
    assert_eq!(renamed.meta.id.as_deref(), Some(id.as_str()));
    let read = |path: &str| s.k().read(path).unwrap();
    let t = trust(s.k(), &read(&renamed.meta.path), Some(&dir), now);
    assert!(t.needs_allow, "a rename is not the permission");
    assert_eq!(t.made_by.as_deref(), Some("claude-code"));
    // Nor is a copy (it has an id of its own, and the folder with it).
    let copy = s
        .k()
        .duplicate(&Actor::Human, &renamed.meta.path, now)
        .unwrap();
    assert_ne!(copy.meta.id, renamed.meta.id);
    let t = trust(s.k(), &read(&copy.meta.path), Some(&dir), now);
    assert!(t.needs_allow, "a copy is not the permission");
    // Once the person allows the page, it and its renamed self run.
    settings::set_allowed(&dir, &id).unwrap();
    assert!(!trust(s.k(), &read(&renamed.meta.path), Some(&dir), now).needs_allow);
}
