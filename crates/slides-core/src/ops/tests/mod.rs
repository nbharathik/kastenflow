//! Tests of the operations, one behaviour each; `undo.rs` checks that every
//! operation can be taken back exactly.

mod align_one;
mod citations;
mod collapse;
mod composite_deck;
mod composites;
mod connectors;
mod empty_slots;
mod export;
mod fixtures;
mod fixtures_v1;
mod format_two;
mod from_size;
mod incoming;
mod inside_groups;
mod joined;
mod layouts;
mod page_size;
mod pages;
mod paragraphs;
mod present;
mod sections;
mod steps;
mod steps_build;
mod steps_content;
mod steps_kit;
mod steps_order;
mod steps_turns;
mod storyboard;
mod table_kinds;
mod table_kit;
mod table_lines;
mod table_ops;
mod tables;
mod templates;
mod transition;
mod undo;
mod unknown;

use serde_json::{Value, json};

use crate::canonical;
use crate::error::Error;
use crate::model::{Deck, Element};
use crate::ops::Engine;

pub(crate) fn engine() -> Engine {
    Engine::create("Test deck", "Light", 1).unwrap()
}

pub(crate) fn first_slide(e: &Engine) -> String {
    e.deck().slides[0].id.clone()
}

/// Adds a slide and returns its id.
pub(crate) fn add(e: &mut Engine, layout: &str, content: Value) -> String {
    let out = e
        .apply("add_slide", json!({ "layout": layout, "content": content }))
        .unwrap();
    out.output["slide"].as_str().unwrap().to_owned()
}

/// Adds a text box and returns its id.
pub(crate) fn text_box(
    e: &mut Engine,
    slide: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    words: &str,
) -> String {
    let element = json!({ "type": "text", "x": x, "y": y, "w": w, "h": h, "text": { "paragraphs": [{ "runs": [{ "t": words }] }] } });
    let out = e
        .apply(
            "add_elements",
            json!({ "slide": slide, "elements": [element] }),
        )
        .unwrap();
    out.output["ids"][0].as_str().unwrap().to_owned()
}

pub(crate) fn element<'a>(e: &'a Engine, slide: &str, id: &str) -> &'a Element {
    e.deck().slide(slide).unwrap().element(id).unwrap()
}

pub(crate) fn bytes(deck: &Deck) -> String {
    canonical::write(deck).unwrap()
}

#[test]
fn a_new_deck_has_a_title_slide_that_reads_back_unchanged() {
    let e = engine();
    assert_eq!(e.deck().slides.len(), 1);
    let text = bytes(e.deck());
    assert_eq!(bytes(&canonical::parse(&text).unwrap()), text);
    assert!(text.ends_with("}\n"));
}

#[test]
fn add_slide_fills_slots_and_undo_and_redo_take_it_away_and_back() {
    let mut e = engine();
    let before = bytes(e.deck());
    let out = e.apply("add_slide", json!({ "layout": "title-body", "content": { "title": "Results", "body": "- one\n- two" } })).unwrap();
    let id = out.output["slide"].as_str().unwrap().to_owned();
    let slide = e.deck().slide(&id).unwrap();
    assert_eq!(slide.layout, "title-body");
    let body = slide
        .elements
        .iter()
        .find(|x| x.base().placeholder.as_deref() == Some("body"))
        .unwrap();
    assert_eq!(body.text().unwrap().plain_text(), "one\ntwo");
    assert_eq!(
        body.text().unwrap().paragraphs[0].list,
        Some(crate::model::ListKind::Bullet)
    );
    assert!(out.changes.slides.get(&id).is_some_and(Option::is_some));
    assert_eq!(out.changes.order.as_ref().map(Vec::len), Some(2));

    let after = bytes(e.deck());
    let undone = e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
    assert_eq!(undone.slides.get(&id), Some(&None));
    e.redo().unwrap();
    assert_eq!(bytes(e.deck()), after);
    assert!(!e.can_redo() && e.can_undo());
}

