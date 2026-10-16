//! What one step of a turn does with what the model answered: an answer cut
//! by its length is continued, a call cut off is asked again smaller, a pause
//! from the provider is not an ending, and calls that only read run together.

use serde_json::json;

use super::turns::{request, results, turn};
use super::{Fake, Seen, Step, vault};
use crate::chat::budget::PauseReason;
use crate::chat::event::EventKind;
use crate::chat::model::{Message, Stop};
use crate::chat::threads::Chats;
use crate::chat::turn;

#[test]
fn an_answer_cut_by_its_length_is_continued_where_it_stopped() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply("The first part, ", vec![], Stop::Length),
        Step::Reply("and the second.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Write it out"));
    assert_eq!(seen.last().kind, EventKind::Done);
    assert_eq!(seen.text(), "The first part, and the second.");
    let second = &model.sent()[1];
    assert_eq!(second.len(), 3);
    assert!(matches!(&second[1], Message::Assistant(r) if r.text == "The first part, "));
    assert_eq!(second[2], Message::User(turn::CONTINUE.to_owned()));
}

#[test]
fn an_answer_that_keeps_running_over_its_length_pauses_after_three_tries() {
    let v = vault();
    let chats = Chats::default();
    let script = (0..6)
        .map(|_| Step::Reply("More words ", vec![], Stop::Length))
        .collect();
    let model = Fake::new(script);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Write a lot"));
    let last = seen.last();
    assert_eq!(
        (last.kind, last.reason),
        (EventKind::Paused, Some(PauseReason::Length))
    );
    assert_eq!(model.sent().len(), 4, "the first and three continues");
    assert!(last.detail.unwrap().contains("length limit"));
}

#[test]
fn a_tool_call_cut_off_by_the_length_limit_is_not_run_and_is_asked_again_smaller() {
    let v = vault();
    let chats = Chats::default();
    let cut = vec![("create_note", "{\"type\": \"card\", \"title\": \"Unfinis")];
    let model = Fake::new(vec![
        Step::Raw("Adding it. ", cut.clone(), Stop::Length),
        Step::Reply("Made it in smaller pieces.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Make a card"));
    assert_eq!(seen.last().kind, EventKind::Done);
    assert!(
        seen.of(EventKind::Tool).is_empty(),
        "nothing half written ran"
    );
    let second = &model.sent()[1];
    assert_eq!(
        second.last(),
        Some(&Message::User(turn::SMALLER.to_owned()))
    );
    assert!(
        matches!(&second[1], Message::Assistant(r) if r.calls.is_empty() && r.text == "Adding it. ")
    );

    // Cut off again at once: the turn pauses rather than trying for ever.
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Raw("", cut.clone(), Stop::Length),
        Step::Raw("", cut, Stop::Length),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Make a card"));
    let last = seen.last();
    assert_eq!(
        (last.kind, last.reason),
        (EventKind::Paused, Some(PauseReason::Length))
    );
    assert_eq!(model.sent().len(), 2);
}

#[test]
fn a_pause_from_the_provider_goes_back_as_it_is_and_the_turn_goes_on() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply("Searching…", vec![], Stop::Pause),
        Step::Reply("Found it.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Look it up"));
    assert_eq!(seen.last().kind, EventKind::Done);
    let second = &model.sent()[1];
    assert!(matches!(second.last(), Some(Message::Assistant(r)) if r.text == "Searching…"));
}

#[test]
fn tools_that_only_read_are_known_from_their_annotation() {
    let specs = kasten_mcp::tools::specs();
    let flag = |name: &str| specs.iter().find(|s| s.name == name).map(|s| s.read_only);
    for name in [
        "list_tags",
        "read_note",
        "search",
        "list_boards",
        "diagram_lint",
        "lint_deck",
    ] {
        assert_eq!(flag(name), Some(true), "{name}");
    }
    for name in [
        "create_note",
        "append",
        "capture",
        "trash_note",
        "add_slide",
    ] {
        assert_eq!(flag(name), Some(false), "{name}");
    }
    // The plan is the chat's own tool, answered in the turn and never run beside others.
    assert!(flag(crate::chat::plan::TOOL).is_none());
    assert!(!crate::chat::plan::spec().read_only);
}

/// The kinds of the tool events of a turn, in order, as T for a call and R for its result.
fn shape(seen: &Seen) -> String {
    seen.all()
        .iter()
        .filter_map(|e| match e.kind {
            EventKind::Tool => Some('T'),
            EventKind::ToolResult => Some('R'),
            _ => None,
        })
        .collect()
}

#[test]
fn calls_that_only_read_run_together_and_their_results_keep_the_models_order() {
    let v = vault();
    let chats = Chats::default();
    let calls = vec![
        ("list_tags", json!({})),
        ("list_boards", json!({})),
        ("list_templates", json!({})),
    ];
    let model = Fake::new(vec![
        Step::Reply("", calls, Stop::Tools),
        Step::Reply("Read all three.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Read everything"));
    assert_eq!(
        shape(&seen),
        "TTTRRR",
        "started together, reported in order"
    );
    let called: Vec<_> = seen
        .of(EventKind::Tool)
        .iter()
        .map(|e| e.tool.clone().unwrap().id)
        .collect();
    let reported: Vec<_> = seen
        .of(EventKind::ToolResult)
        .iter()
        .map(|e| e.result.clone().unwrap().id)
        .collect();
    assert_eq!(called, reported);
    let sent = model.sent();
    let back: Vec<_> = results(sent[1].last().unwrap())
        .iter()
        .map(|r| r.id.clone())
        .collect();
    assert_eq!(back, called);
}

#[test]
fn no_more_than_four_run_at_once_and_a_write_ends_a_group() {
    let v = vault();
    let chats = Chats::default();
    let six = vec![
        ("list_tags", json!({})),
        ("list_boards", json!({})),
        ("list_templates", json!({})),
        ("list_diagrams", json!({})),
        ("list_notes", json!({"limit": 1})),
        ("list_notes", json!({"limit": 2})),
    ];
    let mixed = vec![
        ("list_tags", json!({})),
        ("capture", json!({"markdown": "Remember the milk"})),
        ("list_boards", json!({})),
    ];
    let model = Fake::new(vec![
        Step::Reply("", six, Stop::Tools),
        Step::Reply("", mixed, Stop::Tools),
        Step::Reply("Done.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "Read, then write"));
    // Four together, then two; then a read, a write and a read each alone.
    assert_eq!(shape(&seen), "TTTTRRRRTTRRTRTRTR");
}
