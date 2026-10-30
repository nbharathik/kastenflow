//! What a person does in the editor that no operation of its own does: these are changes to a field of
//! an element, which `patch_elements` and `add_elements` reach for an agent as for the editor. Each test
//! is one claim of the gap check, so a change that stopped them reaching a field would fail here.

use serde_json::{Value, json};

use super::table_kit::{TABLE, setup, table};
use super::{add, bytes, element, engine};
use crate::ops::Engine;

fn json_of(e: &Engine, slide: &str, id: &str) -> Value {
    serde_json::to_value(element(e, slide, id)).unwrap()
}

fn patch(e: &mut Engine, slide: &str, id: &str, patch: Value) {
    e.apply(
        "patch_elements",
        json!({ "slide": slide, "patches": [{ "id": id, "patch": patch }] }),
    )
    .unwrap_or_else(|err| panic!("patch {patch}: {err}"));
}

fn with_element(element: Value) -> (Engine, String) {
    let mut e = engine();
    let slide = add(&mut e, "title-only", json!({ "title": "T" }));
    e.apply(
        "add_elements",
        json!({ "slide": slide, "elements": [element] }),
    )
    .unwrap();
    (e, slide)
}

#[test]
fn a_picture_is_cropped_masked_described_linked_and_locked_by_patch_and_undone_in_one_step() {
    let (mut e, slide) = with_element(json!({
        "type": "image", "id": "e-pic", "x": 40, "y": 40, "w": 300, "h": 200, "src": "assets/a.png"
    }));
    let before = bytes(e.deck());
    patch(
        &mut e,
        &slide,
        "e-pic",
        json!({
            "crop": { "left": 0.1, "top": 0.0, "right": 0.2, "bottom": 0.05 },
            "mask": "ellipse",
            "alt": "A cat on a sofa",
            "link": "https://example.com/cat",
            "locked": true,
            "name": "Cat"
        }),
    );
    let pic = json_of(&e, &slide, "e-pic");
    assert_eq!(pic["crop"]["left"], 0.1);
    assert_eq!(pic["crop"]["right"], 0.2);
    assert_eq!(pic["mask"], "ellipse");
    assert_eq!(pic["alt"], "A cat on a sofa");
    assert_eq!(pic["link"], "https://example.com/cat");
    assert_eq!(pic["locked"], true);
    assert_eq!(pic["name"], "Cat");

    // The crop is taken off again the way the editor does it: null.
    patch(
        &mut e,
        &slide,
        "e-pic",
        json!({ "crop": null, "mask": null }),
    );
    let pic = json_of(&e, &slide, "e-pic");
    assert!(
        pic.get("crop").is_none() && pic.get("mask").is_none(),
        "{pic}"
    );

    e.undo().unwrap();
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn a_web_page_element_has_its_zoom_fit_window_and_reader_set_by_patch() {
    let (mut e, slide) = with_element(json!({
        "type": "embed", "id": "e-web", "x": 40, "y": 40, "w": 640, "h": 400, "url": "https://example.com"
    }));
    patch(
        &mut e,
        &slide,
        "e-web",
        json!({ "zoom": 1.5, "fit": "page", "design": { "w": 1024, "h": 768 }, "reader": true, "title": "Example" }),
    );
    let web = json_of(&e, &slide, "e-web");
    assert_eq!(web["zoom"], 1.5);
    assert_eq!(web["fit"], "page");
    assert_eq!(web["design"]["w"], 1024.0);
    assert_eq!(web["reader"], true);
    assert_eq!(web["title"], "Example");
}

#[test]
fn a_slide_can_link_to_another_slide_from_any_element() {
    let mut e = engine();
    let a = add(&mut e, "title-only", json!({ "title": "A" }));
    let b = add(&mut e, "title-only", json!({ "title": "B" }));
    e.apply(
        "add_elements",
        json!({ "slide": a, "elements": [{ "type": "shape", "id": "e-go", "shape": "rect", "x": 10, "y": 10, "w": 100, "h": 40 }] }),
    )
    .unwrap();
    patch(&mut e, &a, "e-go", json!({ "link": format!("slide:{b}") }));
    assert_eq!(json_of(&e, &a, "e-go")["link"], format!("slide:{b}"));
}

#[test]
fn a_table_gets_a_header_row_column_widths_and_row_heights_by_patch() {
    let (mut e, slide) = setup(3, 2);
    patch(
        &mut e,
        &slide,
        TABLE,
        json!({ "headerRow": true, "columns": [100.0, 200.0, 300.0] }),
    );
    let t = table(&e, &slide);
    assert!(t.header_row);
    assert_eq!(t.columns, [100.0, 200.0, 300.0]);
    let mut rows = serde_json::to_value(&t.rows).unwrap();
    rows[0]["height"] = json!(80.0);
    patch(&mut e, &slide, TABLE, json!({ "rows": rows }));
    assert_eq!(table(&e, &slide).rows[0].height, Some(80.0));
}

#[test]
fn the_deck_presents_with_a_transition_and_slide_numbers_by_set_present_and_each_slide_by_set_transition()
 {
    let mut e = engine();
    let slide = add(&mut e, "title-only", json!({}));
    e.apply(
        "set_present",
        json!({ "slideNumbers": true, "transition": { "kind": "fade", "duration": 0.4 } }),
    )
    .unwrap();
    e.apply(
        "set_transition",
        json!({ "ids": [slide], "transition": { "kind": "slide" } }),
    )
    .unwrap();
    let deck = e.deck();
    assert!(deck.present.slide_numbers);
    assert!(deck.present.transition.is_some());
    assert!(deck.slide(&slide).unwrap().transition.is_some());
}

#[test]
fn a_section_moves_with_the_slides_it_starts_at_so_there_is_no_command_to_reorder_one() {
    let mut e = engine();
    let first = e.deck().slides[0].id.clone();
    let second = add(&mut e, "title-only", json!({}));
    let third = add(&mut e, "title-only", json!({}));
    e.apply("add_section", json!({ "at": second, "title": "Middle" }))
        .unwrap();
    e.apply("move_slides", json!({ "ids": [third], "to": 1 }))
        .unwrap();
    let order: Vec<String> = e.deck().slides.iter().map(|s| s.id.clone()).collect();
    assert_eq!(order, [first, third, second.clone()]);
    // The section still names a slide of the deck, and the deck still reads back.
    assert!(
        e.deck()
            .sections
            .iter()
            .all(|s| e.deck().index_of(&s.starts_at).is_some())
    );
    let text = bytes(e.deck());
    assert!(crate::canonical::parse(&text).is_ok());
}
