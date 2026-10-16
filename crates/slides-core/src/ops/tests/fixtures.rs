//! The small decks in `fixtures/decks`: made here through the operations, so
//! they are what the operations make, and checked here to read and save back
//! byte for byte. `write_fixtures` (run by hand with `--ignored`) makes them;
//! it never runs by itself, and an existing fixture is never edited to make a
//! test pass.

use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};

use super::composite_deck::composites;
use super::fixtures_v1::highlight_citations;
use super::{add, bytes, engine, first_slide, text_box};
use crate::canonical;
use crate::marks::{Author, stamp};
use crate::ops::Engine;

pub(super) fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/decks")
}

fn shapes() -> Engine {
    let mut e = Engine::create("Every shape", "Light", 11).unwrap();
    let s = add(&mut e, "blank", json!({}));
    let mut elements: Vec<Value> = Vec::new();
    for (i, shape) in [
        "rect",
        "roundRect",
        "ellipse",
        "triangle",
        "rtTriangle",
        "diamond",
        "chevron",
        "rightArrow",
    ]
    .into_iter()
    .enumerate()
    {
        elements.push(json!({
            "type": "shape", "shape": shape, "id": format!("shape-{i}"),
            "x": 60 + (i % 4) * 210, "y": 60 + (i / 4) * 130, "w": 160, "h": 90,
            "style": { "fill": { "color": format!("accent{}", i % 6 + 1), "alpha": 0.25 }, "stroke": { "color": format!("accent{}", i % 6 + 1), "width": 2 }, "radius": 12 },
            "text": { "paragraphs": [{ "align": "center", "runs": [{ "t": shape, "b": true }] }], "valign": "middle" },
        }));
    }
    elements.push(json!({ "type": "line", "id": "line-1", "x": 60, "y": 340, "w": 300, "h": 0, "style": { "stroke": { "color": "text2", "width": 3, "dash": "dash" }, "endArrow": "triangle" } }));
    elements.push(json!({ "type": "connector", "id": "link-1", "route": "elbow", "x": 0, "y": 0, "w": 1, "h": 1, "from": { "el": "shape-0", "side": "bottom" }, "to": { "el": "shape-5", "side": "top" }, "style": { "stroke": { "color": "text2", "width": 1.5 }, "endArrow": "triangle" } }));
    elements.push(json!({ "type": "image", "id": "image-1", "x": 700, "y": 340, "w": 200, "h": 120, "src": "assets/figure.png", "alt": "A figure", "mask": "roundRect" }));
    elements.push(json!({ "type": "table", "id": "table-1", "x": 60, "y": 380, "w": 400, "h": 90, "columns": [200, 200], "headerRow": true,
        "rows": [
            { "cells": [{ "text": { "paragraphs": [{ "runs": [{ "t": "Name", "b": true }] }] } }, { "text": { "paragraphs": [{ "runs": [{ "t": "Value", "b": true }] }] } }] },
            { "cells": [{ "text": { "paragraphs": [{ "runs": [{ "t": "alpha" }] }] } }, { "text": { "paragraphs": [{ "runs": [{ "t": "1" }] }] } }] }
        ] }));
    e.apply("add_elements", json!({ "slide": s, "elements": elements }))
        .unwrap();
    e.apply(
        "group_elements",
        json!({ "slide": s, "ids": ["shape-0", "shape-1"] }),
    )
    .unwrap();
    e
}

