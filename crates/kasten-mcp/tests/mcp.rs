//! `kasten-mcp` over stdio, as Claude Code uses it: the tools, and an agent
//! that captures, edits a section and reads back.

mod common;

use std::process::Command;

use common::{Client, vault};
use serde_json::json;

#[test]
fn version_flag_prints_core_version() {
    let out = Command::new(env!("CARGO_BIN_EXE_kasten-mcp"))
        .arg("--version")
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8(out.stdout).unwrap().trim(),
        format!("kasten-mcp {}", kasten_core::VERSION)
    );
}

#[test]
fn refuses_a_vault_without_history() {
    let dir = std::env::temp_dir().join(format!(
        "kasten-mcp-nohistory-{}",
        kasten_core::ulid_at(kasten_core::Instant::now().millis)
    ));
    std::fs::create_dir_all(dir.join("library")).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_kasten-mcp"))
        .args(["--vault", dir.to_str().unwrap()])
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("keeps no history"));
}

#[test]
fn lists_every_tool_in_the_spec() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    let tools = c.tools();
    for name in [
        "search",
        "read_note",
        "list_notes",
        "query_tag",
        "get_journal",
        "get_history",
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
    ] {
        assert!(
            tools.contains(&name.to_owned()),
            "missing {name} in {tools:?}"
        );
    }
}

#[test]
fn offers_no_tool_that_deletes_or_rewrites_history() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    let tools = c.tools();
    // Some deck tools take a word that sounds worse than what they do: they change a deck, and
    // what they take out (slides, elements, table rows and columns) stays in its history (undo
    // brings it back). More than three slides taken out in ten minutes (removed, or left empty)
    // waits for review, and a deck itself only ever goes to the trash.
    const DECK_EDITS: [&str; 4] = [
        "delete_slides",
        "delete_elements",
        "delete_rows",
        "delete_columns",
    ];
    // Two parity tools carry words that sound like history rewrites and are not: `restore_note`
    // brings a note back out of the trash (it only ever moves it back), and `undo_session` takes
    // back the agent's own session as new commits, so history is only added to; a session of
    // another agent waits for review (tests/parity_tools_more.rs checks both).
    // `smart_delete_file` takes one file out of a smart page's folder: it goes to the trash and
    // `undo` or a restore brings it back, like a note (tests/smart_tools.rs).
    const TAKING_BACK: [&str; 3] = ["restore_note", "undo_session", "smart_delete_file"];
    for name in tools
        .iter()
        .filter(|n| !DECK_EDITS.contains(&n.as_str()) && !TAKING_BACK.contains(&n.as_str()))
    {
        for word in [
            "delete",
            "remove_note",
            "empty",
            "purge",
            "destroy",
            "reset",
            "force",
            "restore",
            "undo",
            "revert",
            "push",
            "latest",
        ] {
            assert!(
                !name.contains(word),
                "{name} sounds destructive; agents get trash_note and nothing more"
            );
        }
    }
    // Trashing is the only way an agent takes a note away.
    assert!(tools.contains(&"trash_note".to_owned()));
}

