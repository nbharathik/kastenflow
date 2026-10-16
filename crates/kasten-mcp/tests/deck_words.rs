//! What the in-app chat says about the deck tools: a line for each call in words for the person, the decks
//! a call touched (so an open editor takes them in), and the text of a deck or slide chip.

mod common;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::decks::context::{deck_context, slide_context};
use kasten_mcp::decks::words::{action, told};
use kasten_mcp::tools::call;
use serde_json::{Value, json};

const OUTLINE: &str = "# Tool use

## What a tool is
A function the model may ask the host to run.

## The loop
- The model asks
- The host runs it
- The result goes back
";

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    (v, k, s)
}

/// Calls a tool and says it as the chat does.
fn said(k: &Kasten, s: &Session, name: &str, input: Value) -> (String, Vec<String>) {
    let value = call(k, s, name, input.clone()).unwrap_or_else(|e| panic!("{name}: {e}"));
    let got = told(k, name, &input, &value).unwrap_or_else(|| panic!("{name} is a deck tool"));
    (got.summary, got.paths)
}

#[test]
fn a_call_is_told_in_words_and_names_the_decks_it_touched() {
    let (_v, k, s) = open();
    let (made, paths) = said(&k, &s, "create_deck", json!({"outline": OUTLINE}));
    assert!(
        made.starts_with("Created the deck “Tool use” with 3 slides"),
        "{made}"
    );
    assert_eq!(paths, ["library/tool-use.deck"]);

    let (listed, none) = said(&k, &s, "list_decks", Value::Null);
    let n = call(&k, &s, "list_decks", Value::Null).unwrap()["decks"]
        .as_array()
        .unwrap()
        .len();
    assert!(n >= 2, "the vault's own deck and this one");
    assert_eq!(listed, format!("Listed {n} decks"));
    assert!(none.is_empty());

    let (read, paths) = said(&k, &s, "get_deck", json!({"deck": "Tool use"}));
    assert_eq!(read, "Read the deck “Tool use” (3 slides)");
    assert!(paths.is_empty(), "a read is not a change: {paths:?}");

    let (slide, _) = said(&k, &s, "get_slide", json!({"deck": "Tool use", "slide": 2}));
    assert_eq!(slide, "Read slide 2 of “Tool use”");

    let (outline, _) = said(&k, &s, "get_outline", json!({"deck": "Tool use"}));
    assert_eq!(outline, "Read the outline of “Tool use”");

    let (linted, _) = said(&k, &s, "lint_deck", json!({"deck": "Tool use"}));
    assert!(linted.starts_with("Checked “Tool use”: "), "{linted}");

    let (changed, paths) = said(
        &k,
        &s,
        "update_elements",
        json!({"deck": "Tool use", "operations": [{"op": "set_notes", "input": {"slide": 2, "notes": "Say it slowly."}}]}),
    );
    assert!(
        changed.starts_with("Changed “Tool use” · lint: 0 errors"),
        "{changed}"
    );
    assert_eq!(paths, ["library/tool-use.deck"]);

    let (worded, _) = said(
        &k,
        &s,
        "add_slide",
        json!({"deck": "Tool use", "layout": "title-only", "content": {"title": "Why"}}),
    );
    assert!(worded.starts_with("Added to “Tool use”"), "{worded}");
}

#[test]
fn a_call_that_waits_or_fails_says_what_it_set_out_to_do() {
    assert_eq!(
        action("lint_deck", &json!({"deck": "Tool use"})).unwrap(),
        "check “Tool use”"
    );
    assert_eq!(
        action("get_slide", &json!({"deck": "Tool use", "slide": "s4"})).unwrap(),
        "read slide s4 of “Tool use”"
    );
    assert_eq!(
        action("delete_slides", &json!({"deck": "Tool use.deck"})).unwrap(),
        "delete slides from “Tool use”"
    );
    assert_eq!(
        action("trash_deck", &json!({"deck": "Talk"})).unwrap(),
        "move “Talk” to the trash"
    );
    assert_eq!(
        action("deck_from_note", &json!({"note": "Plan"})).unwrap(),
        "make a deck from “Plan”"
    );
    assert_eq!(
        action("create_deck", &json!({"title": "Tool use"})).unwrap(),
        "create the deck “Tool use”"
    );
    assert_eq!(
        action("set_text", &json!({})).unwrap(),
        "change the deck (set text)"
    );
    assert_eq!(
        action("read_note", &json!({"note": "Plan"})),
        None,
        "the tools for notes are worded elsewhere"
    );
    let (_v, k, _s) = open();
    assert_eq!(told(&k, "read_note", &json!({}), &json!({})), None);
}

