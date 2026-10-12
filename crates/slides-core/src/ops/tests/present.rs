//! The deck's presenting settings: the slide numbers a deck shows, set by an
//! operation, and off for a deck that is new.

use serde_json::json;

use super::{add, bytes, engine};
use crate::canonical;
use crate::error::Error;
use crate::model::{Transition, TransitionKind};
use crate::ops::Engine;

fn numbers(e: &Engine) -> bool {
    e.deck().present.slide_numbers
}

#[test]
fn a_new_deck_shows_no_slide_numbers() {
    let e = engine();
    assert!(!numbers(&e));
    let text = bytes(e.deck());
    assert!(text.contains("\"slideNumbers\": false"), "{text}");
    assert!(!canonical::parse(&text).unwrap().present.slide_numbers);
}

#[test]
fn a_deck_made_with_each_theme_starts_without_numbers() {
    for theme in crate::themes::all() {
        let e = Engine::create("T", &theme.name, 3).unwrap();
        assert!(!numbers(&e), "{}", theme.name);
    }
}

#[test]
fn a_deck_read_from_a_file_keeps_what_the_file_says() {
    // This deck was saved with its numbers on, as every deck was before the choice existed.
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/decks/minimal.deck");
    let old = std::fs::read_to_string(path).unwrap();
    assert!(old.contains("\"slideNumbers\": true"));
    let reopened = Engine::new(canonical::parse(&old).unwrap(), 5);
    assert!(numbers(&reopened), "opening a deck does not turn them off");
    assert_eq!(bytes(reopened.deck()), old);

    // And one saved with them off stays off.
    let off = old.replace("\"slideNumbers\": true", "\"slideNumbers\": false");
    let reopened = Engine::new(canonical::parse(&off).unwrap(), 5);
    assert!(!numbers(&reopened));
    assert_eq!(bytes(reopened.deck()), off);
}

#[test]
fn set_present_turns_the_numbers_on_and_off_each_as_one_step_of_undo() {
    let mut e = engine();
    let off = bytes(e.deck());
    let out = e
        .apply("set_present", json!({ "slideNumbers": true }))
        .unwrap();
    assert!(numbers(&e));
    assert_eq!(e.undo_label(), Some("set_present"));
    let reported = out.changes.meta.as_ref().expect("the meta changed");
    assert!(reported.present.slide_numbers);
    let on = bytes(e.deck());

    e.undo().unwrap();
    assert!(!numbers(&e));
    assert_eq!(bytes(e.deck()), off, "undo puts back the exact bytes");
    e.redo().unwrap();
    assert_eq!(bytes(e.deck()), on, "redo does it again");

    e.apply("set_present", json!({ "slideNumbers": false }))
        .unwrap();
    assert!(!numbers(&e));
    assert_eq!(bytes(e.deck()), off);
}

