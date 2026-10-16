//! Stopping and resetting: a turn ends when told, between chunks or
//! between tool calls, and a thread takes one turn at a time.

use std::sync::Arc;

use serde_json::json;

use super::turns::{request, results, turn};
use super::{Fake, Seen, Step, block_on, vault};
use crate::chat::model::{Message, Stop};
use crate::chat::threads::{self, Chats};
use crate::chat::{EventKind, Events};

#[test]
fn stop_ends_an_answer_mid_stream() {
    let v = vault();
    let chats = Chats::default();
    let stopper = chats.clone();
    let seen = Seen::with(move |e| {
        if e.kind == EventKind::Text {
            stopper.stop("c1");
        }
    });
    let model = Fake::new(vec![Step::Hang("Let me think about")]);
    turn(&chats, &v, &model, &seen, request("c1", "Plan my week"));
    let last = seen.last();
    assert_eq!((last.kind, last.stopped), (EventKind::Done, Some(true)));
    // What was said stays in the thread, and the thread takes a new turn.
    let thread = chats.messages("c1").unwrap();
    assert!(matches!(&thread[1], Message::Assistant(r) if r.text == "Let me think about"));
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Go on"));
    assert_eq!(seen.last().stopped, Some(false));
}

#[test]
fn stop_between_tool_calls_leaves_the_rest_unrun() {
    let v = vault();
    let chats = Chats::default();
    let stopper = chats.clone();
    let seen = Seen::with(move |e| {
        if e.kind == EventKind::ToolResult {
            stopper.stop("c1");
        }
    });
    // Calls that only read start together, so the second is a write: it follows the first.
    let calls = vec![
        ("list_tags", json!({})),
        ("capture", json!({"markdown": "Never captured"})),
    ];
    let model = Fake::new(vec![Step::Reply("", calls, Stop::Tools)]);
    turn(&chats, &v, &model, &seen, request("c1", "Look around"));
    assert_eq!(seen.of(EventKind::Tool).len(), 1);
    assert_eq!(seen.last().stopped, Some(true));
    let thread = chats.messages("c1").unwrap();
    let outputs = results(thread.last().unwrap());
    assert!(!outputs[0].is_error);
    assert_eq!(outputs[1].content, "Not run: the user stopped this turn");
}

#[test]
fn reset_during_a_turn_frees_the_thread_at_once() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Hang("Working on"),
        Step::Reply("Fresh start.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    let events: Arc<dyn Events> = seen.clone();
    let send = |text: &str| {
        let request = request("c1", text);
        threads::send(
            &chats,
            Arc::clone(&v.kasten),
            events.clone(),
            Arc::clone(&model),
            request,
        )
        .unwrap()
    };
    let (first, work) = send("One");
    block_on(async {
        let running = tokio::spawn(work);
        while seen.text().is_empty() {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        chats.reset("c1");
        let (second, next) = send("Two");
        assert_ne!(second.session, first.session);
        running.await.unwrap();
        next.await;
    });
    let ends: Vec<_> = seen.of(EventKind::Done);
    assert_eq!(ends.len(), 2);
    assert_eq!(
        (ends[0].turn.as_str(), ends[0].stopped),
        (first.turn.as_str(), Some(true))
    );
    // The thread holds the new conversation only.
    let thread = chats.messages("c1").unwrap();
    assert_eq!(thread.len(), 2);
    assert_eq!(thread[0], Message::User("Two".to_owned()));
}

#[test]
fn a_thread_takes_one_turn_at_a_time() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![]);
    let seen = Seen::new();
    let events: Arc<dyn Events> = seen.clone();
    let send = |r| {
        threads::send(
            &chats,
            Arc::clone(&v.kasten),
            events.clone(),
            Arc::clone(&model),
            r,
        )
    };
    let (started, first) = send(request("c1", "One")).unwrap();
    assert!(!started.queued);
    // A message sent while the thread works waits for the running turn.
    let (waiting, _) = send(request("c1", "Two")).unwrap();
    assert!(waiting.queued);
    assert_eq!(waiting.turn, started.turn);
    assert_eq!(chats.waiting("c1"), ["Two"]);
    // Another chat is free, and a turn dropped unrun frees its own.
    assert!(send(request("c2", "Three")).is_ok());
    drop(first);
    assert_eq!(seen.last().kind, EventKind::Error);
    assert!(send(request("c1", "Four")).is_ok());
}
