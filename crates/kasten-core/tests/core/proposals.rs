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
