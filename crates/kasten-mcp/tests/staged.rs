//! The tools called as a chat that previews its changes calls them: writes
//! are held in its change set and reads see them, and the same tools called
//! directly (as an external client calls them) are as they always were.

mod common;

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use common::{OUTLINE, TempDir, vault};
use kasten_core::agent::{ApplyOutcome, ChangeSet, Session};
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in};
use serde_json::{Value, json};

const WELCOME: &str = "library/welcome-to-kasten.md";

fn open() -> (TempDir, Kasten, Session, Mutex<ChangeSet>) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    (v, k, s, set)
}

fn staged(
    k: &Kasten,
    s: &Session,
    set: &Mutex<ChangeSet>,
    tool: &str,
    args: Value,
) -> Result<Value, String> {
    call_in(k, s, Writes::Staged(set), tool, args)
}

fn apply(k: &Kasten, set: &Mutex<ChangeSet>) -> Vec<String> {
    let set = set.lock().unwrap().clone();
    match k.apply_changes(&set, "Ada", Instant::now()).unwrap() {
        ApplyOutcome::Applied { paths, .. } => paths,
        stale => panic!("expected it to apply, got {stale:?}"),
    }
}

#[test]
fn a_write_is_staged_and_a_read_sees_it() {
    let (v, k, s, set) = open();
    let before = fs::read_to_string(v.0.join(WELCOME)).unwrap();
    let told = staged(
        &k,
        &s,
        &set,
        "append",
        json!({"note": WELCOME, "markdown": "Added from the chat."}),
    )
    .unwrap();
    assert_eq!(told["status"], "staged", "{told}");
    assert_eq!(told["paths"], json!([WELCOME]));
    assert_eq!(told["result"]["title"], "Welcome to KastenFlow");
    assert!(
        told["note"]
            .as_str()
            .unwrap()
            .contains("Nothing was written")
    );
    assert_eq!(told["session"], json!(s.id));
    assert_eq!(fs::read_to_string(v.0.join(WELCOME)).unwrap(), before);

    // The chat reads what it staged, and the vault does not have it.
    let read = staged(
        &k,
        &s,
        &set,
        "read_note",
        json!({"note": "Welcome to KastenFlow"}),
    )
    .unwrap();
    assert!(
        read["body"]
            .as_str()
            .unwrap()
            .contains("Added from the chat.")
    );
    assert_eq!(read["staged"], true);
    let direct = call(&k, &s, "read_note", json!({"note": WELCOME})).unwrap();
    assert!(
        !direct["body"]
            .as_str()
            .unwrap()
            .contains("Added from the chat.")
    );
    // A second write builds on the first.
    staged(
        &k,
        &s,
        &set,
        "append",
        json!({"note": WELCOME, "markdown": "And more."}),
    )
    .unwrap();
    let read = staged(&k, &s, &set, "read_note", json!({"note": WELCOME})).unwrap();
    let body = read["body"].as_str().unwrap();
    assert!(body.find("Added from the chat.").unwrap() < body.find("And more.").unwrap());
}

#[test]
fn a_note_the_chat_made_can_be_named_read_and_changed_before_it_exists() {
    let (v, k, s, set) = open();
    let made = staged(
        &k,
        &s,
        &set,
        "create_note",
        json!({"type": "page", "title": "Trip plan", "body": "Day one.\n", "tags": ["trip"]}),
    )
    .unwrap();
    assert_eq!(made["status"], "staged");
    let path = made["result"]["path"].as_str().unwrap().to_owned();
    assert!(!v.0.join(&path).exists());
    staged(
        &k,
        &s,
        &set,
        "append",
        json!({"note": "Trip plan", "markdown": "Day two."}),
    )
    .unwrap();
    staged(
        &k,
        &s,
        &set,
        "add_tags",
        json!({"note": path, "tags": ["summer"]}),
    )
    .unwrap();
    let read = staged(&k, &s, &set, "read_note", json!({"note": "Trip plan"})).unwrap();
    assert!(
        read["body"]
            .as_str()
            .unwrap()
            .contains("Day one.\n\nDay two."),
        "{read}"
    );
    assert_eq!(read["tags"], json!(["trip", "summer"]));
    // Lists and searches see only what is saved, and say so.
    let listed = staged(&k, &s, &set, "list_notes", json!({})).unwrap();
    assert!(
        listed["note"]
            .as_str()
            .unwrap()
            .contains("not in this result"),
        "{listed}"
    );
    assert!(!listed["notes"].to_string().contains("Trip plan"));
    let found = staged(&k, &s, &set, "search", json!({"query": "welcome"})).unwrap();
    assert!(
        found["note"].is_string() && found["results"].is_array(),
        "{found}"
    );
    // Putting it on a board is not previewed with a note that is not saved yet.
    let board = staged(
        &k,
        &s,
        &set,
        "add_to_board",
        json!({"board": "projects/photo-organiser/boards/brainstorm.canvas", "notes": [path]}),
    )
    .unwrap_err();
    assert!(board.contains("only in the staged changes"), "{board}");
    let paths = apply(&k, &set);
    assert_eq!(paths, std::slice::from_ref(&path));
    let saved = call(&k, &s, "read_note", json!({"note": "Trip plan"})).unwrap();
    assert_eq!(saved["tags"], json!(["trip", "summer"]));
}

