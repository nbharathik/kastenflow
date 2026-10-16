//! An external client's whole job on a deck, over stdio, as Claude Code would
//! do it: read a deck of the vault, put a table on a slide and fill a cell,
//! change the theme, look at the slide, lint, export, try what must wait for
//! the person, and undo the session. Every change goes through the
//! guardrails, and the vault ends as it began.
//!
//! Looking at the slide needs a browser, the page it is drawn with and a
//! program built to draw. This machine may have none of them, so the test
//! takes whichever it has: a picture, or the sentence that says which of them
//! is missing.

mod common;

use std::fs;

use common::{Client, vault};
use kasten_core::history::History;
use kasten_core::{Instant, Kasten};
use serde_json::{Value, json};

const DECK: &str = "library/tool-use-in-language-models.deck";

/// The slide ids in `get_deck`'s answer over MCP, which is a table of text: a line for each slide.
fn ids(c: &mut Client) -> Vec<String> {
    let got = c.call("get_deck", json!({"deck": DECK})).unwrap();
    got.as_str()
        .expect("get_deck answers in text over MCP")
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().find(|word| word.starts_with("s-")))
        .map(str::to_owned)
        .collect()
}

fn has_string(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(s) => s == needle,
        Value::Array(items) => items.iter().any(|v| has_string(v, needle)),
        Value::Object(map) => map.values().any(|v| has_string(v, needle)),
        _ => false,
    }
}

fn deck_on_disk(root: &std::path::Path) -> Value {
    serde_json::from_str(&fs::read_to_string(root.join(DECK)).unwrap()).expect("a deck is JSON")
}

fn table(id: &str) -> Value {
    let cell = |t: &str| json!({ "text": { "paragraphs": [{ "runs": [{ "t": t }] }] } });
    json!({
        "type": "table", "id": id, "x": 80, "y": 220, "w": 600, "h": 200,
        "columns": [300.0, 300.0],
        "rows": [
            { "cells": [cell("Tool"), cell("Used for")] },
            { "cells": [cell("search"), cell("finding")] },
        ],
    })
}

#[test]
fn an_external_client_edits_themes_looks_lints_exports_and_undoes_through_the_guardrails() {
    let v = vault();
    let history = History::open(&v.0).unwrap().unwrap();
    let before = history.tree_id("HEAD").unwrap();
    let mut c = Client::start(&v.0, "journey-client");
    assert!(c.instructions.contains("SLIDE DECKS"), "{}", c.instructions);

    // Read a deck of the vault.
    let slides = ids(&mut c);
    assert!(slides.len() >= 2, "{slides:?}");
    let read = c.call("get_deck", json!({"deck": DECK})).unwrap();
    assert!(read.as_str().unwrap().contains(DECK), "{read}");

    // Put a table on the second slide and fill a cell of it.
    let added = c
        .call(
            "add_elements",
            json!({"deck": DECK, "slide": slides[1], "elements": [table("e-journey")]}),
        )
        .unwrap();
    assert_eq!(added["status"], json!("done"), "{added}");
    let session = added["session"].as_str().unwrap().to_owned();
    let filled = c
        .call(
            "set_cells",
            json!({"deck": DECK, "slide": slides[1], "id": "e-journey",
                   "at": {"row": 1, "col": 1}, "cells": [[{"markdown": "Journey"}]]}),
        )
        .unwrap();
    assert_eq!(filled["status"], json!("done"), "{filled}");
    assert_eq!(filled["session"], json!(session));
    assert!(
        has_string(&deck_on_disk(&v.0), "Journey"),
        "the cell is in the file"
    );

    // Change the theme.
    let themed = c
        .call("apply_theme", json!({"deck": DECK, "name": "Dark"}))
        .unwrap();
    assert_eq!(themed["status"], json!("done"), "{themed}");
    assert!(
        has_string(&deck_on_disk(&v.0), "Dark"),
        "the theme is in the file"
    );

    // Look at the slide: a picture where this program and machine can draw, else the sentence that says why not.
    match c.call("render_slide", json!({"deck": DECK, "slide": slides[1]})) {
        Ok(drawn) => {
            eprintln!("journey: render_slide drew a picture: {drawn}");
            assert!(
                drawn["width"].as_u64().unwrap_or_default() > 0,
                "a picture has a size: {drawn}"
            );
        }
        Err(said) => {
            eprintln!("journey: render_slide said: {said}");
            assert!(
                [
                    "none was found",
                    "does not carry the page",
                    "Drawing slides is not part of this program",
                    "The browser could not be started",
                    "The browser failed while drawing",
                ]
                .iter()
                .any(|sentence| said.contains(sentence)),
                "an explicit reason, not a silent failure: {said}"
            );
        }
    }
    let tools = c.tools();
    assert_eq!(
        tools.contains(&"render_slide".to_owned()),
        cfg!(feature = "render"),
        "a program that cannot draw does not list the tools that draw"
    );

    // Lint the deck.
    let linted = c.call("lint_deck", json!({"deck": DECK})).unwrap();
    assert!(linted.as_str().is_some_and(|t| !t.is_empty()), "{linted}");

    // Export it as a PowerPoint file, kept in assets/.
    let exported = c
        .call("export", json!({"deck": DECK, "format": "pptx"}))
        .unwrap();
    assert_eq!(exported["status"], json!("done"), "{exported}");
    let file = exported["result"]["path"].as_str().unwrap().to_owned();
    assert!(
        file.starts_with("assets/") && file.ends_with(".pptx"),
        "{file}"
    );
    assert_eq!(
        &fs::read(v.0.join(&file)).unwrap()[..2],
        b"PK",
        "a zip file"
    );

    // What must wait for the person waits, and changes nothing.
    let waiting = c.call("trash_deck", json!({"deck": DECK})).unwrap();
    assert_eq!(waiting["status"], json!("pending_review"), "{waiting}");
    assert!(v.0.join(DECK).is_file());

    // The agent's work is its session's, commit by commit.
    let k = Kasten::open(&v.0).unwrap();
    let log = k.log(Some(DECK), 10).unwrap();
    let mine: Vec<_> = log
        .iter()
        .filter(|c| c.session.as_deref() == Some(session.as_str()))
        .collect();
    assert!(
        mine.len() >= 3 && mine.iter().all(|c| c.author == "agent:journey-client"),
        "{log:?}"
    );
    let ops: Vec<&str> = mine.iter().filter_map(|c| c.op.as_deref()).collect();
    for op in ["add_elements", "set_cells", "apply_theme"] {
        assert!(ops.contains(&op), "{op} in {ops:?}");
    }

    // Undo the session: the exact tree from before, the export gone with the rest.
    let undone = k.undo_session(&session, Instant::now()).unwrap();
    assert_eq!(undone.conflict, None);
    assert_eq!(
        history.tree_id("HEAD").unwrap(),
        before,
        "undo restores the exact tree"
    );
    assert!(!v.0.join(&file).exists());
    assert!(!has_string(&deck_on_disk(&v.0), "Journey"));
}
