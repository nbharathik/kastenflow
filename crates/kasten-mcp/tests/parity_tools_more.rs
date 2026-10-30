//! The parity tools for saved searches, references, whiteboards, diagram
//! files and the history of sessions: the happy path, a refusal, and what the
//! modes do. (Notes, the journal, to-dos and comments are in parity_tools.)

mod common;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::call;
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

#[test]
fn saved_searches_are_listed_made_and_changed_with_the_hash_they_were_listed_under() {
    let (v, k, s) = open();
    let made = call(
        &k,
        &s,
        "create_collection",
        json!({ "name": "Reading queue", "settings": { "query": "#capture", "icon": "book" } }),
    )
    .unwrap();
    assert_eq!(made["status"], "done", "{made}");
    assert!(v.0.join("views/reading-queue.yaml").exists());
    let listed = call(&k, &s, "list_collections", Value::Null).unwrap();
    assert_eq!(listed["collections"][0]["query"], "#capture");
    let hash = listed["collections"][0]["hash"].clone();
    let changed = call(
        &k,
        &s,
        "update_collection",
        json!({ "collection": "Reading queue", "hash": hash, "settings": { "query": "#paper", "icon": null } }),
    )
    .unwrap();
    assert_eq!(changed["result"]["query"], "#paper", "{changed}");
    assert!(changed["result"]["icon"].is_null());
    let stale = call(
        &k,
        &s,
        "update_collection",
        json!({ "collection": "views/reading-queue.yaml", "hash": hash, "settings": { "query": "#idea" } }),
    )
    .unwrap_err();
    assert!(stale.contains("changed since you listed it"), "{stale}");
    let odd = call(
        &k,
        &s,
        "create_collection",
        json!({ "name": "Odd", "settings": { "owner": "me" } }),
    )
    .unwrap_err();
    assert!(odd.contains("A saved search has"), "{odd}");
    let nothing = call(
        &k,
        &s,
        "update_collection",
        json!({ "collection": "Reading queue", "hash": hash, "settings": {} }),
    )
    .unwrap_err();
    assert!(nothing.contains("Say what to change"), "{nothing}");
    set_mode(&k, AgentMode::Review);
    let held = call(
        &k,
        &s,
        "create_collection",
        json!({ "name": "Later", "settings": { "query": "x" } }),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert!(!v.0.join("views/later.yaml").exists());
}

fn reference(key: &str) -> Value {
    json!({
        "type": "article",
        "key": key,
        "fields": { "title": "On saved things", "author": "Rivera, Ana", "year": "2026" }
    })
}

#[test]
fn a_reference_always_waits_in_balanced_is_listed_once_accepted_and_taken_in_autonomous() {
    let (v, k, s) = open();
    let held = call(&k, &s, "add_reference", reference("rivera2026saved")).unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    let none = call(&k, &s, "list_references", json!({ "query": "rivera" })).unwrap();
    assert_eq!(none["total"], 0);
    k.accept_proposal(held["proposal"].as_str().unwrap(), "me", Instant::now())
        .unwrap();
    let found = call(
        &k,
        &s,
        "list_references",
        json!({ "query": "rivera saved" }),
    )
    .unwrap();
    assert_eq!(found["total"], 1, "{found}");
    assert_eq!(found["references"][0]["key"], "rivera2026saved");
    assert_eq!(found["managedFile"]["exists"], true);
    let again = call(&k, &s, "add_reference", reference("rivera2026saved")).unwrap_err();
    assert!(again.contains("same work"), "{again}");
    let bad = call(&k, &s, "add_reference", reference("two words")).unwrap_err();
    assert!(!bad.is_empty());

    set_mode(&k, AgentMode::Autonomous);
    let auto = call(&k, &s, "add_reference", reference("rivera2026auto")).unwrap();
    assert_eq!(auto["status"], "done", "{auto}");
    let text = std::fs::read_to_string(v.0.join("sources/references.bib")).unwrap();
    assert!(text.contains("rivera2026auto"));
    set_mode(&k, AgentMode::Review);
    let review = call(&k, &s, "add_reference", reference("rivera2026review")).unwrap();
    assert_eq!(review["status"], "pending_review", "{review}");
}

fn nodes(k: &Kasten, s: &Session, board: &str) -> Vec<Value> {
    let read = call(k, s, "read_board", json!({ "board": board })).unwrap();
    read["nodes"].as_array().unwrap().clone()
}

#[test]
fn board_edit_runs_typed_steps_as_one_change_and_a_bad_step_changes_nothing() {
    let (_v, k, s) = open();
    let before = nodes(&k, &s, "Brainstorm");
    let added = call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Brainstorm", "steps": [
            { "step": "add_sticky", "text": "New idea", "x": 4000, "y": 4000 },
            { "step": "add_sticky", "text": "Other idea", "x": 4400, "y": 4000 }
        ] }),
    )
    .unwrap();
    assert_eq!(added["status"], "done", "{added}");
    let after = nodes(&k, &s, "Brainstorm");
    assert_eq!(after.len(), before.len() + 2);
    let id_of = |text: &str| {
        after.iter().find(|n| n["text"] == text).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let (first, second) = (id_of("New idea"), id_of("Other idea"));

    let styled = call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Brainstorm", "steps": [
            { "step": "move", "id": first, "x": 100, "y": 120 },
            { "step": "resize", "id": second, "x": 4400, "y": 4000, "width": 300, "height": 90 },
            { "step": "restyle", "ids": [first], "color": "3" }
        ] }),
    )
    .unwrap();
    assert_eq!(styled["status"], "done", "{styled}");
    let moved = nodes(&k, &s, "Brainstorm");
    let node = |id: &str| moved.iter().find(|n| n["id"] == id).unwrap().clone();
    assert_eq!(
        (node(&first)["x"].clone(), node(&first)["y"].clone()),
        (json!(100), json!(120))
    );
    assert_eq!(
        (
            node(&second)["width"].clone(),
            node(&second)["height"].clone()
        ),
        (json!(300), json!(90))
    );

    let connected = call(
        &k,
        &s,
        "connect",
        json!({ "board": "Brainstorm", "from": first, "to": second }),
    )
    .unwrap();
    let edge = connected["result"]["edge"].as_str().unwrap().to_owned();
    let edge_styled = call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Brainstorm", "steps": [
            { "step": "edge_style", "id": edge, "label": "leads to", "to_end": "arrow", "line": "elbow", "dashed": true }
        ] }),
    )
    .unwrap();
    assert_eq!(edge_styled["status"], "done", "{edge_styled}");
    let read = call(&k, &s, "read_board", json!({ "board": "Brainstorm" })).unwrap();
    assert!(read["edges"].to_string().contains("leads to"), "{read}");

    // A step that cannot be made stops them all.
    let count = nodes(&k, &s, "Brainstorm").len();
    let err = call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Brainstorm", "steps": [
            { "step": "add_sticky", "text": "Never", "x": 0, "y": 0 },
            { "step": "move", "id": "no-such-node", "x": 1, "y": 1 }
        ] }),
    )
    .unwrap_err();
    assert!(!err.is_empty());
    assert_eq!(nodes(&k, &s, "Brainstorm").len(), count);
    let empty = call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Brainstorm", "steps": [] }),
    )
    .unwrap_err();
    assert!(empty.contains("at least one step"), "{empty}");
}

