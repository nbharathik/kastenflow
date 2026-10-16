//! Messages sent while a turn works, the plan, and the prompt's date.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;

use super::budget::{go_on, small};
use super::turns::{request, results, turn};
use super::{Fake, Seen, Step, block_on, vault};
use crate::chat::event::EventKind;
use crate::chat::model::{Message, Stop};
use crate::chat::store::Status;
use crate::chat::threads::{self, Chats, Queued};
use crate::chat::{ChatRequest, Events};

/// Queues `text` once, the first time `when` is true of an event.
fn sender(
    chats: &Chats,
    text: &'static str,
    when: impl Fn(&crate::chat::ChatEvent) -> bool + Send + Sync + 'static,
) -> Arc<Seen> {
    let chats = chats.clone();
    let once = AtomicBool::new(false);
    Seen::with(move |e| {
        if when(e) && !once.swap(true, Ordering::SeqCst) {
            let queued = Queued {
                text: text.to_owned(),
                message: Message::User(text.to_owned()),
            };
            let _ = chats.enqueue("c1", queued);
        }
    })
}

#[test]
fn a_message_sent_while_the_turn_works_is_taken_up_at_the_next_step() {
    let v = vault();
    let chats = Chats::default();
    let seen = sender(&chats, "Also look at the boards", |e| {
        e.kind == EventKind::ToolResult
    });
    let model = Fake::new(vec![
        Step::Reply("", vec![("list_tags", json!({}))], Stop::Tools),
        Step::Reply("Tags and boards checked.", vec![], Stop::End),
    ]);
    turn(&chats, &v, &model, &seen, request("c1", "Check the tags"));
    assert_eq!(seen.last().kind, EventKind::Done);
    let second = &model.sent()[1];
    assert_eq!(
        second.len(),
        4,
        "question, answer, results, and the new words after them"
    );
    assert!(matches!(second[2], Message::Results(_)));
    assert_eq!(
        second[3],
        Message::User("Also look at the boards".to_owned())
    );
    let delivered = seen.of(EventKind::Queued);
    assert_eq!(delivered.len(), 1);
    assert_eq!(
        (delivered[0].text.as_deref(), delivered[0].delivered),
        (Some("Also look at the boards"), Some(true))
    );
    assert!(chats.waiting("c1").is_empty());
}

#[test]
fn a_message_that_comes_as_the_answer_ends_is_the_next_step() {
    let v = vault();
    let chats = Chats::default();
    let seen = sender(&chats, "One more thing", |e| e.kind == EventKind::Text);
    let model = Fake::new(vec![
        Step::Reply("First answer.", vec![], Stop::End),
        Step::Reply("Second answer.", vec![], Stop::End),
    ]);
    turn(&chats, &v, &model, &seen, request("c1", "A question"));
    assert_eq!(model.sent().len(), 2, "the turn did not end between them");
    assert_eq!(
        model.sent()[1].last(),
        Some(&Message::User("One more thing".to_owned()))
    );
    assert_eq!(seen.of(EventKind::Done).len(), 1);
    assert_eq!(chats.state("c1", 0).status, Status::Idle);
}

#[test]
fn send_while_a_turn_works_queues_the_message_and_the_turn_takes_it_up() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![Step::Reply("Both answered.", vec![], Stop::End)]);
    let seen = Seen::new();
    let events: Arc<dyn Events> = seen.clone();
    let send = |text: &str| {
        threads::send(
            &chats,
            Arc::clone(&v.kasten),
            events.clone(),
            Arc::clone(&model),
            request("c1", text),
        )
    };
    let (first, work) = send("First").unwrap();
    let (second, nothing) = send("And second").unwrap();
    assert!(!first.queued && second.queued);
    assert_eq!(
        (&second.turn, &second.session),
        (&first.turn, &first.session)
    );
    block_on(nothing);
    assert_eq!(chats.waiting("c1"), ["And second"]);
    let waiting = seen.of(EventKind::Queued);
    assert_eq!(
        (waiting[0].text.as_deref(), waiting[0].delivered),
        (Some("And second"), Some(false))
    );

    block_on(work);
    let sent = model.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        sent[0],
        [
            Message::User("First".to_owned()),
            Message::User("And second".to_owned())
        ]
    );
    let delivered: Vec<_> = seen
        .of(EventKind::Queued)
        .iter()
        .map(|e| e.delivered)
        .collect();
    assert_eq!(delivered, [Some(false), Some(true)]);
    assert_eq!(seen.of(EventKind::Done).len(), 1);
    assert!(chats.waiting("c1").is_empty());
}

