//! A long turn kept within the model's window: old results are left out,
//! then older rounds are summarised, with markers, the plan and what was
//! staged, and nothing happens while the history is small.

use std::sync::Arc;

use serde_json::json;

use super::turns::request;
use super::{Fake, Seen, Step, Vault, block_on, vault};
use crate::chat::compact::{self, ELIDED, SUMMARY_HEAD, SUMMARY_SYSTEM};
use crate::chat::event::EventKind;
use crate::chat::model::{Message, Stop};
use crate::chat::plan;
use crate::chat::prompt;
use crate::chat::threads::{self, Chats, Profile};
use crate::chat::{ChatRequest, Events, WriteMode};

/// Runs a turn on a model whose window is `window` tokens.
fn within(
    window: usize,
    chats: &Chats,
    v: &Vault,
    model: &Arc<Fake>,
    seen: &Arc<Seen>,
    request: ChatRequest,
) {
    let events: Arc<dyn Events> = seen.clone();
    let profile = Profile {
        window,
        ..Profile::default()
    };
    let (_, work) = threads::send_with(
        chats,
        Arc::clone(&v.kasten),
        events,
        Arc::clone(model),
        request,
        profile,
    )
    .unwrap();
    block_on(work);
}

/// Steps of reading, with results long enough to be left out. Two steps in a
/// row never make the same call, so none of it is a loop.
fn reading(from: usize, to: usize) -> Vec<Step> {
    (from..to)
        .map(|i| {
            let args = json!({ "limit": 3 + i % 3 });
            Step::Reply("", vec![("list_notes", args)], Stop::Tools)
        })
        .collect()
}

/// What the system prompt and the tools weigh before anyone says a word, in tokens.
fn fixed() -> usize {
    let mut tools = kasten_mcp::tools::specs();
    tools.push(plan::spec());
    compact::State::new(&tools).tools + compact::estimate(&prompt::system("2026-09-24"), &[])
}

fn user_texts(thread: &[Message]) -> Vec<String> {
    thread
        .iter()
        .filter_map(|m| m.user_text().map(str::to_owned))
        .collect()
}

#[test]
fn nothing_is_touched_while_the_history_is_small() {
    let v = vault();
    let chats = Chats::default();
    let mut script = reading(0, 9);
    script.push(Step::Reply("Done.", vec![], Stop::End));
    let model = Fake::new(script);
    let seen = Seen::new();
    within(
        100_000_000,
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Read a lot"),
    );
    assert_eq!(seen.last().kind, EventKind::Done);
    let sent = model.sent();
    assert_eq!(sent.len(), 10, "no extra request for a summary");
    let last = sent.last().unwrap();
    assert!(
        last.iter()
            .all(|m| !matches!(m, Message::Results(r) if r[0].content == ELIDED)),
        "no result left out"
    );
    assert!(seen.of(EventKind::Notice).is_empty());
}

