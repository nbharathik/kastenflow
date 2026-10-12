//! Ungrouping a composite into shapes, and the steps a slide gets from its composites.

use serde_json::{Value, json};

use super::{add, bytes, engine, text_box};
use crate::error::Error;
use crate::model::{Element, StepState};
use crate::ops::Engine;

fn code_json(id: &str, focus: &[&str]) -> Value {
    json!({ "type": "code", "id": id, "x": 64, "y": 148, "w": 832, "h": 344, "language": "python",
        "code": "a = 1\nb = 2\nc = 3\nd = 4", "focus": focus })
}

fn add_one(e: &mut Engine, slide: &str, element: Value) -> String {
    e.apply(
        "add_elements",
        json!({ "slide": slide, "elements": [element] }),
    )
    .unwrap()
    .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned()
}

fn order(e: &Engine, slide: &str) -> Vec<String> {
    e.deck()
        .slide(slide)
        .unwrap()
        .elements
        .iter()
        .map(|x| x.id().to_owned())
        .collect()
}

fn steps(e: &Engine, slide: &str) -> u32 {
    e.deck().slide(slide).unwrap().steps
}

#[test]
fn a_composite_becomes_a_group_of_its_parts_at_the_same_place_in_the_stack() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let below = text_box(&mut e, &s, 0.0, 0.0, 50.0, 20.0, "below");
    let code = add_one(&mut e, &s, code_json("e-code", &[]));
    let above = text_box(&mut e, &s, 0.0, 30.0, 50.0, 20.0, "above");
    let out = e
        .apply("expand_composite", json!({ "slide": s, "id": code }))
        .unwrap()
        .output;
    assert_eq!(out["group"], "e-code");
    assert_eq!(
        order(&e, &s),
        [below.clone(), "e-code".to_owned(), above.clone()]
    );
    let Element::Group(group) = e.deck().slide(&s).unwrap().element("e-code").unwrap() else {
        panic!("a group")
    };
    let parts: Vec<&str> = group.children.iter().map(Element::id).collect();
    let listed: Vec<&str> = out["parts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    assert_eq!(parts, listed, "the operation says which parts it made");
    assert!(parts.iter().all(|p| p.starts_with("e-code.")));
    assert!(group.children.iter().all(|c| !c.is_composite()));
    assert_eq!(group.base.rect().map(|r| (r.0, r.1)), Some((64.0, 148.0)));
    assert!(e.deck().slide(&s).unwrap().element(&above).is_some());
    crate::canonical::check_structure(e.deck()).unwrap();
}

#[test]
fn the_group_keeps_the_composites_name_alt_text_steps_and_link() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let embed = json!({ "type": "embed", "id": "e-web", "x": 100, "y": 100, "w": 400, "h": 250, "url": "https://example.com/x",
        "name": "The demo", "alt": "Screenshot of the demo", "stepStates": { "1": "hidden", "2": "normal" } });
    let id = add_one(&mut e, &s, embed);
    e.apply("expand_composite", json!({ "slide": s, "id": id }))
        .unwrap();
    let group = e
        .deck()
        .slide(&s)
        .unwrap()
        .element("e-web")
        .unwrap()
        .base()
        .clone();
    assert_eq!(group.name.as_deref(), Some("The demo"));
    assert_eq!(group.alt.as_deref(), Some("Screenshot of the demo"));
    assert_eq!(group.link.as_deref(), Some("https://example.com/x"));
    assert_eq!(group.step_states.get(&1), Some(&StepState::Hidden));
    assert_eq!(group.step_states.get(&2), Some(&StepState::Normal));
}

