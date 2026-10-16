//! The rules staging keeps: the refusals that still hold, what cannot be
//! previewed and waits for review, the size of a set, discarding it, and that
//! staging counts against no limit.

use std::fs;

use kasten_core::Outcome;
use kasten_core::agent::AgentOp;
use serde_json::{Map, json};

use crate::change_sets::{DRAFT, WELCOME, append, create, open, replace, snapshot, stage};
use crate::common::NOW;

fn waiting(outcome: &Outcome) -> String {
    match outcome {
        Outcome::PendingReview { reason, .. } => reason.clone(),
        other => panic!("expected a proposal, got {other:?}"),
    }
}

#[test]
fn refusals_hold_when_staging() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    // A locked note.
    let file = t.vault.root().join(DRAFT);
    let text = fs::read_to_string(&file).unwrap().replacen(
        "tags: [paper]",
        "tags: [paper]\nlocked: true",
        1,
    );
    fs::write(&file, text).unwrap();
    k.reindex().unwrap();
    let err = k.stage(&mut set, &s, &append(DRAFT, "x"), NOW).unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    // A template, a hidden folder and a write over 200 KB.
    let err = k
        .stage(&mut set, &s, &append("templates/page.md", "x"), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("read-only"), "{err}");
    let err = k
        .stage(&mut set, &s, &append(".kasten/config.yaml", "x"), NOW)
        .unwrap_err();
    assert!(
        err.to_string().contains("read-only") || err.to_string().contains("not"),
        "{err}"
    );
    let big = "x".repeat(210 * 1024);
    let err = k
        .stage(&mut set, &s, &append(WELCOME, &big), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("200 KB"), "{err}");
    assert!(set.is_empty() && set.steps.is_empty(), "nothing was staged");
    // Trust lifts no refusal.
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    assert!(k.stage(&mut set, &s, &append(DRAFT, "x"), NOW).is_err());
}

#[test]
fn what_cannot_be_previewed_waits_for_review_and_never_runs() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    let before = snapshot(t.vault.root());
    let mut related = Map::new();
    related.insert("related".into(), json!(["Related work notes"]));
    let ops = [
        AgentOp::Rename {
            path: WELCOME.into(),
            title: "A new name".into(),
        },
        AgentOp::Move {
            path: WELCOME.into(),
            project: Some("photo-organiser".into()),
        },
        AgentOp::Trash {
            path: WELCOME.into(),
            reason: None,
        },
        AgentOp::Edit {
            path: WELCOME.into(),
            body: "Rewritten.".into(),
            base: String::new(),
            reason: None,
        },
        AgentOp::TagSchema {
            tag: "trip".into(),
            schema: json!({"properties": [{"key": "stage", "type": "select", "options": ["Idea"]}]}),
        },
        // A relation names another note, which is not previewed.
        AgentOp::UpdateProps {
            path: DRAFT.into(),
            props: related,
        },
    ];
    for op in &ops {
        let outcome = k.stage(&mut set, &s, op, NOW).unwrap();
        let why = waiting(&outcome);
        assert!(why.contains("waits for your review"), "{op:?}: {why}");
    }
    assert!(set.is_empty(), "none of them went into the set");
    assert_eq!(k.proposals().unwrap().len(), ops.len());
    // Only the proposals' own files are new; no note changed.
    let after = snapshot(t.vault.root());
    let changed: Vec<&String> = after
        .iter()
        .filter(|(p, b)| before.get(*p) != Some(*b))
        .map(|(p, _)| p)
        .collect();
    assert!(
        changed.iter().all(|p| p.starts_with(".kasten/proposals/")),
        "{changed:?}"
    );
    assert!(t.vault.exists(WELCOME));
}

#[test]
fn a_note_only_the_set_has_cannot_be_renamed_or_trashed_yet() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    let made = stage(&k, &mut set, &s, &create("Only staged", "x"));
    let path = made["path"].as_str().unwrap().to_owned();
    for op in [
        AgentOp::Rename {
            path: path.clone(),
            title: "Other".into(),
        },
        AgentOp::Trash {
            path: path.clone(),
            reason: None,
        },
    ] {
        let err = k.stage(&mut set, &s, &op, NOW).unwrap_err().to_string();
        assert!(err.contains("only in the staged changes"), "{err}");
    }
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn a_step_that_fails_leaves_the_set_as_it_was() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &append(WELCOME, "Kept."));
    let before = set.clone();
    let err = k
        .stage(&mut set, &s, &replace(WELCOME, "No such heading", "x"), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("No heading"), "{err}");
    assert_eq!(set, before);
}

#[test]
fn a_set_holds_at_most_fifty_files_and_two_megabytes() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    for n in 0..50 {
        stage(&k, &mut set, &s, &create(&format!("Note {n}"), "x"));
    }
    let err = k
        .stage(&mut set, &s, &create("One too many", "x"), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("at most 50 files"), "{err}");
    assert_eq!(set.created_files.len(), 50);
    // Changing a file already in the set is not another file.
    stage(&k, &mut set, &s, &append("library/note-0.md", "more"));
    assert_eq!(set.created_files.len(), 50);

    // Two megabytes of text: ten notes of 190 KB fit, the eleventh does not.
    let mut big = k.begin_changes(&s, NOW);
    let text = "word ".repeat(38 * 1024);
    for n in 0..10 {
        stage(&k, &mut big, &s, &create(&format!("Big {n}"), &text));
    }
    let err = k
        .stage(&mut big, &s, &create("Big 10", &text), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("at most 2 MB"), "{err}");
}

#[test]
fn discarding_removes_only_the_cache_folder() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    let head = k.log(None, 1).unwrap()[0].id.clone();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &append(WELCOME, "x"));
    stage(&k, &mut set, &s, &create("Gone", "y"));
    let dir = t.vault.root().join(".kasten/cache/changes").join(&set.id);
    assert!(dir.join("set.json").is_file());
    k.discard_changes(&set).unwrap();
    assert!(!dir.exists());
    // The folder of every other set stays, and so does the rest of the cache.
    assert!(t.vault.root().join(".kasten/cache/index.sqlite").exists());
    assert_eq!(snapshot(t.vault.root()), before);
    assert_eq!(k.log(None, 1).unwrap()[0].id, head);
    // Discarding twice is fine; an id that is not a set's cannot point elsewhere.
    k.discard_changes(&set).unwrap();
    let mut forged = set.clone();
    forged.id = "../../../library".into();
    assert!(k.discard_changes(&forged).is_err());
    assert!(t.vault.root().join("library").is_dir());
}

#[test]
fn staging_does_not_count_against_the_soft_limits() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    // More than the 25 notes a session may change in ten minutes.
    for n in 0..30 {
        let outcome = k
            .stage(&mut set, &s, &create(&format!("Many {n}"), "x"), NOW)
            .unwrap();
        assert!(matches!(outcome, Outcome::Staged { .. }));
    }
}
