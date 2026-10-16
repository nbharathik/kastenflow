//! The version a deck is written with: 1, unless it uses something that came with 2.

use serde_json::{Value, json};

use super::*;
use crate::error::Error;
use crate::ops::Engine;

fn engine() -> Engine {
    Engine::create("Versions", "Light", 3).unwrap_or_else(|e| panic!("{e}"))
}

/// A deck with one blank slide that has the element on it.
fn with(element: Value) -> Deck {
    let mut e = engine();
    let slide = e
        .apply("add_slide", json!({ "layout": "blank" }))
        .unwrap_or_else(|err| panic!("{err}"))
        .output["slide"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    e.apply(
        "add_elements",
        json!({ "slide": slide, "elements": [element] }),
    )
    .unwrap_or_else(|err| panic!("{err}"));
    e.into_deck()
}

fn text_with(run: Value) -> Value {
    json!({ "type": "text", "x": 40, "y": 40, "w": 300, "h": 60, "text": { "paragraphs": [{ "runs": [run] }] } })
}

fn version_of(text: &str) -> u64 {
    let value: Value = serde_json::from_str(text).unwrap_or_else(|e| panic!("{e}"));
    value["formatVersion"].as_u64().unwrap_or(0)
}

#[test]
fn this_build_reads_up_to_version_two() {
    assert_eq!(FORMAT_VERSION, 2);
}

#[test]
fn a_deck_that_uses_nothing_new_is_written_as_version_one_and_saves_back_unchanged() {
    let text = write(&engine().into_deck()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(version_of(&text), 1);
    let deck = parse(&text).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        deck.format_version, FORMAT_VERSION,
        "in memory it is current"
    );
    assert_eq!(write(&deck).unwrap_or_else(|e| panic!("{e}")), text);
}

#[test]
fn a_deck_that_uses_one_of_the_new_things_is_written_as_version_two_and_reads_back() {
    let cases = [
        (
            "a highlight",
            with(text_with(json!({ "t": "marked", "highlight": "accent2" }))),
        ),
        (
            "citation links",
            with(
                json!({ "type": "citation", "x": 40, "y": 480, "w": 400, "h": 30, "keys": ["a"], "links": true }),
            ),
        ),
        (
            "a page source's made",
            with(json!({ "type": "text", "x": 40, "y": 40, "w": 300, "h": 60,
                "text": { "paragraphs": [{ "runs": [{ "t": "x" }] }] },
                "source": { "page": "plan.md", "kind": "contents", "made": "storyboard" } })),
        ),
    ];
    for (what, deck) in cases {
        let text = write(&deck).unwrap_or_else(|e| panic!("{what}: {e}"));
        assert_eq!(version_of(&text), 2, "{what}");
        let back = parse(&text).unwrap_or_else(|e| panic!("{what}: {e}"));
        assert_eq!(
            write(&back).unwrap_or_else(|e| panic!("{what}: {e}")),
            text,
            "{what}"
        );
    }
}

#[test]
fn a_new_thing_anywhere_in_the_deck_makes_it_version_two() {
    // In a table cell, in a group, in the master and in a layout's own decoration.
    let cell = json!({ "type": "table", "x": 40, "y": 40, "w": 300, "h": 60, "columns": [300],
        "rows": [{ "cells": [{ "text": { "paragraphs": [{ "runs": [{ "t": "c", "highlight": "#ffee00" }] }] } }] }] });
    assert_eq!(version_of(&write(&with(cell)).unwrap_or_default()), 2);

    let mut deck = engine().into_deck();
    let note = serde_json::from_value(
        text_with(json!({ "t": "m", "highlight": "accent1" })).tap_id("master-note"),
    )
    .unwrap_or_else(|e| panic!("{e}"));
    deck.theme.master.push(note);
    assert_eq!(version_of(&write(&deck).unwrap_or_default()), 2);

    let mut deck = engine().into_deck();
    let note = serde_json::from_value(
        text_with(json!({ "t": "l", "highlight": "accent1" })).tap_id("layout-note"),
    )
    .unwrap_or_else(|e| panic!("{e}"));
    if let Some(layout) = deck.theme.layouts.first_mut() {
        layout.elements.push(note);
    }
    assert_eq!(version_of(&write(&deck).unwrap_or_default()), 2);
}

trait TapId {
    fn tap_id(self, id: &str) -> Value;
}

impl TapId for Value {
    fn tap_id(mut self, id: &str) -> Value {
        self["id"] = json!(id);
        self
    }
}

#[test]
fn the_themes_own_highlight_outline_and_words_called_links_are_not_new_things() {
    // `highlight` on the theme is the outline of a highlighted element, `links` on a text is just a field.
    let deck = with(
        json!({ "type": "text", "x": 40, "y": 40, "w": 300, "h": 60, "links": true,
        "text": { "paragraphs": [{ "runs": [{ "t": "highlight" }] }] } }),
    );
    assert!(deck.theme.highlight.width > 0.0);
    assert_eq!(version_of(&write(&deck).unwrap_or_default()), 1);
    let citation_off = with(
        json!({ "type": "citation", "x": 40, "y": 480, "w": 400, "h": 30, "keys": ["a"], "links": false }),
    );
    assert_eq!(version_of(&write(&citation_off).unwrap_or_default()), 1);
}

#[test]
fn a_deck_labelled_two_that_uses_nothing_new_is_written_as_one_and_a_one_that_does_is_written_as_two()
 {
    let plain = write(&engine().into_deck()).unwrap_or_else(|e| panic!("{e}"));
    let labelled = plain.replacen("\"formatVersion\": 1", "\"formatVersion\": 2", 1);
    assert_ne!(labelled, plain);
    let deck = parse(&labelled).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(write(&deck).unwrap_or_default(), plain);

    let marked = write(&with(text_with(
        json!({ "t": "m", "highlight": "accent1" }),
    )))
    .unwrap_or_else(|e| panic!("{e}"));
    let mislabelled = marked.replacen("\"formatVersion\": 2", "\"formatVersion\": 1", 1);
    assert_ne!(mislabelled, marked);
    let deck = parse(&mislabelled).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(write(&deck).unwrap_or_default(), marked);
}

#[test]
fn a_deck_of_a_newer_version_than_this_build_reads_is_refused_and_a_broken_version_is_not_a_deck() {
    let plain = write(&engine().into_deck()).unwrap_or_else(|e| panic!("{e}"));
    for found in [3_u32, 7, 4_000_000] {
        let text = plain.replacen(
            "\"formatVersion\": 1",
            &format!("\"formatVersion\": {found}"),
            1,
        );
        match parse(&text) {
            Err(Error::TooNew {
                found: f,
                supported,
            }) => assert_eq!((f, supported), (found, 2)),
            other => panic!("version {found}: {other:?}"),
        }
    }
    for broken in ["0", "-1", "1.5", "\"1\"", "null"] {
        let text = plain.replacen(
            "\"formatVersion\": 1",
            &format!("\"formatVersion\": {broken}"),
            1,
        );
        assert!(
            matches!(parse(&text), Err(Error::Malformed { .. })),
            "{broken}"
        );
    }
    let missing = plain.replacen("  \"formatVersion\": 1,\n", "", 1);
    assert!(matches!(parse(&missing), Err(Error::Malformed { .. })));
    let other = plain.replacen("kasten-deck", "canvas", 1);
    assert!(matches!(parse(&other), Err(Error::Malformed { .. })));
}
