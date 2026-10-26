//! Threads that are kept: a chat comes back after the app was closed, goes on
//! without running anything twice, brings its staged changes with it, and a
//! damaged file never gets in the way.

use std::fs;
use std::sync::Arc;

use kasten_core::Instant;
use kasten_core::agent::Session;
use serde_json::json;

use super::turns::{request, results, turn};
use super::{Fake, Scratch, Seen, Step, Vault, block_on, vault};
use crate::chat::attach::Attachments;
use crate::chat::event::EventKind;
use crate::chat::model::{Message, Reply, Stop, ToolCall};
use crate::chat::store::{Record, Status, Store, VERSION};
use crate::chat::threads::{self, Chats, Profile};
use crate::chat::{ChatRequest, Events, WriteMode};

/// The app's saved chats for a vault, as a fresh run of the app would open them.
pub(super) fn open(data: &Scratch, v: &Vault) -> Chats {
    let chats = Chats::default();
    let root = v.kasten.root().display().to_string();
    chats.use_store(
        Arc::new(Store::open(&data.0, &root)),
        Some(Arc::new(Attachments::open(&data.0, &root))),
    );
    chats
}

pub(super) fn store_of(data: &Scratch, v: &Vault) -> Store {
    Store::open(&data.0, &v.kasten.root().display().to_string())
}

fn go_on(chats: &Chats, v: &Vault, model: &Arc<Fake>, seen: &Arc<Seen>) {
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

#[test]
fn a_chat_the_app_closed_on_comes_back_interrupted_and_goes_on_from_its_last_step() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    let model = Fake::new(vec![
        Step::Reply("", vec![("list_tags", json!({}))], Stop::Tools),
        Step::Hang("Thinking about the tags"),
    ]);
    // The app is closed while the second step streams.
    let closing = chats.clone();
    let seen = Seen::with(move |e| {
        if e.kind == EventKind::Text {
            closing.interrupt_all();
        }
    });
    turn(
        &chats,
        &v,
        &model,
        &seen,
        request("c1", "Make a note of the tags"),
    );
    chats
        .save_ui(
            "c1",
            json!({"title": "Tags", "seq": 5, "messages": ["on screen"]}),
        )
        .unwrap();
    let saved = store_of(&data, &v).load("c1").unwrap();
    assert_eq!(saved.status, Status::Interrupted);
    let before = chats.messages("c1").unwrap();
    assert_eq!(saved.messages, before);

    // The app starts again.
    let again = open(&data, &v);
    let list = again.list();
    assert_eq!(
        (list[0].id.as_str(), list[0].title.as_str(), list[0].status),
        ("c1", "Tags", Status::Interrupted)
    );
    let loaded = again.loaded("c1", &v.kasten).unwrap();
    assert_eq!(loaded.status, Status::Interrupted);
    assert_eq!(loaded.ui.unwrap()["messages"], json!(["on screen"]));
    assert_eq!(loaded.seq, 5, "the screen was up to date with event 5");

    let next = Fake::new(vec![Step::Reply("Here are the tags.", vec![], Stop::End)]);
    let seen = Seen::new();
    go_on(&again, &v, &next, &seen);
    assert_eq!(seen.last().kind, EventKind::Done);
    assert!(seen.of(EventKind::Tool).is_empty(), "nothing ran again");
    // It goes on from what was kept: the question, the call and its result, and what it was saying.
    let sent = &next.sent()[0];
    assert_eq!(sent[..before.len()], before[..]);
    assert_eq!(sent.len(), before.len() + 1);
    assert_eq!(
        sent.last().unwrap().user_text(),
        Some(crate::chat::turn::RESUME)
    );
    assert_eq!(again.state("c1", 0).status, Status::Idle);
    assert_eq!(store_of(&data, &v).load("c1").unwrap().status, Status::Idle);
}