#[test]
fn anything_that_is_not_a_composite_is_refused_and_says_what_to_use() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let t = text_box(&mut e, &s, 0.0, 0.0, 50.0, 20.0, "words");
    let before = bytes(e.deck());
    let Error::Refused { message } = e
        .apply("expand_composite", json!({ "slide": s, "id": t }))
        .unwrap_err()
    else {
        panic!("refused")
    };
    assert!(
        message.contains(&t) && message.contains("not a composite"),
        "{message}"
    );
    assert!(message.contains("ungroup_element"), "{message}");
    assert_eq!(bytes(e.deck()), before);
    assert!(!e.can_undo() || e.undo_label() != Some("expand_composite"));
    assert!(matches!(
        e.apply("expand_composite", json!({ "slide": s, "id": "e-none" })),
        Err(Error::NoSuchElement { .. })
    ));
    assert!(matches!(
        e.apply("expand_composite", json!({ "slide": "s-none", "id": t })),
        Err(Error::NoSuchSlide { .. })
    ));
}

#[test]
fn a_formula_is_refused_because_it_is_drawn_as_a_picture_and_the_message_says_what_to_do() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let formula = add_one(
        &mut e,
        &s,
        json!({ "type": "math", "id": "e-f", "x": 64, "y": 148, "w": 400, "h": 120, "latex": "x^2 + y^2 = z^2" }),
    );
    let before = bytes(e.deck());
    let Error::Refused { message } = e
        .apply("expand_composite", json!({ "slide": s, "id": formula }))
        .unwrap_err()
    else {
        panic!("refused")
    };
    assert!(
        message.contains(&formula) && message.contains("formula"),
        "{message}"
    );
    assert!(message.contains("picture"), "why: {message}");
    assert!(
        message.contains("latex") && message.contains("text box"),
        "what to do: {message}"
    );
    assert_eq!(bytes(e.deck()), before, "nothing changed");
    assert!(!e.can_undo() || e.undo_label() != Some("expand_composite"));
}

#[test]
fn a_poster_still_covers_its_box_once_ungrouped_and_the_deck_writes_back_the_same() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    add_one(
        &mut e,
        &s,
        json!({ "type": "video", "id": "e-v", "x": 64, "y": 148, "w": 640, "h": 360,
            "src": "assets/clip.mp4", "poster": "assets/still.png" }),
    );
    e.apply("expand_composite", json!({ "slide": s, "id": "e-v" }))
        .unwrap();
    let Element::Group(group) = e.deck().slide(&s).unwrap().element("e-v").unwrap() else {
        panic!("a group")
    };
    let Element::Image(still) = &group.children[0] else {
        panic!("the poster")
    };
    assert!(still.covers(), "the shapes look as the composite did");
    let text = bytes(e.deck());
    assert_eq!(bytes(&crate::canonical::parse(&text).unwrap()), text);
}

#[test]
fn a_composite_inside_a_group_is_replaced_where_it_stands() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let note = text_box(&mut e, &s, 0.0, 0.0, 50.0, 20.0, "note");
    let code = add_one(&mut e, &s, code_json("e-code", &[]));
    let g = e
        .apply("group_elements", json!({ "slide": s, "ids": [note, code] }))
        .unwrap()
        .output["group"]
        .as_str()
        .unwrap()
        .to_owned();
    e.apply("expand_composite", json!({ "slide": s, "id": "e-code" }))
        .unwrap();
    let Element::Group(outer) = e.deck().slide(&s).unwrap().element(&g).unwrap() else {
        panic!("a group")
    };
    assert!(matches!(outer.children[1], Element::Group(_)));
    assert_eq!(outer.children[1].id(), "e-code");
}

#[test]
fn a_part_whose_name_is_taken_gets_another_so_ids_stay_unique() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let code = add_one(&mut e, &s, code_json("e-code", &[]));
    text_box_with_id(&mut e, &s, "e-code.1");
    e.apply("expand_composite", json!({ "slide": s, "id": code }))
        .unwrap();
    crate::canonical::check_structure(e.deck()).unwrap();
    let ids: Vec<String> = e
        .deck()
        .slide(&s)
        .unwrap()
        .element("e-code")
        .unwrap()
        .children()
        .iter()
        .map(|c| c.id().to_owned())
        .collect();
    assert!(
        !ids.contains(&"e-code.1".to_owned()) && ids.len() == 2,
        "{ids:?}"
    );
}