#[test]
fn an_unknown_layout_or_slot_says_what_exists() {
    let mut e = engine();
    let Error::BadInput { message, .. } = e
        .apply("add_slide", json!({ "layout": "nope" }))
        .unwrap_err()
    else {
        panic!("bad input")
    };
    assert!(message.contains("title-body"), "{message}");
    let Error::BadInput { message, .. } = e
        .apply(
            "add_slide",
            json!({ "layout": "title-only", "content": { "body": "x" } }),
        )
        .unwrap_err()
    else {
        panic!("bad input")
    };
    assert!(message.contains("title"), "{message}");
    assert_eq!(
        e.deck().slides.len(),
        1,
        "a refused operation changes nothing"
    );
    assert!(!e.can_undo());
}

#[test]
fn an_unknown_operation_and_bad_input_are_errors_that_change_nothing() {
    let mut e = engine();
    assert!(matches!(
        e.apply("frobnicate", json!({})),
        Err(Error::UnknownOp { .. })
    ));
    assert!(matches!(
        e.apply("set_title", json!({ "title": 5 })),
        Err(Error::BadInput { .. })
    ));
    assert!(!e.can_undo());
}

#[test]
fn slides_can_be_duplicated_moved_flagged_and_deleted() {
    let mut e = engine();
    let a = first_slide(&e);
    let b = add(&mut e, "title-only", json!({ "title": "B" }));
    let c = add(&mut e, "title-only", json!({ "title": "C" }));
    let copies = e
        .apply("duplicate_slides", json!({ "ids": [a] }))
        .unwrap()
        .output["slides"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(e.deck().slides.len(), 4);
    assert_eq!(e.deck().slides[1].id, copies[0].as_str().unwrap());
    assert_eq!(
        e.deck().slides[1].elements[0].id(),
        e.deck().slides[0].elements[0].id(),
        "a copy keeps element ids, so it can Morph"
    );

    e.apply("move_slides", json!({ "ids": [c], "to": 0 }))
        .unwrap();
    assert_eq!(e.deck().slides[0].id, c);
    e.apply(
        "set_slide_flags",
        json!({ "ids": [b], "hidden": true, "backup": true }),
    )
    .unwrap();
    assert!(e.deck().slide(&b).unwrap().hidden && e.deck().slide(&b).unwrap().backup);
    assert!(matches!(
        e.apply("set_slide_flags", json!({ "ids": [c], "backup": true })),
        Err(Error::Refused { .. })
    ));

    e.apply("delete_slides", json!({ "ids": [c] })).unwrap();
    assert!(
        !e.deck().slides[0].backup,
        "the first slide is never a backup"
    );
    let all: Vec<String> = e.deck().slides.iter().map(|s| s.id.clone()).collect();
    assert!(
        matches!(
            e.apply("delete_slides", json!({ "ids": all })),
            Err(Error::Refused { .. })
        ),
        "a deck keeps a slide"
    );
}

#[test]
fn deleting_a_slide_moves_or_drops_the_section_that_began_there() {
    let mut e = engine();
    let a = first_slide(&e);
    let b = add(&mut e, "title-only", json!({}));
    let c = add(&mut e, "title-only", json!({}));
    e.apply("add_elements", json!({ "slide": a, "elements": [] }))
        .unwrap();
    let d = e.deck();
    assert_eq!(d.slides.len(), 3);
    // Sections are set by editing the deck's meta; do it through the engine's deck via a duplicate of the deck.
    let mut deck = e.deck().clone();
    deck.sections = vec![crate::model::Section {
        title: "Two".into(),
        starts_at: b.clone(),
        extra: crate::model::Extra::new(),
    }];
    let mut e = Engine::new(deck, 5);
    e.apply("delete_slides", json!({ "ids": [b] })).unwrap();
    assert_eq!(e.deck().sections[0].starts_at, c);
    e.apply("delete_slides", json!({ "ids": [c] })).unwrap();
    assert!(e.deck().sections.is_empty());
}

#[test]
fn set_layout_moves_content_to_slots_and_keeps_what_has_none() {
    let mut e = engine();
    let s = add(
        &mut e,
        "title-body",
        json!({ "title": "T", "body": "kept" }),
    );
    let out = e
        .apply("set_layout", json!({ "slide": s, "layout": "title-only" }))
        .unwrap();
    let detached = out.output["detached"].as_array().unwrap();
    assert_eq!(detached.len(), 1, "the body has no slot on title-only");
    let slide = e.deck().slide(&s).unwrap();
    assert_eq!(slide.layout, "title-only");
    let body = slide.element(detached[0].as_str().unwrap()).unwrap();
    assert!(
        body.base().placeholder.is_none() && body.base().rect().is_some(),
        "it stays where it was, as a plain element"
    );
    assert_eq!(body.text().unwrap().plain_text(), "kept");
    // Back again: the body slot returns, empty, and nothing was lost.
    let out = e
        .apply("set_layout", json!({ "slide": s, "layout": "title-body" }))
        .unwrap();
    assert_eq!(out.output["added"].as_array().unwrap().len(), 1);
    assert_eq!(e.deck().slide(&s).unwrap().elements.len(), 3);
}

#[test]
fn elements_are_added_patched_moved_and_deleted() {
    let mut e = engine();
    let s = first_slide(&e);
    let t = text_box(&mut e, &s, 100.0, 100.0, 200.0, 50.0, "hello");
    assert!(matches!(e.apply("add_elements", json!({ "slide": s, "elements": [{ "type": "text", "text": { "paragraphs": [] } }] })), Err(Error::BadInput { .. })), "no position");
    e.apply("patch_elements", json!({ "slide": s, "patches": [{ "id": t, "patch": { "name": "Greeting", "style": { "fill": { "color": "accent2", "alpha": 0.2 } } } }] })).unwrap();
    assert_eq!(element(&e, &s, &t).base().name.as_deref(), Some("Greeting"));
    assert!(matches!(e.apply("patch_elements", json!({ "slide": s, "patches": [{ "id": t, "patch": { "style": { "fill": { "color": "not-a-colour" } } } }] })), Err(Error::BadInput { .. })));
    assert!(matches!(
        e.apply(
            "patch_elements",
            json!({ "slide": s, "patches": [{ "id": t, "patch": { "type": "shape" } }] })
        ),
        Err(Error::BadInput { .. })
    ));

    e.apply("transform_elements", json!({ "slide": s, "items": [{ "id": t, "x": 10.5, "y": 20.0, "w": 300.0, "rotation": 15.0 }] })).unwrap();
    let b = element(&e, &s, &t).base();
    assert_eq!(
        (b.x, b.y, b.w, b.h, b.rotation),
        (Some(10.5), Some(20.0), Some(300.0), Some(50.0), Some(15.0))
    );

    e.apply("delete_elements", json!({ "slide": s, "ids": [t] }))
        .unwrap();
    assert!(e.deck().slide(&s).unwrap().element(&t).is_none());
    assert!(matches!(
        e.apply("delete_elements", json!({ "slide": s, "ids": [t] })),
        Err(Error::NoSuchElement { .. })
    ));
}

#[test]
fn moving_a_placeholder_pins_its_box_and_a_connector_follows() {
    let mut e = engine();
    let s = add(&mut e, "title-only", json!({ "title": "T" }));
    let title = e.deck().slide(&s).unwrap().elements[0].id().to_owned();
    let other = text_box(&mut e, &s, 600.0, 300.0, 100.0, 40.0, "b");
    let line = json!({ "type": "connector", "route": "straight", "x": 0, "y": 0, "w": 1, "h": 1, "from": { "el": title, "side": "bottom" }, "to": { "el": other, "side": "left" } });
    let k = e
        .apply("add_elements", json!({ "slide": s, "elements": [line] }))
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let (x0, y0) = {
        let b = element(&e, &s, &k).base();
        (b.x.unwrap(), b.y.unwrap())
    };
    e.apply(
        "transform_elements",
        json!({ "slide": s, "items": [{ "id": other, "y": 400.0 }] }),
    )
    .unwrap();
    let b = element(&e, &s, &k).base();
    assert_eq!(b.x, Some(x0));
    assert!(
        b.h.unwrap() > 0.0 && b.y == Some(y0),
        "the line now runs down to the moved box"
    );
}

#[test]
fn grouping_moves_and_scales_children_together_and_ungrouping_frees_them() {
    let mut e = engine();
    let s = first_slide(&e);
    let a = text_box(&mut e, &s, 0.0, 0.0, 100.0, 50.0, "a");
    let b = text_box(&mut e, &s, 100.0, 50.0, 100.0, 50.0, "b");
    let g = e
        .apply("group_elements", json!({ "slide": s, "ids": [a, b] }))
        .unwrap()
        .output["group"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        element(&e, &s, &g).base().rect(),
        Some((0.0, 0.0, 200.0, 100.0))
    );
    e.apply(
        "transform_elements",
        json!({ "slide": s, "items": [{ "id": g, "x": 10.0, "y": 10.0, "w": 400.0 }] }),
    )
    .unwrap();
    assert_eq!(
        element(&e, &s, &a).base().rect(),
        Some((10.0, 10.0, 200.0, 50.0))
    );
    assert_eq!(
        element(&e, &s, &b).base().rect(),
        Some((210.0, 60.0, 200.0, 50.0))
    );
    assert!(matches!(
        e.apply("group_elements", json!({ "slide": s, "ids": [a] })),
        Err(Error::BadInput { .. })
    ));
    let freed = e
        .apply("ungroup_element", json!({ "slide": s, "id": g }))
        .unwrap()
        .output["ids"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(freed, 2);
    assert!(e.deck().slide(&s).unwrap().element(&g).is_none());
}

#[test]
fn duplicate_and_paste_make_fresh_ids_and_stay_valid() {
    let mut e = engine();
    let s = first_slide(&e);
    let a = text_box(&mut e, &s, 0.0, 0.0, 100.0, 50.0, "a");
    let dup = e
        .apply("duplicate_elements", json!({ "slide": s, "ids": [a] }))
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(dup, a);
    assert_eq!(
        element(&e, &s, &dup).base().rect(),
        Some((12.0, 12.0, 100.0, 50.0))
    );
    let copy = serde_json::to_value(element(&e, &s, &a)).unwrap();
    let other = add(&mut e, "blank", json!({}));
    let pasted = e
        .apply(
            "paste_elements",
            json!({ "slide": other, "elements": [copy], "keepIds": true }),
        )
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(pasted, a, "a free id is kept so a paste can join a Morph");
    canonical::check_structure(e.deck()).unwrap();
}

#[test]
fn align_and_distribute_use_the_selection_or_the_slide() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let a = text_box(&mut e, &s, 10.0, 10.0, 100.0, 20.0, "a");
    let b = text_box(&mut e, &s, 300.0, 50.0, 50.0, 20.0, "b");
    let c = text_box(&mut e, &s, 200.0, 90.0, 100.0, 20.0, "c");
    e.apply(
        "align_elements",
        json!({ "slide": s, "ids": [a, b, c], "mode": "left" }),
    )
    .unwrap();
    assert!(
        [&a, &b, &c]
            .iter()
            .all(|id| element(&e, &s, id).base().x == Some(10.0))
    );
    e.apply(
        "align_elements",
        json!({ "slide": s, "ids": [a], "mode": "centerH" }),
    )
    .unwrap();
    assert_eq!(
        element(&e, &s, &a).base().x,
        Some(430.0),
        "a lone element aligns to the 960 wide slide"
    );

    let d = text_box(&mut e, &s, 0.0, 0.0, 10.0, 10.0, "d");
    let f = text_box(&mut e, &s, 100.0, 0.0, 10.0, 10.0, "f");
    let g = text_box(&mut e, &s, 400.0, 0.0, 10.0, 10.0, "g");
    e.apply(
        "distribute_elements",
        json!({ "slide": s, "ids": [d, f, g], "axis": "horizontal" }),
    )
    .unwrap();
    assert_eq!(element(&e, &s, &f).base().x, Some(200.0));
    assert!(matches!(
        e.apply(
            "distribute_elements",
            json!({ "slide": s, "ids": [d, f], "axis": "horizontal" })
        ),
        Err(Error::BadInput { .. })
    ));
}

#[test]
fn reordering_changes_the_stacking_order() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let ids: Vec<String> = (0..4)
        .map(|i| text_box(&mut e, &s, i as f64 * 10.0, 0.0, 5.0, 5.0, "x"))
        .collect();
    let order = |e: &Engine| {
        e.deck()
            .slide(&s)
            .unwrap()
            .elements
            .iter()
            .map(|x| x.id().to_owned())
            .collect::<Vec<_>>()
    };
    e.apply(
        "reorder_elements",
        json!({ "slide": s, "ids": [ids[0]], "to": "front" }),
    )
    .unwrap();
    assert_eq!(
        order(&e),
        vec![
            ids[1].clone(),
            ids[2].clone(),
            ids[3].clone(),
            ids[0].clone()
        ]
    );
    e.apply(
        "reorder_elements",
        json!({ "slide": s, "ids": [ids[3]], "to": "backward" }),
    )
    .unwrap();
    assert_eq!(
        order(&e),
        vec![
            ids[1].clone(),
            ids[3].clone(),
            ids[2].clone(),
            ids[0].clone()
        ]
    );
    e.apply(
        "reorder_elements",
        json!({ "slide": s, "ids": [ids[3], ids[2]], "to": "back" }),
    )
    .unwrap();
    assert_eq!(order(&e)[..2], [ids[3].clone(), ids[2].clone()]);
}

