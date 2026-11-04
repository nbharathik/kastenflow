//! The footer and date, the rulers, grid and guides, and swapping a picture: each is one step of
//! undo, refused changes leave the deck as it was, and what a deck did not have it still does not
//! write.

use serde_json::{Value, json};

use super::{add, bytes, element, engine, first_slide};
use crate::model::{Element, GuideAxis};
use crate::ops::Engine;

/// Applies the operation and checks that undo and redo take it back and forth byte for byte.
fn done(e: &mut Engine, op: &str, input: Value) {
    let before = bytes(e.deck());
    e.apply(op, input)
        .unwrap_or_else(|err| panic!("{op}: {err}"));
    let after = bytes(e.deck());
    assert_ne!(before, after, "{op} changed nothing");
    assert_eq!(e.undo_label(), Some(op));
    e.undo().expect("undo");
    assert_eq!(bytes(e.deck()), before, "undo of {op}");
    e.redo().expect("redo");
    assert_eq!(bytes(e.deck()), after, "redo of {op}");
}

fn refused(e: &mut Engine, op: &str, input: Value) -> String {
    let before = bytes(e.deck());
    let err = e.apply(op, input).expect_err("refused").to_string();
    assert_eq!(bytes(e.deck()), before, "{op} changed the deck");
    err
}

#[test]
fn a_new_deck_writes_no_footer_and_no_guides() {
    let text = bytes(engine().deck());
    for key in [
        "headerFooter",
        "guides",
        "\"footer\"",
        "tableStyle",
        "borders",
        "adjust",
        "maskShape",
    ] {
        assert!(!text.contains(key), "{key} in a new deck");
    }
}

#[test]
fn the_footer_and_the_date_are_the_decks_and_undo_takes_them_back() {
    let mut e = engine();
    done(
        &mut e,
        "set_header_footer",
        json!({ "footer": "Quarterly review", "date": { "format": "d MMMM yyyy" }, "hideOnTitle": true }),
    );
    let hf = e.deck().present.header_footer.clone().expect("a footer");
    assert_eq!(hf.footer.as_deref(), Some("Quarterly review"));
    assert_eq!(
        hf.date.and_then(|d| d.format).as_deref(),
        Some("d MMMM yyyy")
    );
    assert!(hf.hide_on_title);
}

#[test]
fn the_slide_number_is_the_decks_one_choice() {
    let mut e = engine();
    done(&mut e, "set_header_footer", json!({ "slideNumbers": true }));
    assert!(e.deck().present.slide_numbers);
    assert!(
        e.deck().present.header_footer.is_none(),
        "numbers alone leave no footer"
    );
}

#[test]
fn a_slide_can_have_its_own_footer_or_hide_the_decks() {
    let mut e = engine();
    e.apply("set_header_footer", json!({ "footer": "Deck" }))
        .unwrap();
    let second = add(&mut e, "title-body", json!({ "title": "Two" }));
    done(
        &mut e,
        "set_header_footer",
        json!({ "slides": [second], "footer": "Mine" }),
    );
    let own = e.deck().slide(&second).unwrap().footer.clone().unwrap();
    assert_eq!(own.footer.as_deref(), Some("Mine"));
    e.apply(
        "set_header_footer",
        json!({ "slides": [second], "hidden": true }),
    )
    .unwrap();
    assert!(
        e.deck()
            .slide(&second)
            .unwrap()
            .footer
            .as_ref()
            .unwrap()
            .hidden
    );
    e.apply(
        "set_header_footer",
        json!({ "slides": [second], "reset": true }),
    )
    .unwrap();
    assert!(
        e.deck().slide(&second).unwrap().footer.is_none(),
        "back to the deck's"
    );
}

#[test]
fn setting_the_decks_footer_forgets_the_footers_slides_set_for_themselves() {
    let mut e = engine();
    let first = first_slide(&e);
    e.apply(
        "set_header_footer",
        json!({ "slides": [first], "footer": "Mine" }),
    )
    .unwrap();
    done(&mut e, "set_header_footer", json!({ "footer": "Everyone" }));
    assert!(e.deck().slide(&first).unwrap().footer.is_none());
    // Turning the title rule on is not "apply to all": own footers stay.
    e.apply(
        "set_header_footer",
        json!({ "slides": [first], "footer": "Mine" }),
    )
    .unwrap();
    e.apply("set_header_footer", json!({ "hideOnTitle": true }))
        .unwrap();
    assert!(e.deck().slide(&first).unwrap().footer.is_some());
}

