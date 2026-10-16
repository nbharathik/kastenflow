//! The harness around a turn: budgets that pause instead of failing, Continue,
//! and the loop guard. (What a step does with an answer is in rounds.rs;
//! messages sent while a turn works and the plan in steering.rs; what the
//! window hears in events.rs.)

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use kasten_core::Instant;
use kasten_core::agent::Session;
use serde_json::{Value, json};

use super::turns::{request, results, turn};
use super::{Fake, Seen, Step, Vault, block_on, vault};
use crate::chat::Events;
use crate::chat::budget::{self, ChatBudgets, PauseReason};
use crate::chat::event::EventKind;
use crate::chat::model::{Message, Stop};
use crate::chat::plan::PlanItem;
use crate::chat::store::Status;
use crate::chat::threads::{self, Chats, Profile, Queued};
use crate::chat::turn::{Ending, Link, Turn};

/// `n` steps of reading, each a different call so none is a loop.
fn working(n: usize) -> Vec<Step> {
    (0..n)
        .map(|i| {
            let args = json!({ "limit": i + 1 });
            Step::Reply("", vec![("list_notes", args)], Stop::Tools)
        })
        .collect()
}

pub(super) fn small(rounds: u32, calls: u32) -> ChatBudgets {
    ChatBudgets {
        rounds,
        calls,
        minutes: 30,
    }
}

/// Lets a paused thread go on, as `chat_continue` does.
pub(super) fn go_on(chats: &Chats, v: &Vault, model: &Arc<Fake>, seen: &Arc<Seen>) {
    let events: Arc<dyn Events> = seen.clone();
    let (_, work) = threads::resume_with(
        chats,
        Arc::clone(&v.kasten),
        events,
        Arc::clone(model),
        "c1",
        Profile::default(),
    )
    .unwrap();
    block_on(work);
}

/// A turn's link to a thread that has none: nothing waits, nothing is kept.
struct Quiet;

impl Link for Quiet {
    fn checkpoint(&self, _: &[Message], _: &[PlanItem]) {}

    fn take_queued(&self) -> Vec<Queued> {
        Vec::new()
    }
}

#[test]
fn a_turn_that_runs_out_of_steps_pauses_and_continue_goes_on_in_place() {
    let v = vault();
    let chats = Chats::default();
    chats.set_budgets(small(3, 250));
    let mut script = working(5);
    script.push(Step::Reply("All done.", vec![], Stop::End));
    let model = Fake::new(script);
    let seen = Seen::new();
    turn(
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Go through everything"),
    );

    let last = seen.last();
    assert_eq!(last.kind, EventKind::Paused, "a pause is not an error");
    assert_eq!(last.reason, Some(PauseReason::Rounds));
    assert_eq!(
        last.detail.as_deref(),
        Some("Paused after 3 steps — Continue to let it go on")
    );
    assert!(last.error.is_none());
    assert_eq!(model.sent().len(), 3);
    let rounds: Vec<_> = seen
        .of(EventKind::Round)
        .iter()
        .map(|e| (e.n, e.calls))
        .collect();
    assert_eq!(
        rounds,
        [(Some(1), Some(0)), (Some(2), Some(1)), (Some(3), Some(2))]
    );
    assert_eq!(chats.state("c1", 0).status, Status::Paused);
    // Every step is kept, and the thread ends on results the model has yet to read.
    let kept = chats.messages("c1").unwrap();
    assert_eq!(kept.len(), 1 + 3 * 2);
    assert!(matches!(kept.last(), Some(Message::Results(_))));

    // Continue: a fresh budget, the same thread, no new question.
    let seen = Seen::new();
    go_on(&chats, &v, &model, &seen);
    assert_eq!(seen.last().kind, EventKind::Done);
    assert_eq!(seen.text(), "All done.");
    let sent = model.sent();
    assert_eq!(sent.len(), 6);
    assert_eq!(sent[3], kept, "it goes on from exactly where it stopped");
    assert_eq!(chats.state("c1", 0).status, Status::Idle);
    // A thread that is done has nothing to continue.
    let events: Arc<dyn Events> = Seen::new();
    let err = threads::resume_with(
        &chats,
        Arc::clone(&v.kasten),
        events,
        Arc::clone(&model),
        "c1",
        Profile::default(),
    )
    .err()
    .unwrap();
    assert!(err.contains("nothing to continue"), "{err}");
}

