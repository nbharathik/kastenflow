//! Deciding proposals: what is accepted is the change the reviewer saw,
//! merged with edits made since, and each proposal is decided once.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::frontmatter::split;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};

const PLAN: &str = "library/plan.md";

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let long: String = (0..30)
        .map(|n| format!("Line {n} of the plan with some words.\n"))
        .collect();
    let text = format!("---\ntitle: Plan\n---\n## Keep\n\nShort.\n\n## Details\n\n{long}");
    fs::write(t.vault.path_of(PLAN).unwrap(), text).unwrap();
    k.reindex().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn proposed(k: &Kasten, s: &Session, op: &AgentOp) -> String {
    match k.agent_run(s, op, NOW).unwrap() {
        Outcome::PendingReview { proposal, .. } => proposal,
        other => panic!("expected a proposal, got {other:?}"),
    }
}

/// The person's own edit to the plan: `change` applied to its body.
fn edit(k: &Kasten, change: impl Fn(&str) -> String) {
    let note = k.read(PLAN).unwrap();
    let body = change(split(&note.text).body);
    k.save_body(&Actor::Human, PLAN, &body, &note.hash, NOW)
        .unwrap();
    k.commit_edits().unwrap();
}

#[test]
fn accepting_a_section_change_never_takes_what_was_written_since() {
    let (_t, k, s) = open();
    let wipe = AgentOp::ReplaceSection {
        path: PLAN.into(),
        heading: "Details".into(),
        markdown: "Gone.".into(),
    };
    let id = proposed(&k, &s, &wipe);
    // The person adds to the section the proposal takes out.
    edit(&k, |body| {
        body.replace(
            "Line 29 of the plan with some words.\n",
            "Line 29 of the plan with some words.\nA line I just wrote.\n",
        )
    });
    let _ = k.accept_proposal(&id, "me", NOW);
    let text = k.read(PLAN).unwrap().text;
    assert!(text.contains("A line I just wrote."), "{text}");
}

#[test]
fn accepting_a_section_change_merges_with_edits_elsewhere() {
    let (_t, k, s) = open();
    let wipe = AgentOp::ReplaceSection {
        path: PLAN.into(),
        heading: "Details".into(),
        markdown: "Gone.".into(),
    };
    let id = proposed(&k, &s, &wipe);
    edit(&k, |body| body.replace("Short.", "Short, and edited."));
    k.accept_proposal(&id, "me", NOW).unwrap();
    let text = k.read(PLAN).unwrap().text;
    assert!(text.contains("Short, and edited."), "{text}");
    assert!(text.contains("## Details\n\nGone.\n"), "{text}");
    assert!(!text.contains("Line 3 of"), "{text}");
}

/// A full rewrite with two separate changes: its text, and the body it was written against.
fn rewrite_with_two_changes(k: &Kasten, s: &Session) -> (String, String) {
    let body = split(&k.read(PLAN).unwrap().text).body.to_owned();
    let whole = body.replace("Short.", "Short, rewritten.").replace(
        "Line 29 of the plan with some words.",
        "Line 29, rewritten.",
    );
    let rewrite = AgentOp::Edit {
        path: PLAN.into(),
        body: whole,
        base: body.clone(),
        reason: None,
    };
    (proposed(k, s, &rewrite), body)
}

#[test]
fn some_of_a_rewrites_changes_can_be_kept_and_the_rest_left_out() {
    let (_t, k, s) = open();
    let (id, body) = rewrite_with_two_changes(&k, &s);
    // The person keeps the first change and undoes the second.
    let kept = body.replace("Short.", "Short, rewritten.");
    k.accept_proposal_hunks(&id, "me", &kept, NOW).unwrap();
    let text = k.read(PLAN).unwrap().text;
    assert!(text.contains("Short, rewritten."), "{text}");
    assert!(
        text.contains("Line 29 of the plan with some words."),
        "{text}"
    );
    assert!(!text.contains("Line 29, rewritten."), "{text}");
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn keeping_part_of_a_change_still_stops_at_a_locked_note() {
    let (t, k, s) = open();
    let (id, body) = rewrite_with_two_changes(&k, &s);
    let path = t.vault.path_of(PLAN).unwrap();
    let text =
        fs::read_to_string(&path)
            .unwrap()
            .replacen("title: Plan", "title: Plan\nlocked: true", 1);
    fs::write(&path, text).unwrap();
    k.reindex().unwrap();
    let kept = body.replace("Short.", "Short, rewritten.");
    let err = k.accept_proposal_hunks(&id, "me", &kept, NOW).unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    assert!(!fs::read_to_string(&path).unwrap().contains("rewritten"));
    assert_eq!(k.proposals().unwrap().len(), 1);
}

#[test]
fn keeping_part_of_a_change_never_overwrites_what_was_written_on_the_same_lines_since() {
    let (_t, k, s) = open();
    let (id, body) = rewrite_with_two_changes(&k, &s);
    edit(&k, |b| b.replace("Short.", "Short, and mine."));
    let kept = body.replace("Short.", "Short, rewritten.");
    let err = k.accept_proposal_hunks(&id, "me", &kept, NOW).unwrap_err();
    assert!(err.to_string().contains("same lines"), "{err}");
    let text = k.read(PLAN).unwrap().text;
    assert!(text.contains("Short, and mine."), "{text}");
    assert_eq!(k.proposals().unwrap().len(), 1, "it still waits");
}

#[test]
fn only_a_change_to_a_pages_text_can_be_kept_in_part() {
    let (_t, k, s) = open();
    // A schema always waits for review, and is not text of a page.
    let schema = AgentOp::TagSchema {
        tag: "trip".into(),
        schema: serde_json::json!({"properties": [{"key": "stage", "type": "select", "options": ["Idea"]}]}),
    };
    let id = proposed(&k, &s, &schema);
    let err = k
        .accept_proposal_hunks(&id, "me", "anything", NOW)
        .unwrap_err();
    assert!(err.to_string().contains("text of a page"), "{err}");
    assert_eq!(k.proposals().unwrap().len(), 1);
}

#[test]
fn a_proposal_accepted_twice_at_once_is_applied_once() {
    let (_t, k, s) = open();
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 0;
    k.set_config(config).unwrap();
    let add = AgentOp::Append {
        path: PLAN.into(),
        markdown: "Added once.".into(),
        heading: None,
    };
    let id = proposed(&k, &s, &add);
    let start = std::sync::Barrier::new(2);
    let accepted: Vec<bool> = std::thread::scope(|scope| {
        let runs: Vec<_> = (0..2)
            .map(|_| {
                let (k, id, start) = (&k, &id, &start);
                scope.spawn(move || {
                    start.wait();
                    k.accept_proposal(id, "me", NOW).is_ok()
                })
            })
            .collect();
        runs.into_iter().map(|run| run.join().unwrap()).collect()
    });
    assert_eq!(accepted.iter().filter(|ok| **ok).count(), 1);
    let text = k.read(PLAN).unwrap().text;
    assert_eq!(text.matches("Added once.").count(), 1, "{text}");
}