#[test]
fn set_text_and_replace_all_change_the_words() {
    let mut e = engine();
    let s = add(
        &mut e,
        "title-body",
        json!({ "title": "Cats", "body": "cat one" }),
    );
    let title = e.deck().slide(&s).unwrap().elements[0].id().to_owned();
    e.apply(
        "set_text",
        json!({ "slide": s, "id": title, "markdown": "**Big** cats" }),
    )
    .unwrap();
    let t = element(&e, &s, &title).text().unwrap();
    assert!(t.paragraphs[0].runs[0].bold && t.plain_text() == "Big cats");
    e.apply("set_notes", json!({ "slide": s, "notes": "Say cat twice" }))
        .unwrap();
    let n = e
        .apply("replace_all", json!({ "find": "cat", "replace": "dog" }))
        .unwrap()
        .output["count"]
        .as_u64()
        .unwrap();
    assert_eq!(n, 3, "the title, the body and the notes");
    assert_eq!(e.deck().slide(&s).unwrap().notes, "Say dog twice");
    assert!(matches!(
        e.apply(
            "set_text",
            json!({ "slide": s, "id": "nope", "markdown": "x" })
        ),
        Err(Error::NoSuchElement { .. })
    ));
}

#[test]
fn themes_can_be_applied_and_edited() {
    let mut e = engine();
    e.apply(
        "edit_theme",
        json!({ "patch": { "colors": { "accent1": "#0b5cad" } } }),
    )
    .unwrap();
    assert_eq!(e.deck().theme.colors.accent1, "#0b5cad");
    assert!(matches!(
        e.apply(
            "edit_theme",
            json!({ "patch": { "colors": { "accent1": "blue" } } })
        ),
        Err(Error::BadInput { .. })
    ));
    e.apply("set_logo", json!({ "src": "assets/logo.png" }))
        .unwrap();
    e.apply("apply_theme", json!({ "name": "Dark" })).unwrap();
    assert_eq!(e.deck().theme.name, "Dark");
    assert!(
        e.deck()
            .theme
            .master
            .iter()
            .any(|m| matches!(m, Element::Image(i) if i.src == "assets/logo.png")),
        "the logo carries over"
    );
    assert!(matches!(
        e.apply("apply_theme", json!({ "name": "Neon" })),
        Err(Error::BadInput { .. })
    ));
    e.undo().unwrap();
    e.undo().unwrap();
    assert_eq!(e.deck().theme.colors.accent1, "#0b5cad");
}

