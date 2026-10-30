//! Batches: many changes sent as one. All or nothing, one commit, one undo;
//! when any change needs review the whole batch waits as one proposal; one
//! refusal refuses all; a failure part way puts every file back.

use std::fs;

use kasten_core::agent::AgentOp;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::History;
use kasten_core::policy::SESSION_LABEL;
use kasten_core::{Kasten, Outcome};
use proptest::prelude::*;

use crate::change_sets::{DRAFT, WELCOME, append, create, open, snapshot};
use crate::common::{NOW, TempVault};

const SKETCH: &str = "projects/photo-organiser/cards/duplicate-score-sketch.md";
const PLAN: &str = "inbox/plan.md";

fn batch(ops: Vec<AgentOp>) -> AgentOp {
    AgentOp::Batch {
        ops,
        reason: Some("test".into()),
    }
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

/// A page with a long section, so that replacing it takes out more than 40%.
fn write_plan(t: &TempVault, k: &Kasten) {
    let long: String = (0..30)
        .map(|n| format!("Line {n} of the plan with some words.\n"))
        .collect();
    let text =
        format!("---\ntitle: Plan\ntype: page\n---\n## Keep\n\nShort.\n\n## Details\n\n{long}");
    fs::write(t.vault.root().join(PLAN), text).unwrap();
    k.reindex().unwrap();
}

fn wipe_details() -> AgentOp {
    AgentOp::ReplaceSection {
        path: PLAN.into(),
        heading: "Details".into(),
        markdown: "Gone.".into(),
    }
}

fn lock(t: &TempVault, k: &Kasten, path: &str) {
    let file = t.vault.root().join(path);
    let text = fs::read_to_string(&file)
        .unwrap()
        .replacen("---\n", "---\nlocked: true\n", 1);
    fs::write(&file, text).unwrap();
    k.reindex().unwrap();
}

fn done(outcome: Outcome) -> serde_json::Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected the batch to be made, got {other:?}"),
    }
}

#[test]
fn fifty_changes_are_one_commit_and_one_undo() {
    let (t, k, s) = open();
    let h = History::open(t.vault.root()).unwrap().unwrap();
    let tree = h.tree_id("HEAD").unwrap();
    let files = snapshot(t.vault.root());
    let commits_before = commits(&k);
    let ops = (0..50)
        .map(|n| append([WELCOME, SKETCH][n % 2], &format!("Batch line {n}.")))
        .collect();
    let result = done(k.agent_run(&s, &batch(ops), NOW).unwrap());
    assert_eq!(result["changes"], 50);
    assert_eq!(result["results"].as_array().unwrap().len(), 50);
    assert_eq!(commits(&k), commits_before + 1, "one commit for all 50");
    let head = &k.log(None, 1).unwrap()[0];
    assert_eq!(head.op.as_deref(), Some("batch"));
    assert!(
        head.message.contains("Kasten-Batch: 50"),
        "{}",
        head.message
    );
    assert_eq!(head.session.as_deref(), Some(s.id.as_str()));
    let text = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    assert!(text.contains("Batch line 0.") && text.contains("Batch line 48."));

    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(undone.reverted.len(), 1, "one undo takes all 50 back");
    assert_eq!(h.tree_id("HEAD").unwrap(), tree);
    assert_eq!(snapshot(t.vault.root()), files);
    assert_eq!(k.sessions(5).unwrap()[0].commits, 1);
}

