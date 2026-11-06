//! How an element comes in, goes out or draws the eye at a step is set by one operation, and the new transitions are kept.

use serde_json::json;

use super::steps_kit::{boxes, message, set_states};
use super::{bytes, element, engine, first_slide};
use crate::model::{FxKind, FxStart, MotionDirection, TransitionKind};

fn one_box(e: &mut crate::ops::Engine, slide: &str) -> String {
    boxes(e, slide, &[(60.0, 60.0, 100.0, 50.0)]).remove(0)
}

fn fx_of(e: &crate::ops::Engine, slide: &str, id: &str) -> Vec<(u32, FxKind)> {
    element(e, slide, id)
        .base()
        .step_fx
        .iter()
        .map(|(step, fx)| (*step, fx.kind.clone()))
        .collect()
}

#[test]
fn an_effect_is_kept_on_its_step_with_its_direction_time_and_start() {
    let mut e = engine();
    let slide = first_slide(&e);
    let id = one_box(&mut e, &slide);
    set_states(&mut e, &slide, &id, json!({ "0": "hidden", "1": "normal" }));
    e.apply(
        "set_step_fx",
        json!({ "slide": slide, "id": id, "fx": { "1": {
            "kind": "fly", "direction": "left", "duration": 0.8, "delay": 0.2, "start": "after"
        } } }),
    )
    .unwrap();
    let fx = &element(&e, &slide, &id).base().step_fx[&1];
    assert_eq!(fx.kind, FxKind::Fly);
    assert_eq!(fx.direction, Some(MotionDirection::Left));
    assert_eq!(fx.duration, Some(0.8));
    assert_eq!(fx.delay, Some(0.2));
    assert_eq!(fx.start, Some(FxStart::After));
}

#[test]
fn null_takes_an_effect_away_and_nothing_is_stored_for_none() {
    let mut e = engine();
    let slide = first_slide(&e);
    let id = one_box(&mut e, &slide);
    let before = bytes(e.deck());
    e.apply(
        "set_step_fx",
        json!({ "slide": slide, "id": id, "fx": { "2": { "kind": "zoom" } } }),
    )
    .unwrap();
    assert_eq!(fx_of(&e, &slide, &id), [(2, FxKind::Zoom)]);
    assert_eq!(
        e.deck().slide(&slide).unwrap().steps,
        2,
        "the slide gets the steps the effect needs"
    );
    e.apply(
        "set_step_fx",
        json!({ "slide": slide, "id": id, "fx": { "2": null } }),
    )
    .unwrap();
    assert!(fx_of(&e, &slide, &id).is_empty());
    assert!(!bytes(e.deck()).contains("stepFx"));
    assert_ne!(bytes(e.deck()), before, "the steps stay");
}