#[test]
fn a_batch_is_one_step_and_all_or_nothing() {
    let mut e = engine();
    let before = bytes(e.deck());
    let s = first_slide(&e);
    let ops = vec![
        ("set_title".to_owned(), json!({ "title": "New" })),
        ("set_notes".to_owned(), json!({ "slide": s, "notes": "n" })),
    ];
    e.apply_batch(ops).unwrap();
    assert_eq!(e.deck().title, "New");
    e.undo().unwrap();
    assert_eq!(
        bytes(e.deck()),
        before,
        "one undo takes the whole batch back"
    );
    assert!(!e.can_undo());

    let bad = vec![
        ("set_title".to_owned(), json!({ "title": "X" })),
        (
            "set_notes".to_owned(),
            json!({ "slide": "nope", "notes": "n" }),
        ),
    ];
    assert!(e.apply_batch(bad).is_err());
    assert_eq!(
        bytes(e.deck()),
        before,
        "a failing step undoes the ones before it"
    );
    assert!(!e.can_undo());
}

#[test]
fn the_registry_lists_every_operation_with_schemas() {
    let specs = crate::ops::specs();
    assert!(specs.len() >= 26);
    assert!(
        specs
            .iter()
            .all(|s| !s.about.is_empty() && s.input.is_object())
    );
    assert_eq!(
        specs.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        crate::ops::names()
    );
    let mut names = crate::ops::names();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), specs.len(), "names are unique");
}
