//! Who may run a smart page: a page an agent made in Review mode waits for a
//! person's "Allow to run", and the whole feature has a switch that stops
//! every frame. Both are kept in the app's data folder, set by window
//! commands only, and checked where a frame begins.

use std::fs;
use std::path::PathBuf;

use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, Kind, NewNote};

use super::{add_page, files, set_mode, smart};
use crate::smart::runtime::Runtime;
use crate::smart::settings;
use crate::smart::trust::{client_name, may_open, trust};

pub(super) fn data(name: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("kasten-smart-trust-{}", std::process::id()))
        .join(name);
    let _ = fs::remove_dir_all(&dir);
    dir
}

pub(super) fn agent(client: &str) -> Actor {
    Actor::Agent {
        client: client.to_owned(),
        session: "s-1".to_owned(),
    }
}

pub(super) fn approved(client: &str) -> Actor {
    Actor::Approved {
        client: client.to_owned(),
        session: "s-1".to_owned(),
        by: "Bharathi".to_owned(),
    }
}

/// A smart page that `actor` made (the layout and the folder are set by a person after).
pub(super) fn made_by(k: &Kasten, actor: &Actor, title: &str) -> (String, String) {
    let now = Instant::now();
    let page = k
        .create(
            actor,
            &NewNote {
                kind: Kind::Page,
                title: title.to_owned(),
                date: "2026-10-10".to_owned(),
                project: None,
                parent: None,
                template: None,
                icon: None,
            },
            now,
        )
        .unwrap();
    k.set_meta(&Actor::Human, &page.meta.path, "layout", Some("smart"), now)
        .unwrap();
    k.commit_edits().unwrap();
    (page.meta.path, page.meta.id.unwrap())
}

fn note(k: &Kasten, path: &str) -> kasten_core::NoteFile {
    k.read(path).unwrap()
}

#[test]
fn a_page_a_person_made_runs_without_asking() {
    let s = smart();
    let dir = data("person");
    let t = trust(s.k(), &note(s.k(), &s.path), Some(&dir), Instant::now());
    assert_eq!(t.made_by, None);
    assert!(!t.needs_allow);
    assert!(may_open(s.k(), &note(s.k(), &s.path), Some(&dir), Instant::now()).is_ok());
}

#[test]
fn a_page_an_agent_made_in_review_mode_waits_for_a_person() {
    let s = smart();
    set_mode(s.k(), AgentMode::Review, &[]);
    let (path, id) = made_by(s.k(), &agent("claude-code"), "Agent tracker");
    let dir = data("review");
    let now = Instant::now();

    let t = trust(s.k(), &note(s.k(), &path), Some(&dir), now);
    assert_eq!(t.made_by.as_deref(), Some("claude-code"));
    assert!(t.needs_allow && !t.allowed);
    let refused = may_open(s.k(), &note(s.k(), &path), Some(&dir), now).unwrap_err();
    assert!(refused.contains("Allow"), "{refused}");

    // A person's click, kept by the page's id: once.
    settings::set_allowed(&dir, &id).unwrap();
    let t = trust(s.k(), &note(s.k(), &path), Some(&dir), now);
    assert!(t.allowed && !t.needs_allow);
    assert_eq!(t.made_by.as_deref(), Some("claude-code"));
    assert!(may_open(s.k(), &note(s.k(), &path), Some(&dir), now).is_ok());
    // It is the page's alone: another page of the same agent still waits.
    let (other, _) = made_by(s.k(), &agent("claude-code"), "Second tracker");
    assert!(trust(s.k(), &note(s.k(), &other), Some(&dir), now).needs_allow);
    // A fresh data folder (a vault someone sent, a new computer) never brings it along.
    assert!(trust(s.k(), &note(s.k(), &path), Some(&data("fresh")), now).needs_allow);
    assert!(trust(s.k(), &note(s.k(), &path), None, now).needs_allow);
}