fn text_heavy() -> Engine {
    let mut e = Engine::create("A talk with words", "Serif", 12).unwrap();
    add(
        &mut e,
        "title-body",
        json!({ "title": "Why decks are files", "body": "- **Plain files** diff in git\n- *Agents* can edit them\n  - and render the result\n- Speaker notes stay with the slide" }),
    );
    add(
        &mut e,
        "two-columns",
        json!({ "title": "Two columns", "body": "1. First\n2. Second\n3. Third", "body2": "A paragraph with `code`, a [link](https://example.com) and math $e^{i\\pi}+1=0$." }),
    );
    let quote = add(
        &mut e,
        "quote",
        json!({ "quote": "Make it work, make it right, make it fast.", "caption": "Kent Beck" }),
    );
    e.apply(
        "set_notes",
        json!({ "slide": quote, "notes": "Pause here.\n\n- ask the room" }),
    )
    .unwrap();
    let hidden = add(
        &mut e,
        "big-number",
        json!({ "number": "42", "label": "the answer" }),
    );
    e.apply(
        "set_slide_flags",
        json!({ "ids": [hidden], "hidden": true }),
    )
    .unwrap();
    let backup = add(&mut e, "title-only", json!({ "title": "Backup: details" }));
    e.apply(
        "set_slide_flags",
        json!({ "ids": [backup], "backup": true }),
    )
    .unwrap();
    e
}

fn unknown_fields() -> Engine {
    let mut e = engine();
    let s = first_slide(&e);
    text_box(&mut e, &s, 100.0, 300.0, 400.0, 60.0, "kept");
    let mut deck = e.deck().clone();
    deck.extra.insert(
        "futureDeckField".to_owned(),
        json!({ "z": 1, "a": [true, null, 2.5] }),
    );
    deck.theme
        .extra
        .insert("futureThemeField".to_owned(), json!("kept"));
    deck.slides[0]
        .extra
        .insert("futureSlideField".to_owned(), json!(7));
    if let crate::model::Element::Text(t) = deck.slides[0].elements.last_mut().unwrap() {
        t.extra
            .insert("futureElementField".to_owned(), json!({ "nested": "kept" }));
        t.text.extra.insert("futureTextField".to_owned(), json!(1));
        t.text.paragraphs[0]
            .extra
            .insert("futureParagraphField".to_owned(), json!("kept"));
        t.text.paragraphs[0].runs[0]
            .extra
            .insert("futureRunField".to_owned(), json!(false));
        t.base.name = Some("With extras".to_owned());
    }
    Engine::new(deck, 13)
}

fn four_three() -> Engine {
    let mut e = Engine::create("Four by three", "Lecture", 14).unwrap();
    // Page setup refits the theme's slots, its master and the title slide to the smaller slide.
    e.apply("set_page_size", json!({ "w": 720, "h": 540 }))
        .unwrap();
    add(
        &mut e,
        "title-body",
        json!({ "title": "An older screen", "body": "- 720 by 540 units" }),
    );
    e
}

/// A deck as assistants left it: one slide is a person's, two are an assistant's, and another
/// assistant has since reworded a title, so a slide carries two batches of marks.
fn agent_marks() -> Engine {
    let author = |by: &str, session: &str, at: u64| Author {
        by: by.to_owned(),
        session: session.to_owned(),
        at,
    };
    let claude = author(
        "claude-code",
        "01K8Z3K6Q2M4X7V9B1C5D8E0F2",
        1_790_000_000_000,
    );
    let chat = author(
        "kasten-chat",
        "01K8Z4M2R7N1W6Y3D5F9G0H8J4",
        1_790_000_600_000,
    );
    let mut e = Engine::create("Made with an assistant", "Light", 15).unwrap();
    add(
        &mut e,
        "title-body",
        json!({ "title": "Written by a person", "body": "- No mark on this slide" }),
    );
    let before = e.deck().clone();
    let second = add(
        &mut e,
        "title-body",
        json!({ "title": "Added by an assistant", "body": "- Every element is marked\n- until a person accepts it or changes it" }),
    );
    add(&mut e, "title-only", json!({ "title": "Also added by it" }));
    let mut deck = e.deck().clone();
    stamp(&before, &mut deck, &claude);
    let mut e = Engine::new(deck, 15);
    let before = e.deck().clone();
    let title = e
        .deck()
        .slide(&second)
        .unwrap()
        .elements
        .iter()
        .find(|el| el.base().placeholder.as_deref() == Some("title"))
        .map(|el| el.id().to_owned())
        .unwrap();
    e.apply(
        "set_text",
        json!({ "slide": second, "id": title, "markdown": "Reworded by another assistant" }),
    )
    .unwrap();
    let mut deck = e.deck().clone();
    stamp(&before, &mut deck, &chat);
    Engine::new(deck, 15)
}

