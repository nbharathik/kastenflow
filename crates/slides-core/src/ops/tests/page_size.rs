//! Page setup: `set_page_size` refits the theme and every slide to the new size.

use proptest::prelude::*;
use serde_json::{Value, json};

use super::{add, bytes, element, engine, first_slide};
use crate::error::Error;
use crate::model::{Element, Theme};
use crate::ops::{Engine, NewDeck};
use crate::resize::PAGE_SIZES;

fn size_of(e: &Engine) -> (f64, f64) {
    (e.deck().size.w, e.deck().size.h)
}

fn resize(e: &mut Engine, w: f64, h: f64) {
    e.apply("set_page_size", json!({ "w": w, "h": h })).unwrap();
}

fn rect(e: &Engine, slide: &str, id: &str) -> (f64, f64, f64, f64) {
    element(e, slide, id).base().rect().unwrap()
}

fn group_id(e: &Engine, slide: &str) -> String {
    e.deck()
        .slide(slide)
        .unwrap()
        .elements
        .iter()
        .find(|el| matches!(el, Element::Group(_)))
        .unwrap()
        .id()
        .to_owned()
}

fn slot(theme: &Theme, layout: &str, role: &str) -> (f64, f64, f64, f64) {
    let slot = theme.layout(layout).unwrap().placeholder(role).unwrap();
    (slot.x, slot.y, slot.w, slot.h)
}

/// A slide with one of everything that stretches, and a few slides of layouts. Nothing in it keeps
/// its shape (no picture, nothing turned, no circle), so a bigger size and back is exact.
fn stretchy() -> (Engine, String) {
    let mut e = Engine::create("Rich", "Light", 5).unwrap();
    add(
        &mut e,
        "title-body",
        json!({ "title": "Results", "body": "- one\n- two" }),
    );
    add(
        &mut e,
        "two-columns",
        json!({ "title": "Two", "body": "a", "body2": "b" }),
    );
    let s = add(&mut e, "blank", json!({}));
    let cell = |words: &str, size: Option<f64>| {
        let mut run = json!({ "t": words });
        if let Some(size) = size {
            run["size"] = json!(size);
        }
        json!({ "text": { "paragraphs": [{ "runs": [run] }] } })
    };
    let elements = json!([
        { "type": "text", "id": "t1", "x": 100, "y": 100, "w": 300, "h": 50,
          "text": { "paragraphs": [{ "runs": [{ "t": "Hello", "size": 20 }], "spaceAfter": 6 }], "insets": { "left": 8, "top": 4, "right": 8, "bottom": 4 } } },
        { "type": "shape", "id": "sh1", "shape": "roundRect", "x": 500, "y": 80, "w": 200, "h": 90,
          "style": { "fill": { "color": "accent1" }, "stroke": { "color": "text1", "width": 2 }, "radius": 12, "shadow": { "color": "text1", "blur": 8, "dx": 2, "dy": 4 } },
          "text": { "paragraphs": [{ "runs": [{ "t": "Box", "size": 18 }] }] } },
        { "type": "shape", "id": "sh2", "shape": "rect", "x": 500, "y": 300, "w": 200, "h": 90 },
        { "type": "line", "id": "ln", "x": 60, "y": 340, "w": 300, "h": 0, "style": { "stroke": { "color": "text2", "width": 3 } } },
        { "type": "connector", "id": "cn", "route": "elbow", "x": 0, "y": 0, "w": 1, "h": 1,
          "from": { "el": "sh1", "side": "bottom" }, "to": { "el": "sh2", "side": "top" } },
        { "type": "table", "id": "tb", "x": 60, "y": 380, "w": 400, "h": 90, "columns": [200, 200],
          "rows": [{ "height": 45, "cells": [cell("a", Some(14.0)), cell("b", None)] }, { "height": 45, "cells": [cell("c", None), cell("d", None)] }] },
        { "type": "code", "id": "cd", "x": 60, "y": 200, "w": 300, "h": 120, "language": "rust", "code": "fn main() {}", "fontSize": 14 },
        { "type": "math", "id": "mt", "x": 600, "y": 200, "w": 200, "h": 60, "latex": "x^2", "fontSize": 28 },
    ]);
    e.apply("add_elements", json!({ "slide": s, "elements": elements }))
        .unwrap();
    e.apply("group_elements", json!({ "slide": s, "ids": ["t1", "ln"] }))
        .unwrap();
    (e, s)
}