#[test]
fn a_call_that_never_ran_is_answered_as_not_run_and_never_run_afterwards() {
    let v = vault();
    let data = Scratch::new();
    // What a crash leaves: the model asked for a note, and the app went before it was made.
    let asked = Message::Assistant(Reply {
        text: "Adding it.".to_owned(),
        calls: vec![ToolCall {
            id: "call_1".to_owned(),
            name: "create_note".to_owned(),
            arguments: json!({"type": "card", "title": "Never run note", "body": "x"}).to_string(),
        }],
        stop: Stop::Tools,
        blocks: None,
        items: None,
    });
    let record = Record {
        version: VERSION,
        id: "c1".to_owned(),
        title: "Add a note".to_owned(),
        created: 1,
        updated: 2,
        status: Status::Running,
        provider: "fake".to_owned(),
        model: String::new(),
        settings: None,
        writes: WriteMode::Direct,
        session: Session::start("kasten-chat", Instant::now()),
        system: "system".to_owned(),
        day: "2026-09-24".to_owned(),
        messages: vec![Message::User("Add a note".to_owned()), asked],
        plan: vec![],
        seq: 4,
        change_set: None,
        ui: None,
        attachments: vec![],
        archived: false,
        bound: None,
        rev: 1,
    };
    store_of(&data, &v).save(&record).unwrap();

    let chats = open(&data, &v);
    assert_eq!(
        chats.list()[0].status,
        Status::Interrupted,
        "found working with nothing working"
    );
    let model = Fake::new(vec![Step::Reply(
        "I will not do that twice.",
        vec![],
        Stop::End,
    )]);
    let seen = Seen::new();
    go_on(&chats, &v, &model, &seen);
    assert_eq!(seen.last().kind, EventKind::Done);
    assert!(seen.of(EventKind::Tool).is_empty());
    assert!(!v.dir.join("inbox/never-run-note.md").exists());
    let sent = model.sent();
    let back = results(&sent[0][2]);
    assert_eq!(back[0].id, "call_1");
    assert!(back[0].is_error && back[0].content.starts_with("Not run: the app closed"));
}

#[test]
fn a_message_sent_to_a_chat_that_was_not_opened_this_run_reaches_the_model_with_its_history() {
    let v = vault();
    let data = Scratch::new();
    let first = open(&data, &v);
    let model = Fake::new(vec![Step::Reply("Noted.", vec![], Stop::End)]);
    turn(
        &first,
        &v,
        &model,
        &Seen::new(),
        request("c1", "Remember the number 7"),
    );

    let again = open(&data, &v);
    let model = Fake::new(vec![Step::Reply("Seven.", vec![], Stop::End)]);
    turn(
        &again,
        &v,
        &model,
        &Seen::new(),
        request("c1", "What number?"),
    );
    let sent = &model.sent()[0];
    assert_eq!(sent.len(), 3);
    assert_eq!(sent[0], Message::User("Remember the number 7".to_owned()));
    assert_eq!(sent[2], Message::User("What number?".to_owned()));
    // The same session, so History shows one chat's work together.
    assert_eq!(
        again.session_of("c1").unwrap().id,
        first.session_of("c1").unwrap().id
    );
    // And the event numbers go on from where they were.
    let seen = Seen::new();
    let model = Fake::new(vec![]);
    turn(&again, &v, &model, &seen, request("c1", "Again"));
    assert!(
        seen.all()[0].seq > first.state("c1", 0).seq,
        "never back to 1"
    );
}