#[test]
fn the_footer_asks_are_checked() {
    let mut e = engine();
    let long = "x".repeat(300);
    assert!(refused(&mut e, "set_header_footer", json!({ "footer": long })).contains("footer"));
    let both = json!({ "date": { "text": "Monday", "format": "d" } });
    assert!(refused(&mut e, "set_header_footer", both).contains("not both"));
    let first = first_slide(&e);
    let rule = json!({ "slides": [first], "hideOnTitle": true });
    assert!(refused(&mut e, "set_header_footer", rule).contains("deck"));
    assert!(
        refused(
            &mut e,
            "set_header_footer",
            json!({ "slides": ["nope"], "footer": "x" })
        )
        .contains("nope")
    );
}

#[test]
fn guides_and_the_grid_are_saved_with_the_deck_one_step_each() {
    let mut e = engine();
    done(&mut e, "set_guides", json!({ "rulers": true }));
    done(
        &mut e,
        "set_guides",
        json!({ "grid": 48, "showGrid": true }),
    );
    done(
        &mut e,
        "set_guides",
        json!({ "lines": [{ "axis": "vertical", "at": 120.5 }, { "axis": "horizontal", "at": 80 }] }),
    );
    let guides = e.deck().present.guides.clone().unwrap();
    assert!(guides.rulers && guides.show_grid);
    assert_eq!(guides.grid, Some(48.0));
    assert_eq!(guides.lines.len(), 2);
    assert_eq!(guides.lines[0].axis, GuideAxis::Vertical);
}

#[test]
fn taking_everything_away_leaves_no_guides_in_the_file() {
    let mut e = engine();
    e.apply(
        "set_guides",
        json!({ "rulers": true, "grid": 24, "lines": [{ "axis": "vertical", "at": 10 }] }),
    )
    .unwrap();
    e.apply(
        "set_guides",
        json!({ "rulers": false, "grid": 0, "lines": [] }),
    )
    .unwrap();
    assert!(e.deck().present.guides.is_none());
    assert!(!bytes(e.deck()).contains("guides"));
}

#[test]
fn a_grid_or_guide_out_of_range_is_refused() {
    let mut e = engine();
    assert!(refused(&mut e, "set_guides", json!({ "grid": 1 })).contains("grid"));
    assert!(
        refused(
            &mut e,
            "set_guides",
            json!({ "lines": [{ "axis": "vertical", "at": 1e9 }] })
        )
        .contains("guide")
    );
}

fn picture(e: &mut Engine, slide: &str) -> String {
    let image = json!({
        "type": "image", "x": 40, "y": 40, "w": 300, "h": 200, "src": "assets/one.png",
        "crop": { "left": 0.1, "top": 0, "right": 0.2, "bottom": 0 }, "mask": "ellipse", "alt": "A chart",
        "style": { "adjust": { "brightness": 0.2, "greyscale": true }, "maskShape": "star5", "opacity": 0.8 },
    });
    let out = e
        .apply(
            "add_elements",
            json!({ "slide": slide, "elements": [image] }),
        )
        .unwrap();
    out.output["ids"][0].as_str().unwrap().to_owned()
}

#[test]
fn replacing_a_picture_changes_only_its_file() {
    let mut e = engine();
    let slide = first_slide(&e);
    let id = picture(&mut e, &slide);
    let before = element(&e, &slide, &id).clone();
    done(
        &mut e,
        "replace_picture",
        json!({ "slide": slide, "id": id, "src": "assets/two.png" }),
    );
    let (Element::Image(was), Element::Image(now)) = (&before, element(&e, &slide, &id)) else {
        panic!("pictures");
    };
    assert_eq!(now.src, "assets/two.png");
    let mut same = now.clone();
    same.src = was.src.clone();
    assert_eq!(&same, was, "box, crop, mask, adjustments and alt are kept");
}

#[test]
fn only_a_picture_has_its_picture_replaced() {
    let mut e = engine();
    let slide = first_slide(&e);
    let title = e.deck().slides[0].elements[0].id().to_owned();
    let said = refused(
        &mut e,
        "replace_picture",
        json!({ "slide": slide, "id": title, "src": "assets/x.png" }),
    );
    assert!(said.contains("not a picture"), "{said}");
    let id = picture(&mut e, &slide);
    assert!(
        refused(
            &mut e,
            "replace_picture",
            json!({ "slide": slide, "id": id, "src": " " })
        )
        .contains("src")
    );
}

#[test]
fn adjustments_and_mask_shapes_are_checked_when_an_element_is_changed() {
    let mut e = engine();
    let slide = first_slide(&e);
    let id = picture(&mut e, &slide);
    let patch = |style: Value| json!({ "slide": slide, "patches": [{ "id": id, "patch": { "style": style } }] });
    let loud = refused(
        &mut e,
        "patch_elements",
        patch(json!({ "adjust": { "contrast": 4 } })),
    );
    assert!(loud.contains("contrast"), "{loud}");
    let odd = refused(
        &mut e,
        "patch_elements",
        patch(json!({ "maskShape": "not a shape" })),
    );
    assert!(odd.contains("shape name"), "{odd}");
}
