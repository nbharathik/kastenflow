//! The decks of format 1, kept as they were when format 2 came (`fixtures/decks-v1`), and the deck
//! that uses what format 2 added (`fixtures/decks/highlight-citations.deck`). A deck of format 1
//! opens and saves back as the same bytes, as version 1, in every build after it.

use std::fs;
use std::path::PathBuf;

use serde_json::json;

use super::add;
use super::fixtures::dir;
use crate::canonical;
use crate::model::Element;
use crate::ops::Engine;

/// The decks as format 1 wrote them.
fn dir_v1() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/decks-v1")
}

/// A deck that uses what format 2 added: words with a highlight, a citation that links its works,
/// and a text box that remembers how it was made from a page.
pub(super) fn highlight_citations() -> Engine {
    let mut e = Engine::create("Marked and cited", "Light", 16).unwrap();
    let s = add(
        &mut e,
        "title-body",
        json!({ "title": "Highlights and links", "body": "- placeholder" }),
    );
    let body = e
        .deck()
        .slide(&s)
        .unwrap()
        .elements
        .iter()
        .find(|el| el.base().placeholder.as_deref() == Some("body"))
        .map(|el| el.id().to_owned())
        .unwrap();
    e.apply(
        "set_rich_text",
        json!({ "slide": s, "id": body, "text": { "paragraphs": [
            { "list": "bullet", "runs": [{ "t": "A " }, { "t": "marked", "highlight": "accent3" }, { "t": " word and " }, { "t": "another", "highlight": "#ffee00" }, { "t": "." }] },
            { "list": "bullet", "runs": [{ "t": "code", "code": true }, { "t": " keeps its ground, " }, { "t": "unless", "code": true, "highlight": "accent2" }, { "t": " it is marked" }] },
        ] } }),
    )
    .unwrap();
    e.apply(
        "add_elements",
        json!({ "slide": s, "elements": [
            { "type": "citation", "id": "cited", "x": 64, "y": 470, "w": 800, "h": 40, "keys": ["vaswani2017attention", "lecun2015deep"], "format": "short", "links": true },
            { "type": "text", "id": "plan", "x": 560, "y": 148, "w": 336, "h": 60,
              "text": { "paragraphs": [{ "runs": [{ "t": "Drafted from the plan" }] }] },
              "source": { "page": "library/plan.md", "kind": "contents", "sync": true, "hash": "00000000000000ff", "made": "storyboard" } },
        ] }),
    )
    .unwrap();
    e
}

/// Copies the decks of format 1 in `fixtures/decks` to `fixtures/decks-v1`, once: a deck that is there
/// stays as it is, and a deck that is not format 1 is not copied. Run it by hand before a format
/// changes the decks in `fixtures/decks`.
#[test]
#[ignore = "writes fixtures/decks-v1; run by hand"]
fn write_v1_fixtures() {
    fs::create_dir_all(dir_v1()).unwrap();
    for entry in fs::read_dir(dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "deck") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        let target = dir_v1().join(path.file_name().unwrap());
        if !target.exists() && text.contains("\"formatVersion\": 1,") {
            fs::write(target, text).unwrap();
        }
    }
}

#[test]
fn the_decks_of_format_one_open_and_save_back_as_version_one() {
    let mut seen = 0;
    for entry in fs::read_dir(dir_v1()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "deck") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"formatVersion\": 1,"), "{}", path.display());
        let deck = canonical::parse(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        assert_eq!(
            canonical::write(&deck).unwrap(),
            text,
            "{} does not save back as version 1",
            path.display()
        );
        seen += 1;
    }
    assert!(seen >= 8, "the decks of format 1 are in fixtures/decks-v1");
}

#[test]
fn every_deck_of_format_one_in_the_fixtures_is_the_one_kept_for_format_one() {
    for entry in fs::read_dir(dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "deck") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        if text.contains("\"formatVersion\": 1,") {
            let kept = fs::read_to_string(dir_v1().join(path.file_name().unwrap()))
                .unwrap_or_else(|e| panic!("{} is not kept for format 1: {e}", path.display()));
            assert_eq!(kept, text, "{}", path.display());
        }
    }
}

#[test]
fn the_deck_that_uses_format_two_is_version_two_and_keeps_what_it_added() {
    let text = fs::read_to_string(dir().join("highlight-citations.deck")).unwrap();
    assert!(text.contains("\"formatVersion\": 2,"));
    let deck = canonical::parse(&text).unwrap();
    assert_eq!(canonical::write(&deck).unwrap(), text);
    let slide = &deck.slides[1];
    let highlights: Vec<&str> = slide
        .elements
        .iter()
        .filter_map(Element::text)
        .flat_map(|t| t.paragraphs.iter().flat_map(|p| p.runs.iter()))
        .filter_map(|r| r.highlight.as_deref())
        .collect();
    assert_eq!(highlights, ["accent3", "#ffee00", "accent2"]);
    let linked = slide
        .elements
        .iter()
        .any(|e| matches!(e, Element::Citation(c) if c.links));
    assert!(linked, "the citation links its works");
    let made = slide
        .elements
        .iter()
        .filter_map(|e| e.base().source.as_ref())
        .filter_map(|s| s.made.as_deref())
        .collect::<Vec<_>>();
    assert_eq!(made, ["storyboard"]);
}
