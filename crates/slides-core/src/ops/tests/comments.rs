//! Comments on a deck: made, answered, settled and opened again, each one step
//! to undo, kept byte for byte, and never drawn into the slide.

use serde_json::{Value, json};

use super::{bytes, engine, first_slide, text_box};
use crate::canonical;
use crate::error::Error;
use crate::ops::Engine;

fn add(e: &mut Engine, input: Value) -> String {
    e.apply("add_deck_comment", input).unwrap().output["comment"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn comment(e: &Engine, slide: &str, at: usize) -> crate::model::DeckComment {
    e.deck().slide(slide).unwrap().comments[at].clone()
}

#[test]
fn a_comment_is_pinned_to_the_slide_an_element_or_a_point() {
    let mut e = engine();
    let s = first_slide(&e);
    let t = text_box(&mut e, &s, 100.0, 100.0, 200.0, 50.0, "hello");
    let whole = add(
        &mut e,
        json!({ "slide": s, "text": " Rework this slide ", "author": "Ana", "at": "2026-11-02T09:30:00Z" }),
    );
    let on_element = add(
        &mut e,
        json!({ "slide": s, "element": t, "text": "Typo?", "author": "Ana" }),
    );
    let at_point = add(
        &mut e,
        json!({ "slide": s, "x": 40.5, "y": 80.0, "text": "Move left" }),
    );

    let first = comment(&e, &s, 0);
    assert_eq!(first.id, whole);
    assert_eq!(first.text, "Rework this slide", "the words are trimmed");
    assert_eq!(
        (first.author.as_str(), first.created.as_str()),
        ("Ana", "2026-11-02T09:30:00Z")
    );
    assert!(first.element.is_none() && first.pin.is_none() && !first.agent && !first.resolved);
    let second = comment(&e, &s, 1);
    assert_eq!(
        (second.id, second.element.as_deref()),
        (on_element, Some(t.as_str()))
    );
    let third = comment(&e, &s, 2);
    assert_eq!(third.id, at_point);
    assert_eq!(third.pin.as_ref().map(|p| (p.x, p.y)), Some((40.5, 80.0)));
    assert_eq!(third.author, "Someone", "nobody was named");
}

#[test]
fn an_assistants_comment_is_marked_and_named() {
    let mut e = engine();
    let s = first_slide(&e);
    add(
        &mut e,
        json!({ "slide": s, "text": "Check the number", "agent": true }),
    );
    let made = comment(&e, &s, 0);
    assert!(made.agent);
    assert_eq!(made.author, "Assistant");
    let text = bytes(e.deck());
    assert!(
        text.contains("\"agent\": true"),
        "the file says who wrote it"
    );
}

#[test]
fn each_comment_reply_and_resolve_is_one_step_that_undo_and_redo_restore_exactly() {
    let mut e = engine();
    let s = first_slide(&e);
    let start = bytes(e.deck());
    let c = add(&mut e, json!({ "slide": s, "text": "One" }));
    let with_comment = bytes(e.deck());
    let reply = e
        .apply(
            "reply_deck_comment",
            json!({ "comment": c, "text": "Done", "author": "Bo", "at": "2026-11-02T10:00:00Z" }),
        )
        .unwrap()
        .output["reply"]
        .as_str()
        .unwrap()
        .to_owned();
    let with_reply = bytes(e.deck());
    e.apply("resolve_deck_comment", json!({ "comment": c }))
        .unwrap();
    let settled = bytes(e.deck());
    assert!(comment(&e, &s, 0).resolved);
    assert_eq!(comment(&e, &s, 0).replies[0].id, reply);
    e.apply(
        "resolve_deck_comment",
        json!({ "comment": c, "resolved": false }),
    )
    .unwrap();
    assert!(!comment(&e, &s, 0).resolved);

    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), settled, "reopening is one step");
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), with_reply);
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), with_comment);
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), start);
    assert!(!e.can_undo());
    for expected in [&with_comment, &with_reply, &settled] {
        e.redo().unwrap();
        assert_eq!(&bytes(e.deck()), expected);
    }
}

#[test]
fn the_changes_an_operation_reports_bring_a_copy_up_to_date() {
    let mut e = engine();
    let s = first_slide(&e);
    let mut copy = e.deck().clone();
    let made = e
        .apply("add_deck_comment", json!({ "slide": s, "text": "Hello" }))
        .unwrap();
    made.changes.apply_to(&mut copy);
    assert_eq!(bytes(&copy), bytes(e.deck()));
    let c = made.output["comment"].as_str().unwrap().to_owned();
    e.apply("resolve_deck_comment", json!({ "comment": c }))
        .unwrap()
        .changes
        .apply_to(&mut copy);
    assert_eq!(bytes(&copy), bytes(e.deck()));
}