#[test]
fn an_agent_captures_edits_a_section_and_reads_back() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    let captured = c.call("capture", json!({"markdown": "Ask the team about the venue\nShe knows the CHI chairs.", "tags": ["paper"]})).unwrap();
    assert_eq!(captured["status"], json!("done"));
    assert_eq!(
        captured["result"]["path"],
        json!("inbox/ask-the-team-about-the-venue.md")
    );
    let session = captured["session"].as_str().unwrap().to_owned();

    let edited = c
        .call("replace_section", json!({"note": "Report draft: How people find old notes", "heading": "4. Evaluation", "markdown": "We replayed 1,200 edits."}))
        .unwrap();
    assert_eq!(edited["status"], json!("done"), "{edited}");
    assert_eq!(edited["session"], json!(session));

    let note = c
        .call(
            "read_note",
            json!({"note": "Report draft: How people find old notes", "with_backlinks": true}),
        )
        .unwrap();
    assert!(
        note["body"]
            .as_str()
            .unwrap()
            .contains("## 4. Evaluation\n\nWe replayed 1,200 edits.\n")
    );
    assert_eq!(note["props"]["status"], json!("Drafting"));
    assert!(
        note["backlinks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["title"] == json!("Related work notes"))
    );

    let found = c
        .call("search", json!({"query": "venue", "tag": "paper"}))
        .unwrap();
    assert_eq!(
        found[0]["path"],
        json!("inbox/ask-the-team-about-the-venue.md"),
        "{found}"
    );
    let rows = c
        .call(
            "query_tag",
            json!({"tag": "paper", "filter": {"status": "drafting"}}),
        )
        .unwrap();
    let titles: Vec<&str> = rows["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["title"].as_str())
        .collect();
    assert_eq!(
        titles,
        [
            "Photo organiser roadmap",
            "Report draft: How people find old notes"
        ]
    );
    // A saved view applies as in the app, and a board comes with its columns.
    let board = c
        .call("query_tag", json!({"tag": "paper", "view": "pipeline"}))
        .unwrap();
    assert!(
        board["views"]
            .as_array()
            .unwrap()
            .contains(&json!("Pipeline")),
        "{board}"
    );
    assert_eq!(board["board"]["group_by"], json!("status"));
    let columns = board["board"]["columns"].as_array().unwrap();
    let count = |label: &str| {
        columns
            .iter()
            .find(|c| c["label"] == json!(label))
            .map(|c| c["count"].clone())
    };
    assert_eq!(count("Drafting"), Some(json!(2)), "{board}");
    assert_eq!(count("Exploring"), Some(json!(1)), "{board}");
    let err = c
        .call("query_tag", json!({"tag": "paper", "view": "Nope"}))
        .unwrap_err();
    assert!(err.contains("no view called"), "{err}");
    let history = c
        .call(
            "get_history",
            json!({"note": "Report draft: How people find old notes", "limit": 1}),
        )
        .unwrap();
    assert_eq!(history[0]["author"], json!("agent:claude-code"));
    assert_eq!(history[0]["session"], json!(session));

    // Errors come back as tool errors the agent can read.
    let err = c
        .call("append", json!({"note": "No such page", "markdown": "x"}))
        .unwrap_err();
    assert!(err.contains("No note called"), "{err}");
    let day = c
        .call(
            "journal_append",
            json!({"markdown": "- Met the team", "date": "2026-09-30"}),
        )
        .unwrap();
    assert_eq!(day["result"]["path"], json!("journal/2026/2026-09-30.md"));
    assert_eq!(
        c.call("get_journal", json!({"date": "2026-10-01"}))
            .unwrap()["exists"],
        json!(false)
    );
}

#[test]
fn an_agent_builds_a_board() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    let board = c
        .call(
            "create_board",
            json!({"title": "Metric ideas", "project": "photo-organiser"}),
        )
        .unwrap();
    assert_eq!(
        board["result"]["board"],
        json!("projects/photo-organiser/boards/metric-ideas.canvas"),
        "{board}"
    );
    for idea in ["Count moved elements", "Weight by element type"] {
        c.call(
            "create_note",
            json!({"type": "card", "title": idea, "project": "photo-organiser", "tags": ["idea"]}),
        )
        .unwrap();
    }
    let added = c
        .call("add_to_board", json!({"board": "Metric ideas", "notes": ["Count moved elements", "Weight by element type", "Duplicate score sketch"], "layout": "cluster_by_tag"}))
        .unwrap();
    assert_eq!(added["status"], json!("done"), "{added}");
    let linked = c.call("connect", json!({"board": "Metric ideas", "from": "Count moved elements", "to": "Weight by element type", "label": "refines"})).unwrap();
    assert_eq!(linked["status"], json!("done"), "{linked}");
    let grouped = c.call("group_on_board", json!({"board": "Metric ideas", "nodes": ["Count moved elements", "Weight by element type"], "title": "New metrics"})).unwrap();
    assert_eq!(grouped["status"], json!("done"), "{grouped}");
    let view = c
        .call(
            "read_board",
            json!({"board": "projects/photo-organiser/boards/metric-ideas.canvas"}),
        )
        .unwrap();
    let titles: Vec<&str> = view["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|n| n["title"].as_str())
        .collect();
    assert!(
        titles.contains(&"Duplicate score sketch") && titles.contains(&"Count moved elements"),
        "{view}"
    );
    assert_eq!(view["edges"][0]["label"], json!("refines"));
    let boards = c.call("list_boards", json!({})).unwrap();
    assert!(
        boards
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["title"] == json!("Metric ideas"))
    );
}
