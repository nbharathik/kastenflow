//! Turns with a scripted model against a copy of the dev vault: tool calls
//! commit in the thread's session, refusals go back to the model, and the
//! limit, stop and reset work.

use std::sync::Arc;

use serde_json::json;

use super::{Fake, Seen, Step, Vault, block_on, vault, vault_with};
use crate::chat::model::{Message, Stop};
use crate::chat::threads::{self, Chats};
use crate::chat::{ChatRequest, ChatTurn, EventKind, Events, MAX_CALLS};

pub(super) fn request(chat: &str, text: &str) -> ChatRequest {
    ChatRequest {
        chat: chat.to_owned(),
        provider: "fake".to_owned(),
        model: String::new(),
        text: text.to_owned(),
        context: vec![],
        date: Some("2026-09-24".to_owned()),
    }
}

/// Sends `request` and runs its turn to the end.
pub(super) fn turn(
    chats: &Chats,
    v: &Vault,
    model: &Arc<Fake>,
    seen: &Arc<Seen>,
    request: ChatRequest,
) -> ChatTurn {
    let events: Arc<dyn Events> = seen.clone();
    let (answer, work) = threads::send(
        chats,
        Arc::clone(&v.kasten),
        events,
        Arc::clone(model),
        request,
    )
    .unwrap();
    block_on(work);
    answer
}

pub(super) fn results(message: &Message) -> &[crate::chat::model::ToolOutput] {
    match message {
        Message::Results(results) => results,
        other => panic!("expected results, got {other:?}"),
    }
}

#[test]
fn a_tool_call_creates_a_note_in_the_threads_session() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply(
            "I'll add it.",
            vec![(
                "create_note",
                json!({"type": "card", "title": "Venue ideas", "body": "The coast or the hills?"}),
            )],
            Stop::Tools,
        ),
        Step::Reply("Added [[Venue ideas]].", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    let answer = turn(
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Note my venue ideas"),
    );

    assert_eq!(seen.text(), "I'll add it.Added [[Venue ideas]].");
    let tool = seen.of(EventKind::Tool)[0].tool.clone().unwrap();
    assert_eq!(tool.name, "create_note");
    assert_eq!(tool.input["title"], json!("Venue ideas"));
    let result = seen.of(EventKind::ToolResult)[0].result.clone().unwrap();
    assert_eq!(result.id, tool.id);
    assert!(result.ok);
    assert_eq!(result.summary, "Created card “Venue ideas”");
    assert_eq!(result.paths, ["inbox/venue-ideas.md"]);
    let last = seen.last();
    assert_eq!((last.kind, last.stopped), (EventKind::Done, Some(false)));
    assert_eq!(
        (last.chat.as_str(), last.turn.as_str()),
        ("c1", answer.turn.as_str())
    );
    assert!(seen.all().iter().all(|e| e.turn == answer.turn));

    // Committed as the chat's agent, in the thread's session.
    let commit = &v.kasten.log(Some("inbox/venue-ideas.md"), 1).unwrap()[0];
    assert_eq!(commit.author, "agent:kasten-chat");
    assert_eq!(commit.session.as_deref(), Some(answer.session.as_str()));

    // The model read the result, and the thread keeps the whole exchange.
    let sent = model.sent();
    assert_eq!(sent.len(), 2);
    let back = &results(sent[1].last().unwrap())[0];
    assert_eq!(back.id, tool.id);
    assert!(
        !back.is_error && back.content.contains("\"status\":\"done\""),
        "{back:?}"
    );
    assert_eq!(chats.messages("c1").unwrap().len(), 4);
    assert!(model.systems()[0].contains("Today is 2026-09-24."));
}