fn all() -> Vec<(&'static str, Engine)> {
    vec![
        ("minimal.deck", engine()),
        ("shapes.deck", shapes()),
        ("text-heavy.deck", text_heavy()),
        ("unknown-fields.deck", unknown_fields()),
        ("four-three.deck", four_three()),
        ("composites.deck", composites()),
        ("agent-marks.deck", agent_marks()),
        ("highlight-citations.deck", highlight_citations()),
    ]
}

#[test]
#[ignore = "writes fixtures/decks; run by hand"]
fn write_fixtures() {
    fs::create_dir_all(dir()).unwrap();
    for (name, engine) in all() {
        let path = dir().join(name);
        // A fixture is never rewritten to make a test pass: delete it on purpose first.
        if path.exists() {
            continue;
        }
        fs::write(path, bytes(engine.deck())).unwrap();
    }
}

#[test]
fn the_fixture_decks_read_and_save_back_unchanged() {
    let mut seen = 0;
    for entry in fs::read_dir(dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "deck") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        let deck = canonical::parse(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        assert_eq!(
            canonical::write(&deck).unwrap(),
            text,
            "{} does not save back the same",
            path.display()
        );
        seen += 1;
    }
    assert!(seen >= 5, "the fixture decks are in fixtures/decks");
}

#[test]
fn the_four_by_three_fixture_is_drawn_for_its_own_slide() {
    let text = fs::read_to_string(dir().join("four-three.deck")).unwrap();
    let deck = canonical::parse(&text).unwrap();
    assert_eq!((deck.size.w, deck.size.h), (720.0, 540.0));
    // Its slots are the theme's, refitted to 720 by 540, so nothing sticks out of the slide.
    assert_eq!(
        deck.theme,
        crate::themes::by_name_sized("Lecture", &deck.size).unwrap()
    );
    for layout in &deck.theme.layouts {
        for slot in &layout.placeholders {
            assert!(
                slot.x + slot.w <= 720.0 && slot.y + slot.h <= 540.0,
                "{} / {} does not fit a 4:3 slide",
                layout.name,
                slot.role
            );
        }
    }
}

#[test]
fn the_marks_fixture_says_who_made_what_and_saves_back_unchanged() {
    let text = fs::read_to_string(dir().join("agent-marks.deck")).unwrap();
    let deck = canonical::parse(&text).unwrap();
    let counts: Vec<usize> = deck
        .slides
        .iter()
        .map(|s| crate::marks::marked_ids(s).len())
        .collect();
    assert_eq!(counts, [0, 0, 2, 1]);
    let second = crate::marks::batches(&deck.slides[2]);
    let who: Vec<&str> = second.iter().map(|b| b.by.as_str()).collect();
    assert_eq!(who, ["claude-code", "kasten-chat"]);
    assert_eq!(second[0].ids.len(), 1, "the title moved to the other batch");
    assert!(text.contains("\"x-agent\""));
    assert_eq!(canonical::write(&deck).unwrap(), text);
}

#[test]
fn unknown_fields_survive_a_read_and_a_save() {
    let text = fs::read_to_string(dir().join("unknown-fields.deck")).unwrap();
    for key in [
        "futureDeckField",
        "futureThemeField",
        "futureSlideField",
        "futureElementField",
        "futureTextField",
        "futureParagraphField",
        "futureRunField",
    ] {
        assert!(text.contains(key), "{key} is in the fixture");
    }
    let saved = canonical::write(&canonical::parse(&text).unwrap()).unwrap();
    assert_eq!(saved, text);
}
