//! What a project's state refuses, and who may change it: a bad value stops the
//! whole change, a tag's own rules hold, agents keep off a locked page, and what
//! the app does not know survives.

use std::fs;

use super::{OTHER, PAGE, head, open, set, state, task, text};
use crate::common::NOW;
use kasten_core::history::Actor;
use kasten_core::{Error, ProjectState};

const ROADMAP: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";

#[test]
fn a_bad_change_is_refused_whole_and_writes_nothing() {
    let (t, k) = open();
    let _ = task(&k, "A task", "Todo");
    let before = head(&k);
    let page_before = text(&t, PAGE);
    let roadmap_before = text(&t, ROADMAP);
    let active = |change: fn(&mut ProjectState)| {
        state(|s| {
            s.status = set("Active");
            change(s);
        })
    };
    let cases: Vec<(&str, &str, ProjectState)> = vec![
        (PAGE, "status", state(|s| s.status = set("Someday"))),
        (PAGE, "health", active(|s| s.health = set("Fine"))),
        (PAGE, "day", active(|s| s.reviewed = set("2026-02-30"))),
        (PAGE, "day", active(|s| s.review_after = set("next week"))),
        (
            PAGE,
            "task",
            active(|s| s.next_action = set("Photo organiser roadmap")),
        ),
        (
            PAGE,
            "No note",
            active(|s| s.next_action = set("No such task")),
        ),
        (ROADMAP, "project page", active(|_| {})),
        (
            "projects/photo-organiser/_project",
            "project page",
            active(|_| {}),
        ),
        (
            "library/zettelkasten-method.md",
            "project page",
            active(|_| {}),
        ),
    ];
    for (path, word, change) in cases {
        let err = k
            .set_project_state(&Actor::Human, path, &change, NOW)
            .unwrap_err();
        assert!(
            matches!(err, Error::Invalid(ref m) if m.contains(word)),
            "{path}: {err:?}"
        );
    }
    assert_eq!(text(&t, PAGE), page_before);
    assert_eq!(text(&t, ROADMAP), roadmap_before);
    assert_eq!(head(&k), before);
}

#[test]
fn a_tag_that_defines_status_with_other_options_stops_the_change_and_is_named() {
    let (t, k) = open();
    k.set_tags(&Actor::Human, PAGE, &["paper".to_owned()], &[], NOW)
        .unwrap();
    let before = text(&t, PAGE);
    let paused = state(|s| s.status = set("Paused"));
    let err = k
        .set_project_state(&Actor::Human, PAGE, &paused, NOW)
        .unwrap_err();
    let Error::Invalid(message) = err else {
        panic!("{err:?}")
    };
    assert!(
        message.contains("paper") && message.contains("status"),
        "{message}"
    );
    assert_eq!(text(&t, PAGE), before);
    // A property the tag does not define is fine.
    let blocked = state(|s| s.health = set("Blocked"));
    k.set_project_state(&Actor::Human, PAGE, &blocked, NOW)
        .unwrap();
}

#[test]
fn a_locked_project_page_is_read_only_for_agents_and_open_to_the_person() {
    let (_t, k) = open();
    k.set_meta(&Actor::Human, PAGE, "locked", Some("true"), NOW)
        .unwrap();
    let agent = Actor::Agent {
        client: "test".into(),
        session: "s-1".into(),
    };
    let paused = state(|s| s.status = set("Paused"));
    assert!(matches!(
        k.set_project_state(&agent, PAGE, &paused, NOW),
        Err(Error::Invalid(_))
    ));
    assert!(
        k.set_project_state(&Actor::Human, PAGE, &paused, NOW)
            .is_ok()
    );
    // An unlocked page takes an agent's change, committed as the agent's.
    let ok = k.set_project_state(&agent, OTHER, &paused, NOW).unwrap();
    assert_eq!(ok.meta.props["status"], "Paused");
    assert!(k.log(None, 1).unwrap()[0].agent);
}

#[test]
fn frontmatter_the_app_does_not_know_survives_byte_for_byte() {
    let (t, k) = open();
    let odd = "---\r\nid: 01ODDPROJECT0000000000000A\r\ntitle: Odd one\r\ntype: project\r\ntags: [project]\r\n# a comment kept as it is\r\nx-other: {a: 1, b: [2, 3]}\r\nprops:\r\n  summary: \"Tricky: yes\"\r\n  weird: [a, b]\r\n---\r\nBody line.\r\n";
    let path = "projects/odd-one/_project.md";
    fs::create_dir_all(t.vault.root().join("projects/odd-one")).unwrap();
    fs::write(t.vault.root().join(path), odd).unwrap();
    k.outside_changes(&[path.to_owned()], 1);
    let paused = state(|s| s.status = set("Paused"));
    k.set_project_state(&Actor::Human, path, &paused, NOW)
        .unwrap();
    let after = text(&t, path);
    for line in [
        "# a comment kept as it is\r\n",
        "x-other: {a: 1, b: [2, 3]}\r\n",
        "  summary: \"Tricky: yes\"\r\n",
        "  weird: [a, b]\r\n",
        "  status: Paused\r\n",
    ] {
        assert!(after.contains(line), "{line:?} in {after:?}");
    }
    assert!(after.ends_with("---\r\nBody line.\r\n"));
}