#[test]
fn taking_more_nodes_off_than_the_limit_waits_for_review_through_board_edit() {
    let (_v, k, s) = open();
    call(&k, &s, "create_board", json!({ "title": "Crowded" })).unwrap();
    let stickies: Vec<Value> = (0..12)
        .map(|i| json!({ "step": "add_sticky", "text": format!("Idea {i}"), "x": i * 300, "y": 0 }))
        .collect();
    call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Crowded", "steps": stickies }),
    )
    .unwrap();
    let ids: Vec<Value> = nodes(&k, &s, "Crowded")
        .iter()
        .map(|n| n["id"].clone())
        .collect();
    assert_eq!(ids.len(), 12);
    let held = call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Crowded", "steps": [{ "step": "remove", "ids": &ids[..11] }] }),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert!(
        held["reason"].as_str().unwrap().contains("limit is 10"),
        "{held}"
    );
    assert_eq!(nodes(&k, &s, "Crowded").len(), 12);
    let done = call(
        &k,
        &s,
        "board_edit",
        json!({ "board": "Crowded", "steps": [{ "step": "remove", "ids": &ids[..10] }] }),
    )
    .unwrap();
    assert_eq!(done["status"], "done", "{done}");
    assert_eq!(nodes(&k, &s, "Crowded").len(), 2);
}