#[test]
fn an_effect_is_one_step_of_undo() {
    let mut e = engine();
    let slide = first_slide(&e);
    let id = one_box(&mut e, &slide);
    let before = bytes(e.deck());
    e.apply(
        "set_step_fx",
        json!({ "slide": slide, "id": id, "fx": { "1": { "kind": "wipe", "direction": "up" } } }),
    )
    .unwrap();
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn a_bad_effect_is_refused_with_a_reason_and_changes_nothing() {
    let mut e = engine();
    let slide = first_slide(&e);
    let id = one_box(&mut e, &slide);
    let before = bytes(e.deck());
    let bad = [
        (json!({ "0": { "kind": "fade" } }), "step 0"),
        (json!({ "51": { "kind": "fade" } }), "50"),
        (json!({ "one": { "kind": "fade" } }), "whole number"),
        (
            json!({ "1": { "kind": "fade", "duration": 11 } }),
            "duration",
        ),
        (json!({ "1": { "kind": "fade", "delay": -1 } }), "delay"),
        (json!({ "1": { "kind": "path" } }), "path"),
        (json!({ "1": { "kind": "path", "dx": 0, "dy": 0 } }), "path"),
        (json!({ "1": { "kind": "colour" } }), "colour"),
        (
            json!({ "1": { "kind": "colour", "color": "red" } }),
            "colour",
        ),
    ];
    for (fx, word) in bad {
        let error = e
            .apply("set_step_fx", json!({ "slide": slide, "id": id, "fx": fx }))
            .unwrap_err();
        assert!(message(error).contains(word), "{fx}");
    }
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn an_element_has_one_motion_path() {
    let mut e = engine();
    let slide = first_slide(&e);
    let id = one_box(&mut e, &slide);
    e.apply(
        "set_step_fx",
        json!({ "slide": slide, "id": id, "fx": { "1": { "kind": "path", "dx": 100, "dy": -40 } } }),
    )
    .unwrap();
    let error = e
        .apply(
            "set_step_fx",
            json!({ "slide": slide, "id": id, "fx": { "2": { "kind": "path", "dx": 5, "dy": 5 } } }),
        )
        .unwrap_err();
    assert!(message(error).contains("one"), "says it is one");
    // Moving the path to another step is not a second path.
    e.apply(
        "set_step_fx",
        json!({ "slide": slide, "id": id, "fx": { "1": null, "2": { "kind": "path", "dx": 5, "dy": 5 } } }),
    )
    .unwrap();
    assert_eq!(fx_of(&e, &slide, &id), [(2, FxKind::Path)]);
}

#[test]
fn unknown_fields_of_an_effect_survive() {
    let text = r#"{"kind":"fade","later":{"a":1}}"#;
    let fx: crate::model::StepFx = serde_json::from_str(text).unwrap();
    assert_eq!(serde_json::to_string(&fx).unwrap(), text);
}

#[test]
fn a_deck_without_effects_reads_and_writes_the_same_bytes() {
    let mut e = engine();
    let slide = first_slide(&e);
    let id = one_box(&mut e, &slide);
    set_states(&mut e, &slide, &id, json!({ "1": "hidden" }));
    let text = bytes(e.deck());
    assert!(!text.contains("stepFx"));
    let again: crate::model::Deck = serde_json::from_str(&text).unwrap();
    assert_eq!(bytes(&again), text);
}

#[test]
fn the_new_transitions_keep_their_direction() {
    let mut e = engine();
    let slide = first_slide(&e);
    for (kind, name) in [
        (TransitionKind::Push, "push"),
        (TransitionKind::Wipe, "wipe"),
        (TransitionKind::Cover, "cover"),
        (TransitionKind::Uncover, "uncover"),
        (TransitionKind::Zoom, "zoom"),
        (TransitionKind::Flip, "flip"),
        (TransitionKind::Dissolve, "dissolve"),
    ] {
        e.apply(
            "set_transition",
            json!({ "ids": [slide], "transition": { "kind": name, "duration": 0.7, "direction": "down" } }),
        )
        .unwrap();
        let t = e.deck().slide(&slide).unwrap().transition.clone().unwrap();
        assert_eq!(t.kind, kind);
        assert_eq!(t.direction, Some(MotionDirection::Down));
    }
    let text = bytes(e.deck());
    assert!(text.contains("\"direction\": \"down\""), "{text}");
}

#[test]
fn a_transition_without_a_direction_writes_none() {
    let mut e = engine();
    let slide = first_slide(&e);
    e.apply(
        "set_transition",
        json!({ "ids": [slide], "transition": { "kind": "fade" } }),
    )
    .unwrap();
    assert!(!bytes(e.deck()).contains("direction"));
}

#[test]
fn the_deck_default_can_be_a_new_transition_for_every_slide() {
    let mut e = engine();
    e.apply(
        "set_present",
        json!({ "transition": { "kind": "push", "direction": "up" } }),
    )
    .unwrap();
    let t = e.deck().present.transition.clone().unwrap();
    assert_eq!(
        (t.kind, t.direction),
        (TransitionKind::Push, Some(MotionDirection::Up))
    );
}