#[test]
fn a_failed_turn_with_work_done_can_go_on_and_one_with_nothing_kept_cannot() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply("", vec![("list_tags", json!({}))], Stop::Tools),
        Step::Fail("The connection to the model broke"),
        Step::Reply("Recovered.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Check the tags"));
    assert_eq!(seen.last().kind, EventKind::Error);
    assert_eq!(chats.state("c1", 0).status, Status::Error);
    // What was done is kept, so going on is a retry from there.
    let seen = Seen::new();
    go_on(&chats, &v, &model, &seen);
    assert_eq!(seen.last().kind, EventKind::Done);
    assert_eq!(seen.text(), "Recovered.");
    assert_eq!(model.sent()[2].len(), 3);

    // A first request that failed leaves nothing, and there is nothing to go on from.
    let nothing = Chats::default();
    let model = Fake::new(vec![Step::Fail("No answer at all")]);
    turn(&nothing, &v, &model, &Seen::new(), request("c1", "Hello"));
    let events: Arc<dyn Events> = Seen::new();
    let err = threads::resume_with(
        &nothing,
        Arc::clone(&v.kasten),
        events,
        Arc::clone(&model),
        "c1",
        Profile::default(),
    )
    .err()
    .unwrap();
    assert!(err.contains("nothing to continue"), "{err}");
}

#[test]
fn a_turn_out_of_tool_calls_leaves_the_rest_of_the_step_unrun_and_pauses() {
    let v = vault();
    let chats = Chats::default();
    chats.set_budgets(small(80, 2));
    let calls = vec![
        ("list_tags", json!({})),
        ("list_boards", json!({})),
        ("list_templates", json!({})),
    ];
    let model = Fake::new(vec![Step::Reply("", calls, Stop::Tools)]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Look at it all"));
    let last = seen.last();
    assert_eq!(
        (last.kind, last.reason),
        (EventKind::Paused, Some(PauseReason::Calls))
    );
    assert_eq!(
        last.detail.as_deref(),
        Some("Paused after 2 tool calls — Continue to let it go on")
    );
    assert_eq!(seen.of(EventKind::Tool).len(), 2);
    let kept = chats.messages("c1").unwrap();
    let back = results(kept.last().unwrap());
    assert_eq!(back.len(), 3, "every call has a result");
    assert!(!back[0].is_error && !back[1].is_error);
    assert!(
        back[2].is_error
            && back[2]
                .content
                .starts_with("Not run: this turn paused at its limit")
    );
}

#[test]
fn a_turn_past_its_minutes_pauses_before_it_asks_again() {
    let v = vault();
    let session = Session::start("kasten-chat", Instant::now());
    let model = Fake::new(vec![]);
    let seen = Seen::new();
    let tools = kasten_mcp::tools::specs();
    let cancel = AtomicBool::new(false);
    let turn = Turn {
        kasten: &v.kasten,
        session: &session,
        system: "system",
        tools: &tools,
        events: seen.as_ref(),
        chat: "c1",
        turn: "t1",
        cancel: &cancel,
        changes: None,
        link: &Quiet,
        budgets: ChatBudgets::default(),
        window: 100_000,
        spent: Duration::from_secs(31 * 60),
    };
    let mut messages = vec![Message::User("Hello".to_owned())];
    let ending = block_on(turn.run(&model, &mut messages, &mut Vec::new()));
    assert_eq!(
        ending,
        Ending::Paused {
            reason: PauseReason::Minutes,
            detail: "Paused after 30 minutes — Continue to let it go on".to_owned()
        }
    );
    assert!(model.sent().is_empty());
}

#[test]
fn the_same_call_with_the_same_result_is_nudged_once_and_then_pauses() {
    let v = vault();
    let chats = Chats::default();
    let script = (0..8)
        .map(|_| Step::Reply("", vec![("list_tags", json!({}))], Stop::Tools))
        .collect();
    let model = Fake::new(script);
    let seen = Seen::new();
    turn(
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Keep checking the tags"),
    );
    let last = seen.last();
    assert_eq!(
        (last.kind, last.reason),
        (EventKind::Paused, Some(PauseReason::Loop))
    );
    assert_eq!(seen.of(EventKind::Tool).len(), 6);
    let sent = model.sent();
    assert_eq!(sent.len(), 6);
    assert_eq!(
        sent[3].last(),
        Some(&Message::User(budget::NUDGE.to_owned())),
        "the nudge comes after the third repeat"
    );
    assert!(!sent[2].iter().any(|m| m.user_text() == Some(budget::NUDGE)));
}

#[test]
fn five_failing_calls_in_a_row_earn_the_nudge_too() {
    let v = vault();
    let chats = Chats::default();
    let names = ["nope1", "nope2", "nope3", "nope4", "nope5"];
    let calls: Vec<(&'static str, Value)> = names.iter().map(|n| (*n, json!({}))).collect();
    let model = Fake::new(vec![
        Step::Reply("", calls, Stop::Tools),
        Step::Reply("I will ask you instead.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Do the impossible"),
    );
    assert_eq!(seen.last().kind, EventKind::Done);
    assert_eq!(
        model.sent()[1].last(),
        Some(&Message::User(budget::NUDGE.to_owned()))
    );
}
