//! The tools called in-process, as the app's chat calls them: the same
//! results, guardrails and errors as over MCP, in the caller's session.

mod common;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::board::BoardChange;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    (v, k, s)
}

#[test]
fn lists_every_tool_with_an_object_schema() {
    let specs = specs();
    let names: Vec<&str> = specs.iter().map(|s| s.name.as_str()).collect();
    for name in [
        "search",
        "read_note",
        "list_notes",
        "query_tag",
        "get_journal",
        "get_history",
        "list_tags",
        "list_templates",
        "capture",
        "create_note",
        "append",
        "replace_section",
        "update_props",
        "add_tags",
        "remove_tags",
        "rename_note",
        "move_note",
        "journal_append",
        "trash_note",
        "propose_edit",
        "update_tag_schema",
        "create_template",
        "update_template",
        "list_boards",
        "read_board",
        "create_board",
        "add_to_board",
        "connect",
        "group_on_board",
        "list_diagrams",
        "get_diagram",
        "create_diagram",
        "update_diagram",
        "trash_diagram",
        "diagram_describe",
        "diagram_find_shapes",
        "diagram_lint",
        "diagram_preview",
        "diagram_new",
        "diagram_edit",
        "diagram_export",
        "server_status",
    ] {
        assert!(names.contains(&name), "missing {name} in {names:?}");
    }
    // The 42 tools for notes, tags, boards and diagrams (server_status and the seven typed diagram tools among
    // them), slides-core's tools for decks, and the one that makes a deck from a note. A program that cannot
    // draw slides does not list the two that draw them.
    let decks = slides_core::agent::tools();
    let drawing = ["render_slide", "render_grid"];
    let hidden = if cfg!(feature = "render") {
        0
    } else {
        drawing.len()
    };
    assert_eq!(specs.len(), 42 + decks.len() + 1 - hidden, "{names:?}");
    assert!(
        names.contains(&"deck_from_note"),
        "missing deck_from_note in {names:?}"
    );
    for deck_tool in &decks {
        let listed = cfg!(feature = "render") || !drawing.contains(&deck_tool.name.as_str());
        assert_eq!(
            names.contains(&deck_tool.name.as_str()),
            listed,
            "{} in {names:?}",
            deck_tool.name
        );
    }
    for spec in &specs {
        assert!(!spec.description.is_empty(), "{}", spec.name);
        assert_eq!(spec.input_schema["type"], json!("object"), "{}", spec.name);
    }
    let search = specs.iter().find(|s| s.name == "search").unwrap();
    assert_eq!(search.input_schema["required"], json!(["query"]));
    assert!(search.description.starts_with("Ranked full-text search"));
}

#[test]
fn reads_as_the_mcp_tools_do() {
    let (_v, k, s) = open();
    let note = call(
        &k,
        &s,
        "read_note",
        json!({"note": "Report draft: How people find old notes"}),
    )
    .unwrap();
    assert_eq!(
        note["path"],
        json!("projects/note-taking-study/pages/report-draft.md")
    );
    assert!(note["body"].as_str().unwrap().contains("## 4. Evaluation"));
    let found = call(&k, &s, "search", json!({"query": "duplicate score"})).unwrap();
    assert!(!found.as_array().unwrap().is_empty(), "{found}");
    // A tool without arguments takes none.
    let tags = call(&k, &s, "list_tags", Value::Null).unwrap();
    assert!(tags["tags"]["paper"].is_number(), "{tags}");
    let board = call(&k, &s, "read_board", json!({"board": "Brainstorm"})).unwrap();
    assert_eq!(
        board["path"],
        json!("projects/photo-organiser/boards/brainstorm.canvas")
    );
}