#[test]
fn what_cannot_be_previewed_waits_for_review_and_the_vault_is_untouched() {
    let (v, k, s, set) = open();
    let before = fs::read_to_string(v.0.join(WELCOME)).unwrap();
    for (tool, args) in [
        ("rename_note", json!({"note": WELCOME, "title": "Hello"})),
        ("trash_note", json!({"note": WELCOME})),
        (
            "propose_edit",
            json!({"note": WELCOME, "new_body": "Gone."}),
        ),
        (
            "move_note",
            json!({"note": WELCOME, "project": "photo-organiser"}),
        ),
        (
            "update_tag_schema",
            json!({"tag": "trip", "schema": {"properties": []}}),
        ),
        ("create_template", json!({"name": "Idea", "body": "x"})),
    ] {
        let told = staged(&k, &s, &set, tool, args).unwrap();
        assert_eq!(told["status"], "pending_review", "{tool}: {told}");
    }
    assert_eq!(fs::read_to_string(v.0.join(WELCOME)).unwrap(), before);
    assert!(set.lock().unwrap().is_empty());
    assert_eq!(k.proposals().unwrap().len(), 6);
}

#[test]
fn the_same_tool_called_directly_writes_at_once_as_it_always_did() {
    let (v, k, s, _) = open();
    let told = call(
        &k,
        &s,
        "append",
        json!({"note": WELCOME, "markdown": "Direct."}),
    )
    .unwrap();
    assert_eq!(told["status"], "done");
    assert!(
        fs::read_to_string(v.0.join(WELCOME))
            .unwrap()
            .contains("Direct.")
    );
    // And through call_in with Direct.
    let again = call_in(
        &k,
        &s,
        Writes::Direct,
        "append",
        json!({"note": WELCOME, "markdown": "Still direct."}),
    )
    .unwrap();
    assert_eq!(again["status"], "done");
    assert!(
        fs::read_to_string(v.0.join(WELCOME))
            .unwrap()
            .contains("Still direct.")
    );
    assert_eq!(
        k.log(Some(WELCOME), 1).unwrap()[0].author,
        "agent:kasten-chat"
    );
}

