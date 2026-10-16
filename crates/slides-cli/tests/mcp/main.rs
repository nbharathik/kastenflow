//! `slides mcp` over stdio, as an agent uses it: the handshake and the tools,
//! a deck built by calls and left as a canonical file, a change that lost a
//! race, pictures and exports, and nothing deleted.

mod client;
mod files;

use std::fs;

use client::{Client, OUTLINE, folder, names_in, slides};
use serde_json::json;
use slides_core::canonical;

#[test]
fn the_handshake_carries_the_instructions_and_every_tool_is_listed() {
    let dir = folder("handshake");
    let mut client = Client::start(&dir);
    assert_eq!(client.init["serverInfo"]["name"], "kasten-slides");
    assert!(client.init["capabilities"]["tools"].is_object());
    let instructions = client.init["instructions"].as_str().unwrap();
    for word in [
        "create_deck",
        "lint_deck",
        "get_deck",
        "nothing is ever deleted",
    ] {
        assert!(
            instructions.contains(word),
            "the instructions mention {word}"
        );
    }

    let listed = client.request("tools/list", json!({}));
    let tools = listed["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    for wanted in [
        "list_decks",
        "get_deck",
        "get_slide",
        "get_outline",
        "list_layouts",
        "get_theme",
        "search_assets",
        "lint_deck",
        "create_deck",
        "add_slide",
        "delete_slides",
        "set_text",
        "add_diagram",
        "place_image",
        "add_elements",
        "update_elements",
        "patch_elements",
        "set_steps",
        "add_asset",
        "export",
        "import_pptx",
        "trash_deck",
        "render_slide",
        "render_grid",
    ] {
        assert!(
            names.contains(&wanted),
            "{wanted} is a tool; the tools are {names:?}"
        );
    }
    // A range, not a design: every operation is a tool, so the count grows with the registry
    // (the table operations took it from 47 to 62).
    assert!(
        names.len() >= 40 && names.len() <= 70,
        "{} tools",
        names.len()
    );
    for tool in tools {
        assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
        assert!(
            tool["description"].as_str().is_some_and(|d| d.len() > 20),
            "{}",
            tool["name"]
        );
        assert!(
            tool["annotations"]["readOnlyHint"].is_boolean(),
            "{}",
            tool["name"]
        );
        assert_eq!(
            tool["annotations"]["destructiveHint"], false,
            "{}",
            tool["name"]
        );
    }
    let by_name = |n: &str| tools.iter().find(|t| t["name"] == n).unwrap();
    assert_eq!(by_name("lint_deck")["annotations"]["readOnlyHint"], true);
    assert_eq!(by_name("add_slide")["annotations"]["readOnlyHint"], false);
    let size = listed.to_string().len();
    assert!(
        size < 64 * 1024,
        "the tool list is {size} bytes; an agent reads all of it every time"
    );
}

