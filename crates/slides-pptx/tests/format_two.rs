//! What deck format 2 adds and what 1.2 changed, through a PowerPoint file: a run's highlight, the
//! merged cells of a table, and what a layout draws.

mod common;

use serde_json::json;
use slides_core::{Deck, Element};
use slides_pptx::import::{ImportOptions, import};
use slides_pptx::{Options, export};

use common::foreign::fixture;
use common::{Builder, Files, cell, compare, inspect, runs};

fn text(package: &inspect::Package, name: &str) -> String {
    String::from_utf8_lossy(
        package
            .parts
            .get(name)
            .unwrap_or_else(|| panic!("{name} is not in the file")),
    )
    .into_owned()
}

/// A deck with one text box of marked and unmarked words on its second slide.
fn marked() -> Deck {
    let mut b = Builder::new("Light", "Highlights", 7);
    let made = b.slide("blank", json!({}));
    b.add(
        &made.id,
        json!([{ "type": "text", "id": "marked", "x": 60, "y": 60, "w": 700, "h": 80,
            "text": { "paragraphs": [runs(&[
                ("plain ", json!({})),
                ("pen", json!({ "highlight": "#ffee00" })),
                (" token ", json!({})),
                ("accent", json!({ "highlight": "accent2" })),
                (" ", json!({})),
                ("code", json!({ "code": true })),
                (" ", json!({})),
                ("marked code", json!({ "code": true, "highlight": "accent3" })),
            ])] } }]),
    );
    b.deck()
}