#[test]
fn stop_stops_and_drops_what_waited() {
    let v = vault();
    let chats = Chats::default();
    let ctl = chats.clone();
    let once = AtomicBool::new(false);
    let seen = Seen::with(move |e| {
        if e.kind == EventKind::Text && !once.swap(true, Ordering::SeqCst) {
            let queued = Queued {
                text: "Never mind that".to_owned(),
                message: Message::User("Never mind that".to_owned()),
            };
            let _ = ctl.enqueue("c1", queued);
            ctl.stop("c1");
        }
    });
    let model = Fake::new(vec![Step::Hang("Working on it")]);
    turn(&chats, &v, &model, &seen, request("c1", "Start"));
    let last = seen.last();
    assert_eq!((last.kind, last.stopped), (EventKind::Done, Some(true)));
    assert!(
        chats.waiting("c1").is_empty(),
        "Stop stops what was waiting too"
    );
    assert_eq!(model.sent().len(), 1);
}

#[test]
fn what_waits_through_a_pause_is_taken_up_when_the_turn_goes_on() {
    let v = vault();
    let chats = Chats::default();
    chats.set_budgets(small(1, 250));
    let seen = sender(&chats, "While you were stopping", |e| {
        e.kind == EventKind::ToolResult
    });
    let model = Fake::new(vec![
        Step::Reply("", vec![("list_tags", json!({}))], Stop::Tools),
        Step::Reply("Carried on.", vec![], Stop::End),
    ]);
    turn(&chats, &v, &model, &seen, request("c1", "Begin"));
    assert_eq!(seen.last().kind, EventKind::Paused);
    assert_eq!(
        chats.waiting("c1"),
        ["While you were stopping"],
        "it is still waiting"
    );

    let seen = Seen::new();
    go_on(&chats, &v, &model, &seen);
    assert_eq!(seen.last().kind, EventKind::Done);
    assert_eq!(
        model.sent()[1].last(),
        Some(&Message::User("While you were stopping".to_owned()))
    );
    assert!(chats.waiting("c1").is_empty());
}

#[test]
fn update_plan_replaces_the_plan_tells_the_window_and_is_kept_with_the_thread() {
    let v = vault();
    let chats = Chats::default();
    let first = json!({"items": [
        {"text": "Read the outline", "status": "doing"},
        {"text": "Write the slides", "status": "todo"},
    ]});
    let second = json!({"items": [
        {"text": "Read the outline", "status": "done"},
        {"text": "Write the slides", "status": "doing"},
    ]});
    let model = Fake::new(vec![
        Step::Reply("", vec![("update_plan", first)], Stop::Tools),
        Step::Reply("", vec![("update_plan", second)], Stop::Tools),
        Step::Reply("Finished.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Make a short deck"),
    );
    assert_eq!(seen.last().kind, EventKind::Done);
    // It is the chat's own tool: no tool rows, only the plan.
    assert!(seen.of(EventKind::Tool).is_empty() && seen.of(EventKind::ToolResult).is_empty());
    let plans: Vec<_> = seen
        .of(EventKind::Plan)
        .into_iter()
        .map(|e| e.plan.unwrap())
        .collect();
    assert_eq!(plans.len(), 2);
    assert_eq!(plans[1][0].id, plans[0][0].id, "an item keeps its id");
    // The thread keeps the plan, for the next turn and for a saved copy.
    assert_eq!(chats.plan("c1"), plans[1]);
    // The model read the list back.
    let sent = model.sent();
    let back = results(sent[1].last().unwrap());
    assert!(
        back[0].content.starts_with("Plan saved (0 of 2 done):"),
        "{}",
        back[0].content
    );
    assert!(!back[0].is_error);
}

#[test]
fn a_plan_that_is_not_one_is_an_error_the_model_reads_and_no_event() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply(
            "",
            vec![("update_plan", json!({"items": "no"}))],
            Stop::Tools,
        ),
        Step::Reply("Sorry.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Plan it"));
    assert!(seen.of(EventKind::Plan).is_empty());
    let sent = model.sent();
    let back = results(sent[1].last().unwrap());
    assert!(back[0].is_error && back[0].content.contains("update_plan needs `items`"));
}

#[test]
fn the_prompt_names_the_day_it_is_even_in_a_chat_kept_for_days() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![]);
    let seen = Seen::new();
    let on = |date: &str, text: &str| ChatRequest {
        date: Some(date.to_owned()),
        ..request("c1", text)
    };
    turn(&chats, &v, &model, &seen, on("2026-09-24", "One"));
    turn(&chats, &v, &model, &seen, on("2026-09-24", "Two"));
    turn(&chats, &v, &model, &seen, on("2026-09-25", "Three"));
    let systems = model.systems();
    assert!(systems[0].contains("Today is 2026-09-24."));
    assert_eq!(
        systems[0], systems[1],
        "the same day, the same prompt, byte for byte"
    );
    assert!(systems[2].contains("Today is 2026-09-25.") && !systems[2].contains("2026-09-24"));
}