#[test]
fn the_presets_are_the_sizes_they_name() {
    for (name, w, h) in PAGE_SIZES {
        let mut e = engine();
        e.apply("set_page_size", json!({ "preset": name })).unwrap();
        assert_eq!(size_of(&e), (w, h), "{name}");
    }
    let mut e = engine();
    e.apply("set_page_size", json!({ "preset": " 4:3 " }))
        .unwrap();
    assert_eq!(
        size_of(&e),
        (960.0, 720.0),
        "spaces around a preset do not matter"
    );
}

#[test]
fn a_taller_slide_stretches_boxes_and_keeps_the_type() {
    let (mut e, s) = stretchy();
    let before = e.deck().theme.clone();
    resize(&mut e, 960.0, 720.0);
    assert_eq!(size_of(&e), (960.0, 720.0));
    assert_eq!(rect(&e, &s, "sh2"), (500.0, 400.0, 200.0, 120.0));
    assert_eq!(rect(&e, &s, "tb"), (60.0, 506.67, 400.0, 120.0));
    // The width did not change, so the type did not either.
    let theme = &e.deck().theme;
    assert_eq!(theme.text_styles, before.text_styles);
    // The slots stretch like everything else, and so does the master.
    assert_eq!(
        slot(theme, "title-body", "title"),
        (64.0, 48.0, 832.0, 128.0)
    );
    let number = theme
        .master
        .iter()
        .find(|m| m.id() == "master-number")
        .unwrap();
    assert_eq!(number.base().rect(), Some((860.0, 666.67, 80.0, 32.0)));
    let Element::Shape(sh1) = element(&e, &s, "sh1") else {
        panic!("a shape")
    };
    assert_eq!(sh1.base.style.as_ref().unwrap().radius, Some(12.0));
}

#[test]
fn a_narrower_slide_scales_type_and_lines_with_the_width() {
    let (mut e, s) = stretchy();
    resize(&mut e, 720.0, 540.0);
    let theme = &e.deck().theme;
    let size = |name: &str| theme.text_style(name).unwrap().size;
    assert_eq!(
        (
            size("title"),
            size("body"),
            size("caption"),
            size("citation")
        ),
        (27.0, 16.5, 10.5, 7.5)
    );
    assert_eq!(theme.highlight.width, 1.5);
    let Element::Shape(sh1) = element(&e, &s, "sh1") else {
        panic!("a shape")
    };
    let style = sh1.base.style.as_ref().unwrap();
    assert_eq!(style.radius, Some(9.0));
    assert_eq!(style.stroke.as_ref().unwrap().width, Some(1.5));
    let shadow = style.shadow.as_ref().unwrap();
    assert_eq!((shadow.blur, shadow.dx, shadow.dy), (6.0, 1.5, 3.0));
    assert_eq!(
        sh1.text.as_ref().unwrap().paragraphs[0].runs[0].size,
        Some(13.5)
    );
    let Element::Code(code) = element(&e, &s, "cd") else {
        panic!("code")
    };
    assert_eq!(code.font_size, Some(10.5));
    let Element::Math(math) = element(&e, &s, "mt") else {
        panic!("math")
    };
    assert_eq!(math.font_size, Some(21.0));
    let Element::Table(table) = element(&e, &s, "tb") else {
        panic!("a table")
    };
    assert_eq!(table.columns, [150.0, 150.0]);
    assert_eq!(table.rows[0].height, Some(45.0));
}

#[test]
fn what_a_group_holds_is_refitted_with_it() {
    let (mut e, s) = stretchy();
    let group = group_id(&e, &s);
    resize(&mut e, 960.0, 720.0);
    assert_eq!(rect(&e, &s, "t1"), (100.0, 133.33, 300.0, 66.67));
    let (x, y, w, h) = rect(&e, &s, &group);
    // The line is the lowest thing the group holds: 340 + 0 stretched.
    assert_eq!((x, y, w), (60.0, 133.33, 340.0));
    assert!((h - (453.33 - 133.33)).abs() < 0.02, "{h}");
}

#[test]
fn a_connector_follows_the_elements_it_joins() {
    let (mut e, s) = stretchy();
    resize(&mut e, 1280.0, 720.0);
    let from = rect(&e, &s, "sh1");
    let to = rect(&e, &s, "sh2");
    let (x, y, w, h) = rect(&e, &s, "cn");
    let (start, end) = (
        (from.0 + from.2 / 2.0, from.1 + from.3),
        (to.0 + to.2 / 2.0, to.1),
    );
    assert!((x - start.0.min(end.0)).abs() < 0.02 && (y - start.1.min(end.1)).abs() < 0.02);
    assert!(
        (w - (end.0 - start.0).abs()).abs() < 0.02 && (h - (end.1 - start.1).abs()).abs() < 0.02
    );
}