#[test]
fn a_highlight_is_written_as_a_highlight_and_inline_code_keeps_its_ground_unless_marked() {
    let deck = marked();
    let file =
        export(&deck, &Files::default(), &Options::default()).unwrap_or_else(|e| panic!("{e}"));
    assert!(file.warnings.is_empty(), "{:?}", file.warnings);
    let package = inspect::open(&file.bytes);
    let xml = text(&package, "ppt/slides/slide2.xml");
    assert!(
        xml.contains(r#"<a:highlight><a:srgbClr val="FFEE00"/></a:highlight>"#),
        "{xml}"
    );
    assert!(
        xml.contains(r#"<a:highlight><a:schemeClr val="accent2"/></a:highlight>"#),
        "{xml}"
    );
    // The marked code is the colour it was marked with, not the ground code has.
    assert!(
        xml.contains(r#"<a:highlight><a:schemeClr val="accent3"/></a:highlight>"#),
        "{xml}"
    );
    // The pen, the accent, the plain code's ground and the marked code, and the paragraph's mark, which
    // takes the look of the last words: five, and none on plain words.
    assert_eq!(xml.matches("<a:highlight>").count(), 5, "{xml}");
    let before_plain = &xml[..xml.find("<a:t>plain </a:t>").unwrap_or(0)];
    let look = &before_plain[before_plain.rfind("<a:rPr").unwrap_or(0)..];
    assert!(!look.contains("highlight"), "{look}");
}

#[test]
fn a_highlight_comes_back_and_a_code_ground_does_not_become_one() {
    let deck = marked();
    let options = Options::default();
    let file = export(&deck, &Files::default(), &options).unwrap_or_else(|e| panic!("{e}"));
    let imported = import(&file.bytes, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let slide = &imported.deck.slides[1];
    let Some(Element::Text(words)) = slide.elements.first() else {
        panic!("the text box came back")
    };
    let seen: Vec<(String, Option<String>, bool)> = words.text.paragraphs[0]
        .runs
        .iter()
        .map(|r| (r.t.clone(), r.highlight.clone(), r.code))
        .collect();
    let want = |t: &str, h: Option<&str>, code: bool| (t.to_owned(), h.map(str::to_owned), code);
    assert_eq!(
        seen,
        [
            want("plain ", None, false),
            want("pen", Some("#ffee00"), false),
            want(" token ", None, false),
            want("accent", Some("accent2"), false),
            want(" ", None, false),
            want("code", None, true),
            want(" ", None, false),
            want("marked code", Some("accent3"), true),
        ]
    );
    let diff = compare::compare(&deck, &options, &imported, &|_| None);
    assert!(diff.is_empty(), "{}", diff.join("\n"));
}

/// Every table of a slide as its cells: where each starts, how far it spans, and its words.
fn grid_of(deck: &Deck, slide: usize) -> Vec<(usize, usize, usize, usize, String)> {
    let Some(Element::Table(table)) = deck.slides[slide]
        .elements
        .iter()
        .find(|e| matches!(e, Element::Table(_)))
    else {
        panic!("a table on slide {slide}")
    };
    let mut matrix = table.to_matrix().unwrap_or_else(|e| panic!("{e}"));
    matrix.cells.sort_by_key(|p| p.at);
    matrix
        .cells
        .iter()
        .map(|p| {
            (
                p.at.row,
                p.at.col,
                p.across,
                p.down,
                p.cell.text.plain_text(),
            )
        })
        .collect()
}

#[test]
fn merged_cells_come_back_merged_and_split_cells_come_back_apart() {
    let mut b = Builder::new("Light", "Tables", 8);
    let made = b.slide("blank", json!({}));
    let rows: Vec<_> = (0..4)
        .map(|r| json!({ "cells": (0..4).map(|c| cell(&format!("r{r}c{c}"))).collect::<Vec<_>>() }))
        .collect();
    b.add(
        &made.id,
        json!([{ "type": "table", "id": "grid", "x": 60, "y": 60, "w": 600, "h": 300, "headerRow": true,
            "columns": [150, 150, 150, 150], "rows": rows }]),
    );
    let at = |row: usize, col: usize| json!({ "row": row, "col": col });
    for (from, to) in [((0, 0), (0, 1)), ((1, 3), (2, 3)), ((2, 0), (3, 1))] {
        b.apply(
            "merge_cells",
            json!({ "slide": made.id, "id": "grid", "from": at(from.0, from.1), "to": at(to.0, to.1) }),
        );
    }
    let merged = b.deck();
    let kept = grid_of(&merged, 1);
    assert_eq!(kept.len(), 16 - 1 - 1 - 3);
    assert!(kept.contains(&(0, 0, 2, 1, "r0c0\nr0c1".to_owned())));
    assert!(kept.contains(&(2, 0, 2, 2, "r2c0\nr2c1\nr3c0\nr3c1".to_owned())));

    let options = Options::default();
    let file = export(&merged, &Files::default(), &options).unwrap_or_else(|e| panic!("{e}"));
    let imported = import(&file.bytes, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(grid_of(&imported.deck, 1), kept);
    let diff = compare::compare(&merged, &options, &imported, &|_| None);
    assert!(diff.is_empty(), "{}", diff.join("\n"));

    // Split again, the cells are one place each and the file says so.
    let mut b = Builder::from_deck(merged, 9);
    for place in [at(0, 0), at(1, 3), at(2, 0)] {
        b.apply(
            "unmerge_cells",
            json!({ "slide": made.id, "id": "grid", "at": place }),
        );
    }
    let split = b.deck();
    assert_eq!(grid_of(&split, 1).len(), 16);
    let file = export(&split, &Files::default(), &options).unwrap_or_else(|e| panic!("{e}"));
    let package = inspect::open(&file.bytes);
    let xml = text(&package, "ppt/slides/slide2.xml");
    assert!(
        !xml.contains("gridSpan") && !xml.contains("rowSpan") && !xml.contains("hMerge"),
        "{xml}"
    );
    let imported = import(&file.bytes, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(grid_of(&imported.deck, 1), grid_of(&split, 1));
}

/// A deck with a layout called Poster: a stripe on every slide, a title and a list; two slides use it.
fn poster() -> Deck {
    let mut b = Builder::new("Light", "Layouts", 4);
    let made = b.slide("blank", json!({}));
    let ids = b.add(
        &made.id,
        json!([
            { "type": "shape", "shape": "rect", "x": 0, "y": 0, "w": 40, "h": 540, "style": { "fill": { "color": "accent2" } } },
            { "type": "text", "x": 80, "y": 40, "w": 800, "h": 90, "text": { "paragraphs": [{ "runs": [{ "t": "A heading" }] }] } },
            { "type": "text", "x": 80, "y": 160, "w": 800, "h": 300, "text": { "paragraphs": [{ "runs": [{ "t": "Some words" }] }] } },
        ]),
    );
    b.apply(
        "save_layout",
        json!({ "slide": made.id, "label": "Poster", "roles": { ids[1].clone(): "title", ids[2].clone(): "body" } }),
    );
    b.slide("poster", json!({ "title": "Second", "body": "- one" }));
    b.deck()
}

#[test]
fn what_a_layout_draws_is_its_own_decoration_once_and_a_slide_keeps_only_its_own_shapes() {
    let deck = poster();
    let file =
        export(&deck, &Files::default(), &Options::default()).unwrap_or_else(|e| panic!("{e}"));
    let imported = import(&file.bytes, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let back = &imported.deck;
    let layout = back
        .theme
        .layouts
        .iter()
        .find(|l| l.label == "Poster")
        .expect("the layout came back");
    assert_eq!(
        layout.elements.len(),
        1,
        "the stripe, once: {:?}",
        layout.elements
    );
    assert!(matches!(layout.elements[0], Element::Shape(_)));
    assert!(!layout.elements[0].base().locked);
    let on_it: Vec<_> = back
        .slides
        .iter()
        .filter(|s| s.layout == layout.name)
        .collect();
    assert_eq!(on_it.len(), 2);
    for slide in on_it {
        assert_eq!(
            slide.elements.len(),
            2,
            "a title and a list, and no copy of the stripe: {:?}",
            slide.elements.iter().map(Element::kind).collect::<Vec<_>>()
        );
        assert!(
            slide
                .elements
                .iter()
                .all(|e| e.kind() == "text" && !e.base().locked)
        );
    }
    // Exported again, the stripe is on the layout and on no slide.
    let again =
        export(back, &Files::default(), &Options::default()).unwrap_or_else(|e| panic!("{e}"));
    let package = inspect::open(&again.bytes);
    for name in ["ppt/slides/slide2.xml", "ppt/slides/slide3.xml"] {
        assert!(
            !text(&package, name).contains(r#"<a:schemeClr val="accent2"/>"#),
            "{name}"
        );
    }
}

#[test]
fn nothing_a_foreign_file_draws_on_its_layouts_is_copied_onto_its_slides() {
    for name in ["libreoffice.pptx", "python-pptx.pptx", "exported.pptx"] {
        let imported = fixture(name);
        assert!(
            imported
                .deck
                .slides
                .iter()
                .flat_map(|s| &s.elements)
                .all(|e| !e.base().locked),
            "{name}: a slide holds a locked copy of what its layout draws"
        );
    }
}