#[test]
fn deck_tools_stage_and_read_the_staged_deck() {
    let (v, k, s, set) = open();
    let made = staged(
        &k,
        &s,
        &set,
        "create_deck",
        json!({"outline": OUTLINE, "project": "photo-organiser"}),
    )
    .unwrap();
    assert_eq!(made["status"], "staged", "{made}");
    let path = made["result"]["deck"].as_str().unwrap().to_owned();
    assert!(!v.0.join(&path).exists());
    // The deck is listed, read and changed in the chat as if it were saved.
    let listed = staged(&k, &s, &set, "list_decks", json!({})).unwrap();
    assert!(listed.to_string().contains(&path), "{listed}");
    let got = staged(&k, &s, &set, "get_deck", json!({"deck": path})).unwrap();
    let ids: Vec<String> = got["slides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids.len(), 7);
    let edited = staged(
        &k,
        &s,
        &set,
        "update_elements",
        json!({"deck": path, "operations": [
            {"op": "set_notes", "input": {"slide": ids[1], "notes": "Say it slowly."}}]}),
    )
    .unwrap();
    assert_eq!(edited["status"], "staged", "{edited}");
    let slide = staged(
        &k,
        &s,
        &set,
        "get_slide",
        json!({"deck": path, "slide": ids[1]}),
    )
    .unwrap();
    assert!(slide.to_string().contains("Say it slowly."), "{slide}");
    // By title too, and lint reads the staged deck.
    let linted = staged(&k, &s, &set, "lint_deck", json!({"deck": "Tool use"})).unwrap();
    assert!(linted.get("issues").is_some(), "{linted}");
    assert_eq!(
        set.lock().unwrap().created_files.len(),
        1,
        "one deck, not two"
    );
    assert!(!v.0.join(&path).exists());
    let paths = apply(&k, &set);
    assert_eq!(paths, std::slice::from_ref(&path));
    let saved = call(&k, &s, "get_slide", json!({"deck": path, "slide": ids[1]})).unwrap();
    assert!(saved.to_string().contains("Say it slowly."));
    // One commit made the whole deck: its first commit is the apply.
    assert_eq!(k.log(Some(&path), 5).unwrap().len(), 1);
}

#[test]
fn a_picture_is_held_with_the_chats_changes_and_a_staged_deck_can_use_it() {
    let (v, k, s, set) = open();
    let png =
        fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/assets/wide.png"))
            .unwrap();
    let made = staged(
        &k,
        &s,
        &set,
        "create_deck",
        json!({"outline": OUTLINE, "project": "photo-organiser"}),
    )
    .unwrap();
    let path = made["result"]["deck"].as_str().unwrap().to_owned();
    let added = staged(
        &k,
        &s,
        &set,
        "add_asset",
        json!({"name": "wide.png", "base64": slides_core::agent::base64_encode(&png)}),
    )
    .unwrap();
    let at = added["result"]["path"].as_str().unwrap().to_owned();
    assert_eq!(at, "assets/wide.png");
    assert!(
        !v.0.join("assets/wide.png").exists(),
        "not in the vault yet"
    );
    let found = staged(&k, &s, &set, "search_assets", json!({"query": "wide"})).unwrap();
    assert_eq!(found["assets"][0]["path"], json!(at), "{found}");
    let got = staged(&k, &s, &set, "get_deck", json!({"deck": path})).unwrap();
    let slide = got["slides"][1]["id"].as_str().unwrap().to_owned();
    let placed = staged(
        &k,
        &s,
        &set,
        "place_image",
        json!({"deck": path, "slide": slide, "src": at, "auto": true, "alt": "A wide picture"}),
    )
    .unwrap();
    assert_eq!(placed["status"], "staged", "{placed}");
    // A PowerPoint file of the staged deck is held too.
    let out = staged(
        &k,
        &s,
        &set,
        "export",
        json!({"deck": path, "format": "pptx"}),
    )
    .unwrap();
    assert_eq!(out["status"], "staged", "{out}");
    let pptx = out["result"]["path"].as_str().unwrap().to_owned();
    assert!(pptx.ends_with(".pptx") && !v.0.join(&pptx).exists());
    let paths = apply(&k, &set);
    for expected in [&path, &at, &pptx] {
        assert!(paths.contains(expected), "{paths:?} lacks {expected}");
    }
    assert_eq!(fs::read(v.0.join(&at)).unwrap(), png);
    assert!(
        fs::read_to_string(v.0.join(&path))
            .unwrap()
            .contains("assets/wide.png")
    );
}

#[test]
fn a_staged_deck_can_be_made_from_a_staged_note() {
    let (_v, k, s, set) = open();
    staged(
        &k,
        &s,
        &set,
        "create_note",
        json!({"type": "page", "title": "Talk notes", "body": "## First point\n\n- one\n- two\n\n## Second point\n\n- three\n"}),
    )
    .unwrap();
    let made = staged(
        &k,
        &s,
        &set,
        "deck_from_note",
        json!({"note": "Talk notes"}),
    )
    .unwrap();
    assert_eq!(made["status"], "staged", "{made}");
    assert_eq!(made["result"]["from"], json!(["library/talk-notes.md"]));
    assert_eq!(set.lock().unwrap().created_files.len(), 2);
}
