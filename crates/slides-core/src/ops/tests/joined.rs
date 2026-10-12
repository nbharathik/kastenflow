//! A step of undo that takes in the operation that follows it: a text box and
//! the first words typed into it are one step, though the words come later.

use proptest::prelude::*;
use serde_json::{Value, json};

use super::{add, bytes, engine, first_slide};
use crate::canonical;
use crate::error::Error;
use crate::ops::Engine;

fn empty_box() -> Value {
    json!({ "type": "text", "x": 100, "y": 100, "w": 300, "h": 56, "text": { "paragraphs": [{ "runs": [{ "t": "" }] }] } })
}

fn words(t: &str) -> Value {
    json!({ "paragraphs": [{ "runs": [{ "t": t }] }] })
}

/// A new text box on a slide of its own, and its id.
fn with_box() -> (Engine, String, String) {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let made = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [empty_box()] }),
        )
        .unwrap();
    let id = made.output["ids"][0].as_str().unwrap().to_owned();
    (e, s, id)
}

#[test]
fn a_box_and_the_words_typed_in_it_are_one_step_of_undo() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let before = bytes(e.deck());
    let made = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [empty_box()] }),
        )
        .unwrap();
    let id = made.output["ids"][0].as_str().unwrap().to_owned();
    let typed = e
        .apply_into_last(
            "set_rich_text",
            json!({ "slide": s, "id": id, "text": words("Hello") }),
        )
        .unwrap();
    assert!(!typed.changes.is_empty(), "the words are reported");
    let after = bytes(e.deck());
    assert_eq!(e.undo_label(), Some("add_elements"));

    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before, "one undo takes back box and words");
    assert!(e.deck().slide(&s).unwrap().elements.is_empty());
    e.redo().unwrap();
    assert_eq!(bytes(e.deck()), after, "one redo brings both back");
    assert_eq!(
        e.deck()
            .slide(&s)
            .unwrap()
            .element(&id)
            .unwrap()
            .text()
            .unwrap()
            .plain_text(),
        "Hello"
    );
    // Only the slide that was added before is left below it.
    e.undo().unwrap();
    assert!(e.undo().is_some(), "the slide was a step of its own");
    assert!(!e.can_undo());
}

#[test]
fn the_changes_reported_bring_a_copy_of_the_deck_up_to_date() {
    let (mut e, s, id) = with_box();
    let mut mirror = e.deck().clone();
    let typed = e
        .apply_into_last(
            "set_rich_text",
            json!({ "slide": s, "id": id, "text": words("Hi") }),
        )
        .unwrap();
    typed.changes.apply_to(&mut mirror);
    assert_eq!(bytes(&mirror), bytes(e.deck()));
    let undone = e.undo().unwrap();
    undone.apply_to(&mut mirror);
    assert_eq!(bytes(&mirror), bytes(e.deck()));
}

#[test]
fn a_step_that_the_last_one_does_not_cover_is_a_step_of_its_own() {
    let (mut e, s, id) = with_box();
    let other = add(&mut e, "blank", json!({}));
    let b = super::text_box(&mut e, &other, 0.0, 0.0, 50.0, 20.0, "b");
    let before = bytes(e.deck());
    // The last step was on `other`; typing in the first slide's box is a different place.
    e.apply_into_last(
        "set_rich_text",
        json!({ "slide": s, "id": id, "text": words("late") }),
    )
    .unwrap();
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before, "only the typing was taken back");
    assert!(e.deck().slide(&other).unwrap().element(&b).is_some());
}