#[test]
fn past_sixty_percent_results_older_than_six_rounds_are_left_out_and_nothing_else() {
    let v = vault();
    let chats = Chats::default();
    // The fixed part is 65% of the window: already past 60%, and the
    // conversation is far from taking it to 85%.
    let window = fixed() * 100 / 65;
    let mut script = reading(0, 9);
    script.push(Step::Reply("Done.", vec![], Stop::End));
    let model = Fake::new(script);
    let seen = Seen::new();
    within(
        window,
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Read a lot"),
    );
    assert_eq!(seen.last().kind, EventKind::Done);
    let sent = model.sent();
    assert_eq!(sent.len(), 10, "left out, not summarised: no extra request");
    let last = sent.last().unwrap();
    let outputs: Vec<_> = last
        .iter()
        .filter_map(|m| match m {
            Message::Results(r) => Some(r[0].content.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(outputs.len(), 9);
    // Nine rounds, the last six kept: the first three are markers, calls and all.
    assert!(outputs[..3].iter().all(|c| *c == ELIDED), "{outputs:?}");
    assert!(outputs[3..].iter().all(|c| *c != ELIDED));
    assert_eq!(
        last.iter()
            .filter(|m| matches!(m, Message::Assistant(r) if !r.calls.is_empty()))
            .count(),
        9
    );
    assert!(seen.of(EventKind::Notice).is_empty());
}

#[test]
fn past_eighty_five_percent_older_rounds_become_a_summary_with_the_plan_and_what_was_staged() {
    let v = vault();
    let chats = Chats::default();
    let first = vec![
        (
            "update_plan",
            json!({"items": [
                {"text": "Read the notes", "status": "doing"},
                {"text": "Write the report", "status": "todo"},
            ]}),
        ),
        ("capture", json!({"markdown": "Remember the milk"})),
    ];
    let mut script = vec![Step::Reply("", first, Stop::Tools)];
    script.extend(reading(1, 7));
    // The eighth step first asks for the summary, then does its work.
    script.push(Step::Reply(
        "- Read the notes; staged a capture.",
        vec![],
        Stop::End,
    ));
    script.push(Step::Reply("Report written.", vec![], Stop::End));
    let model = Fake::new(script);
    let seen = Seen::new();
    let asked = ChatRequest {
        writes: WriteMode::Preview,
        ..request("c1", "Write me a report on the notes")
    };
    within(2_000, &chats, &v, &model, &seen, asked);
    assert_eq!(seen.last().kind, EventKind::Done);
    assert_eq!(seen.text(), "Report written.");

    let sent = model.sent();
    assert_eq!(sent.len(), 9);
    let systems = model.systems();
    assert_eq!(
        systems[7], SUMMARY_SYSTEM,
        "one extra call, written for the summary"
    );
    assert_eq!(sent[7].len(), 1);
    let Message::User(record) = &sent[7][0] else {
        panic!("{:?}", sent[7]);
    };
    assert!(record.contains("[Assistant called] capture("), "{record}");

    // The request that followed: the first message, the summary, the last six rounds.
    let thread = &sent[8];
    assert_eq!(
        thread[0],
        Message::User("Write me a report on the notes".to_owned())
    );
    let Message::User(summary) = &thread[1] else {
        panic!("{:?}", thread[1]);
    };
    assert!(summary.starts_with(SUMMARY_HEAD), "{summary}");
    assert!(summary.contains("- Read the notes; staged a capture."));
    assert!(
        summary.contains("The plan as it stands:\n- [~] Read the notes\n- [ ] Write the report"),
        "{summary}"
    );
    let staged = chats.changes("c1").unwrap().lock().unwrap().steps[0]
        .summary
        .clone();
    assert!(
        summary.contains("Changes staged so far") && summary.contains(&format!("- {staged}")),
        "{summary}"
    );
    assert!(matches!(thread[2], Message::Assistant(_)));
    assert_eq!(thread.len(), 2 + 2 * 6);
    assert_eq!(
        systems
            .iter()
            .filter(|s| s.as_str() == SUMMARY_SYSTEM)
            .count(),
        1
    );

    // The person was told, and the thread kept the shorter history.
    let notice = &seen.of(EventKind::Notice)[0];
    assert_eq!(
        notice.text.as_deref(),
        Some("Earlier steps were summarised to make room.")
    );
    assert_eq!(notice.code.as_deref(), Some("summary"));
    let kept = chats.messages("c1").unwrap();
    assert_eq!(kept.len(), thread.len() + 1, "plus the final answer");
}

#[test]
fn a_summary_that_fails_leaves_the_history_alone_and_is_not_tried_at_every_step() {
    let v = vault();
    let chats = Chats::default();
    let mut script = reading(0, 7);
    script.push(Step::Fail("The summary could not be written"));
    script.extend(reading(7, 8));
    script.push(Step::Reply("Done anyway.", vec![], Stop::End));
    let model = Fake::new(script);
    let seen = Seen::new();
    within(
        2_000,
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Read a lot"),
    );
    assert_eq!(seen.last().kind, EventKind::Done);
    assert_eq!(seen.text(), "Done anyway.");
    // Seven steps, one failed summary, then the eighth and ninth steps: ten requests.
    let systems = model.systems();
    assert_eq!(systems.len(), 10);
    assert_eq!(
        systems.iter().filter(|s| *s == SUMMARY_SYSTEM).count(),
        1,
        "tried once"
    );
    assert!(
        seen.of(EventKind::Notice).is_empty(),
        "nothing was summarised"
    );
    assert!(
        !user_texts(&model.sent()[9])
            .iter()
            .any(|t| t.starts_with(SUMMARY_HEAD))
    );
}

#[test]
fn the_summary_names_what_it_left_out_of_a_message_that_carried_attachments() {
    let v = vault();
    let chats = Chats::default();
    let first = "Here is what I am working on";
    let middle = "<context>\nThe user attached this (from their vault, and as text or files):\n\n<attachment name=\"brief.md\">\nA long brief nobody should have to read twice.\n</attachment>\n</context>\n\nUse the brief";
    let last = "And now read everything";
    // Two questions that need no work, then one that does.
    let early = Fake::new(vec![]);
    within(
        2_000,
        &chats,
        &v,
        &early,
        &Seen::new(),
        request("c1", first),
    );
    within(
        2_000,
        &chats,
        &v,
        &early,
        &Seen::new(),
        request("c1", middle),
    );
    // The two early answers count as rounds: after five more, seven are more than six.
    let mut script = reading(0, 5);
    script.push(Step::Reply("- Read it.", vec![], Stop::End));
    script.push(Step::Reply("Done.", vec![], Stop::End));
    let model = Fake::new(script);
    within(2_000, &chats, &v, &model, &Seen::new(), request("c1", last));

    let sent = model.sent();
    assert_eq!(sent.len(), 7);
    // What the summary was written from names the attachment and does not repeat it.
    let Message::User(record) = &sent[5][0] else {
        panic!("{:?}", sent[5]);
    };
    assert!(
        record.contains(
            "[attached context left out of this summary; it included attachments “brief.md”]"
        ),
        "{record}"
    );
    assert!(!record.contains("A long brief"), "{record}");
    // The first message is exactly as it was, so is the latest request, and
    // the middle one is gone from what the model reads, not from the summary's marker.
    let thread = &sent[6];
    assert_eq!(thread[0], Message::User(first.to_owned()));
    let summary = thread[1].user_text().unwrap();
    assert!(summary.starts_with(SUMMARY_HEAD));
    // Whatever the model wrote, the summary says which attachments it does not carry.
    assert!(
        summary.contains("Attachments of the earlier messages, left out here: “brief.md”."),
        "{summary}"
    );
    assert!(thread.contains(&Message::User(last.to_owned())));
    assert!(
        !user_texts(thread)
            .iter()
            .any(|t| t.contains("A long brief"))
    );
}
