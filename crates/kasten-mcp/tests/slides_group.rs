//! The deck tools as a group: a vault with no deck lists only the ones that start a deck and the guide to making
//! one, and the rest come once there is a deck. The app's chat lists them all (`tools::specs`).

mod common;

use std::fs;

use common::{Client, OUTLINE, TempDir};
use kasten_core::{Instant, Kasten, ulid_at};
use kasten_mcp::tools::specs;
use serde_json::json;

/// A vault with history and nothing in it.
fn empty_vault() -> TempDir {
    kasten_mcp::decks::render::pretend_no_browser(true);
    let dir = std::env::temp_dir().join(format!(
        "kasten-mcp-slides-group-{}",
        ulid_at(Instant::now().millis)
    ));
    fs::create_dir_all(dir.join(".kasten")).unwrap();
    Kasten::open(&dir).unwrap().start_history().unwrap();
    TempDir(dir)
}

#[test]
fn a_vault_with_no_deck_lists_the_tools_that_start_one_and_the_rest_once_it_has_one() {
    let vault = empty_vault();
    let mut client = Client::start(&vault.0, "claude-code");
    let before = client.tools();
    for name in [
        "slides_help",
        "list_decks",
        "create_deck",
        "build_deck",
        "deck_from_note",
        "import_pptx",
    ] {
        assert!(before.iter().any(|n| n == name), "{name} in {before:?}");
    }
    for name in [
        "lint_deck",
        "render_slide",
        "add_slide",
        "set_chart_data",
        "export",
    ] {
        assert!(
            !before.iter().any(|n| n == name),
            "{name} is listed with no deck"
        );
    }
    assert!(
        before.iter().any(|n| n == "capture"),
        "the note tools are there"
    );
    let made = client
        .call("create_deck", json!({ "outline": OUTLINE }))
        .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let after = client.tools();
    for name in [
        "lint_deck",
        "render_slide",
        "add_slide",
        "set_chart_data",
        "place_diagram",
        "replace_asset",
        "set_notes_bulk",
        "build_deck",
    ] {
        assert!(after.iter().any(|n| n == name), "{name} in {after:?}");
    }
    assert!(
        after.len() > before.len() + 30,
        "{} and {}",
        before.len(),
        after.len()
    );
}

#[test]
fn the_guide_gives_the_order_of_work_even_with_no_deck() {
    let vault = empty_vault();
    let mut client = Client::start(&vault.0, "claude-code");
    let help = client.call("slides_help", json!({})).unwrap();
    let text = help.as_str().unwrap_or_default();
    assert!(
        text.contains("Outline") && text.contains("build_deck") && text.contains("lint_deck"),
        "{help}"
    );
}

#[test]
fn a_whole_deck_is_built_in_one_call_and_a_bad_spec_writes_nothing() {
    let vault = empty_vault();
    let mut client = Client::start(&vault.0, "claude-code");
    let bad = client
        .call(
            "build_deck",
            json!({ "title": "X", "slides": [{ "layout": "nope" }] }),
        )
        .unwrap_err();
    assert!(
        bad.contains("Nothing was written") && bad.contains("`slides[0]`"),
        "{bad}"
    );
    assert!(
        !client.tools().iter().any(|n| n == "lint_deck"),
        "no deck was made"
    );
    let made = client
        .call(
            "build_deck",
            json!({ "title": "Review", "slides": [
                { "layout": "title", "slots": { "title": "Review", "subtitle": "Q3" } },
                { "layout": "title-body", "slots": { "title": "Why", "body": "- one\n- two" }, "notes": "Say it plainly." }
            ] }),
        )
        .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    assert_eq!(made["result"]["slides"].as_array().map(Vec::len), Some(2));
    assert!(client.tools().iter().any(|n| n == "lint_deck"));
}

#[test]
fn the_app_chat_lists_every_deck_tool_whatever_the_vault_has() {
    let all = specs();
    for name in [
        "lint_deck",
        "render_slide",
        "build_deck",
        "slides_help",
        "set_chart_data",
    ] {
        assert!(all.iter().any(|s| s.name == name), "{name}");
    }
}
