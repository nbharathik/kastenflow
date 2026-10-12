//! An empty slot holds a plain empty paragraph, so nothing shows in it (no
//! bullet) until something is typed. The slot's list setting still decides what
//! words put into it become.

use serde_json::json;

use super::{add, bytes, engine, first_slide};
use crate::model::{Element, ListKind};
use crate::ops::Engine;

/// The text of the element that fills `role` on a slide.
fn slot(e: &Engine, slide: &str, role: &str) -> (String, crate::model::Text) {
    let found = e
        .deck()
        .slide(slide)
        .unwrap()
        .elements
        .iter()
        .find(|x| x.base().placeholder.as_deref() == Some(role))
        .unwrap_or_else(|| panic!("no `{role}` slot"));
    (found.id().to_owned(), found.text().unwrap().clone())
}

fn lists(text: &crate::model::Text) -> Vec<Option<ListKind>> {
    text.paragraphs.iter().map(|p| p.list.clone()).collect()
}

#[test]
fn an_empty_body_is_one_plain_empty_paragraph() {
    let mut e = engine();
    let s = add(&mut e, "title-body", json!({}));
    let (_, body) = slot(&e, &s, "body");
    assert_eq!(body.paragraphs.len(), 1);
    assert_eq!(body.plain_text(), "");
    assert_eq!(lists(&body), [None], "no bullet before anything is typed");
    assert!(body.paragraphs[0].style.is_none());
}

#[test]
fn every_empty_slot_of_every_layout_is_plain() {
    let mut e = engine();
    let names: Vec<String> = e
        .deck()
        .theme
        .layouts
        .iter()
        .map(|l| l.name.clone())
        .collect();
    for name in names {
        let s = add(&mut e, &name, json!({}));
        for element in &e.deck().slide(&s).unwrap().elements {
            if let Element::Text(t) = element {
                assert!(
                    t.text.paragraphs.iter().all(|p| p.list.is_none()),
                    "{name} / {:?} starts with a list",
                    element.base().placeholder
                );
            }
        }
    }
}

#[test]
fn words_put_into_a_body_still_become_a_list() {
    let mut e = engine();
    let s = add(
        &mut e,
        "two-columns",
        json!({ "title": "Hi", "body": "one\ntwo", "body2": "- three" }),
    );
    let (_, body) = slot(&e, &s, "body");
    assert_eq!(body.plain_text(), "one\ntwo");
    assert_eq!(
        lists(&body),
        [Some(ListKind::Bullet), Some(ListKind::Bullet)]
    );
    let (_, body2) = slot(&e, &s, "body2");
    assert_eq!(lists(&body2), [Some(ListKind::Bullet)]);
    // A title is never a list.
    let (_, title) = slot(&e, &s, "title");
    assert_eq!(lists(&title), [None]);
}

#[test]
fn set_text_makes_a_list_of_words_and_a_plain_paragraph_of_nothing() {
    let mut e = engine();
    let s = add(&mut e, "title-body", json!({ "body": "a\nb" }));
    let (id, body) = slot(&e, &s, "body");
    assert_eq!(
        lists(&body),
        [Some(ListKind::Bullet), Some(ListKind::Bullet)]
    );

    e.apply("set_text", json!({ "slide": s, "id": id, "markdown": "" }))
        .unwrap();
    let (_, emptied) = slot(&e, &s, "body");
    assert_eq!(emptied.paragraphs.len(), 1);
    assert_eq!(lists(&emptied), [None], "emptying a body leaves no bullet");

    e.apply(
        "set_text",
        json!({ "slide": s, "id": id, "markdown": "again" }),
    )
    .unwrap();
    let (_, filled) = slot(&e, &s, "body");
    assert_eq!(lists(&filled), [Some(ListKind::Bullet)]);
}

#[test]
fn a_slot_a_layout_change_adds_is_plain_and_what_was_typed_keeps_its_bullets() {
    let mut e = engine();
    let s = add(&mut e, "title-only", json!({ "title": "T" }));
    e.apply("set_layout", json!({ "slide": s, "layout": "title-body" }))
        .unwrap();
    let (_, body) = slot(&e, &s, "body");
    assert_eq!(lists(&body), [None]);

    // Words typed as a list stay a list when the layout changes under them.
    let (id, _) = slot(&e, &s, "body");
    e.apply(
        "set_rich_text",
        json!({ "slide": s, "id": id, "text": { "paragraphs": [{ "runs": [{ "t": "kept" }], "list": "bullet" }] } }),
    )
    .unwrap();
    e.apply("set_layout", json!({ "slide": s, "layout": "two-columns" }))
        .unwrap();
    let (_, kept) = slot(&e, &s, "body");
    assert_eq!(lists(&kept), [Some(ListKind::Bullet)]);
    let (_, added) = slot(&e, &s, "body2");
    assert_eq!(lists(&added), [None], "the column that was added is empty");
}

#[test]
fn an_empty_body_survives_a_save_and_undo_unchanged() {
    let mut e = engine();
    let before = bytes(e.deck());
    let s = add(&mut e, "title-body", json!({}));
    let on_slide = serde_json::to_string(e.deck().slide(&s).unwrap()).unwrap();
    assert!(
        !on_slide.contains("\"list\""),
        "nothing on the slide says list: {on_slide}"
    );
    let text = bytes(e.deck());
    assert_eq!(bytes(&crate::canonical::parse(&text).unwrap()), text);
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
    assert_eq!(e.deck().slides.len(), 1, "only the first slide remains");
    assert_eq!(e.deck().slides[0].id, first_slide(&e));
}