#[test]
fn pictures_circles_and_turned_elements_keep_their_shape() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let elements = json!([
        { "type": "image", "id": "pic", "x": 100, "y": 100, "w": 200, "h": 100, "src": "assets/a.png" },
        { "type": "shape", "id": "dot", "shape": "ellipse", "x": 400, "y": 100, "w": 100, "h": 100 },
        { "type": "shape", "id": "oval", "shape": "ellipse", "x": 400, "y": 300, "w": 100, "h": 60 },
        { "type": "text", "id": "tilt", "x": 600, "y": 100, "w": 100, "h": 40, "rotation": 30, "text": { "paragraphs": [{ "runs": [{ "t": "x" }] }] } },
        { "type": "shape", "id": "box", "shape": "rect", "x": 100, "y": 300, "w": 100, "h": 100 },
    ]);
    e.apply("add_elements", json!({ "slide": s, "elements": elements }))
        .unwrap();
    resize(&mut e, 960.0, 720.0);
    // Wider than tall is stretched to 4/3 high: the picture keeps its size, centred where it was.
    assert_eq!(rect(&e, &s, "pic"), (100.0, 150.0, 200.0, 100.0));
    assert_eq!(rect(&e, &s, "dot"), (400.0, 150.0, 100.0, 100.0));
    assert_eq!(rect(&e, &s, "oval"), (400.0, 400.0, 100.0, 80.0));
    assert_eq!(
        rect(&e, &s, "tilt"),
        (600.0, 140.0, 100.0, 40.0),
        "a turned box only moves"
    );
    assert_eq!(rect(&e, &s, "box"), (100.0, 400.0, 100.0, 133.33));
    // Narrower: the picture is as large as fits the stretched box, both ways.
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    e.apply("add_elements", json!({ "slide": s, "elements": [
        { "type": "image", "id": "pic", "x": 100, "y": 100, "w": 200, "h": 100, "src": "assets/a.png" }
    ] })).unwrap();
    resize(&mut e, 720.0, 720.0);
    assert_eq!(rect(&e, &s, "pic"), (75.0, 162.5, 150.0, 75.0));
}

#[test]
fn a_group_with_a_picture_is_the_box_that_holds_its_children() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    e.apply("add_elements", json!({ "slide": s, "elements": [
        { "type": "image", "id": "pic", "x": 100, "y": 100, "w": 200, "h": 100, "src": "assets/a.png" },
        { "type": "text", "id": "cap", "x": 100, "y": 220, "w": 200, "h": 30, "text": { "paragraphs": [{ "runs": [{ "t": "x" }] }] } }
    ] })).unwrap();
    e.apply(
        "group_elements",
        json!({ "slide": s, "ids": ["pic", "cap"] }),
    )
    .unwrap();
    resize(&mut e, 720.0, 720.0);
    let group = group_id(&e, &s);
    let (pic, cap) = (rect(&e, &s, "pic"), rect(&e, &s, "cap"));
    let (x, y, w, h) = rect(&e, &s, &group);
    assert_eq!(x, pic.0.min(cap.0));
    assert_eq!(y, pic.1.min(cap.1));
    assert!((x + w - (pic.0 + pic.2).max(cap.0 + cap.2)).abs() < 0.02);
    assert!((y + h - (pic.1 + pic.3).max(cap.1 + cap.3)).abs() < 0.02);
}

#[test]
fn the_same_size_changes_nothing_and_records_no_step() {
    let (mut e, _) = stretchy();
    let before = bytes(e.deck());
    let steps = e.undo_label().map(str::to_owned);
    let applied = e
        .apply("set_page_size", json!({ "w": 960, "h": 540 }))
        .unwrap();
    assert!(applied.changes.is_empty());
    assert_eq!(bytes(e.deck()), before);
    assert_eq!(
        e.undo_label().map(str::to_owned),
        steps,
        "no step was added"
    );
}