fn text_box_with_id(e: &mut Engine, slide: &str, id: &str) {
    let element = json!({ "type": "text", "id": id, "x": 0, "y": 0, "w": 10, "h": 10, "text": { "paragraphs": [{ "runs": [{ "t": "x" }] }] } });
    e.apply(
        "add_elements",
        json!({ "slide": slide, "elements": [element] }),
    )
    .unwrap();
}

#[test]
fn ungrouping_is_one_step_of_undo_and_the_bytes_come_back() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    add_one(&mut e, &s, code_json("e-code", &["1", "2-3"]));
    let before = bytes(e.deck());
    e.apply("expand_composite", json!({ "slide": s, "id": "e-code" }))
        .unwrap();
    let after = bytes(e.deck());
    assert_ne!(after, before);
    assert_eq!(e.undo_label(), Some("expand_composite"));
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
    e.redo().unwrap();
    assert_eq!(bytes(e.deck()), after);
    // The steps it needed are still there once the composite is gone; nothing lowers them.
    assert_eq!(steps(&e, &s), 2);
}

#[test]
fn a_walkthrough_of_code_gives_its_slide_the_steps_it_needs() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    assert_eq!(steps(&e, &s), 0);
    let code = add_one(&mut e, &s, code_json("e-code", &["1", "2", "3"]));
    assert_eq!(steps(&e, &s), 3, "one step for each focus entry");
    // More entries raise it; fewer never lower it.
    e.apply("patch_elements", json!({ "slide": s, "patches": [{ "id": code, "patch": { "focus": ["1", "2", "3", "4", "4"] } }] })).unwrap();
    assert_eq!(steps(&e, &s), 5);
    e.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": code, "patch": { "focus": ["1"] } }] }),
    )
    .unwrap();
    assert_eq!(steps(&e, &s), 5);
    // A slide that already has more keeps them.
    let other = add(&mut e, "blank", json!({}));
    e.apply("set_slide_steps", json!({ "slide": other, "steps": 7 }))
        .unwrap();
    add_one(&mut e, &other, code_json("e-code2", &["1", "2"]));
    assert_eq!(steps(&e, &other), 7);
}

#[test]
fn a_walkthrough_longer_than_a_slide_can_hold_stops_at_the_most_steps() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let focus: Vec<String> = (1..=60).map(|n| n.to_string()).collect();
    let focus: Vec<&str> = focus.iter().map(String::as_str).collect();
    add_one(&mut e, &s, code_json("e-code", &focus));
    assert_eq!(steps(&e, &s), crate::ops::MOST_STEPS);
    // The deck is still one that `set_slide_steps` and the rest accept.
    e.apply("set_slide_steps", json!({ "slide": s, "steps": 50 }))
        .unwrap();
}

#[test]
fn pasting_and_duplicating_a_walkthrough_bring_its_steps_along() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let code = add_one(&mut e, &s, code_json("e-code", &["1", "2", "3"]));
    let copy = serde_json::to_value(e.deck().slide(&s).unwrap().element(&code).unwrap()).unwrap();
    let other = add(&mut e, "blank", json!({}));
    assert_eq!(steps(&e, &other), 0);
    e.apply(
        "paste_elements",
        json!({ "slide": other, "elements": [copy] }),
    )
    .unwrap();
    assert_eq!(steps(&e, &other), 3);
    // A file edited by hand can carry fewer steps than its code block needs; a duplicate raises them again.
    let third = add(&mut e, "blank", json!({}));
    let id = add_one(&mut e, &third, code_json("e-code3", &["1", "2"]));
    let mut value = serde_json::to_value(e.deck()).unwrap();
    for slide in value["slides"].as_array_mut().unwrap() {
        if slide["id"] == json!(third) {
            slide["steps"] = json!(0);
        }
    }
    let mut e = crate::ops::Engine::new(serde_json::from_value(value).unwrap(), 7);
    assert_eq!(steps(&e, &third), 0);
    e.apply("duplicate_elements", json!({ "slide": third, "ids": [id] }))
        .unwrap();
    assert_eq!(steps(&e, &third), 2);
}

