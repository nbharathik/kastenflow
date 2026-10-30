//! `edit_page`'s guardrails: the 40 % rule in each mode (a deleted block
//! counts, a moved or wrapped one does not), locked pages, the 200 KB limit,
//! proposals that go stale, and batches.

use crate::common;
use crate::edit_page::{
    PAGE, blocks, commits, done, edit, open, open_with, r, refused, replace, set_mode, text,
};

use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::pages::PageStep;
use kasten_core::{Kasten, Outcome};

/// Delete the intro, the tasks and the table: well over 40 % of the page.
fn big(k: &Kasten) -> AgentOp {
    let all = blocks(k);
    edit(vec![
        PageStep::Delete { block: r(&all[1]) },
        PageStep::Delete { block: r(&all[3]) },
        PageStep::Delete { block: r(&all[5]) },
    ])
}

fn pending(outcome: Outcome) -> (String, String) {
    match outcome {
        Outcome::PendingReview { reason, proposal } => (reason, proposal),
        other => panic!("expected a proposal, got {other:?}"),
    }
}

fn human_edit(k: &Kasten, from: &str, to: &str) {
    let note = k.read(PAGE).unwrap();
    let text = note.text.replace(from, to);
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&text).body,
        &note.hash,
        common::NOW,
    )
    .unwrap();
}

#[test]
fn balanced_mode_holds_an_edit_that_takes_out_more_than_the_limit() {
    let (t, k, s) = open();
    let before = text(&t);
    let (why, id) = pending(k.agent_run(&s, &big(&k), common::NOW).unwrap());
    assert!(why.contains("Removes") && why.contains("40%"), "{why}");
    assert_eq!(text(&t), before, "nothing is written until it is accepted");
    let waiting = k.proposals().unwrap();
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].target.as_ref().unwrap().path, PAGE);
    assert!(
        waiting[0].diff.contains("-Intro paragraph."),
        "{}",
        waiting[0].diff
    );
    assert!(
        waiting[0].diff.contains("3 steps: delete"),
        "{}",
        waiting[0].diff
    );

    k.accept_proposal(&id, "me", common::NOW).unwrap();
    let after = text(&t);
    assert!(!after.contains("Intro paragraph.") && !after.contains("apple"));
    assert!(after.contains("# Plan") && after.contains("Closing words."));
    let head = &k.log(Some(PAGE), 1).unwrap()[0];
    assert_eq!(head.op.as_deref(), Some("edit_page"));
    assert_eq!(head.approved_by.as_deref(), Some("me"));
}

#[test]
fn a_proposal_whose_blocks_changed_meanwhile_is_refused_when_accepted() {
    let (t, k, s) = open();
    let (_, id) = pending(k.agent_run(&s, &big(&k), common::NOW).unwrap());
    human_edit(&k, "Intro paragraph.", "Intro, by a person.");
    let kept = text(&t);
    let err = k.accept_proposal(&id, "me", common::NOW).unwrap_err();
    assert!(err.to_string().contains("changed since"), "{err}");
    assert_eq!(text(&t), kept);
    assert_eq!(k.proposals().unwrap().len(), 1, "it still waits");
}

#[test]
fn the_limit_counts_what_is_taken_out_and_not_what_is_moved_or_wrapped() {
    let (t, k, s) = open();
    let all = blocks(&k);
    // Moving the whole table to the top takes nothing out.
    done(
        k.agent_run(
            &s,
            &edit(vec![PageStep::Move {
                block: r(&all[5]),
                after: None,
                before: Some(r(&all[0])),
            }]),
            common::NOW,
        )
        .unwrap(),
    );
    let all = blocks(&k);
    // Setting most of the page in a callout takes nothing out either.
    done(
        k.agent_run(
            &s,
            &edit(vec![PageStep::Callout {
                blocks: all[1..6].iter().map(r).collect(),
                kind: "note".into(),
                title: "Wrapped".into(),
            }]),
            common::NOW,
        )
        .unwrap(),
    );
    assert!(text(&t).contains("> [!note] Wrapped\n"));
    // A small deletion is under the limit.
    let all = blocks(&k);
    done(
        k.agent_run(
            &s,
            &edit(vec![PageStep::Delete {
                block: r(all.last().unwrap()),
            }]),
            common::NOW,
        )
        .unwrap(),
    );
}

