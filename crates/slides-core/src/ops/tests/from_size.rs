//! Slides and layouts that come from a deck of another page size are refitted to this deck's, the
//! way a change of page size refits a deck, and are left alone when the sizes are the same.

use serde_json::json;

use super::{add, bytes, engine};
use crate::error::Error;
use crate::model::{Element, Slide};
use crate::ops::Engine;

/// A slide with a text box of 40 point type at (100, 100) of 400 by 200, made for a 1920 by 1080 deck.
fn big_slide() -> Slide {
    let mut other = Engine::create("Other", "Light", 5).unwrap_or_else(|e| panic!("{e}"));
    let slide = add(&mut other, "blank", json!({}));
    let text = json!({ "type": "text", "id": "e-big", "x": 100, "y": 100, "w": 400, "h": 200,
        "text": { "paragraphs": [{ "runs": [{ "t": "big", "size": 40 }] }] } });
    other
        .apply(
            "add_elements",
            json!({ "slide": slide, "elements": [text] }),
        )
        .unwrap_or_else(|e| panic!("{e}"));
    other
        .deck()
        .slide(&slide)
        .cloned()
        .unwrap_or_else(|| panic!("the slide"))
}

fn the_text(e: &Engine, slide: &str) -> (f64, f64, f64, f64, f64) {
    let Some(Element::Text(t)) = e.deck().slide(slide).and_then(|s| s.elements.first()) else {
        panic!("a text box")
    };
    let (x, y, w, h) = t.base.rect().unwrap_or_default();
    let size = t.text.paragraphs[0].runs[0].size.unwrap_or_default();
    (x, y, w, h, size)
}

#[test]
fn pasted_slides_are_refitted_from_the_size_they_were_made_for() {
    let mut e = engine();
    let out = e
        .apply(
            "add_slides",
            json!({ "slides": [big_slide()], "fromSize": { "w": 1920, "h": 1080 } }),
        )
        .unwrap_or_else(|err| panic!("{err}"));
    let id = out.output["slides"][0]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    // Half the width and half the height: the box halves, and the type follows the width.
    assert_eq!(the_text(&e, &id), (50.0, 50.0, 200.0, 100.0, 20.0));
    // Another shape: 4:3 into 16:9 stretches the boxes with the slide and keeps the type's size.
    let out = e
        .apply(
            "add_slides",
            json!({ "slides": [big_slide()], "fromSize": { "w": 960, "h": 720 } }),
        )
        .unwrap_or_else(|err| panic!("{err}"));
    let id = out.output["slides"][0]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    assert_eq!(the_text(&e, &id), (100.0, 75.0, 400.0, 150.0, 40.0));
    e.undo().unwrap_or_else(|| panic!("undo"));
    e.undo().unwrap_or_else(|| panic!("undo"));
    assert_eq!(e.deck().slides.len(), 1);
}

#[test]
fn slides_from_a_deck_of_the_same_size_or_of_none_given_are_not_touched() {
    let mut e = engine();
    for body in [
        json!({ "slides": [big_slide()] }),
        json!({ "slides": [big_slide()], "fromSize": { "w": 960, "h": 540 } }),
    ] {
        let out = e
            .apply("add_slides", body)
            .unwrap_or_else(|err| panic!("{err}"));
        let id = out.output["slides"][0]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        assert_eq!(the_text(&e, &id), (100.0, 100.0, 400.0, 200.0, 40.0));
    }
}

#[test]
fn a_size_that_is_not_a_slide_size_is_refused_and_nothing_is_added() {
    let mut e = engine();
    let before = bytes(e.deck());
    for from in [
        json!({ "w": 0, "h": 540 }),
        json!({ "w": 960, "h": 100000 }),
        json!({ "w": 10, "h": 10 }),
    ] {
        let err = e
            .apply(
                "add_slides",
                json!({ "slides": [big_slide()], "fromSize": from }),
            )
            .expect_err("not a slide size");
        assert!(matches!(err, Error::BadInput { .. }), "{err}");
        assert!(err.to_string().contains("fromSize"), "{err}");
        let err = e
            .apply(
                "import_layouts",
                json!({ "layouts": [e.deck().theme.layouts[0].clone()], "fromSize": from }),
            )
            .expect_err("not a slide size");
        assert!(err.to_string().contains("fromSize"), "{err}");
    }
    assert_eq!(bytes(e.deck()), before);
    assert!(!e.can_undo());
}

#[test]
fn imported_layouts_and_the_text_styles_they_bring_are_refitted_too() {
    let mut e = engine();
    let mut layout = e
        .deck()
        .theme
        .layouts
        .iter()
        .find(|l| l.name == "title-body")
        .cloned()
        .unwrap_or_else(|| panic!("a layout"));
    let slot = layout.placeholders[0].clone();
    layout.placeholders[0].style = Some("poster".to_owned());
    let mut look = e.deck().theme.text_styles["title"].clone();
    look.size = 44.0;
    let out = e
        .apply(
            "import_layouts",
            json!({ "layouts": [layout], "textStyles": { "poster": look }, "fromSize": { "w": 1920, "h": 1080 } }),
        )
        .unwrap_or_else(|err| panic!("{err}"));
    let name = out.output["added"][0]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let theme = &e.deck().theme;
    let brought = theme
        .layout(&name)
        .unwrap_or_else(|| panic!("the layout is there"));
    let half = |v: f64| (v * 50.0).round() / 100.0;
    let first = &brought.placeholders[0];
    assert_eq!(
        (first.x, first.y, first.w, first.h),
        (half(slot.x), half(slot.y), half(slot.w), half(slot.h))
    );
    assert_eq!(
        theme.text_styles["poster"].size, 22.0,
        "44 points on a slide twice as wide"
    );
    // The same size changes nothing.
    let before = bytes(e.deck());
    e.apply(
        "import_layouts",
        json!({ "layouts": [theme.layouts[0].clone()], "fromSize": { "w": 960, "h": 540 } }),
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let added = e
        .deck()
        .theme
        .layouts
        .last()
        .cloned()
        .unwrap_or_else(|| panic!("a layout"));
    assert_eq!(added.placeholders, e.deck().theme.layouts[0].placeholders);
    e.undo().unwrap_or_else(|| panic!("undo"));
    assert_eq!(bytes(e.deck()), before);
}