#[test]
fn the_step_rule_is_undone_with_the_step_that_made_it() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let before = bytes(e.deck());
    add_one(&mut e, &s, code_json("e-code", &["1", "2"]));
    assert_eq!(steps(&e, &s), 2);
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
    assert_eq!(steps(&e, &s), 0);
}

#[test]
fn the_operation_is_in_the_registry_for_agents_and_the_editor() {
    let specs = crate::ops::specs();
    let spec = specs
        .iter()
        .find(|s| s.name == "expand_composite")
        .expect("registered");
    assert!(spec.about.contains("Ungroup to shapes"));
    assert!(
        spec.input["properties"]["slide"].is_object() && spec.input["properties"]["id"].is_object()
    );
}

/// A composite of each of the nine kinds, by number, for the property test of undo.
pub(super) fn sample(kind: u8) -> Value {
    let at = json!({ "x": 64, "y": 148, "w": 832, "h": 300 });
    let mut value = match kind % 12 {
        0 => {
            json!({ "type": "code", "language": "python", "code": "a = 1\nb = 2\nc = 3", "focus": ["1", "2-3"] })
        }
        1 => json!({ "type": "math", "latex": "x^2 + y^2 = z^2" }),
        2 => {
            json!({ "type": "chat", "messages": [{ "role": "user", "text": "Hi" }, { "role": "assistant", "text": "Hello!" }] })
        }
        3 => {
            json!({ "type": "token-probs", "tokens": ["The", " cat"], "next": [{ "token": " sat", "p": 0.6 }, { "token": " ran", "p": 0.4 }], "chosen": 0 })
        }
        4 => {
            json!({ "type": "card-grid", "cards": [{ "title": "One", "body": "First" }, { "title": "Two" }] })
        }
        5 => json!({ "type": "citation", "keys": ["a2020"] }),
        6 => json!({ "type": "step-label" }),
        7 => {
            json!({ "type": "embed", "url": "https://example.com", "design": { "w": 390, "h": 844 }, "zoom": 0.5, "fit": "page" })
        }
        8 => json!({ "type": "video", "src": "assets/clip.mp4" }),
        9 => {
            json!({ "type": "chart", "kind": "bar", "categories": ["A", "B"], "series": [{ "name": "S", "values": [1, 2] }] })
        }
        10 => json!({ "type": "timer", "seconds": 90, "label": "Break" }),
        _ => json!({ "type": "qr", "data": "https://example.com/slides" }),
    };
    if let (Some(map), Some(extra)) = (value.as_object_mut(), at.as_object()) {
        map.extend(extra.clone());
    }
    value
}

/// The number `sample` gives a formula, which cannot be ungrouped.
const MATH: u8 = 1;

#[test]
fn every_kind_that_can_be_ungrouped_is_a_deck_that_writes_back_the_same() {
    for kind in (0..9).filter(|kind| *kind != MATH) {
        let mut e = engine();
        let s = add(&mut e, "blank", json!({}));
        let mut element = sample(kind);
        element["id"] = json!("e-x");
        add_one(&mut e, &s, element);
        e.apply("expand_composite", json!({ "slide": s, "id": "e-x" }))
            .unwrap();
        let text = bytes(e.deck());
        let again = bytes(&crate::canonical::parse(&text).unwrap());
        if text != again {
            let (a, b) = text
                .lines()
                .zip(again.lines())
                .find(|(a, b)| a != b)
                .unwrap();
            panic!("kind {kind} does not write back the same:\n  {a}\n  {b}");
        }
    }
}
