//! A project page's state (status, health, next action, review days): fixed
//! vocabularies, checked as a whole before anything is written, stored in the
//! page's `props` and committed once. Nothing else in the page changes.

mod refusals;

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote, ProjectState};

const PAGE: &str = "projects/photo-organiser/_project.md";
const OTHER: &str = "projects/note-taking-study/_project.md";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn set(v: &str) -> Option<Option<String>> {
    Some(Some(v.to_owned()))
}

const CLEAR: Option<Option<String>> = Some(None);

fn text(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn head(k: &Kasten) -> String {
    k.log(None, 1).unwrap()[0].id.clone()
}

/// A state that changes one thing, as the test names it.
fn state(change: impl FnOnce(&mut ProjectState)) -> ProjectState {
    let mut state = ProjectState::default();
    change(&mut state);
    state
}

/// A task note called `title` in the photo organiser, with the `task` tag.
fn task(k: &Kasten, title: &str, status: &str) -> String {
    let note = k
        .create(
            &Actor::Human,
            &NewNote {
                kind: Kind::Card,
                title: title.to_owned(),
                date: "2026-10-06".to_owned(),
                project: Some("photo-organiser".to_owned()),
                parent: None,
                template: None,
                icon: None,
            },
            NOW,
        )
        .unwrap();
    k.set_tags(
        &Actor::Human,
        &note.meta.path,
        &["task".to_owned()],
        &[],
        NOW,
    )
    .unwrap();
    let props = serde_json::json!({"status": status})
        .as_object()
        .unwrap()
        .clone();
    k.update_props(&Actor::Human, &note.meta.path, &props, NOW)
        .unwrap();
    note.meta.path
}

#[test]
fn sets_every_field_in_the_pages_props_and_commits_once() {
    let (t, k) = open();
    let before = head(&k);
    let all = state(|s| {
        s.status = set("Active");
        s.health = set("At risk");
        s.reviewed = set("2026-10-05");
        s.review_after = set("2026-10-12");
    });
    let note = k.set_project_state(&Actor::Human, PAGE, &all, NOW).unwrap();
    assert_eq!(note.meta.props["status"], "Active");
    assert_eq!(note.meta.props["health"], "At risk");
    assert_eq!(note.meta.props["last_review"], "2026-10-05");
    assert_eq!(note.meta.props["review_after"], "2026-10-12");
    let log = k.log(None, 2).unwrap();
    assert_eq!(log[1].id, before, "one commit");
    assert_eq!(
        log[0].summary,
        "project: Photo organiser — Active, At risk, reviewed 2026-10-05, review after 2026-10-12"
    );
    // Only the props and `updated` changed: every other line of the page is as it was.
    let after = text(&t, PAGE);
    assert!(after.contains("props:\n  status: Active\n  health: At risk\n  last_review: 2026-10-05\n  review_after: 2026-10-12\n"), "{after}");
    let kept = |s: &str| -> Vec<String> {
        s.lines()
            .filter(|l| !l.starts_with("updated:") && !l.starts_with("  ") && *l != "props:")
            .map(str::to_owned)
            .collect()
    };
    let original = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/dev-vault")
            .join(PAGE),
    )
    .unwrap();
    assert_eq!(kept(&after), kept(&original));
    assert!(after.contains("updated: 2026-09-24T08:00:00Z\n"), "{after}");
}

#[test]
fn accepts_the_vocabularies_in_any_case_and_writes_them_as_spelled_here() {
    let (_t, k) = open();
    let lower = state(|s| {
        s.status = set("paused");
        s.health = set("BLOCKED");
    });
    let note = k
        .set_project_state(&Actor::Human, PAGE, &lower, NOW)
        .unwrap();
    assert_eq!(note.meta.props["status"], "Paused");
    assert_eq!(note.meta.props["health"], "Blocked");
    for done in ["Done", "done"] {
        let s = state(|s| s.status = set(done));
        let saved = k.set_project_state(&Actor::Human, PAGE, &s, NOW).unwrap();
        assert_eq!(saved.meta.props["status"], "Done");
    }
}