#[test]
fn a_board_read_shows_a_drawing_without_its_points() {
    let (_v, k, s) = open();
    let path = "projects/photo-organiser/boards/brainstorm.canvas";
    let draw = BoardChange::Draw {
        points: "4,4 20,10 36,4".into(),
        x: 0,
        y: 900,
        width: 40,
        height: 16,
        size: 4,
        color: None,
    };
    k.board_apply(&Actor::Human, path, &[draw], Instant::now())
        .unwrap();
    let board = call(&k, &s, "read_board", json!({"board": "Brainstorm"})).unwrap();
    let drawn: Vec<&Value> = board["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n.get("draw").is_some())
        .collect();
    // A stroke's thousands of numbers say nothing to an agent.
    assert_eq!(drawn.len(), 1, "{board}");
    assert_eq!(drawn[0]["draw"], json!({"size": 4, "points": 3}));
}

#[test]
fn writes_commit_in_the_callers_session() {
    let (_v, k, s) = open();
    let out = call(
        &k,
        &s,
        "capture",
        json!({"markdown": "Ask the team about the venue", "tags": ["paper"]}),
    )
    .unwrap();
    assert_eq!(out["status"], json!("done"), "{out}");
    assert_eq!(out["session"], json!(s.id));
    let path = out["result"]["path"].as_str().unwrap();
    assert_eq!(path, "inbox/ask-the-team-about-the-venue.md");
    let last = &k.log(Some(path), 1).unwrap()[0];
    assert_eq!(last.author, "agent:kasten-chat");
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    assert_eq!(last.summary, "capture: Ask the team about the venue");
    assert!(
        last.message.contains(&format!("Kasten-Session: {}", s.id)),
        "{}",
        last.message
    );
    // A full rewrite waits for review, in the same session.
    let proposed = call(
        &k,
        &s,
        "propose_edit",
        json!({"note": path, "new_body": "Other text\n", "reason": "test"}),
    )
    .unwrap();
    assert_eq!(proposed["status"], json!("pending_review"), "{proposed}");
    assert_eq!(proposed["session"], json!(s.id));
}

#[test]
fn errors_read_as_they_do_over_mcp() {
    let (_v, k, s) = open();
    let unknown = call(&k, &s, "delete_everything", json!({})).unwrap_err();
    assert_eq!(unknown, "tool not found: delete_everything");
    let missing = call(&k, &s, "search", json!({})).unwrap_err();
    assert!(
        missing.starts_with("failed to deserialize parameters") && missing.contains("query"),
        "{missing}"
    );
    let wrong = call(
        &k,
        &s,
        "append",
        json!({"note": "Welcome to KastenFlow", "markdown": 5}),
    )
    .unwrap_err();
    assert!(
        wrong.starts_with("failed to deserialize parameters"),
        "{wrong}"
    );
    let refused = call(
        &k,
        &s,
        "append",
        json!({"note": "templates/page.md", "markdown": "x"}),
    )
    .unwrap_err();
    assert!(refused.contains("read-only for agents"), "{refused}");
    let absent = call(
        &k,
        &s,
        "append",
        json!({"note": "No such page", "markdown": "x"}),
    )
    .unwrap_err();
    assert!(absent.contains("No note called"), "{absent}");
    // Nothing above wrote anything.
    assert!(k.dirty().unwrap().is_empty(), "{:?}", k.dirty().unwrap());
}

#[test]
fn templates_are_listed_proposed_and_used() {
    let (v, k, s) = open();
    let listed = call(&k, &s, "list_templates", Value::Null).unwrap();
    let names: Vec<&str> = listed["templates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&"meeting") && names.contains(&"road-trip"),
        "{names:?}"
    );
    let trip = listed["templates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "road-trip")
        .unwrap();
    assert_eq!(trip["label"], json!("Road trip"));
    assert_eq!(trip["type"], json!("page"));

    // A new template waits for the user; nothing is written before.
    let made = call(
        &k,
        &s,
        "create_template",
        json!({"name": "Daily standup", "body": "## Yesterday\n\n## Today", "tags": ["meeting"], "icon": "☀️", "reason": "asked for one"}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("pending_review"), "{made}");
    assert!(!v.0.join("templates/daily-standup.md").exists());
    let proposal = made["proposal"].as_str().unwrap();
    k.accept_proposal(proposal, "me", Instant::now()).unwrap();
    let text = std::fs::read_to_string(v.0.join("templates/daily-standup.md")).unwrap();
    assert_eq!(
        text,
        "---\ntitle: \"{{title}}\"\ntype: page\nicon: ☀️\ntags: [meeting]\n---\n## Yesterday\n\n## Today\n"
    );

    // A change to it waits too, and keeps its frontmatter.
    let changed = call(
        &k,
        &s,
        "update_template",
        json!({"name": "Daily standup", "body": "## Done\n## Next\n"}),
    )
    .unwrap();
    assert_eq!(changed["status"], json!("pending_review"), "{changed}");
    k.accept_proposal(changed["proposal"].as_str().unwrap(), "me", Instant::now())
        .unwrap();
    let text = std::fs::read_to_string(v.0.join("templates/daily-standup.md")).unwrap();
    assert!(text.starts_with("---\ntitle: \"{{title}}\""), "{text}");
    assert!(text.ends_with("## Done\n## Next\n"), "{text}");

    // A page starts from it.
    let page = call(
        &k,
        &s,
        "create_note",
        json!({"type": "page", "title": "Monday standup", "template": "Daily standup"}),
    )
    .unwrap();
    assert_eq!(page["status"], json!("done"), "{page}");
    let body = call(&k, &s, "read_note", json!({"note": page["result"]["path"]})).unwrap();
    assert_eq!(body["title"], json!("Monday standup"));
    assert!(body["body"].as_str().unwrap().contains("## Next"), "{body}");
    assert_eq!(body["tags"], json!(["meeting"]));
    let unknown = call(
        &k,
        &s,
        "create_note",
        json!({"type": "page", "title": "X", "template": "Nope"}),
    )
    .unwrap_err();
    assert!(unknown.contains("No template"), "{unknown}");
}