#[test]
fn a_folder_that_is_not_there_is_an_error_and_the_protocol_channel_stays_empty() {
    let out = slides(&["mcp", "--folder", "/no/such/folder/of/decks"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty(), "stdout carries only the protocol");
    let said = String::from_utf8_lossy(&out.stderr);
    assert!(
        said.contains("cannot open") && said.contains("of/decks"),
        "{said}"
    );
}

#[test]
fn an_agent_builds_a_deck_and_leaves_a_canonical_file_that_lints_clean() {
    let dir = folder("build");
    let mut client = Client::start(&dir);
    assert_eq!(client.ok("list_decks", json!({})), json!({ "decks": [] }));

    let made = client.ok("create_deck", json!({ "outline": OUTLINE }));
    let name = made["deck"].as_str().unwrap().to_owned();
    assert_eq!(name, "tool-use.deck");
    assert_eq!(made["slides"].as_array().unwrap().len(), 3);

    let added = client.ok(
        "add_slide",
        json!({ "deck": name, "layout": "title-only", "content": { "title": "The loop" } }),
    );
    let slide = added["result"]["slide"].as_str().unwrap().to_owned();
    let drawn = client.ok("add_diagram", json!({ "deck": name, "slide": slide,
        "nodes": [{ "id": "m", "label": "Model" }, { "id": "h", "label": "Host" }, { "id": "t", "label": "Tool" }],
        "edges": [{ "from": "m", "to": "h" }, { "from": "h", "to": "t" }] }));
    assert_eq!(drawn["result"]["connectors"].as_array().unwrap().len(), 2);
    assert_eq!(drawn["lint"]["errors"], 0, "{}", drawn["lint"]);

    // The list on the second slide appears an item at a time.
    let stepped = client.ok(
        "set_steps",
        json!({ "deck": name, "slide": 2, "recipe": "reveal" }),
    );
    assert_eq!(stepped["result"]["steps"], 2, "{stepped}");

    let listed = client.ok("list_decks", json!({}));
    assert_eq!(listed["decks"][0]["name"], "tool-use.deck");
    assert_eq!(listed["decks"][0]["slides"], 4);

    // What is on disk is the canonical form of the deck, and the command line agrees.
    let file = dir.join(&name);
    let text = fs::read_to_string(&file).unwrap();
    let deck = canonical::parse(&text).unwrap();
    assert_eq!(canonical::write(&deck).unwrap(), text);
    assert_eq!(deck.slides.len(), 4);
    assert_eq!(deck.slides[1].steps, 2, "the steps were saved");
    let path = file.to_str().unwrap();
    assert!(slides(&["validate", path]).status.success());
    let lint = slides(&["lint", path, "--estimate"]);
    assert!(
        lint.status.success(),
        "{}",
        String::from_utf8_lossy(&lint.stdout)
    );

    let report = client.call("lint_deck", json!({ "deck": name })).text;
    assert!(
        report.starts_with("Lint of tool-use.deck: 0 errors, 0 warnings"),
        "{report}"
    );
}

#[test]
fn a_change_made_from_an_old_version_is_kept_beside_the_deck_and_never_over_it() {
    let dir = folder("conflict");
    let mut client = Client::start(&dir);
    let name = client.ok("create_deck", json!({ "outline": OUTLINE }))["deck"]
        .as_str()
        .unwrap()
        .to_owned();
    client.text("get_deck", json!({ "deck": name }));

    // Someone else (an editor, another agent) changes the deck.
    let path = dir.join(&name);
    let changed = slides(&[
        "op",
        path.to_str().unwrap(),
        "set_title",
        r#"{"title":"Theirs"}"#,
    ]);
    assert!(changed.status.success());
    let theirs = fs::read_to_string(&path).unwrap();

    let why = client.refused(
        "set_notes",
        json!({ "deck": name, "slide": 2, "notes": "Mine" }),
    );
    assert!(
        why.contains("was changed by someone else") && why.contains("get_deck"),
        "{why}"
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        theirs,
        "their deck is untouched"
    );
    let copies: Vec<String> = names_in(&dir)
        .into_iter()
        .filter(|n| n.contains("(conflict"))
        .collect();
    assert_eq!(copies.len(), 1, "{copies:?}");
    let copy = canonical::parse(&fs::read_to_string(dir.join(&copies[0])).unwrap()).unwrap();
    assert_eq!(
        copy.slides[1].notes, "Mine",
        "the change is kept whole in the copy"
    );

    // Read again, repeat the change, and it goes in.
    client.text("get_deck", json!({ "deck": name }));
    client.ok(
        "set_notes",
        json!({ "deck": name, "slide": 2, "notes": "Mine" }),
    );
    let deck = canonical::parse(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(
        (deck.title.as_str(), deck.slides[1].notes.as_str()),
        ("Theirs", "Mine")
    );
}

#[test]
fn two_connections_to_one_folder_do_not_overwrite_each_other() {
    let dir = folder("two");
    let mut first = Client::start(&dir);
    let mut second = Client::start(&dir);
    let name = first.ok("create_deck", json!({ "outline": OUTLINE }))["deck"]
        .as_str()
        .unwrap()
        .to_owned();
    first.text("get_deck", json!({ "deck": name }));
    second.text("get_deck", json!({ "deck": name }));

    first.ok(
        "set_notes",
        json!({ "deck": name, "slide": 2, "notes": "From the first" }),
    );
    let why = second.refused(
        "set_notes",
        json!({ "deck": name, "slide": 3, "notes": "From the second" }),
    );
    assert!(why.contains("saved as"), "{why}");
    let deck = canonical::parse(&fs::read_to_string(dir.join(&name)).unwrap()).unwrap();
    assert_eq!(deck.slides[1].notes, "From the first");
    assert_eq!(deck.slides[2].notes, "");
}