#[test]
fn a_page_that_waits_for_a_person_is_not_kept_as_a_template_before_it_is_allowed() {
    let s = smart();
    set_mode(s.k(), AgentMode::Review, &[]);
    let (path, id) = made_by(s.k(), &agent("claude-code"), "Agent tracker");
    let dir = data("template");
    let now = Instant::now();
    let held =
        crate::smart::author::may_keep(s.k(), &note(s.k(), &path), Some(&dir), now).unwrap_err();
    assert!(held.contains("Allow it first"), "{held}");
    settings::set_allowed(&dir, &id).unwrap();
    assert!(crate::smart::author::may_keep(s.k(), &note(s.k(), &path), Some(&dir), now).is_ok());
    // A page a person made is never held.
    assert!(crate::smart::author::may_keep(s.k(), &note(s.k(), &s.path), Some(&dir), now).is_ok());
}

#[test]
fn a_page_made_through_a_held_change_waits_whatever_the_mode_is_now() {
    let s = smart();
    set_mode(s.k(), AgentMode::Balanced, &[]);
    let (path, _) = made_by(s.k(), &approved("claude-code"), "Reviewed tracker");
    let t = trust(
        s.k(),
        &note(s.k(), &path),
        Some(&data("held")),
        Instant::now(),
    );
    assert_eq!(t.made_by.as_deref(), Some("claude-code"));
    assert!(t.needs_allow);
}

#[test]
fn a_page_an_agent_made_in_balanced_or_autonomous_mode_is_not_held_back() {
    let s = smart();
    set_mode(s.k(), AgentMode::Balanced, &[]);
    let (path, _) = made_by(s.k(), &agent("claude-code"), "Balanced tracker");
    let t = trust(
        s.k(),
        &note(s.k(), &path),
        Some(&data("balanced")),
        Instant::now(),
    );
    assert_eq!(t.made_by.as_deref(), Some("claude-code"));
    assert!(!t.needs_allow);
    set_mode(s.k(), AgentMode::Autonomous, &[]);
    let (path, _) = made_by(s.k(), &agent("claude-code"), "Autonomous tracker");
    assert!(
        !trust(
            s.k(),
            &note(s.k(), &path),
            Some(&data("auto")),
            Instant::now()
        )
        .needs_allow
    );
}

#[test]
fn an_agent_does_not_pass_for_a_person_by_its_name() {
    // Only the commit's author says who made a page; a title or a client name that looks like
    // a person changes nothing.
    let s = smart();
    set_mode(s.k(), AgentMode::Review, &[]);
    let (path, _) = made_by(s.k(), &agent("Bharathi"), "Looks like me");
    let t = trust(
        s.k(),
        &note(s.k(), &path),
        Some(&data("name")),
        Instant::now(),
    );
    assert_eq!(t.made_by.as_deref(), Some("Bharathi"));
    assert!(t.needs_allow);
    assert_eq!(client_name("agent:claude-code"), "claude-code");
    assert_eq!(
        client_name("agent:smart:library/x.md"),
        "smart:library/x.md"
    );
    assert_eq!(client_name("Bharathi"), "Bharathi");
}

#[test]
fn the_switch_is_on_until_a_person_turns_it_off() {
    let s = smart();
    let dir = data("switch");
    assert!(settings::run_enabled(Some(&dir)));
    assert!(settings::run_enabled(None), "no data folder: the default");
    settings::set_run_enabled(&dir, false).unwrap();
    assert!(!settings::run_enabled(Some(&dir)));
    let refused = may_open(s.k(), &note(s.k(), &s.path), Some(&dir), Instant::now()).unwrap_err();
    assert!(refused.contains("off"), "{refused}");
    settings::set_run_enabled(&dir, true).unwrap();
    assert!(settings::run_enabled(Some(&dir)));
    assert!(may_open(s.k(), &note(s.k(), &s.path), Some(&dir), Instant::now()).is_ok());
}