#[test]
fn asking_for_what_is_already_so_changes_nothing_and_leaves_no_step() {
    let mut e = engine();
    let before = bytes(e.deck());
    let out = e
        .apply("set_present", json!({ "slideNumbers": false }))
        .unwrap();
    assert!(out.changes.is_empty());
    assert!(!e.can_undo(), "nothing happened, so nothing can be undone");
    let nothing = e.apply("set_present", json!({})).unwrap();
    assert!(nothing.changes.is_empty());
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn only_what_is_given_changes_and_the_other_settings_stay() {
    let mut e = engine();
    add(&mut e, "title-only", json!({}));
    let mut deck = e.deck().clone();
    deck.present.step_label = "{n} of {total}".to_owned();
    deck.present.transition = Some(Transition {
        kind: TransitionKind::Fade,
        duration: Some(0.4),
        easing: None,
        extra: crate::model::Extra::new(),
    });
    deck.present
        .extra
        .insert("futurePresentField".to_owned(), json!({ "kept": true }));
    let mut e = Engine::new(deck, 9);
    let slides = e.deck().slides.clone();
    e.apply("set_present", json!({ "slideNumbers": true }))
        .unwrap();
    let after = &e.deck().present;
    assert!(after.slide_numbers);
    assert_eq!(after.step_label, "{n} of {total}");
    assert_eq!(
        after.transition.as_ref().map(|t| &t.kind),
        Some(&TransitionKind::Fade)
    );
    assert_eq!(
        after.extra.get("futurePresentField"),
        Some(&json!({ "kept": true }))
    );
    assert_eq!(e.deck().slides, slides, "no slide was touched");
}

#[test]
fn a_deck_wide_transition_is_set_changed_and_taken_away_each_as_one_step() {
    let mut e = engine();
    let plain = bytes(e.deck());
    let current = |e: &Engine| {
        e.deck()
            .present
            .transition
            .as_ref()
            .map(|t| (t.kind.clone(), t.duration))
    };
    e.apply(
        "set_present",
        json!({ "transition": { "kind": "fade", "duration": 0.5 } }),
    )
    .unwrap();
    assert_eq!(current(&e), Some((TransitionKind::Fade, Some(0.5))));
    let fade = bytes(e.deck());
    assert!(
        !numbers(&e),
        "the numbers were not mentioned, so they stay off"
    );

    e.apply("set_present", json!({ "transition": { "kind": "slide" } }))
        .unwrap();
    assert_eq!(current(&e), Some((TransitionKind::Slide, None)));

    // None takes the deck's transition away: each slide is a plain cut again, as before.
    e.apply("set_present", json!({ "transition": { "kind": "none" } }))
        .unwrap();
    assert_eq!(current(&e), None);
    assert_eq!(bytes(e.deck()), plain);

    e.undo().unwrap();
    assert_eq!(current(&e), Some((TransitionKind::Slide, None)));
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), fade, "undo puts back the exact bytes");
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), plain);

    // Asking for none where there is none changes nothing.
    let out = e
        .apply("set_present", json!({ "transition": { "kind": "none" } }))
        .unwrap();
    assert!(out.changes.is_empty());
    assert!(!e.can_undo() || e.undo_label() != Some("set_present"));
}

#[test]
fn a_slide_with_its_own_transition_keeps_it_when_the_deck_gets_one() {
    let mut e = engine();
    let s = add(&mut e, "title-only", json!({}));
    e.apply(
        "set_transition",
        json!({ "ids": [s], "transition": { "kind": "morph" } }),
    )
    .unwrap();
    let before = e.deck().slide(&s).unwrap().clone();
    e.apply("set_present", json!({ "transition": { "kind": "fade" } }))
        .unwrap();
    assert_eq!(
        e.deck().slide(&s),
        Some(&before),
        "the slide was not touched"
    );
}

#[test]
fn a_setting_that_is_not_a_yes_or_no_is_refused_and_changes_nothing() {
    let mut e = engine();
    let before = bytes(e.deck());
    assert!(matches!(
        e.apply("set_present", json!({ "slideNumbers": "yes" })),
        Err(Error::BadInput { .. })
    ));
    assert!(matches!(
        e.apply(
            "set_present",
            json!({ "slideNumbers": true, "transition": { "kind": "fade", "duration": 11 } })
        ),
        Err(Error::Invalid { .. })
    ));
    assert_eq!(
        bytes(e.deck()),
        before,
        "nothing was changed, the numbers included"
    );
    assert!(!e.can_undo());
}

#[test]
fn the_operation_is_listed_with_a_description_an_agent_can_read() {
    assert!(crate::ops::names().contains(&"set_present"));
    let spec = crate::ops::specs()
        .into_iter()
        .find(|s| s.name == "set_present")
        .unwrap();
    assert!(spec.about.contains("slide number"), "{}", spec.about);
    assert!(spec.input.to_string().contains("slideNumbers"));
}

#[test]
fn the_slides_stay_as_they_were_when_the_numbers_change() {
    let mut e = engine();
    let s = add(&mut e, "title-body", json!({ "title": "A", "body": "b" }));
    let slide = e.deck().slide(&s).unwrap().clone();
    e.apply("set_present", json!({ "slideNumbers": true }))
        .unwrap();
    assert_eq!(e.deck().slide(&s), Some(&slide));
}
