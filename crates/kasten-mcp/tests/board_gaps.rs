//! What a person does on a whiteboard that `board_edit` could not: new words for a sticky, a section or a
//! link, links, sections and shapes, another outline, how a card shows, folding a section, taking arrows
//! away. Also the audit: every change the board editor sends is a step, a tool, or named as the editor's.

mod common;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::board::BoardChange;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
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

fn read(k: &Kasten, s: &Session, board: &str) -> Value {
    call(k, s, "read_board", json!({ "board": board })).unwrap()
}

fn node(k: &Kasten, s: &Session, board: &str, pick: impl Fn(&Value) -> bool) -> Value {
    read(k, s, board)["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| pick(n))
        .unwrap_or_else(|| panic!("no such node on {board}"))
        .clone()
}

fn edit(k: &Kasten, s: &Session, board: &str, steps: Value) -> Result<Value, String> {
    call(
        k,
        s,
        "board_edit",
        json!({ "board": board, "steps": steps }),
    )
}

/// How the board editor's changes reach an agent. A new kind of change does not compile until it is
/// said here, so the next release cannot add one and forget the agents.
enum Reach {
    /// A step of `board_edit`, or the tool, that makes it.
    Agent(&'static str),
    /// Only the editor makes it, and why.
    Editor(&'static str),
}

fn reach(change: &BoardChange) -> Reach {
    match change {
        BoardChange::Place { .. } => Reach::Agent("board_edit: move, resize"),
        BoardChange::Remove { .. } => Reach::Agent("board_edit: remove"),
        BoardChange::Text { .. } => Reach::Agent("board_edit: set_text"),
        BoardChange::Color { .. } => Reach::Agent("board_edit: restyle"),
        BoardChange::Sticky { .. } => Reach::Agent("board_edit: add_sticky"),
        BoardChange::Card { .. } => Reach::Agent("add_to_board"),
        BoardChange::Link { .. } => Reach::Agent("board_edit: add_link"),
        BoardChange::Section { .. } => Reach::Agent("board_edit: add_section"),
        BoardChange::Wrap { .. } => Reach::Agent("group_on_board"),
        BoardChange::Connect { .. } => Reach::Agent("connect"),
        BoardChange::Edge { .. } => Reach::Agent("board_edit: edge_style"),
        BoardChange::Unlink { .. } => Reach::Agent("board_edit: unlink"),
        BoardChange::CardSize { .. } => Reach::Agent("board_edit: card_size"),
        BoardChange::Collapse { .. } => Reach::Agent("board_edit: collapse"),
        BoardChange::Restore { .. } => Reach::Editor(
            "puts back what was taken off, which is the editor's undo; an agent has undo_session",
        ),
        BoardChange::Shape { .. } => Reach::Agent("board_edit: add_shape"),
        BoardChange::Reshape { .. } => Reach::Agent("board_edit: reshape"),
        BoardChange::Draw { .. } => Reach::Editor(
            "a stroke drawn with the pen, point by point; an agent draws with shapes, arrows and stickies",
        ),
        BoardChange::Line { .. } => Reach::Agent("board_edit: edge_style (line, dashed)"),
        BoardChange::Source { .. } => {
            Reach::Editor("what a board made from a page remembers about the page, kept by the app")
        }
    }
}

#[test]
fn every_change_the_board_editor_sends_is_a_step_a_tool_or_named_as_the_editors_own() {
    let changes = [
        BoardChange::Restore {
            nodes: vec![],
            edges: vec![],
        },
        BoardChange::Draw {
            points: String::new(),
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            size: 1,
            color: None,
        },
        BoardChange::Source { source: None },
        BoardChange::Unlink { ids: vec![] },
    ];
    let mut editors = 0;
    for change in &changes {
        match reach(change) {
            Reach::Editor(why) => {
                editors += 1;
                assert!(why.len() > 20);
            }
            Reach::Agent(name) => assert!(name.contains("board_edit"), "{name}"),
        }
    }
    assert_eq!(
        editors, 3,
        "restore, draw and source are the editor's alone"
    );
}

#[test]
fn stickies_links_sections_and_shapes_are_made_reworded_reshaped_and_folded_in_two_changes() {
    let (_v, k, s) = open();
    let made = edit(
        &k,
        &s,
        "Brainstorm",
        json!([
            { "step": "add_sticky", "text": "Draft", "x": 4000, "y": 4000 },
            { "step": "add_link", "url": "https://example.com/spec", "x": 4400, "y": 4000 },
            { "step": "add_section", "label": "Ideas", "x": 3900, "y": 3800, "width": 900, "height": 500 },
            { "step": "add_shape", "shape": "ellipse", "text": "Why?", "x": 4000, "y": 4200, "width": 160, "height": 100 }
        ]),
    )
    .unwrap();
    assert_eq!(made["status"], "done", "{made}");
    let sticky = node(&k, &s, "Brainstorm", |n| n["text"] == "Draft");
    let link = node(&k, &s, "Brainstorm", |n| {
        n["url"] == "https://example.com/spec"
    });
    let section = node(&k, &s, "Brainstorm", |n| n["label"] == "Ideas");
    let shape = node(&k, &s, "Brainstorm", |n| n["text"] == "Why?");
    assert_eq!(shape["shape"], "ellipse");
    assert_eq!(
        (section["width"].clone(), section["height"].clone()),
        (json!(900), json!(500))
    );

    let changed = edit(
        &k,
        &s,
        "Brainstorm",
        json!([
            { "step": "set_text", "id": sticky["id"], "text": "Final" },
            { "step": "set_text", "id": link["id"], "text": "https://example.com/new" },
            { "step": "set_text", "id": section["id"], "text": "Ideas, second round" },
            { "step": "reshape", "id": shape["id"], "shape": "diamond" },
            { "step": "collapse", "id": section["id"], "collapsed": true }
        ]),
    )
    .unwrap();
    assert_eq!(changed["status"], "done", "{changed}");
    let id = |n: &Value| n["id"].clone();
    let by_id = |want: Value| node(&k, &s, "Brainstorm", move |n| n["id"] == want);
    assert_eq!(by_id(id(&sticky))["text"], "Final");
    assert_eq!(by_id(id(&link))["url"], "https://example.com/new");
    let folded = by_id(id(&section));
    assert_eq!(folded["label"], "Ideas, second round");
    assert_eq!(folded["collapsed"], true);
    assert_eq!(by_id(id(&shape))["shape"], "diamond");

    // An empty outline makes the shape a plain sticky again, and the section opens.
    edit(
        &k,
        &s,
        "Brainstorm",
        json!([
            { "step": "reshape", "id": shape["id"], "shape": "" },
            { "step": "collapse", "id": section["id"], "collapsed": false }
        ]),
    )
    .unwrap();
    assert!(by_id(id(&shape)).get("shape").is_none());
    assert!(by_id(id(&section)).get("collapsed").is_none());
}

#[test]
fn a_note_card_shows_its_title_or_all_its_note_and_goes_back_to_the_default() {
    let (_v, k, s) = open();
    call(&k, &s, "create_board", json!({ "title": "Sizes" })).unwrap();
    let listed = call(&k, &s, "list_notes", json!({ "limit": 5 })).unwrap();
    let note = listed["notes"][0]["path"].as_str().unwrap().to_owned();
    call(
        &k,
        &s,
        "add_to_board",
        json!({ "board": "Sizes", "notes": [note] }),
    )
    .unwrap();
    let card = node(&k, &s, "Sizes", |n| n["kind"] == "file");
    for size in ["expanded", "title"] {
        edit(
            &k,
            &s,
            "Sizes",
            json!([{ "step": "card_size", "id": card["id"], "size": size }]),
        )
        .unwrap();
        assert_eq!(node(&k, &s, "Sizes", |n| n["kind"] == "file")["size"], size);
    }
    edit(
        &k,
        &s,
        "Sizes",
        json!([{ "step": "card_size", "id": card["id"], "size": null }]),
    )
    .unwrap();
    assert!(
        node(&k, &s, "Sizes", |n| n["kind"] == "file")
            .get("size")
            .is_none()
    );
}

#[test]
fn a_bad_step_among_the_new_ones_changes_nothing() {
    let (_v, k, s) = open();
    let before = read(&k, &s, "Brainstorm");
    let sticky = before["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["kind"] == "text")
        .unwrap()
        .clone();
    let card = before["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["kind"] == "file");
    for steps in [
        json!([{ "step": "add_sticky", "text": "Never", "x": 1, "y": 1 }, { "step": "add_link", "url": "javascript:alert(1)", "x": 0, "y": 0 }]),
        json!([{ "step": "add_sticky", "text": "Never", "x": 1, "y": 1 }, { "step": "add_shape", "shape": "blob", "text": "x", "x": 0, "y": 0, "width": 10, "height": 10 }]),
        json!([{ "step": "add_sticky", "text": "Never", "x": 1, "y": 1 }, { "step": "card_size", "id": sticky["id"], "size": "expanded" }]),
        json!([{ "step": "add_sticky", "text": "Never", "x": 1, "y": 1 }, { "step": "collapse", "id": sticky["id"], "collapsed": true }]),
        json!([{ "step": "add_sticky", "text": "Never", "x": 1, "y": 1 }, { "step": "set_text", "id": "no-such-node", "text": "x" }]),
    ] {
        assert!(edit(&k, &s, "Brainstorm", steps).is_err());
    }
    if let Some(card) = card {
        let words = edit(
            &k,
            &s,
            "Brainstorm",
            json!([{ "step": "set_text", "id": card["id"], "text": "x" }]),
        )
        .unwrap_err();
        assert!(words.contains("edit the note instead"), "{words}");
    }
    assert_eq!(read(&k, &s, "Brainstorm"), before);
}

#[test]
fn arrows_are_taken_off_and_count_against_the_limit_so_many_at_once_wait() {
    let (_v, k, s) = open();
    call(&k, &s, "create_board", json!({ "title": "Chain" })).unwrap();
    let stickies: Vec<Value> = (0..12)
        .map(|i| json!({ "step": "add_sticky", "text": format!("Link {i}"), "x": i * 300, "y": 0 }))
        .collect();
    edit(&k, &s, "Chain", json!(stickies)).unwrap();
    let ids: Vec<Value> = read(&k, &s, "Chain")["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].clone())
        .collect();
    for pair in ids.windows(2) {
        call(
            &k,
            &s,
            "connect",
            json!({ "board": "Chain", "from": pair[0], "to": pair[1] }),
        )
        .unwrap();
    }
    let edges: Vec<Value> = read(&k, &s, "Chain")["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].clone())
        .collect();
    assert_eq!(edges.len(), 11);
    let held = edit(
        &k,
        &s,
        "Chain",
        json!([{ "step": "unlink", "ids": &edges[..] }]),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert!(
        held["reason"].as_str().unwrap().contains("limit is 10"),
        "{held}"
    );
    assert_eq!(read(&k, &s, "Chain")["edges"].as_array().unwrap().len(), 11);
    let done = edit(
        &k,
        &s,
        "Chain",
        json!([{ "step": "unlink", "ids": &edges[..3] }]),
    )
    .unwrap();
    assert_eq!(done["status"], "done", "{done}");
    let left = read(&k, &s, "Chain");
    assert_eq!(left["edges"].as_array().unwrap().len(), 8);
    // The stickies the arrows joined are still there.
    assert_eq!(left["nodes"].as_array().unwrap().len(), 12);
}

#[test]
fn in_review_mode_the_new_steps_wait_and_one_undo_takes_back_a_session() {
    let (_v, k, s) = open();
    let before = read(&k, &s, "Brainstorm");
    let done = edit(
        &k,
        &s,
        "Brainstorm",
        json!([
            { "step": "add_link", "url": "https://example.com/a", "x": 100, "y": 100 },
            { "step": "add_section", "label": "Later", "x": 0, "y": 0, "width": 50, "height": 50 }
        ]),
    )
    .unwrap();
    assert_eq!(done["status"], "done", "{done}");
    assert_ne!(read(&k, &s, "Brainstorm"), before);
    call(&k, &s, "undo_session", Value::Null).unwrap();
    assert_eq!(read(&k, &s, "Brainstorm"), before);

    set_mode(&k, AgentMode::Review);
    let held = edit(
        &k,
        &s,
        "Brainstorm",
        json!([{ "step": "add_shape", "shape": "hexagon", "text": "Held", "x": 5, "y": 5, "width": 90, "height": 60 }]),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert_eq!(read(&k, &s, "Brainstorm"), before);
}
