//! `list_layouts` and the layout library: the layouts a person keeps for every deck follow the deck's
//! own, marked, and an agent cannot write them through a deck tool.

mod common;

use common::{TempDir, deck_of_eight, vault};
use kasten_core::agent::Session;
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

fn entry(id: &str, label: &str) -> String {
    let mut text = serde_json::to_string_pretty(&json!({
        "format": "kasten-layout",
        "formatVersion": 1,
        "id": id,
        "label": label,
        "layout": {
            "label": label,
            "name": "photo-caption",
            "placeholders": [
                { "role": "title", "kind": "title", "x": 40, "y": 30, "w": 880, "h": 80 },
                { "role": "image", "kind": "image", "x": 40, "y": 130, "w": 600, "h": 360 },
            ],
            "elements": [{ "id": "stripe", "type": "shape", "shape": "rect", "x": 0, "y": 0, "w": 40, "h": 540 }],
        },
        "size": { "h": 540, "w": 960 },
        "textStyles": {},
    }))
    .unwrap();
    text.push('\n');
    text
}

#[test]
fn the_library_follows_the_decks_own_layouts_marked_and_in_brief() {
    let (v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    let before = call(&k, &s, "list_layouts", json!({ "deck": path })).unwrap();
    assert!(before.get("library").is_none(), "{before}");

    k.save_library_layout(
        &Actor::Human,
        &entry("L-photo", "Photo caption"),
        Instant::now(),
    )
    .unwrap();
    // A file that is not a layout is left out, not an error.
    std::fs::write(
        v.0.join("templates/layouts/odd.layout"),
        "this is not a layout",
    )
    .unwrap();

    let listed = call(&k, &s, "list_layouts", json!({ "deck": path })).unwrap();
    let library = listed["library"].as_array().unwrap();
    assert_eq!(library.len(), 1, "{listed}");
    assert_eq!(library[0]["id"], "L-photo");
    assert_eq!(library[0]["label"], "Photo caption");
    assert_eq!(library[0]["library"], true);
    assert_eq!(library[0]["decoration"], 1);
    assert_eq!(library[0]["slots"][1]["role"], "image");
    assert!(
        listed["layouts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|l| l.get("library").is_none()),
        "the deck's own layouts are not marked"
    );
    assert!(
        listed["libraryNote"]
            .as_str()
            .unwrap()
            .contains("person uses one")
    );
}

#[test]
fn no_deck_tool_writes_the_library() {
    let names: Vec<String> = specs().into_iter().map(|t| t.name).collect();
    for tool in [
        "save_layout",
        "import_layouts",
        "set_layout_design",
        "delete_layout",
    ] {
        assert!(!names.iter().any(|n| n == tool), "{tool}");
    }
}

#[test]
fn a_library_file_is_not_a_deck_for_the_tools() {
    let (_v, k, s) = open();
    deck_of_eight(&k, &s);
    k.save_library_layout(
        &Actor::Human,
        &entry("L-photo", "Photo caption"),
        Instant::now(),
    )
    .unwrap();
    let decks: Value = call(&k, &s, "list_decks", Value::Null).unwrap();
    assert!(
        decks["decks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|d| !d["name"].as_str().unwrap().ends_with(".layout"))
    );
}
