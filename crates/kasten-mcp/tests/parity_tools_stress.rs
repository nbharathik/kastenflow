//! The parity tools under attack: spellings of the lock, hostile values,
//! odd arguments to the reads, and an undo that names a person's changes.

mod common;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::call;
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    k.start_history().unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn page(k: &Kasten, s: &Session, title: &str) -> String {
    let told = call(
        k,
        s,
        "create_note",
        json!({ "type": "page", "title": title, "body": "- [ ] one\n- [ ] two\n" }),
    )
    .unwrap();
    told["result"]["path"].as_str().unwrap().to_owned()
}

#[test]
fn no_spelling_of_the_lock_or_the_identity_can_be_set() {
    let (_v, k, s) = open();
    let path = page(&k, &s, "Styled");
    let before = k.read(&path).unwrap().text;
    for key in [
        "locked",
        "LOCKED",
        " locked ",
        "Locked",
        "title",
        "id",
        "parent",
        "type",
        "opens",
        "created",
        "children_order",
        "tags",
        "icon\nlocked",
    ] {
        let err = call(
            &k,
            &s,
            "set_note_meta",
            json!({ "note": path, "key": key, "value": "true" }),
        )
        .unwrap_err();
        assert!(!err.is_empty(), "{key:?}");
    }
    for value in [
        "x\nlocked: true",
        "x\r\nid: 1",
        "x\u{0}",
        &"y".repeat(5_000),
    ] {
        let err = call(
            &k,
            &s,
            "set_note_meta",
            json!({ "note": path, "key": "icon", "value": value }),
        )
        .unwrap_err();
        assert!(!err.is_empty(), "{value:?}");
    }
    let after = k.read(&path).unwrap();
    assert_eq!(after.text, before, "refusals write nothing");
    assert!(!after.meta.locked);
    // The key's case does not matter when it is allowed.
    let told = call(
        &k,
        &s,
        "set_note_meta",
        json!({ "note": path, "key": "Font", "value": "serif" }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
}

#[test]
fn the_reads_answer_odd_arguments_with_a_sentence_and_never_a_panic() {
    let (_v, k, s) = open();
    page(&k, &s, "Chores");
    for (tool, args) in [
        ("list_tasks", json!({ "today": "not-a-day" })),
        ("list_tasks", json!({ "status": "everything" })),
        ("list_tasks", json!({ "due": "someday" })),
        ("list_comments", json!({ "note": "no such note" })),
        ("restore_note", json!({ "note": "../../etc/passwd" })),
        ("restore_note", json!({ "note": ".trash/../library/x.md" })),
        (
            "update_collection",
            json!({ "collection": "views/../x.yaml", "hash": "h", "settings": { "query": "x" } }),
        ),
        (
            "move_diagram",
            json!({ "diagram": "../../x.drawio", "project": "../.." }),
        ),
        ("undo_session", json!({ "session": "no-such-session" })),
    ] {
        let err = call(&k, &s, tool, args.clone()).unwrap_err();
        assert!(!err.is_empty(), "{tool} {args}");
    }
    for limit in [0, 1, 1_000_000] {
        let told = call(&k, &s, "list_tasks", json!({ "limit": limit })).unwrap();
        assert!(told["tasks"].as_array().unwrap().len() <= 500);
        let told = call(&k, &s, "list_references", json!({ "limit": limit })).unwrap();
        assert!(told["references"].as_array().unwrap().len() <= 200);
        let told = call(&k, &s, "list_sessions", json!({ "limit": limit })).unwrap();
        assert!(told["sessions"].as_array().unwrap().len() <= 200);
    }
}

#[test]
fn a_persons_changes_are_never_a_session_to_take_back() {
    let (_v, k, s) = open();
    // The person works; the agent works; the agent names every id it can see.
    let mine = k
        .capture(&Actor::Human, "My own thought", &[], Instant::now())
        .unwrap();
    page(&k, &s, "The agents page");
    let listed = call(&k, &s, "list_sessions", Value::Null).unwrap();
    for session in listed["sessions"].as_array().unwrap() {
        assert_ne!(session["id"], "", "{session}");
    }
    for guess in ["human", "kasten", "user", "agent", " "] {
        let outcome = call(&k, &s, "undo_session", json!({ "session": guess }));
        // An empty name means the agent's own session; nothing else exists.
        if guess.trim().is_empty() {
            assert_eq!(outcome.unwrap()["status"], "done");
        } else {
            let err = outcome.unwrap_err();
            assert!(err.contains("nothing left to undo"), "{guess}: {err}");
        }
    }
    assert!(
        k.read(&mine.meta.path).is_ok(),
        "the person's card is still there"
    );
}

#[test]
fn the_new_write_tools_only_add_to_history_and_a_taking_back_loses_nothing() {
    let (v, k, s) = open();
    let first = k.log(None, 10_000).unwrap();
    let path = page(&k, &s, "Worked on");
    let steps = [
        ("duplicate_note", json!({ "note": path })),
        (
            "set_note_meta",
            json!({ "note": path, "key": "icon", "value": "📘" }),
        ),
        ("journal_day", json!({ "date": "2026-03-04" })),
        ("add_comment", json!({ "note": path, "text": "Check this" })),
        (
            "create_collection",
            json!({ "name": "Mine", "settings": { "query": "#x" } }),
        ),
    ];
    for (tool, args) in steps {
        let told = call(&k, &s, tool, args).unwrap();
        assert_eq!(told["status"], "done", "{tool}: {told}");
    }
    let before_undo = k.log(None, 10_000).unwrap();
    let undone = call(&k, &s, "undo_session", json!({})).unwrap();
    assert_eq!(undone["status"], "done", "{undone}");
    let after = k.log(None, 10_000).unwrap();
    // Every commit there was is still there, and the taking back added more.
    for commit in &before_undo {
        assert!(after.iter().any(|c| c.id == commit.id));
    }
    assert!(after.len() > before_undo.len());
    for commit in &first {
        assert!(after.iter().any(|c| c.id == commit.id));
    }
    // What the agent made is gone from the folder but its words are in history.
    assert!(k.read(&path).is_err());
    let trail: Vec<_> = after.iter().filter(|c| c.undoes.is_some()).collect();
    assert!(!trail.is_empty());
    assert!(v.0.join(".git").is_dir(), "the repository is still there");
}

#[test]
fn a_board_edit_over_the_step_limit_is_refused_before_anything_is_made() {
    let (_v, k, s) = open();
    let steps: Vec<Value> = (0..201)
        .map(|i| json!({ "step": "add_sticky", "text": format!("n{i}"), "x": i, "y": 0 }))
        .collect();
    let before = call(&k, &s, "read_board", json!({ "board": "Brainstorm" })).unwrap();
    let err = call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Brainstorm", "steps": steps }),
    )
    .unwrap_err();
    assert!(err.contains("At most"), "{err}");
    let after = call(&k, &s, "read_board", json!({ "board": "Brainstorm" })).unwrap();
    assert_eq!(before, after);
}