#[test]
fn a_size_that_is_not_one_is_refused_and_the_deck_is_left_alone() {
    let mut e = engine();
    let before = bytes(e.deck());
    for input in [
        json!({ "w": 10, "h": 540 }),
        json!({ "w": 960, "h": 9000 }),
        json!({ "w": -960, "h": 540 }),
        json!({ "w": 960 }),
        json!({}),
        json!({ "preset": "5:4" }),
        json!({ "preset": "4:3", "w": 960, "h": 720 }),
    ] {
        let Err(Error::BadInput { op, message }) = e.apply("set_page_size", input.clone()) else {
            panic!("{input} should be refused")
        };
        assert_eq!(op, "set_page_size");
        assert!(!message.is_empty());
    }
    assert!(
        matches!(
            e.apply("set_page_size", json!({ "preset": "5:4" })),
            Err(Error::BadInput { message, .. }) if message.contains("16:9") && message.contains("1:1")
        ),
        "an unknown preset lists the known ones"
    );
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn undo_and_redo_take_a_resize_back_and_forth_byte_for_byte() {
    let (mut e, _) = stretchy();
    let before = bytes(e.deck());
    for (w, h) in [
        (960.0, 720.0),
        (720.0, 540.0),
        (720.0, 720.0),
        (1280.0, 720.0),
    ] {
        resize(&mut e, w, h);
        let after = bytes(e.deck());
        assert_ne!(after, before, "{w} by {h}");
        e.undo().unwrap();
        assert_eq!(bytes(e.deck()), before, "undo after {w} by {h}");
        e.redo().unwrap();
        assert_eq!(bytes(e.deck()), after, "redo after {w} by {h}");
        e.undo().unwrap();
    }
}

#[test]
fn a_bigger_size_and_back_returns_the_deck_that_was() {
    let (mut e, _) = stretchy();
    let before = bytes(e.deck());
    for (w, h) in [
        (960.0, 600.0),
        (960.0, 720.0),
        (1280.0, 720.0),
        (1920.0, 1080.0),
        (960.0, 960.0),
        (1200.0, 540.0),
    ] {
        resize(&mut e, w, h);
        resize(&mut e, 960.0, 540.0);
        assert_eq!(bytes(e.deck()), before, "through {w} by {h}");
    }
}

fn text_boxes(boxes: &[(u16, u16, u16, u16, u8)]) -> Value {
    let all: Vec<Value> = boxes
        .iter()
        .map(|(x, y, w, h, size)| {
            json!({ "type": "text", "x": x, "y": y, "w": w.max(&1), "h": h.max(&1),
                "text": { "paragraphs": [{ "runs": [{ "t": "hi", "size": f64::from(*size) / 2.0 + 8.0 }] }] } })
        })
        .collect();
    json!(all)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    #[test]
    fn any_boxes_come_back_exactly_from_a_bigger_slide(
        boxes in proptest::collection::vec((0u16..900, 0u16..500, 1u16..400, 1u16..300, 0u8..60), 1..6),
        target in 0usize..5,
    ) {
        let (w, h) = [(960.0, 600.0), (960.0, 720.0), (1280.0, 720.0), (1920.0, 1080.0), (1200.0, 900.0)][target];
        let mut e = engine();
        let s = first_slide(&e);
        e.apply("add_elements", json!({ "slide": s, "elements": text_boxes(&boxes) })).unwrap();
        let before = bytes(e.deck());
        resize(&mut e, w, h);
        resize(&mut e, 960.0, 540.0);
        prop_assert_eq!(bytes(e.deck()), before);
    }

    #[test]
    fn a_smaller_slide_and_back_is_off_by_at_most_a_hundredth(
        boxes in proptest::collection::vec((0u16..900, 0u16..500, 1u16..400, 1u16..300, 0u8..60), 1..6),
        target in 0usize..3,
    ) {
        let (w, h) = [(720.0, 540.0), (640.0, 360.0), (480.0, 270.0)][target];
        let mut e = engine();
        let s = first_slide(&e);
        e.apply("add_elements", json!({ "slide": s, "elements": text_boxes(&boxes) })).unwrap();
        let before = e.deck().clone();
        resize(&mut e, w, h);
        resize(&mut e, 960.0, 540.0);
        let boxed = before.slides[0].elements.iter().zip(&e.deck().slides[0].elements);
        for (a, b) in boxed.filter(|(a, _)| a.base().rect().is_some()) {
            let (a, b) = (a.base().rect().unwrap(), b.base().rect().unwrap());
            // Each step rounds to a hundredth; the second one scales that by the inverse of the first.
            let slack = 0.01 * (960.0 / w).max(540.0 / h) + 0.001;
            prop_assert!((a.0 - b.0).abs() <= slack && (a.1 - b.1).abs() <= slack);
            prop_assert!((a.2 - b.2).abs() <= slack && (a.3 - b.3).abs() <= slack);
        }
    }
}

#[test]
fn a_theme_applied_to_a_deck_of_another_size_is_fitted_to_it() {
    for (w, h) in [
        (960.0, 720.0),
        (720.0, 540.0),
        (720.0, 720.0),
        (1280.0, 720.0),
    ] {
        let mut e = engine();
        resize(&mut e, w, h);
        for name in crate::themes::all().iter().map(|t| t.name.clone()) {
            e.apply("apply_theme", json!({ "name": name })).unwrap();
            let theme = &e.deck().theme;
            assert_eq!(theme.name, name);
            for layout in &theme.layouts {
                for slot in &layout.placeholders {
                    assert!(
                        slot.x >= 0.0
                            && slot.y >= 0.0
                            && slot.x + slot.w <= w + 0.01
                            && slot.y + slot.h <= h + 0.01,
                        "{name} / {} / {} sticks out of a {w} by {h} slide: {:?}",
                        layout.name,
                        slot.role,
                        (slot.x, slot.y, slot.w, slot.h)
                    );
                }
            }
            for item in &theme.master {
                let (x, y, ew, eh) = item.base().rect().unwrap();
                assert!(
                    x >= 0.0 && y >= 0.0 && x + ew <= w + 0.01 && y + eh <= h + 0.01,
                    "{name} / {}",
                    item.id()
                );
            }
        }
    }
}

#[test]
fn applying_a_theme_on_a_16_by_9_deck_is_the_theme_as_it_is_drawn() {
    for theme in crate::themes::all() {
        let mut e = engine();
        e.apply("apply_theme", json!({ "name": theme.name }))
            .unwrap();
        assert_eq!(e.deck().theme, theme, "{}", theme.name);
    }
}

#[test]
fn a_logo_added_to_a_theme_without_one_lands_in_the_corner_of_the_slide() {
    let mut e = engine();
    resize(&mut e, 720.0, 720.0);
    e.apply("set_logo", json!({ "src": "assets/logo.png" }))
        .unwrap();
    let logo = e
        .deck()
        .theme
        .master
        .iter()
        .find(|m| m.id() == "master-logo")
        .unwrap();
    let (x, y, w, h) = logo.base().rect().unwrap();
    assert!(
        x + w <= 720.0 && y >= 0.0 && x > 400.0,
        "{:?}",
        (x, y, w, h)
    );
}

#[test]
fn a_new_deck_can_be_any_size_and_start_with_its_example_slides() {
    for (w, h) in [(960.0, 540.0), (960.0, 720.0), (720.0, 720.0)] {
        for theme in crate::themes::all() {
            let e = Engine::create_with(&NewDeck {
                title: "Quarterly review",
                theme: &theme.name,
                size: Some((w, h)),
                examples: true,
                seed: 3,
            })
            .unwrap();
            let deck = e.deck();
            assert_eq!((deck.size.w, deck.size.h), (w, h));
            let layouts: Vec<&str> = deck.slides.iter().map(|s| s.layout.as_str()).collect();
            assert_eq!(
                layouts,
                [
                    "title",
                    "section",
                    "title-body",
                    "two-columns",
                    "title-image",
                    "quote",
                    "title"
                ],
                "{}",
                theme.name
            );
            let first = deck.slides[0].elements[0].text().unwrap().plain_text();
            assert_eq!(first, "Quarterly review");
            assert!(!e.can_undo(), "a new deck has nothing to undo");
            let text = bytes(deck);
            assert_eq!(bytes(&crate::canonical::parse(&text).unwrap()), text);
        }
    }
}

#[test]
fn a_new_deck_without_examples_is_the_title_slide_alone() {
    let e = Engine::create_with(&NewDeck {
        title: "Alone",
        theme: "Bold",
        size: Some((960.0, 720.0)),
        examples: false,
        seed: 9,
    })
    .unwrap();
    assert_eq!(e.deck().slides.len(), 1);
    assert_eq!(e.deck().slides[0].layout, "title");
    let Err(Error::BadInput { message, .. }) = Engine::create_with(&NewDeck {
        title: "Tiny",
        theme: "Light",
        size: Some((20.0, 20.0)),
        examples: false,
        seed: 1,
    }) else {
        panic!("a size of 20 units is refused")
    };
    assert!(message.contains("between 96 and 5376"), "{message}");
}