#[test]
fn what_cannot_be_kept_is_refused_and_changes_nothing() {
    let mut e = engine();
    let s = first_slide(&e);
    let before = bytes(e.deck());
    let refused = |e: &mut Engine, op: &str, input: Value| {
        let err = e.apply(op, input).unwrap_err();
        assert!(
            matches!(
                err,
                Error::Invalid { .. } | Error::NoSuchSlide { .. } | Error::NoSuchElement { .. }
            ),
            "{err:?}"
        );
    };
    refused(
        &mut e,
        "add_deck_comment",
        json!({ "slide": s, "text": "   " }),
    );
    refused(
        &mut e,
        "add_deck_comment",
        json!({ "slide": "s-nope", "text": "x" }),
    );
    refused(
        &mut e,
        "add_deck_comment",
        json!({ "slide": s, "element": "e-nope", "text": "x" }),
    );
    refused(
        &mut e,
        "add_deck_comment",
        json!({ "slide": s, "x": 4.0, "text": "x" }),
    );
    refused(
        &mut e,
        "add_deck_comment",
        json!({ "slide": s, "text": "x".repeat(4001) }),
    );
    refused(
        &mut e,
        "add_deck_comment",
        json!({ "slide": s, "text": "x", "author": "a".repeat(81) }),
    );
    refused(
        &mut e,
        "reply_deck_comment",
        json!({ "comment": "c-nope", "text": "x" }),
    );
    refused(
        &mut e,
        "resolve_deck_comment",
        json!({ "comment": "c-nope" }),
    );
    assert_eq!(bytes(e.deck()), before);
    assert!(!e.can_undo());
}

#[test]
fn comment_and_reply_ids_are_unique_across_the_deck() {
    let mut e = engine();
    let s = first_slide(&e);
    let t = super::add(&mut e, "title-only", json!({}));
    let mut ids = Vec::new();
    for slide in [&s, &t, &s] {
        let c = add(&mut e, json!({ "slide": slide, "text": "x" }));
        let r = e
            .apply("reply_deck_comment", json!({ "comment": c, "text": "y" }))
            .unwrap()
            .output["reply"]
            .as_str()
            .unwrap()
            .to_owned();
        ids.extend([c, r]);
    }
    let mut sorted = ids.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), ids.len());
    assert!(ids.iter().all(|id| id.starts_with("c-")));
}

#[test]
fn a_deck_without_comments_is_the_same_bytes_and_comments_keep_what_a_newer_build_wrote() {
    let e = engine();
    assert!(
        !bytes(e.deck()).contains("comments"),
        "nothing is written for no comments"
    );

    let mut e = engine();
    let s = first_slide(&e);
    add(
        &mut e,
        json!({ "slide": s, "text": "Keep me", "at": "2026-11-02T09:30:00Z" }),
    );
    let mut value = canonical::to_value(e.deck()).unwrap();
    value["slides"][0]["comments"][0]["later"] = json!({ "kept": true });
    value["slides"][0]["comments"][0]["replies"] = json!([
        { "id": "c-r1", "author": "Bo", "text": "ok", "created": "", "also": 7 }
    ]);
    let text = serde_json::to_string_pretty(&value).unwrap();
    let read = canonical::parse(&text).unwrap();
    let written = canonical::write(&read).unwrap();
    let back: Value = serde_json::from_str(&written).unwrap();
    assert_eq!(
        back["slides"][0]["comments"][0]["later"],
        json!({ "kept": true })
    );
    assert_eq!(back["slides"][0]["comments"][0]["replies"][0]["also"], 7);
    assert_eq!(
        canonical::write(&canonical::parse(&written).unwrap()).unwrap(),
        written
    );
}

#[test]
fn a_copy_of_a_slide_starts_without_the_notes_left_on_the_original() {
    let mut e = engine();
    let s = first_slide(&e);
    add(&mut e, json!({ "slide": s, "text": "A note" }));
    let copies = e
        .apply("duplicate_slides", json!({ "ids": [s] }))
        .unwrap()
        .output["slides"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let copy = e.deck().slide(&copies).unwrap();
    assert!(
        copy.comments.is_empty(),
        "the note stays with its slide, and its id stays unique"
    );
    assert_eq!(e.deck().slide(&s).unwrap().comments.len(), 1);
    assert_eq!(
        copy.elements.len(),
        e.deck().slide(&s).unwrap().elements.len()
    );
}