#[test]
fn one_refused_change_refuses_the_batch_and_nothing_is_written() {
    let (t, k, s) = open();
    lock(&t, &k, DRAFT);
    let files = snapshot(t.vault.root());
    let commits_before = commits(&k);
    let ops = vec![
        append(WELCOME, "First."),
        create("Made by the batch", "Body."),
        append(DRAFT, "Third, to a locked page."),
        append(SKETCH, "Fourth."),
    ];
    let err = k.agent_run(&s, &batch(ops), NOW).unwrap_err().to_string();
    assert!(err.contains("Change 3 of 4 (append)"), "{err}");
    assert!(err.contains("locked"), "{err}");
    assert!(err.contains("Nothing in the batch was changed"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files);
    assert_eq!(commits(&k), commits_before);
    assert!(
        k.list()
            .unwrap()
            .iter()
            .all(|n| n.title != "Made by the batch")
    );
}

#[test]
fn a_note_that_is_not_there_refuses_the_batch() {
    let (t, k, s) = open();
    let files = snapshot(t.vault.root());
    let ops = vec![
        append(WELCOME, "First."),
        append("inbox/gone.md", "Second."),
    ];
    let err = k.agent_run(&s, &batch(ops), NOW).unwrap_err().to_string();
    assert!(err.contains("Change 2 of 2"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn a_failure_part_way_puts_every_file_back() {
    let (t, k, s) = open();
    let h = History::open(t.vault.root()).unwrap().unwrap();
    let tree = h.tree_id("HEAD").unwrap();
    let files = snapshot(t.vault.root());
    let commits_before = commits(&k);
    let ops = || {
        vec![
            create("Fresh one", "Body one."),
            append(WELCOME, "Second."),
            AgentOp::Rename {
                path: SKETCH.into(),
                title: "Renamed sketch".into(),
            },
            create("Fresh two", "Body two."),
            append(WELCOME, "Fifth."),
        ]
    };
    // The disk fills up after three changes are made.
    k.fail_batch_after(3);
    let err = k.agent_run(&s, &batch(ops()), NOW).unwrap_err().to_string();
    assert!(err.contains("Change 4 of 5"), "{err}");
    assert!(err.contains("No space left"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files, "every byte is back");
    assert_eq!(h.tree_id("HEAD").unwrap(), tree);
    assert_eq!(commits(&k), commits_before, "nothing in the history");
    let titles: Vec<String> = k.list().unwrap().into_iter().map(|n| n.title).collect();
    assert!(titles.iter().all(|t| !t.starts_with("Fresh")), "{titles:?}");
    assert!(!titles.contains(&"Renamed sketch".to_owned()));
    assert!(titles.iter().any(|t| t.contains("Duplicate")), "{titles:?}");

    // The engine is whole: the same batch now goes through.
    done(k.agent_run(&s, &batch(ops()), NOW).unwrap());
    assert_eq!(commits(&k), commits_before + 1);
    assert!(
        k.list()
            .unwrap()
            .iter()
            .any(|n| n.title == "Renamed sketch")
    );
}

#[test]
fn a_failure_gives_the_soft_limit_tally_back() {
    let (t, k, s) = open();
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 3;
    k.set_config(config).unwrap();
    let files = snapshot(t.vault.root());
    // Two notes are changed, then the disk fills up.
    k.fail_batch_after(2);
    let ops = vec![
        append(WELCOME, "One."),
        append(SKETCH, "Two."),
        append(DRAFT, "Three."),
    ];
    assert!(k.agent_run(&s, &batch(ops), NOW).is_err());
    assert_eq!(snapshot(t.vault.root()), files);
    // Had the two notes stayed in the tally, these two would be four in all, over the limit of three.
    let ops = vec![append(DRAFT, "Fine."), create("Another", "Body.")];
    done(k.agent_run(&s, &batch(ops), NOW).unwrap());
}

#[test]
fn a_commit_that_fails_puts_the_files_back_and_stages_nothing() {
    let (t, k, s) = open();
    let h = History::open(t.vault.root()).unwrap().unwrap();
    let tree = h.tree_id("HEAD").unwrap();
    let files = snapshot(t.vault.root());
    let commits_before = commits(&k);
    // A name git will not sign a commit with: the changes are made, then the commit fails.
    let unsignable = kasten_core::agent::Session {
        client: "bad<name>".into(),
        ..s.clone()
    };
    let ops = vec![
        create("Never kept", "Body."),
        append(WELCOME, "Never kept either."),
    ];
    let err = k
        .agent_run(&unsignable, &batch(ops), NOW)
        .unwrap_err()
        .to_string();
    assert!(
        !err.contains("Change "),
        "it was the commit that failed: {err}"
    );
    assert_eq!(snapshot(t.vault.root()), files, "every byte is back");
    assert_eq!(h.tree_id("HEAD").unwrap(), tree);
    assert_eq!(commits(&k), commits_before);
    assert!(
        h.dirty().unwrap().is_empty(),
        "{:?}: nothing is left staged or changed",
        h.dirty()
    );
    // The next commit holds only its own change, not the failed batch's files.
    done(
        k.agent_run(&s, &batch(vec![append(SKETCH, "Next.")]), NOW)
            .unwrap(),
    );
    assert!(h.dirty().unwrap().is_empty(), "{:?}", h.dirty());
    let text = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    assert!(!text.contains("Never kept either"));
}

#[test]
fn a_batch_does_not_touch_a_file_history_could_not_save() {
    let (t, k, s) = open();
    // A note too big for the backup stays changed but unsaved in History.
    let big = format!(
        "---\ntitle: Huge\ntype: page\n---\n{}",
        "x".repeat(101 * 1024 * 1024)
    );
    let path = "inbox/huge.md";
    fs::write(t.vault.root().join(path), &big).unwrap();
    k.reindex().unwrap();
    k.commit_external().unwrap();
    let h = History::open(t.vault.root()).unwrap().unwrap();
    assert!(
        h.dirty().unwrap().contains(&path.to_owned()),
        "{:?}",
        h.dirty()
    );
    let files = snapshot(t.vault.root());
    let ops = vec![append(WELCOME, "Fine."), append(path, "Not this.")];
    let err = k.agent_run(&s, &batch(ops), NOW).unwrap_err().to_string();
    assert!(err.contains("has not saved"), "{err}");
    assert!(err.contains("Nothing in the batch was changed"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files);
    // Changes that leave it alone go through.
    done(
        k.agent_run(&s, &batch(vec![append(WELCOME, "Fine.")]), NOW)
            .unwrap(),
    );
    assert_eq!(fs::read_to_string(t.vault.root().join(path)).unwrap(), big);
}

#[test]
fn batches_and_single_changes_from_other_threads_never_mix() {
    let (t, k, s) = open();
    let other = kasten_core::agent::Session::start("second-chat", NOW);
    let third = kasten_core::agent::Session::start("third-chat", NOW);
    let commits_before = commits(&k);
    std::thread::scope(|scope| {
        let (k, s, other, third) = (&k, &s, &other, &third);
        let first = scope.spawn(move || {
            let ops = (0..30)
                .map(|n| append(WELCOME, &format!("First {n}.")))
                .collect();
            done(k.agent_run(s, &batch(ops), NOW).unwrap());
        });
        let second = scope.spawn(move || {
            let ops = (0..30)
                .map(|n| append(SKETCH, &format!("Second {n}.")))
                .collect();
            done(k.agent_run(other, &batch(ops), NOW).unwrap());
        });
        let single = scope.spawn(move || {
            for n in 0..10 {
                done(
                    k.agent_run(third, &append(DRAFT, &format!("Single {n}.")), NOW)
                        .unwrap(),
                );
            }
        });
        first.join().unwrap();
        second.join().unwrap();
        single.join().unwrap();
    });
    let log = k.log(None, 10_000).unwrap();
    let new: Vec<_> = log.iter().take(log.len() - commits_before).collect();
    assert_eq!(new.len(), 12, "two batches and ten single changes");
    assert_eq!(
        new.iter()
            .filter(|c| c.op.as_deref() == Some("batch"))
            .count(),
        2
    );
    // Each batch's commit holds its own note and nothing else.
    for commit in new.iter().filter(|c| c.op.as_deref() == Some("batch")) {
        let changed = k.commit_changes(&commit.id).unwrap();
        assert_eq!(changed.len(), 1, "{changed:?}");
    }
    let text = |path: &str| fs::read_to_string(t.vault.root().join(path)).unwrap();
    assert!(text(WELCOME).contains("First 29.") && text(SKETCH).contains("Second 29."));
    assert!(text(DRAFT).contains("Single 9."));
    // Undoing the first chat takes only its own batch back.
    k.undo_session(&s.id, NOW).unwrap();
    assert!(!text(WELCOME).contains("First 0."));
    assert!(text(SKETCH).contains("Second 0.") && text(DRAFT).contains("Single 0."));
}

#[test]
fn a_change_that_needs_review_makes_the_whole_batch_one_proposal() {
    let (t, k, s) = open();
    write_plan(&t, &k);
    let welcome = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    let ops = vec![
        append(WELCOME, "Waits with the rest."),
        wipe_details(),
        append(SKETCH, "Also waits."),
    ];
    let Outcome::PendingReview { proposal, reason } = k.agent_run(&s, &batch(ops), NOW).unwrap()
    else {
        panic!("expected a proposal")
    };
    assert!(
        reason.contains("removes") || reason.contains("Removes"),
        "{reason}"
    );
    // Nothing of it is in the notes.
    assert_eq!(
        fs::read_to_string(t.vault.root().join(WELCOME)).unwrap(),
        welcome
    );
    let pending = k.proposals().unwrap();
    assert_eq!(pending.len(), 1, "one proposal, not three");
    assert!(matches!(pending[0].op, AgentOp::Batch { .. }));
    assert!(
        pending[0].diff.contains("Change 2 of 3"),
        "{}",
        pending[0].diff
    );

    k.accept_proposal(&proposal, "me", NOW).unwrap();
    let text = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    assert!(text.contains("Waits with the rest."));
    assert!(
        fs::read_to_string(t.vault.root().join(PLAN))
            .unwrap()
            .contains("Gone.")
    );
    let log = k.log(None, 50).unwrap();
    let batches: Vec<_> = log
        .iter()
        .filter(|c| c.op.as_deref() == Some("batch"))
        .collect();
    assert_eq!(batches.len(), 1, "accepting is one commit");
    assert_eq!(batches[0].approved_by.as_deref(), Some("me"));
    assert!(batches[0].message.contains("Kasten-Batch: 3"));
}

#[test]
fn a_rejected_batch_proposal_changes_nothing() {
    let (t, k, s) = open();
    write_plan(&t, &k);
    let ops = vec![append(WELCOME, "Not wanted."), wipe_details()];
    let Outcome::PendingReview { proposal, .. } = k.agent_run(&s, &batch(ops), NOW).unwrap() else {
        panic!("expected a proposal")
    };
    k.reject_proposal(&proposal, "me", NOW).unwrap();
    let text = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    assert!(!text.contains("Not wanted."));
    assert!(
        k.log(None, 50)
            .unwrap()
            .iter()
            .all(|c| c.op.as_deref() != Some("batch"))
    );
}

#[test]
fn review_everything_holds_a_plain_batch_as_one_proposal() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let welcome = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    let ops = vec![append(WELCOME, "One."), append(SKETCH, "Two.")];
    let Outcome::PendingReview { reason, .. } = k.agent_run(&s, &batch(ops), NOW).unwrap() else {
        panic!("expected a proposal")
    };
    assert!(reason.contains("Review everything"), "{reason}");
    assert_eq!(k.proposals().unwrap().len(), 1);
    assert_eq!(
        fs::read_to_string(t.vault.root().join(WELCOME)).unwrap(),
        welcome
    );
}

#[test]
fn too_many_changes_too_much_text_and_changes_a_batch_may_not_hold() {
    let (t, k, s) = open();
    let files = snapshot(t.vault.root());
    let many: Vec<AgentOp> = (0..101)
        .map(|n| append(WELCOME, &format!("L{n}")))
        .collect();
    let err = k.agent_run(&s, &batch(many), NOW).unwrap_err().to_string();
    assert!(err.contains("at most 100"), "{err}");
    let hundred: Vec<AgentOp> = (0..100)
        .map(|n| append(WELCOME, &format!("L{n}")))
        .collect();
    done(k.agent_run(&s, &batch(hundred), NOW).unwrap());

    // Six writes just under the single-write limit are over the batch's megabyte.
    let big: Vec<AgentOp> = (0..6)
        .map(|_| append(SKETCH, &"x".repeat(200_000)))
        .collect();
    let before = snapshot(t.vault.root());
    let err = k.agent_run(&s, &batch(big), NOW).unwrap_err().to_string();
    assert!(err.contains("at most 1024 KB"), "{err}");
    assert_eq!(snapshot(t.vault.root()), before);

    let trash = AgentOp::Trash {
        path: SKETCH.into(),
        reason: None,
    };
    let err = k
        .agent_run(&s, &batch(vec![trash]), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("cannot be part of a batch"), "{err}");
    let err = k
        .agent_run(&s, &batch(vec![]), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("at least one"), "{err}");
    assert_ne!(before, files);
}

#[test]
fn a_batch_over_twenty_changes_records_a_checkpoint_first() {
    let (t, k, s) = open();
    let head = History::open(t.vault.root())
        .unwrap()
        .unwrap()
        .head()
        .unwrap();
    let welcome = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    let twenty: Vec<AgentOp> = (0..20).map(|n| append(WELCOME, &format!("L{n}"))).collect();
    done(k.agent_run(&s, &batch(twenty), NOW).unwrap());
    assert!(
        k.list_checkpoints().unwrap().is_empty(),
        "20 is not over 20"
    );

    let head_20 = History::open(t.vault.root())
        .unwrap()
        .unwrap()
        .head()
        .unwrap();
    let more: Vec<AgentOp> = (0..21).map(|n| append(SKETCH, &format!("M{n}"))).collect();
    done(k.agent_run(&s, &batch(more), NOW).unwrap());
    let checkpoints = k.list_checkpoints().unwrap();
    assert_eq!(checkpoints.len(), 1);
    assert_eq!(checkpoints[0].label, "Before a batch of 21 changes");
    assert_eq!(checkpoints[0].head, head_20);
    assert_ne!(head_20, head);
    // Going back to it undoes the second batch only.
    k.restore_to_checkpoint(&checkpoints[0].id, NOW).unwrap();
    let text = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    assert!(text.contains("L19") && text.len() > welcome.len());
    assert!(
        !fs::read_to_string(t.vault.root().join(SKETCH))
            .unwrap()
            .contains("M20")
    );
}

#[test]
fn a_big_batch_that_fails_leaves_no_checkpoint_behind() {
    let (t, k, s) = open();
    let files = snapshot(t.vault.root());
    let more: Vec<AgentOp> = (0..21).map(|n| append(SKETCH, &format!("M{n}"))).collect();
    k.fail_batch_after(3);
    assert!(k.agent_run(&s, &batch(more.clone()), NOW).is_err());
    assert_eq!(snapshot(t.vault.root()), files, "everything was put back");
    assert!(
        k.list_checkpoints().unwrap().is_empty(),
        "a batch that did not happen offers no restore point"
    );
    // The same batch, run for real, does get one.
    done(k.agent_run(&s, &batch(more), NOW).unwrap());
    assert_eq!(k.list_checkpoints().unwrap().len(), 1);
}

#[test]
fn an_autonomous_batch_is_one_commit_after_one_checkpoint() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    write_plan(&t, &k);
    k.commit_external().unwrap();
    let before = commits(&k);
    // Even a change that would wait goes through in autonomous mode.
    let ops = vec![append(WELCOME, "Auto."), wipe_details()];
    done(k.agent_run(&s, &batch(ops), NOW).unwrap());
    let head = &k.log(None, 1).unwrap()[0];
    assert_eq!(head.op.as_deref(), Some("batch"));
    assert_eq!(head.mode.as_deref(), Some("autonomous"));
    // A soft limit is lifted, not approved: only what always waits is auto-accepted.
    assert_eq!(head.approved_by, None);
    assert_eq!(commits(&k), before + 1);
    let checkpoints = k.list_checkpoints().unwrap();
    assert_eq!(checkpoints.len(), 1);
    assert_eq!(checkpoints[0].label, SESSION_LABEL);
}

#[test]
fn staged_in_a_chat_a_batch_is_one_step_and_applies_as_one_commit() {
    let (t, k, s) = open();
    let files = snapshot(t.vault.root());
    let mut set = k.begin_changes(&s, NOW);
    let ops = vec![
        create("Staged by batch", "Body."),
        append(WELCOME, "Staged line."),
    ];
    let outcome = k.stage(&mut set, &s, &batch(ops), NOW).unwrap();
    let Outcome::Staged { paths, result, .. } = outcome else {
        panic!("expected staged")
    };
    assert_eq!(paths.len(), 2);
    assert_eq!(result["changes"], 2);
    assert_eq!(snapshot(t.vault.root()), files, "nothing reached the vault");
    assert_eq!(set.steps.len(), 1);
    let before = commits(&k);
    k.apply_changes(&set, "me", NOW).unwrap();
    assert_eq!(commits(&k), before + 1);
}

#[test]
fn staged_one_refusal_stages_nothing_and_a_rename_holds_the_whole_batch() {
    let (t, k, s) = open();
    lock(&t, &k, DRAFT);
    let mut set = k.begin_changes(&s, NOW);
    let ops = vec![append(WELCOME, "Fine."), append(DRAFT, "Locked.")];
    let err = k
        .stage(&mut set, &s, &batch(ops), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("Change 2 of 2"), "{err}");
    assert!(set.steps.is_empty() && set.files.is_empty());

    let rename = AgentOp::Rename {
        path: SKETCH.into(),
        title: "Another".into(),
    };
    let ops = vec![append(WELCOME, "Held back."), rename];
    let outcome = k.stage(&mut set, &s, &batch(ops), NOW).unwrap();
    assert!(
        matches!(outcome, Outcome::PendingReview { .. }),
        "{outcome:?}"
    );
    assert!(
        set.steps.is_empty() && set.files.is_empty(),
        "the set is as it was"
    );
    assert_eq!(k.proposals().unwrap().len(), 1);
}

const NOTES: [&str; 3] = [WELCOME, SKETCH, DRAFT];

proptest! {
    #![proptest_config(ProptestConfig { cases: 6, ..ProptestConfig::default() })]

    /// Any list of changes either goes through as one commit that one undo
    /// takes back to the exact bytes, or does nothing at all.
    #[test]
    fn any_batch_is_all_or_nothing_and_undoes_to_the_exact_vault(
        plan in prop::collection::vec((0usize..6, 0usize..3, "[a-z]{1,12}"), 1..9)
    ) {
        let (t, k, s) = open();
        let h = History::open(t.vault.root()).unwrap().unwrap();
        let tree = h.tree_id("HEAD").unwrap();
        let files = snapshot(t.vault.root());
        let ops: Vec<AgentOp> = plan
            .iter()
            .enumerate()
            .map(|(n, (kind, target, text))| match kind {
                0 => append(NOTES[*target], text),
                1 => AgentOp::Tags { path: NOTES[*target].into(), add: vec![format!("tag{}", n % 3)], remove: vec![] },
                2 => create(&format!("Prop note {n}"), text),
                3 => AgentOp::JournalAppend { date: "2026-09-23".into(), markdown: text.clone(), heading: None },
                4 => AgentOp::Rename { path: NOTES[*target].into(), title: format!("Renamed {n} {text}") },
                _ => AgentOp::Move { path: NOTES[*target].into(), project: Some("photo-organiser".into()) },
            })
            .collect();
        let commits_before = commits(&k);
        match k.agent_run(&s, &batch(ops), NOW) {
            // Changes that change nothing (a move to where the note is) make no commit.
            Ok(Outcome::Done { .. }) if commits(&k) == commits_before => {
                prop_assert_eq!(snapshot(t.vault.root()), files);
            }
            Ok(Outcome::Done { .. }) => {
                prop_assert_eq!(commits(&k), commits_before + 1);
                prop_assert_eq!(k.sessions(5).unwrap()[0].commits, 1);
                let undone = k.undo_session(&s.id, NOW).unwrap();
                prop_assert!(undone.conflict.is_none());
                prop_assert_eq!(h.tree_id("HEAD").unwrap(), tree);
                prop_assert_eq!(snapshot(t.vault.root()), files);
            }
            Ok(_) => {}
            Err(_) => {
                prop_assert_eq!(snapshot(t.vault.root()), files);
                prop_assert_eq!(h.tree_id("HEAD").unwrap(), tree);
            }
        }
    }
}