#[test]
fn a_trusted_session_and_autonomous_mode_make_the_big_edit_at_once() {
    let (t, k, s) = open();
    k.trust_session(&s.id, common::NOW.millis + 60_000).unwrap();
    done(k.agent_run(&s, &big(&k), common::NOW).unwrap());
    assert!(!text(&t).contains("Intro paragraph."));

    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    done(k.agent_run(&s, &big(&k), common::NOW).unwrap());
    assert!(!text(&t).contains("Intro paragraph."));
    let head = &k.log(Some(PAGE), 1).unwrap()[0];
    assert_eq!(head.mode.as_deref(), Some("autonomous"));
    assert_eq!(head.op.as_deref(), Some("edit_page"));
}

#[test]
fn review_mode_holds_even_a_small_edit() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let before = text(&t);
    let all = blocks(&k);
    pending(
        k.agent_run(&s, &edit(vec![replace(&all[1], "Small.")]), common::NOW)
            .unwrap(),
    );
    assert_eq!(text(&t), before);
}

#[test]
fn a_locked_page_is_refused_in_every_mode() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let (t, k, s) = open_with("locked: true\n", "# Plan\n\nIntro.\n");
        set_mode(&k, mode);
        let before = text(&t);
        let all = blocks(&k);
        let why = refused(k.agent_run(&s, &edit(vec![replace(&all[1], "x")]), common::NOW));
        assert!(why.contains("locked"), "{mode:?}: {why}");
        assert_eq!(text(&t), before);
    }
}

#[test]
fn what_an_agent_sends_may_be_at_most_200_kb() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let before = text(&t);
    let why = refused(k.agent_run(
        &s,
        &edit(vec![replace(&all[1], &"x".repeat(204_801))]),
        common::NOW,
    ));
    assert!(
        why.contains("A single write may be at most 200 KB"),
        "{why}"
    );
    assert_eq!(text(&t), before);
    done(
        k.agent_run(
            &s,
            &edit(vec![replace(&all[1], &"x".repeat(204_800))]),
            common::NOW,
        )
        .unwrap(),
    );
    assert!(text(&t).contains(&"x".repeat(204_800)));
}

#[test]
fn a_batch_holds_page_edits_and_is_all_or_nothing() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let n = commits(&k);
    let append = AgentOp::Append {
        path: PAGE.into(),
        markdown: "Appended.".into(),
        heading: None,
    };
    let batch = AgentOp::Batch {
        ops: vec![edit(vec![replace(&all[1], "Batch intro.")]), append.clone()],
        reason: None,
    };
    done(k.agent_run(&s, &batch, common::NOW).unwrap());
    assert_eq!(commits(&k), n + 1, "one commit for the batch");
    let after = text(&t);
    assert!(after.contains("Batch intro.") && after.contains("Appended."));
    assert_eq!(k.log(None, 1).unwrap()[0].op.as_deref(), Some("batch"));

    // A step that names a block that changed refuses the batch, and the append with it.
    let (t, k, s) = open();
    let all = blocks(&k);
    human_edit(&k, "Intro paragraph.", "Changed by a person.");
    let kept = text(&t);
    let batch = AgentOp::Batch {
        ops: vec![append, edit(vec![replace(&all[1], "Stale.")])],
        reason: None,
    };
    let why = refused(k.agent_run(&s, &batch, common::NOW));
    assert!(
        why.contains("Change 2 of 2 (edit_page)") && why.contains("changed since"),
        "{why}"
    );
    assert_eq!(text(&t), kept);
}

#[test]
fn a_batch_whose_first_page_edit_moves_the_ids_for_the_second_writes_nothing() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let before = text(&t);
    let n = commits(&k);
    let first = edit(vec![PageStep::Insert {
        before: None,
        after: Some(r(&all[0])),
        at_end_of_heading: None,
        markdown: "A new paragraph.".into(),
    }]);
    // Worked out against the page as it was, but made after the first has moved every id.
    let second = edit(vec![replace(&all[6], "Late.")]);
    let batch = AgentOp::Batch {
        ops: vec![first, second],
        reason: None,
    };
    let err = k.agent_run(&s, &batch, common::NOW).unwrap_err();
    assert!(err.to_string().contains("changed since"), "{err}");
    assert_eq!(text(&t), before);
    assert_eq!(commits(&k), n);
}
