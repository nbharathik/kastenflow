//! What a slide tells a person who cannot see it: a hidden title, the order its
//! elements are read in, and a picture marked as decoration.

use serde_json::json;

use super::steps_kit::{build, entries, four};
use super::{bytes, engine, first_slide};
use crate::error::Error;
use crate::model::StepState::*;

#[test]
fn a_hidden_title_and_a_reading_order_are_set_and_taken_away() {
    let mut e = engine();
    let s = first_slide(&e);
    let ids = four(&mut e, &s);
    let start = bytes(e.deck());
    e.apply(
        "set_slide_access",
        json!({ "slide": s, "title": "  Results overview ", "readingOrder": [ids[2], ids[0]] }),
    )
    .unwrap();
    let access = e.deck().slide(&s).unwrap().access.clone().unwrap();
    assert_eq!(access.title.as_deref(), Some("Results overview"));
    assert_eq!(access.reading_order, [ids[2].clone(), ids[0].clone()]);

    // Only what is given changes.
    e.apply("set_slide_access", json!({ "slide": s, "title": "" }))
        .unwrap();
    let access = e.deck().slide(&s).unwrap().access.clone().unwrap();
    assert!(access.title.is_none() && access.reading_order.len() == 2);
    e.apply(
        "set_slide_access",
        json!({ "slide": s, "readingOrder": [] }),
    )
    .unwrap();
    assert!(
        e.deck().slide(&s).unwrap().access.is_none(),
        "with nothing left to say, nothing is stored"
    );
    assert!(!bytes(e.deck()).contains("\"access\""));

    // Each is one step.
    for _ in 0..3 {
        e.undo().unwrap();
    }
    assert_eq!(bytes(e.deck()), start);
    // The next step back is the last of the four boxes made before `start`, not a fourth setting.
    e.undo().unwrap();
    assert_ne!(bytes(e.deck()), start);
}

#[test]
fn an_unknown_or_repeated_element_in_the_order_is_refused() {
    let mut e = engine();
    let s = first_slide(&e);
    let ids = four(&mut e, &s);
    let before = bytes(e.deck());
    assert!(matches!(
        e.apply(
            "set_slide_access",
            json!({ "slide": s, "readingOrder": ["e-nope"] })
        ),
        Err(Error::NoSuchElement { .. })
    ));
    assert!(matches!(
        e.apply(
            "set_slide_access",
            json!({ "slide": s, "readingOrder": [ids[0], ids[0]] })
        ),
        Err(Error::Invalid { .. })
    ));
    assert!(matches!(
        e.apply(
            "set_slide_access",
            json!({ "slide": s, "title": "x".repeat(201) })
        ),
        Err(Error::Invalid { .. })
    ));
    assert!(matches!(
        e.apply(
            "set_slide_access",
            json!({ "slide": "s-nope", "title": "x" })
        ),
        Err(Error::NoSuchSlide { .. })
    ));
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn a_reveal_follows_the_reading_order_the_slide_was_given() {
    let mut e = engine();
    let s = first_slide(&e);
    let ids = four(&mut e, &s);
    // Usual order: ids[1], ids[2], ids[3], ids[0] (see the reveal test). Put the last first.
    e.apply(
        "set_slide_access",
        json!({ "slide": s, "readingOrder": [ids[0], ids[3]] }),
    )
    .unwrap();
    build(&mut e, &s, &[&ids[0], &ids[1], &ids[2], &ids[3]], "reveal");
    for (place, id) in [&ids[0], &ids[3], &ids[1], &ids[2]].into_iter().enumerate() {
        let step = place as u32 + 1;
        assert_eq!(entries(&e, &s, id), [(0, Hidden), (step, Normal)]);
    }
}

#[test]
fn a_picture_marked_as_decoration_has_the_empty_words_and_is_kept_that_way() {
    let mut e = engine();
    let s = first_slide(&e);
    let image = json!({ "type": "image", "x": 10, "y": 10, "w": 100, "h": 100, "src": "assets/figure.png" });
    let id = e
        .apply("add_elements", json!({ "slide": s, "elements": [image] }))
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    e.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": id, "patch": { "alt": "" } }] }),
    )
    .unwrap();
    let el = e.deck().slide(&s).unwrap().element(&id).unwrap();
    assert_eq!(
        el.base().alt.as_deref(),
        Some(""),
        "decoration is alt text that is empty on purpose"
    );
    assert!(bytes(e.deck()).contains("\"alt\": \"\""));
}
