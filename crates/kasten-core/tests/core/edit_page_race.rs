//! `edit_page` under contention and across the staging and review paths: two
//! engines on one vault (as two processes are), a chat that previews its
//! changes, and a proposal whose page was locked or changed while it waited.

use crate::common::{NOW, TempVault};
use crate::edit_page::{PAGE, blocks, commits, edit, open, refused, replace, text};

use kasten_core::agent::{AgentOp, Session};
use kasten_core::history::Actor;
use kasten_core::pages::PageStep;
use kasten_core::{Instant, Kasten, Outcome};

fn done(outcome: &Result<Outcome, kasten_core::Error>) -> bool {
    matches!(outcome, Ok(Outcome::Done { .. }))
}

fn second_engine(t: &TempVault) -> (Kasten, Session) {
    let other = Kasten::open(t.vault.root()).unwrap();
    let _ = other.start_history();
    let theirs = Session::start(
        "other-client",
        Instant {
            millis: NOW.millis + 2,
        },
    );
    (other, theirs)
}

#[test]
fn two_engines_replacing_one_block_let_exactly_one_win_and_say_why_to_the_other() {
    for round in 0..4 {
        let (t, k, s) = open();
        let (other, theirs) = second_engine(&t);
        let all = blocks(&k);
        let one = edit(vec![replace(&all[1], "ONE")]);
        let two = edit(vec![replace(&all[1], "TWO")]);
        let (a, b) = std::thread::scope(|scope| {
            let a = scope.spawn(|| k.agent_run(&s, &one, NOW));
            let b = scope.spawn(|| other.agent_run(&theirs, &two, NOW));
            (a.join().unwrap(), b.join().unwrap())
        });
        assert_ne!(done(&a), done(&b), "round {round}: {a:?} / {b:?}");
        let loser = if done(&a) { b } else { a };
        let why = loser.unwrap_err().to_string();
        assert!(why.contains("changed since"), "round {round}: {why}");
        let after = text(&t);
        assert_ne!(
            after.contains("ONE"),
            after.contains("TWO"),
            "round {round}"
        );
    }
}

#[test]
fn two_engines_editing_different_blocks_keep_both_edits() {
    for round in 0..4 {
        let (t, k, s) = open();
        let (other, theirs) = second_engine(&t);
        let all = blocks(&k);
        let one = edit(vec![replace(&all[1], "ONE")]);
        let two = edit(vec![replace(&all[6], "TWO")]);
        let (a, b) = std::thread::scope(|scope| {
            let a = scope.spawn(|| k.agent_run(&s, &one, NOW));
            let b = scope.spawn(|| other.agent_run(&theirs, &two, NOW));
            (a.join().unwrap(), b.join().unwrap())
        });
        assert!(done(&a) && done(&b), "round {round}: {a:?} / {b:?}");
        let after = text(&t);
        assert!(
            after.contains("ONE") && after.contains("TWO"),
            "round {round}"
        );
        assert!(!after.contains("Intro paragraph.") && !after.contains("Closing words."));
    }
}

#[test]
fn a_page_saved_by_a_person_while_the_agent_is_between_read_and_edit_is_never_overwritten() {
    let (t, k, s) = open();
    let all = blocks(&k);
    // A person's editor saves the same block through the app's own save.
    let note = k.read(PAGE).unwrap();
    let human = note.text.replace("Intro paragraph.", "Intro paragraph!");
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&human).body,
        &note.hash,
        NOW,
    )
    .unwrap();
    let kept = text(&t);
    let n = commits(&k);
    // One character off is enough: nothing is written, not even `updated`.
    let why = refused(k.agent_run(&s, &edit(vec![replace(&all[1], "Agent")]), NOW));
    assert!(why.contains("changed since"), "{why}");
    assert_eq!(text(&t), kept);
    assert_eq!(commits(&k), n);
}

#[test]
fn a_chat_that_previews_its_changes_stages_a_page_edit_and_refuses_a_stale_one() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let before = text(&t);
    let mut set = k.begin_changes(&s, NOW);
    let held = k
        .stage(&mut set, &s, &edit(vec![replace(&all[1], "Staged")]), NOW)
        .unwrap();
    assert!(matches!(held, Outcome::Staged { .. }), "{held:?}");
    assert!(!set.is_empty());
    assert_eq!(text(&t), before);
    assert!(k.proposals().unwrap().is_empty());
    // A block that changed since the read is refused while staging, with nothing kept.
    let note = k.read(PAGE).unwrap();
    let human = note.text.replace("Intro paragraph.", "Other words.");
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&human).body,
        &note.hash,
        NOW,
    )
    .unwrap();
    let err = k
        .stage(&mut set, &s, &edit(vec![replace(&all[1], "Late")]), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("changed since"), "{err}");
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn a_proposal_for_a_page_that_was_locked_while_it_waited_is_refused_when_accepted() {
    let (t, k, s) = open();
    let all = blocks(&k);
    crate::edit_page::set_mode(&k, kasten_core::config_keys::AgentMode::Review);
    let held = k
        .agent_run(&s, &edit(vec![replace(&all[1], "Proposed")]), NOW)
        .unwrap();
    let Outcome::PendingReview { proposal, .. } = held else {
        panic!("expected a proposal, got {held:?}");
    };
    let locked = text(&t).replacen("custom:", "locked: true\ncustom:", 1);
    std::fs::write(t.vault.root().join(PAGE), &locked).unwrap();
    let err = k.accept_proposal(&proposal, "me", NOW).unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    assert_eq!(text(&t), locked);
    assert_eq!(k.proposals().unwrap().len(), 1, "it still waits");
}

#[test]
fn two_page_edits_in_one_batch_work_when_the_first_moves_no_ids() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let n = commits(&k);
    let batch = AgentOp::Batch {
        ops: vec![
            edit(vec![replace(&all[1], "ONE")]),
            edit(vec![replace(&all[6], "TWO")]),
        ],
        reason: None,
    };
    let told = k.agent_run(&s, &batch, NOW);
    assert!(done(&told), "{told:?}");
    let after = text(&t);
    assert!(after.contains("ONE") && after.contains("TWO"));
    assert_eq!(commits(&k), n + 1, "one commit for the batch");
}

#[test]
fn a_page_edit_that_fails_in_a_batch_leaves_the_page_and_the_history_as_they_were() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let before = text(&t);
    let n = commits(&k);
    let first = edit(vec![replace(&all[1], "First")]);
    // Names a block that is not there: the whole batch is refused.
    let second = AgentOp::EditPage {
        path: PAGE.into(),
        steps: vec![PageStep::Delete {
            block: kasten_core::pages::BlockRef {
                block: "b99".into(),
                hash: "0".into(),
            },
        }],
        reason: None,
    };
    let batch = AgentOp::Batch {
        ops: vec![first, second],
        reason: None,
    };
    let err = k.agent_run(&s, &batch, NOW).unwrap_err();
    assert!(err.to_string().contains("There is no block"), "{err}");
    assert_eq!(text(&t), before);
    assert_eq!(commits(&k), n);
}
