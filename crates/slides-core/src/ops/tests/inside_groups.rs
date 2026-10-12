//! Changing an element inside a group: the group's box follows what it holds.

use serde_json::json;

use super::{add, bytes, element, engine, text_box};
use crate::model::Element;
use crate::ops::Engine;

/// A slide with a group of two text boxes and a third box beside it.
fn grouped() -> (Engine, String, [String; 3], String) {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let a = text_box(&mut e, &s, 100.0, 100.0, 100.0, 50.0, "a");
    let b = text_box(&mut e, &s, 300.0, 200.0, 100.0, 50.0, "b");
    let c = text_box(&mut e, &s, 500.0, 300.0, 100.0, 50.0, "c");
    let out = e
        .apply(
            "group_elements",
            json!({ "slide": s, "ids": [a.clone(), b.clone()] }),
        )
        .unwrap();
    let group = out.output["group"].as_str().unwrap().to_owned();
    (e, s, [a, b, c], group)
}

fn rect_of(e: &Engine, slide: &str, id: &str) -> (f64, f64, f64, f64) {
    element(e, slide, id).base().rect().unwrap()
}

#[test]
fn moving_a_child_refits_the_group_that_holds_it() {
    let (mut e, s, [a, b, _], group) = grouped();
    assert_eq!(rect_of(&e, &s, &group), (100.0, 100.0, 300.0, 150.0));
    let before = bytes(e.deck());
    e.apply(
        "transform_elements",
        json!({ "slide": s, "items": [{ "id": b, "x": 600, "y": 400 }] }),
    )
    .unwrap();
    assert_eq!(rect_of(&e, &s, &group), (100.0, 100.0, 600.0, 350.0));
    assert_eq!(
        rect_of(&e, &s, &a),
        (100.0, 100.0, 100.0, 50.0),
        "the other child stays"
    );
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn resizing_a_child_inside_a_group_inside_a_group_refits_every_group_above_it() {
    let (mut e, s, [a, b, c], group) = grouped();
    let outer = e
        .apply(
            "group_elements",
            json!({ "slide": s, "ids": [group.clone(), c.clone()] }),
        )
        .unwrap()
        .output["group"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(rect_of(&e, &s, &outer), (100.0, 100.0, 500.0, 250.0));
    e.apply(
        "transform_elements",
        json!({ "slide": s, "items": [{ "id": a, "x": 20, "w": 40 }] }),
    )
    .unwrap();
    assert_eq!(rect_of(&e, &s, &group), (20.0, 100.0, 380.0, 150.0));
    assert_eq!(rect_of(&e, &s, &outer), (20.0, 100.0, 580.0, 250.0));
    assert_eq!(rect_of(&e, &s, &b), (300.0, 200.0, 100.0, 50.0));
}

#[test]
fn deleting_a_child_shrinks_the_group_and_deleting_the_last_one_takes_it_away() {
    let (mut e, s, [a, b, _], group) = grouped();
    e.apply("delete_elements", json!({ "slide": s, "ids": [b] }))
        .unwrap();
    assert_eq!(rect_of(&e, &s, &group), (100.0, 100.0, 100.0, 50.0));
    e.apply("delete_elements", json!({ "slide": s, "ids": [a] }))
        .unwrap();
    assert!(e.deck().slide(&s).unwrap().element(&group).is_none());
}

#[test]
fn aligning_children_to_each_other_refits_their_group() {
    let (mut e, s, [a, b, _], group) = grouped();
    e.apply(
        "align_elements",
        json!({ "slide": s, "ids": [a, b.clone()], "mode": "left" }),
    )
    .unwrap();
    assert_eq!(rect_of(&e, &s, &b).0, 100.0);
    assert_eq!(rect_of(&e, &s, &group), (100.0, 100.0, 100.0, 150.0));
}

#[test]
fn a_patch_that_moves_a_child_refits_the_group_but_one_that_does_not_leaves_it_alone() {
    let (mut e, s, [_, b, _], group) = grouped();
    let before = rect_of(&e, &s, &group);
    e.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": b.clone(), "patch": { "name": "Second" } }] }),
    )
    .unwrap();
    assert_eq!(rect_of(&e, &s, &group), before);
    e.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": b, "patch": { "x": 700 } }] }),
    )
    .unwrap();
    assert_eq!(rect_of(&e, &s, &group), (100.0, 100.0, 700.0, 150.0));
}

#[test]
fn a_group_whose_box_is_not_the_union_is_left_as_it_is_until_something_inside_it_moves() {
    let (e, s, [a, _, _], group) = grouped();
    // An imported group may have a box of its own.
    let mut deck = e.deck().clone();
    if let Some(Element::Group(g)) = deck.slide_mut(&s).unwrap().element_mut(&group) {
        g.base.w = Some(400.0);
    }
    let mut e2 = Engine::new(deck, 3);
    e2.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": a.clone(), "patch": { "alt": "x" } }] }),
    )
    .unwrap();
    assert_eq!(rect_of(&e2, &s, &group).2, 400.0);
    e2.apply(
        "transform_elements",
        json!({ "slide": s, "items": [{ "id": a, "x": 110 }] }),
    )
    .unwrap();
    assert_eq!(rect_of(&e2, &s, &group), (110.0, 100.0, 290.0, 150.0));
}