#[test]
fn diagram_files_are_renamed_moved_and_copied_while_the_plugin_is_on() {
    let (_v, k, s) = open();
    let made = call(&k, &s, "create_diagram", json!({ "title": "Login flow" })).unwrap();
    let path = made["result"]["path"].as_str().unwrap().to_owned();
    let renamed = call(
        &k,
        &s,
        "rename_diagram",
        json!({ "diagram": "Login flow", "title": "Sign in flow" }),
    )
    .unwrap();
    assert_eq!(renamed["status"], "done", "{renamed}");
    let new_path = renamed["result"]["path"].as_str().unwrap().to_owned();
    assert_ne!(new_path, path);
    let moved = call(
        &k,
        &s,
        "move_diagram",
        json!({ "diagram": new_path, "project": "photo-organiser" }),
    )
    .unwrap();
    let there = moved["result"]["path"].as_str().unwrap().to_owned();
    assert!(there.starts_with("projects/photo-organiser/"), "{there}");
    let copy = call(&k, &s, "duplicate_diagram", json!({ "diagram": there })).unwrap();
    assert_eq!(copy["status"], "done", "{copy}");
    assert_eq!(k.diagrams().unwrap().len(), 2);
    let err = call(
        &k,
        &s,
        "rename_diagram",
        json!({ "diagram": "No such", "title": "X" }),
    )
    .unwrap_err();
    assert!(!err.is_empty());
    set_mode(&k, AgentMode::Review);
    let held = call(&k, &s, "duplicate_diagram", json!({ "diagram": there })).unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");

    // With the plugin off the tools answer with how to turn it on.
    k.set_plugin_enabled(&Actor::Human, "diagrams", false, Instant::now())
        .unwrap();
    for (tool, args) in [
        ("rename_diagram", json!({ "diagram": there, "title": "Z" })),
        ("move_diagram", json!({ "diagram": there })),
        ("duplicate_diagram", json!({ "diagram": there })),
    ] {
        let err = call(&k, &s, tool, args).unwrap_err();
        assert!(err.contains("Turn on the Diagrams plugin"), "{tool}: {err}");
    }
}

#[test]
fn sessions_are_listed_and_a_session_takes_back_its_own_changes() {
    let (_v, k, s) = open();
    let made = call(
        &k,
        &s,
        "capture",
        json!({ "markdown": "Remember the milk" }),
    )
    .unwrap();
    let path = made["result"]["path"].as_str().unwrap().to_owned();
    let listed = call(&k, &s, "list_sessions", Value::Null).unwrap();
    let mine = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == s.id.as_str())
        .unwrap();
    assert_eq!(
        (mine["commits"].clone(), mine["undone"].clone()),
        (json!(1), json!(false))
    );
    let undone = call(&k, &s, "undo_session", json!({})).unwrap();
    assert_eq!(undone["status"], "done", "{undone}");
    assert!(k.read(&path).is_err());
    let again = call(&k, &s, "undo_session", json!({})).unwrap_err();
    assert!(again.contains("nothing left to undo"), "{again}");
}

#[test]
fn another_sessions_changes_wait_for_review_before_they_are_taken_back() {
    let (_v, k, s) = open();
    let made = call(
        &k,
        &s,
        "capture",
        json!({ "markdown": "Remember the milk" }),
    )
    .unwrap();
    let path = made["result"]["path"].as_str().unwrap().to_owned();
    let other = Session::start(
        "other-agent",
        Instant {
            millis: Instant::now().millis + 5,
        },
    );
    let held = call(&k, &other, "undo_session", json!({ "session": s.id })).unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert!(k.read(&path).is_ok());
    k.accept_proposal(held["proposal"].as_str().unwrap(), "me", Instant::now())
        .unwrap();
    assert!(k.read(&path).is_err());
}