#[test]
fn the_screen_is_kept_with_the_thread_and_its_title_is_the_first_words() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    let model = Fake::new(vec![]);
    turn(
        &chats,
        &v,
        &model,
        &Seen::new(),
        request("c1", "Plan my week\nand the next"),
    );
    assert_eq!(chats.list()[0].title, "Plan my week");
    // Without a number in the screen, it is up to date with the last event.
    let loaded = chats.loaded("c1", &v.kasten).unwrap();
    assert_eq!(loaded.seq, chats.state("c1", 0).seq);
    chats
        .save_ui("c1", json!({"title": "  My weekly plan  "}))
        .unwrap();
    assert_eq!(chats.list()[0].title, "My weekly plan");
    let too_big = json!({"blob": "x".repeat(5 * 1024 * 1024)});
    let err = chats.save_ui("c1", too_big).unwrap_err();
    assert!(err.contains("too long") && err.contains("5 MB"), "{err}");
    // A chat that has only a screen so far is kept too.
    chats
        .save_ui("draft", json!({"title": "Not sent yet"}))
        .unwrap();
    let titles: Vec<_> = open(&data, &v)
        .list()
        .into_iter()
        .map(|t| t.title)
        .collect();
    assert!(titles.contains(&"Not sent yet".to_owned()), "{titles:?}");
}

#[test]
fn a_chat_that_is_not_in_memory_still_answers_where_it_stands() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    turn(
        &chats,
        &v,
        &Fake::new(vec![]),
        &Seen::new(),
        request("c1", "Hello"),
    );
    let seq = chats.state("c1", 0).seq;
    let again = open(&data, &v);
    let state = again.state("c1", 0);
    assert_eq!((state.status, state.seq), (Status::Idle, seq));
    assert!(
        state.events.is_empty() && state.gap,
        "the events are gone, so the window must load the chat"
    );
    assert!(!again.state("c1", seq).gap);
    assert_eq!(again.state("nobody", 0).status, Status::Idle);
}

#[test]
fn a_chat_with_a_damaged_file_is_skipped_and_the_name_is_free_again() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    turn(
        &chats,
        &v,
        &Fake::new(vec![]),
        &Seen::new(),
        request("c1", "Hello"),
    );
    turn(
        &chats,
        &v,
        &Fake::new(vec![]),
        &Seen::new(),
        request("c2", "Other"),
    );
    let root = v.kasten.root().display().to_string();
    let folder = data
        .0
        .join("chats")
        .join(crate::chat::store::vault_hash(&root));
    fs::write(folder.join("c1.json"), b"{\"version\": 1, torn").unwrap();
    fs::write(folder.join("c1.head.json"), b"").unwrap();

    let again = open(&data, &v);
    let ids: Vec<_> = again.list().into_iter().map(|t| t.id).collect();
    assert_eq!(ids, ["c2"]);
    assert!(again.loaded("c1", &v.kasten).is_err());
    assert!(
        folder.join("c1.json.bad").exists(),
        "kept aside, not deleted"
    );
    // The same chat id starts afresh.
    let model = Fake::new(vec![]);
    turn(
        &again,
        &v,
        &model,
        &Seen::new(),
        request("c1", "A new start"),
    );
    assert_eq!(model.sent()[0].len(), 1);
}

#[test]
fn staged_changes_come_back_with_the_chat() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    let model = Fake::new(vec![
        Step::Reply(
            "",
            vec![("capture", json!({"markdown": "Water the plants"}))],
            Stop::Tools,
        ),
        Step::Reply("Staged it.", vec![], Stop::End),
    ]);
    let asked = ChatRequest {
        writes: WriteMode::Preview,
        ..request("c1", "Capture a reminder")
    };
    turn(&chats, &v, &model, &Seen::new(), asked);
    let staged = chats.changes("c1").unwrap().lock().unwrap().clone();
    assert!(!staged.is_empty());

    let again = open(&data, &v);
    again.loaded("c1", &v.kasten).unwrap();
    let back = again.changes("c1").unwrap().lock().unwrap().clone();
    assert_eq!(back, staged, "the same set, read from the vault's cache");
    // A chat with changes waiting cannot be deleted.
    let err = again.delete_thread("c1", &v.kasten).unwrap_err();
    assert!(err.contains("changes waiting for review"), "{err}");
    assert!(again.list().iter().any(|t| t.id == "c1"));
}