#[test]
fn with_nothing_to_join_it_is_an_ordinary_step() {
    let mut e = engine();
    let s = first_slide(&e);
    let before = bytes(e.deck());
    e.apply_into_last("set_notes", json!({ "slide": s, "notes": "n" }))
        .unwrap();
    assert!(e.can_undo());
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn a_joined_step_that_changes_nothing_leaves_the_history_alone() {
    let (mut e, s, id) = with_box();
    let same = e
        .apply_into_last(
            "set_rich_text",
            json!({ "slide": s, "id": id, "text": words("") }),
        )
        .unwrap();
    assert!(same.changes.is_empty());
    e.undo().unwrap();
    assert!(
        e.deck().slide(&s).unwrap().elements.is_empty(),
        "the box is still its own step"
    );
}

#[test]
fn a_refused_joined_step_changes_nothing_and_the_last_step_stays_whole() {
    let (mut e, s, id) = with_box();
    let before = bytes(e.deck());
    let result = e.apply_into_last(
        "set_rich_text",
        json!({ "slide": s, "id": "nope", "text": words("x") }),
    );
    assert!(
        matches!(result, Err(Error::NoSuchElement { .. })),
        "{result:?}"
    );
    assert_eq!(bytes(e.deck()), before);
    e.undo().unwrap();
    assert!(e.deck().slide(&s).unwrap().element(&id).is_none());
}

#[test]
fn joining_clears_what_could_have_been_redone() {
    let (mut e, s, id) = with_box();
    e.apply_into_last(
        "set_rich_text",
        json!({ "slide": s, "id": id, "text": words("one") }),
    )
    .unwrap();
    e.undo().unwrap();
    assert!(e.can_redo());
    // After an undo the person made a new box; typing into it joins that step, not the one redo holds.
    let made = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [empty_box()] }),
        )
        .unwrap();
    let id2 = made.output["ids"][0].as_str().unwrap().to_owned();
    assert!(!e.can_redo());
    e.apply_into_last(
        "set_rich_text",
        json!({ "slide": s, "id": id2, "text": words("two") }),
    )
    .unwrap();
    assert!(!e.can_redo());
}

#[derive(Clone, Debug)]
enum Step {
    Box {
        slide: usize,
        join: bool,
    },
    Type {
        slide: usize,
        el: usize,
        n: u8,
        join: bool,
    },
    Slide,
    Undo,
    Redo,
}

fn step() -> impl Strategy<Value = Step> {
    prop_oneof![
        (0usize..4, any::<bool>()).prop_map(|(slide, join)| Step::Box { slide, join }),
        (0usize..4, 0usize..4, 0u8..3, any::<bool>()).prop_map(|(slide, el, n, join)| Step::Type {
            slide,
            el,
            n,
            join
        }),
        Just(Step::Slide),
        Just(Step::Undo),
        Just(Step::Redo),
    ]
}

fn run(steps: &[Step]) {
    let mut e = Engine::create("Joined", "Light", 4).unwrap();
    let start = bytes(e.deck());
    let mut mirror = e.deck().clone();
    for step in steps {
        let slide = |i: usize| e.deck().slides[i % e.deck().slides.len()].id.clone();
        let (name, input, join) = match step {
            Step::Box { slide: s, join } => (
                "add_elements",
                json!({ "slide": slide(*s), "elements": [empty_box()] }),
                *join,
            ),
            Step::Type {
                slide: s,
                el,
                n,
                join,
            } => {
                let id = slide(*s);
                let on = e.deck().slide(&id).unwrap();
                let Some(target) = on.elements.get(el % on.elements.len().max(1)) else {
                    continue;
                };
                (
                    "set_rich_text",
                    json!({ "slide": id, "id": target.id(), "text": words(["a", "bb", ""][usize::from(*n)]) }),
                    *join,
                )
            }
            Step::Slide => ("add_slide", json!({ "layout": "blank" }), false),
            Step::Undo => {
                if let Some(changes) = e.undo() {
                    changes.apply_to(&mut mirror);
                }
                continue;
            }
            Step::Redo => {
                if let Some(changes) = e.redo() {
                    changes.apply_to(&mut mirror);
                }
                continue;
            }
        };
        let applied = if join {
            e.apply_into_last(name, input)
        } else {
            e.apply(name, input)
        };
        if let Ok(applied) = applied {
            canonical::check_structure(e.deck()).unwrap();
            applied.changes.apply_to(&mut mirror);
        }
        assert_eq!(
            bytes(&mirror),
            bytes(e.deck()),
            "the changes keep a copy in step"
        );
    }
    // The run may end in the middle of the history: go to its far end first.
    while e.redo().is_some() {}
    let end = bytes(e.deck());
    while e.undo().is_some() {}
    assert_eq!(bytes(e.deck()), start, "everything can be undone");
    while e.redo().is_some() {}
    assert_eq!(bytes(e.deck()), end, "and done again");
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 96, ..ProptestConfig::default() })]

    #[test]
    fn any_mix_of_joined_and_separate_steps_can_be_undone_and_redone_exactly(steps in proptest::collection::vec(step(), 1..30)) {
        run(&steps);
    }
}