#[test]
fn the_choices_share_a_file_and_do_not_undo_each_other() {
    let dir = data("together");
    settings::set_web_images(&dir, "01AAA", true, "same").unwrap();
    settings::set_allowed(&dir, "01AAA").unwrap();
    settings::set_run_enabled(&dir, false).unwrap();
    settings::set_web_images(&dir, "01BBB", true, "same").unwrap();
    let same = || "same".to_owned();
    assert!(
        settings::web_images(Some(&dir), "01AAA", &same)
            && settings::web_images(Some(&dir), "01BBB", &same)
    );
    assert!(settings::allowed(Some(&dir), "01AAA") && !settings::allowed(Some(&dir), "01BBB"));
    assert!(!settings::run_enabled(Some(&dir)));
    // A file from before these choices existed still reads.
    fs::write(dir.join("smart-pages.json"), r#"{"webImages":["01OLD"]}"#).unwrap();
    assert!(settings::web_images(Some(&dir), "01OLD", &same));
    assert!(settings::run_enabled(Some(&dir)));
    assert!(!settings::allowed(Some(&dir), "01OLD"));
    // One that does not read says no to a permission and yes to the default.
    fs::write(dir.join("smart-pages.json"), "{ not json").unwrap();
    assert!(!settings::allowed(Some(&dir), "01OLD"));
    assert!(settings::run_enabled(Some(&dir)));
}

#[test]
fn turning_the_switch_off_ends_every_frame() {
    let rt = Runtime::default();
    let a = rt.open_frame("01AAA").unwrap();
    let b = rt.open_frame("01BBB").unwrap();
    assert!(rt.frame_page(&a).is_some() && rt.frame_page(&b).is_some());
    rt.close_all();
    assert!(rt.frame_page(&a).is_none() && rt.frame_page(&b).is_none());
    // Frames made afterwards work.
    let c = rt.open_frame("01CCC").unwrap();
    assert_eq!(rt.frame_page(&c).as_deref(), Some("01CCC"));
}

#[test]
fn the_codes_history_lists_the_commits_that_changed_the_folder_and_no_others() {
    let s = smart();
    let dir = kasten_core::smart::sidecar_dir(&s.path).unwrap();
    let k = s.k();
    let now = Instant::now();
    let before = k.log(Some(&dir), 50).unwrap().len();
    assert!(before >= 1);
    // The page's own header changing is not a change of its code.
    k.set_meta(&Actor::Human, &s.path, "width", Some("wide"), now)
        .unwrap();
    k.commit_edits().unwrap();
    assert_eq!(k.log(Some(&dir), 50).unwrap().len(), before);
    k.smart_write_file(
        &Actor::Human,
        &s.path,
        "app.js",
        b"window.app = 2;",
        None,
        now,
    )
    .unwrap();
    k.commit_edits().unwrap();
    let log = k.log(Some(&dir), 50).unwrap();
    assert_eq!(log.len(), before + 1);
    assert!(log[0].summary.contains("app.js"), "{}", log[0].summary);
    // And a version of it comes back as one more.
    let restored = k
        .smart_restore_version(&Actor::Human, &s.path, &log[1].id, now)
        .unwrap();
    assert_eq!(restored.written, [format!("{dir}/app.js")]);
    assert_eq!(k.log(Some(&dir), 50).unwrap().len(), before + 2);
}

#[test]
fn other_pages_do_not_borrow_a_pages_permission_by_the_same_title() {
    let s = smart();
    set_mode(s.k(), AgentMode::Review, &[]);
    let (first, first_id) = made_by(s.k(), &agent("claude-code"), "Twin");
    let dir = data("twin");
    settings::set_allowed(&dir, &first_id).unwrap();
    let (second, _) = add_page(s.k(), "Twin", &files());
    // The person's own page of the same title needs nothing; the agent's second page still would.
    assert!(!trust(s.k(), &note(s.k(), &second), Some(&dir), Instant::now()).needs_allow);
    assert!(trust(s.k(), &note(s.k(), &first), Some(&dir), Instant::now()).allowed);
}