#[test]
fn each_table_operation_has_words_of_its_own_before_and_after() {
    let (_v, k, s) = open();
    let made = call(&k, &s, "create_deck", json!({"outline": OUTLINE})).unwrap();
    let path = made["result"]["deck"].as_str().unwrap().to_owned();
    let ops = [
        ("set_cells", "fill cells in", "Filled cells in"),
        ("clear_cells", "clear cells in", "Cleared cells in"),
        ("set_cell_fill", "colour cells in", "Coloured cells in"),
        ("insert_rows", "add rows to", "Added rows to"),
        ("delete_rows", "remove rows from", "Removed rows from"),
        ("insert_columns", "add columns to", "Added columns to"),
        (
            "delete_columns",
            "remove columns from",
            "Removed columns from",
        ),
        ("merge_cells", "merge cells in", "Merged cells in"),
        (
            "unmerge_cells",
            "split merged cells in",
            "Split merged cells in",
        ),
    ];
    let mut said = std::collections::BTreeSet::new();
    for (op, before, after) in ops {
        let input = json!({"deck": "Tool use"});
        assert_eq!(
            action(op, &input).unwrap(),
            format!("{before} “Tool use”"),
            "{op}"
        );
        let answer = json!({"status": "done", "result": {"deck": path, "changed": true}});
        let got = told(&k, op, &input, &answer).unwrap();
        assert_eq!(got.summary, format!("{after} “Tool use”"), "{op}");
        assert_eq!(got.paths, [path.as_str()], "{op}");
        // Each says something different, so the history of a table reads as what was done to it.
        assert!(said.insert(got.summary), "{op} repeats another's words");
    }
}

#[test]
fn a_deck_made_from_a_note_is_told_with_where_it_came_from() {
    let (v, k, s) = open();
    std::fs::write(
        v.0.join("library/plan.md"),
        "---\ntitle: Plan\ntype: page\n---\n## Aim\n\n- One\n- Two\n",
    )
    .unwrap();
    let k = Kasten::open(&v.0).unwrap_or(k);
    let (made, paths) = said(&k, &s, "deck_from_note", json!({"note": "Plan"}));
    assert!(
        made.starts_with("Made the deck “Plan” from “Plan”: 2 slides"),
        "{made}"
    );
    assert_eq!(paths, ["library/plan.deck"]);
}

#[test]
fn a_deck_chip_is_its_outline_and_a_slide_chip_says_what_is_selected() {
    let (_v, k, s) = open();
    let made = call(&k, &s, "create_deck", json!({"outline": OUTLINE})).unwrap();
    let path = made["result"]["deck"].as_str().unwrap().to_owned();
    let deck = deck_context(&k, &path).unwrap();
    assert_eq!(deck.title, "Tool use");
    assert!(
        deck.body.contains("library/tool-use.deck") && deck.body.contains("3 slides"),
        "{}",
        deck.body
    );
    assert!(
        deck.body.contains("## The loop") && deck.body.contains("The host runs it"),
        "{}",
        deck.body
    );

    let got = call(&k, &s, "get_deck", json!({"deck": path})).unwrap();
    let slide = got["slides"][2]["id"].as_str().unwrap().to_owned();
    let body_id = call(&k, &s, "get_slide", json!({"deck": path, "slide": slide})).unwrap()["slide"]["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["placeholder"] == "body")
        .map(|e| e["id"].as_str().unwrap().to_owned())
        .expect("a body");

    let chip = slide_context(&k, &path, &slide, std::slice::from_ref(&body_id)).unwrap();
    assert!(
        chip.body.contains("slide 3 of 3") && chip.body.contains("“The loop”"),
        "{}",
        chip.body
    );
    assert!(
        chip.body
            .contains(&format!("{body_id} (text, the body slot: “The model asks")),
        "{}",
        chip.body
    );
    assert!(
        chip.body.contains("This slide in the deck's own format"),
        "{}",
        chip.body
    );
    assert!(chip.body.contains("\"layout\""), "{}", chip.body);

    let none = slide_context(&k, &path, &slide, &[]).unwrap();
    assert!(
        none.body.contains("No element of the slide is selected."),
        "{}",
        none.body
    );
    let gone = slide_context(&k, &path, "nope", &[]).unwrap();
    assert!(
        gone.body.contains("is not in the deck any more"),
        "{}",
        gone.body
    );
    let missing = deck_context(&k, "library/none.deck").unwrap_err();
    assert!(missing.contains("deck"), "{missing}");
}