#[test]
fn a_key_left_out_stays_and_none_takes_a_key_away() {
    let (t, k) = open();
    let first = state(|s| {
        s.status = set("Paused");
        s.health = set("Blocked");
        s.reviewed = set("2026-10-01");
    });
    k.set_project_state(&Actor::Human, PAGE, &first, NOW)
        .unwrap();
    let no_health = state(|s| s.health = CLEAR);
    let note = k
        .set_project_state(&Actor::Human, PAGE, &no_health, NOW)
        .unwrap();
    assert_eq!(note.meta.props["status"], "Paused");
    assert!(note.meta.props.get("health").is_none());
    assert_eq!(note.meta.props["last_review"], "2026-10-01");
    // Taking the last ones away leaves no empty `props:`.
    let none = state(|s| {
        s.status = CLEAR;
        s.reviewed = CLEAR;
    });
    k.set_project_state(&Actor::Human, PAGE, &none, NOW)
        .unwrap();
    assert!(!text(&t, PAGE).contains("props:"), "{}", text(&t, PAGE));
}

#[test]
fn the_next_action_is_a_task_note_stored_by_id_and_given_one_in_the_same_commit() {
    let (t, k) = open();
    let path = task(&k, "Ask Anna", "Todo");
    // A task written by hand, with no id yet.
    let bare = "projects/photo-organiser/cards/bare-task.md";
    fs::write(
        t.vault.root().join(bare),
        "---\ntitle: Bare task\ntype: card\ntags: [task]\nprops:\n  status: Todo\n---\nDo it.\n",
    )
    .unwrap();
    k.outside_changes(&[bare.to_owned()], 1);
    k.commit_external().unwrap();
    assert!(!text(&t, bare).contains("id:"));

    let before = head(&k);
    let id = k.read(&path).unwrap().meta.id.unwrap();
    // By title, by path and by id name the same note.
    for reference in ["Ask Anna", path.as_str(), id.as_str()] {
        let s = state(|s| s.next_action = set(reference));
        let note = k.set_project_state(&Actor::Human, PAGE, &s, NOW).unwrap();
        assert_eq!(note.meta.props["next_action"], id.as_str(), "{reference}");
    }
    let s = state(|s| s.next_action = set(bare));
    let note = k.set_project_state(&Actor::Human, PAGE, &s, NOW).unwrap();
    let given = k
        .read(bare)
        .unwrap()
        .meta
        .id
        .expect("the task was given an id");
    assert_eq!(note.meta.props["next_action"], given.as_str());
    let log = k.log(None, 8).unwrap();
    assert_eq!(log[0].summary, "project: Photo organiser — next: Bare task");
    let changed: Vec<String> = k
        .commit_changes(&log[0].id)
        .unwrap()
        .into_iter()
        .map(|c| c.path)
        .collect();
    assert!(
        changed.contains(&PAGE.to_owned()) && changed.contains(&bare.to_owned()),
        "{changed:?}"
    );
    assert_ne!(log[0].id, before);
    // The id was written into the task's own frontmatter and nothing else of it changed.
    assert!(text(&t, bare).contains(&format!("id: {given}\n")));
    assert!(text(&t, bare).ends_with("---\nDo it.\n"));
}

#[test]
fn undo_takes_the_whole_change_back_byte_for_byte() {
    let (t, k) = open();
    let task_path = task(&k, "Ask Anna", "Todo");
    let before = (text(&t, PAGE), text(&t, &task_path));
    let all = state(|s| {
        s.status = set("Done");
        s.health = set("On track");
        s.next_action = set("Ask Anna");
        s.reviewed = set("2026-10-06");
    });
    k.set_project_state(&Actor::Human, PAGE, &all, NOW).unwrap();
    let commit = head(&k);
    assert_ne!(text(&t, PAGE), before.0);
    k.undo_commit(&commit, NOW).unwrap();
    assert_eq!((text(&t, PAGE), text(&t, &task_path)), before);
}

#[test]
fn saying_what_is_already_so_changes_and_commits_nothing() {
    let (_t, k) = open();
    let same = state(|s| {
        s.status = set("Paused");
        s.health = set("At risk");
    });
    k.set_project_state(&Actor::Human, PAGE, &same, NOW)
        .unwrap();
    let (head_before, revision) = (head(&k), k.revision());
    let again = k
        .set_project_state(&Actor::Human, PAGE, &same, NOW)
        .unwrap();
    assert_eq!(again.meta.props["status"], "Paused");
    assert_eq!(head(&k), head_before);
    assert_eq!(k.revision(), revision);
    // Clearing what was never set is no change either.
    let never = state(|s| s.health = CLEAR);
    k.set_project_state(&Actor::Human, OTHER, &never, NOW)
        .unwrap();
    assert_eq!(head(&k), head_before);
}
