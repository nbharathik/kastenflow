//! One element aligns to the slide (two or more align to each other).

use serde_json::json;

use super::{add, bytes, element, engine, text_box};

#[test]
fn a_lone_element_goes_to_each_edge_and_middle_of_the_slide() {
    // The slide is 960 by 540.
    let cases = [
        ("left", (0.0, 100.0)),
        ("centerH", (430.0, 100.0)),
        ("right", (860.0, 100.0)),
        ("top", (300.0, 0.0)),
        ("middleV", (300.0, 260.0)),
        ("bottom", (300.0, 520.0)),
    ];
    for (mode, (x, y)) in cases {
        let mut e = engine();
        let s = add(&mut e, "blank", json!({}));
        let a = text_box(&mut e, &s, 300.0, 100.0, 100.0, 20.0, "a");
        let before = bytes(e.deck());
        e.apply(
            "align_elements",
            json!({ "slide": s, "ids": [a], "mode": mode }),
        )
        .unwrap();
        let moved = element(&e, &s, &a).base().rect().unwrap();
        assert_eq!((moved.0, moved.1), (x, y), "{mode}");
        assert_eq!((moved.2, moved.3), (100.0, 20.0), "{mode} keeps its size");
        e.undo().unwrap();
        assert_eq!(bytes(e.deck()), before, "{mode} can be undone exactly");
    }
}

#[test]
fn a_lone_element_follows_the_slide_it_is_on_not_a_fixed_size() {
    let mut deck = engine().deck().clone();
    deck.size.w = 720.0;
    deck.size.h = 540.0;
    let mut e = crate::ops::Engine::new(deck, 4);
    let s = add(&mut e, "blank", json!({}));
    let a = text_box(&mut e, &s, 10.0, 10.0, 100.0, 20.0, "a");
    e.apply(
        "align_elements",
        json!({ "slide": s, "ids": [a], "mode": "right" }),
    )
    .unwrap();
    assert_eq!(element(&e, &s, &a).base().x, Some(620.0));
}

#[test]
fn two_elements_still_align_to_each_other_and_not_to_the_slide() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let a = text_box(&mut e, &s, 300.0, 100.0, 100.0, 20.0, "a");
    let b = text_box(&mut e, &s, 500.0, 200.0, 100.0, 20.0, "b");
    e.apply(
        "align_elements",
        json!({ "slide": s, "ids": [a, b], "mode": "left" }),
    )
    .unwrap();
    assert_eq!(element(&e, &s, &a).base().x, Some(300.0));
    assert_eq!(element(&e, &s, &b).base().x, Some(300.0));
}
