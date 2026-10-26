//! An agent taking more cards off a board than `max_board_nodes_removed`
//! allows waits for review, as the other soft limits do; at the limit or
//! under it the change is made. People are not held to it.

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::board::BoardChange;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

/// A board with `n` stickies; returns its path and their ids.
fn board_of(k: &Kasten, n: usize) -> (String, Vec<String>) {
    let board = k.create_board(&Actor::Human, "Crowded", None, NOW).unwrap();
    let stickies: Vec<BoardChange> = (0..n)
        .map(|i| BoardChange::Sticky {
            text: format!("Idea {i}"),
            x: (i as i64) * 300,
            y: 0,
        })
        .collect();
    let applied = k
        .board_apply(&Actor::Human, &board, &stickies, NOW)
        .unwrap();
    assert_eq!(applied.made.len(), n);
    (board, applied.made)
}

fn remove(board: &str, ids: &[String]) -> AgentOp {
    AgentOp::BoardChanges {
        board: board.to_owned(),
        changes: vec![BoardChange::Remove { ids: ids.to_vec() }],
        summary: String::new(),
    }
}

#[test]
fn taking_more_cards_off_than_the_limit_waits_for_review() {
    let (_t, k) = open();
    assert_eq!(k.config().guardrails.max_board_nodes_removed, 10);
    let (board, ids) = board_of(&k, 12);
    let s = Session::start("claude-code", NOW);
    let outcome = k.agent_run(&s, &remove(&board, &ids[..11]), NOW).unwrap();
    match outcome {
        Outcome::PendingReview { reason, .. } => {
            assert!(
                reason.contains("11") && reason.contains("10"),
                "the reason names the count and the limit: {reason}"
            );
        }
        other => panic!("expected a proposal, got {other:?}"),
    }
    assert_eq!(
        k.board(&board).unwrap().nodes.len(),
        12,
        "nothing was removed"
    );
}

#[test]
fn taking_off_as_many_as_the_limit_allows_is_done() {
    let (_t, k) = open();
    let (board, ids) = board_of(&k, 12);
    let s = Session::start("claude-code", NOW);
    let outcome = k.agent_run(&s, &remove(&board, &ids[..10]), NOW).unwrap();
    assert!(matches!(outcome, Outcome::Done { .. }), "{outcome:?}");
    assert_eq!(k.board(&board).unwrap().nodes.len(), 2);
}

#[test]
fn the_limit_is_the_one_in_the_config_and_a_trusted_session_is_not_held_to_it() {
    let (_t, k) = open();
    let mut config = k.config();
    config.guardrails.max_board_nodes_removed = 2;
    k.set_config(config).unwrap();
    let (board, ids) = board_of(&k, 6);
    let s = Session::start("claude-code", NOW);
    let held = k.agent_run(&s, &remove(&board, &ids[..3]), NOW).unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");

    k.trust_session(&s.id, NOW.millis + 60_000).unwrap();
    let done = k.agent_run(&s, &remove(&board, &ids[..3]), NOW).unwrap();
    assert!(matches!(done, Outcome::Done { .. }), "{done:?}");
    assert_eq!(k.board(&board).unwrap().nodes.len(), 3);
}

#[test]
fn several_calls_that_each_stay_under_the_limit_are_added_up_over_ten_minutes() {
    let (_t, k) = open();
    let (board, ids) = board_of(&k, 12);
    let s = Session::start("claude-code", NOW);
    let first = k.agent_run(&s, &remove(&board, &ids[..6]), NOW).unwrap();
    assert!(matches!(first, Outcome::Done { .. }), "{first:?}");
    match k.agent_run(&s, &remove(&board, &ids[6..12]), NOW).unwrap() {
        Outcome::PendingReview { reason, .. } => {
            assert!(
                reason.contains("already took 6") && reason.contains("12") && reason.contains("10"),
                "{reason}"
            );
        }
        other => panic!("expected a proposal, got {other:?}"),
    }
    assert_eq!(
        k.board(&board).unwrap().nodes.len(),
        6,
        "the second call removed nothing"
    );
    // Another session is counted by itself, and ten minutes later the count is gone.
    let other = Session::start("another", NOW);
    let done = k
        .agent_run(&other, &remove(&board, &ids[6..9]), NOW)
        .unwrap();
    assert!(matches!(done, Outcome::Done { .. }), "{done:?}");
    let later = kasten_core::Instant {
        millis: NOW.millis + 11 * 60_000,
    };
    let done = k
        .agent_run(&s, &remove(&board, &ids[9..12]), later)
        .unwrap();
    assert!(matches!(done, Outcome::Done { .. }), "{done:?}");
}

#[test]
fn a_person_is_not_held_to_it() {
    let (_t, k) = open();
    let (board, ids) = board_of(&k, 12);
    k.board_apply(
        &Actor::Human,
        &board,
        &[BoardChange::Remove { ids: ids.clone() }],
        NOW,
    )
    .unwrap();
    assert!(k.board(&board).unwrap().nodes.is_empty());
}

#[test]
fn a_change_that_removes_nothing_is_not_held() {
    let (_t, k) = open();
    let (board, _ids) = board_of(&k, 12);
    let s = Session::start("claude-code", NOW);
    let op = AgentOp::BoardChanges {
        board: board.clone(),
        changes: vec![BoardChange::Sticky {
            text: "One more".into(),
            x: 0,
            y: 400,
        }],
        summary: String::new(),
    };
    let outcome = k.agent_run(&s, &op, NOW).unwrap();
    assert!(matches!(outcome, Outcome::Done { .. }), "{outcome:?}");
    assert_eq!(k.board(&board).unwrap().nodes.len(), 13);
}