#[test]
fn a_thread_keeps_its_session_and_conversation_until_reset() {
    let v = vault();
    let chats = Chats::default();
    let capture = |text: &str| vec![("capture", json!({ "markdown": text }))];
    let model = Fake::new(vec![
        Step::Reply("", capture("Ask the team about the venue"), Stop::Tools),
        Step::Reply("Captured.", vec![], Stop::End),
        Step::Reply("", capture("Book the train"), Stop::Tools),
        Step::Reply("Captured too.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    let first = turn(
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Remind me to ask the team"),
    );
    let second = turn(
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "And to book the train"),
    );
    assert_eq!(first.session, second.session);
    assert_ne!(first.turn, second.turn);
    for path in [
        "inbox/ask-the-team-about-the-venue.md",
        "inbox/book-the-train.md",
    ] {
        let commit = &v.kasten.log(Some(path), 1).unwrap()[0];
        assert_eq!(
            commit.session.as_deref(),
            Some(first.session.as_str()),
            "{path}"
        );
    }
    // Each request repeats the one before it unchanged, prompt included.
    let sent = model.sent();
    assert_eq!(sent.len(), 4);
    assert_eq!(sent[2][..3], sent[1][..]);
    assert_eq!(sent[2].len(), 5);
    let systems = model.systems();
    assert!(systems.iter().all(|s| *s == systems[0]));

    chats.reset("c1");
    let third = turn(&chats, &v, &model, &seen, request("c1", "Hello again"));
    assert_ne!(third.session, first.session);
    assert_eq!(model.sent()[4].len(), 1, "a reset thread starts afresh");
}

#[test]
fn refusals_and_reviews_go_back_to_the_model() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply(
            "",
            vec![
                (
                    "append",
                    json!({"note": "templates/page.md", "markdown": "x"}),
                ),
                (
                    "propose_edit",
                    json!({"note": "Welcome to KastenFlow", "new_body": "All new.\n", "reason": "tidy"}),
                ),
            ],
            Stop::Tools,
        ),
        Step::Reply(
            "The template is read-only; the rewrite waits for you.",
            vec![],
            Stop::End,
        ),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Tidy up"));
    let shown: Vec<_> = seen
        .of(EventKind::ToolResult)
        .into_iter()
        .map(|e| e.result.unwrap())
        .collect();
    assert!(!shown[0].ok);
    assert!(
        shown[0]
            .summary
            .starts_with("Could not add to “templates/page.md”: ")
            && shown[0].summary.contains("read-only"),
        "{}",
        shown[0].summary
    );
    assert!(shown[1].ok);
    assert!(
        shown[1]
            .summary
            .starts_with("Waiting for review: rewrite “Welcome to KastenFlow”"),
        "{}",
        shown[1].summary
    );
    assert_eq!(
        seen.last().kind,
        EventKind::Done,
        "a refusal is not a crash"
    );
    let back = results(model.sent()[1].last().unwrap()).to_vec();
    assert!(back[0].is_error && back[0].content.contains("read-only"));
    assert!(!back[1].is_error && back[1].content.contains("pending_review"));
}

#[test]
fn a_turn_stops_at_its_tool_call_limit() {
    let v = vault();
    let chats = Chats::default();
    let script = (0..=MAX_CALLS)
        .map(|_| Step::Reply("", vec![("list_tags", json!({}))], Stop::Tools))
        .collect();
    let model = Fake::new(script);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Keep looking"));
    assert_eq!(seen.of(EventKind::Tool).len(), MAX_CALLS);
    assert_eq!(seen.of(EventKind::ToolResult).len(), MAX_CALLS);
    let last = seen.last();
    assert_eq!(last.kind, EventKind::Error);
    assert!(last.error.unwrap().contains("12 tool calls"));
    // The call that was not run still has a result, so the thread goes on.
    let thread = chats.messages("c1").unwrap();
    let unrun = &results(thread.last().unwrap())[0];
    assert!(unrun.is_error);
    assert!(
        unrun
            .content
            .starts_with("Not run: this turn reached its limit")
    );
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Go on"));
    assert_eq!(seen.last().kind, EventKind::Done);
}

#[test]
fn a_turn_without_an_answer_leaves_no_trace() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![Step::Fail("Claude answered 529: Overloaded.")]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Hello"));
    let last = seen.last();
    assert_eq!(last.kind, EventKind::Error);
    assert_eq!(
        last.error.as_deref(),
        Some("Claude answered 529: Overloaded.")
    );
    assert_eq!(chats.messages("c1").unwrap(), vec![]);
    turn(&chats, &v, &model, &seen, request("c1", "Hello"));
    assert_eq!(model.sent()[1].len(), 1, "the message is sent again, once");
}

#[test]
fn sending_needs_history_and_something_to_send() {
    let bare = vault_with(false);
    let chats = Chats::default();
    let seen: Arc<dyn Events> = Seen::new();
    let model = Fake::new(vec![]);
    let err = threads::send(
        &chats,
        Arc::clone(&bare.kasten),
        seen.clone(),
        Arc::clone(&model),
        request("c1", "Hi"),
    )
    .err()
    .unwrap();
    assert!(err.contains("keeps no history"), "{err}");
    let v = vault();
    let err = threads::send(
        &chats,
        Arc::clone(&v.kasten),
        seen,
        model,
        request("c1", "  "),
    )
    .err()
    .unwrap();
    assert!(err.contains("nothing to send"), "{err}");
}
