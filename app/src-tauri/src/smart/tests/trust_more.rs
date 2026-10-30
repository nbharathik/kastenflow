//! Who made a page, further: a page made from a template of an agent's page is
//! still the agent's, and with History off, where agents are held to Review, no
//! page runs before a person has allowed it.

use kasten_core::Instant;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;

use super::trust::{agent, data, made_by};
use super::{add_page, files, set_mode, smart};
use crate::chat::tests::vault_with;
use crate::smart::author;
use crate::smart::page;
use crate::smart::settings;
use crate::smart::trust::trust;

#[test]
fn a_page_made_from_a_template_of_an_agents_page_is_still_the_agents() {
    let s = smart();
    set_mode(s.k(), AgentMode::Review, &[]);
    let now = Instant::now();
    let (path, id) = made_by(s.k(), &agent("claude-code"), "Agent tracker");
    for (rel, bytes) in files() {
        s.k()
            .smart_write_file(&Actor::Human, &path, rel, &bytes, Some(""), now)
            .unwrap();
    }
    s.k().commit_edits().unwrap();
    let saved = s
        .k()
        .smart_save_template(&Actor::Human, &path, "Mine", now)
        .unwrap();
    let made = author::make(
        s.k(),
        &format!("mine:{}", saved.slug),
        None,
        Some("Copy"),
        now,
    )
    .unwrap();
    s.k().commit_edits().unwrap();
    let dir = data("template-copy");
    let page = s.k().read(&made.page).unwrap();
    let t = trust(s.k(), &page, Some(&dir), now);
    assert_eq!(t.made_by.as_deref(), Some("claude-code"));
    assert!(t.needs_allow, "the copy waits as the page did");
    // Allowing the first page is not allowing the copy: it has an id of its own.
    settings::set_allowed(&dir, &id).unwrap();
    assert!(trust(s.k(), &page, Some(&dir), now).needs_allow);
    // A starter the app ships is nobody's copy: the person's.
    let started = author::make(s.k(), "gallery", None, None, now).unwrap();
    let note = s.k().read(&started.page).unwrap();
    assert!(!trust(s.k(), &note, Some(&dir), now).needs_allow);
    // And a template of a person's own page makes the person's page.
    let (own, _) = add_page(s.k(), "Own", &files());
    let kept = s
        .k()
        .smart_save_template(&Actor::Human, &own, "Own template", now)
        .unwrap();
    let from_own = author::make(
        s.k(),
        &format!("mine:{}", kept.slug),
        None,
        Some("From own"),
        now,
    )
    .unwrap();
    let note = s.k().read(&from_own.page).unwrap();
    let t = trust(s.k(), &note, Some(&dir), now);
    assert_eq!(t.made_by, None);
    assert!(!t.needs_allow);
}

#[test]
fn the_leave_for_pictures_from_the_web_ends_when_the_pages_files_change() {
    let s = smart();
    let k = s.k();
    let dir = data("web-leave");
    let current = || page::fingerprint(k, &s.path);
    settings::set_web_images(&dir, &s.id, true, &current()).unwrap();
    assert!(settings::web_images(Some(&dir), &s.id, &current));
    // Code written afterwards, by anyone, does not inherit the leave.
    k.smart_write_file(
        &Actor::Human,
        &s.path,
        "app.js",
        b"window.app = 2; // new",
        None,
        Instant::now(),
    )
    .unwrap();
    assert!(!settings::web_images(Some(&dir), &s.id, &current));
    // The person gives it again, for the files as they are now.
    settings::set_web_images(&dir, &s.id, true, &current()).unwrap();
    assert!(settings::web_images(Some(&dir), &s.id, &current));
    // A file added or taken out ends it too.
    k.smart_write_file(
        &Actor::Human,
        &s.path,
        "data/more.json",
        b"{}",
        Some(""),
        Instant::now(),
    )
    .unwrap();
    assert!(!settings::web_images(Some(&dir), &s.id, &current));
    // No leave given: the fingerprint is never asked for.
    let never = || -> String { panic!("asked for nothing") };
    assert!(!settings::web_images(Some(&dir), "01NONE", &never));
}

#[test]
fn two_notes_with_one_id_run_neither_page() {
    let s = smart();
    let k = s.k();
    let text = std::fs::read(k.root().join(&s.path)).unwrap();
    let twin = std::path::Path::new(&s.path).with_file_name("twin-of-tracker.md");
    std::fs::write(k.root().join(&twin), text).unwrap();
    k.reindex().unwrap();
    assert!(
        page::path_of(k, &s.id).is_none(),
        "an id two notes carry names neither"
    );
    let refused = page::read(k, &s.path).unwrap_err();
    assert!(refused.contains("same id"), "{refused}");
    // Taking the twin away lets the page run again.
    std::fs::remove_file(k.root().join(&twin)).unwrap();
    k.reindex().unwrap();
    assert_eq!(page::path_of(k, &s.id).as_deref(), Some(s.path.as_str()));
    assert!(page::read(k, &s.path).is_ok());
}

#[test]
fn with_history_off_review_holds_every_page_until_a_person_allows_it() {
    let v = vault_with(false);
    let k = &*v.kasten;
    set_mode(k, AgentMode::Review, &[]);
    let (path, id) = add_page(k, "No history", &files());
    let dir = data("no-history");
    let now = Instant::now();
    let page = k.read(&path).unwrap();
    let t = trust(k, &page, Some(&dir), now);
    assert!(t.needs_allow && t.unknown_maker, "{t:?}");
    assert_eq!(t.made_by, None);
    settings::set_allowed(&dir, &id).unwrap();
    let t = trust(k, &page, Some(&dir), now);
    assert!(!t.needs_allow && !t.unknown_maker && t.allowed);
    // A page the person has just made from a starter is theirs for certain: allowed at once.
    let made = author::make(k, "gallery", None, None, now).unwrap();
    let fresh = k.read(&made.page).unwrap();
    assert!(trust(k, &fresh, Some(&dir), now).needs_allow);
    assert!(author::allow_a_page_just_made(k, &dir, &made, "gallery").unwrap());
    assert!(!trust(k, &fresh, Some(&dir), now).needs_allow);
    // One from a template of their own keeps asking (the template may be an agent's).
    let kept = k
        .smart_save_template(&Actor::Human, &made.page, "Mine", now)
        .unwrap();
    let from_template = author::make(k, &format!("mine:{}", kept.slug), None, None, now).unwrap();
    assert!(
        !author::allow_a_page_just_made(k, &dir, &from_template, &format!("mine:{}", kept.slug))
            .unwrap()
    );
    let again = k.read(&from_template.page).unwrap();
    assert!(trust(k, &again, Some(&dir), now).needs_allow);
    // Where agents may write, there is nothing to hold.
    set_mode(k, AgentMode::Balanced, &[]);
    let t = trust(k, &page, Some(&data("no-history-balanced")), now);
    assert!(!t.needs_allow && !t.unknown_maker);
}
