//! What format 2 added, through the operations: a run's highlight, a citation's links and a page
//! source's made. Each makes the deck version 2 while it is there, and nothing else does.

use serde_json::{Value, json};

use super::{add, bytes, engine, first_slide, text_box};
use crate::canonical;
use crate::model::Element;
use crate::ops::Engine;

/// The version the deck is written with.
fn version(e: &Engine) -> u64 {
    let value: Value = serde_json::from_str(&bytes(e.deck())).unwrap();
    value["formatVersion"].as_u64().unwrap()
}

fn words(runs: Value) -> Value {
    json!({ "paragraphs": [{ "runs": runs }] })
}

#[test]
fn a_highlight_is_a_colour_behind_words_and_the_deck_is_version_two_while_it_is_there() {
    let mut e = engine();
    let s = first_slide(&e);
    let t = text_box(&mut e, &s, 100.0, 300.0, 400.0, 60.0, "plain");
    let before = bytes(e.deck());
    assert_eq!(version(&e), 1);
    for color in ["accent2", "text1", "#ffee00", "#fe0"] {
        e.apply(
            "set_rich_text",
            json!({ "slide": s, "id": t, "text": words(json!([{ "t": "a " }, { "t": "marked", "highlight": color }])) }),
        )
        .unwrap();
        assert_eq!(version(&e), 2, "{color}");
        let text = bytes(e.deck());
        let back = canonical::parse(&text).unwrap();
        assert_eq!(canonical::write(&back).unwrap(), text);
        let run = &back
            .slide(&s)
            .and_then(|sl| sl.element(&t))
            .and_then(Element::text)
            .unwrap()
            .paragraphs[0]
            .runs[1];
        assert_eq!(run.highlight.as_deref(), Some(color));
    }
    // Taking it away is version 1 again, and the bytes there were.
    e.apply(
        "set_rich_text",
        json!({ "slide": s, "id": t, "text": words(json!([{ "t": "plain" }])) }),
    )
    .unwrap();
    assert_eq!(version(&e), 1);
    assert_eq!(bytes(e.deck()), before);
    // And an undo of the first highlight is exact.
    while e.undo().is_some() {}
    assert_eq!(version(&e), 1);
}

#[test]
fn a_highlight_that_is_not_a_colour_is_refused_and_changes_nothing() {
    let mut e = engine();
    let s = first_slide(&e);
    let t = text_box(&mut e, &s, 100.0, 300.0, 400.0, 60.0, "plain");
    let before = bytes(e.deck());
    for bad in ["yellow", "#12", "accent9", "", "rgb(1,2,3)"] {
        let err = e
            .apply(
                "set_rich_text",
                json!({ "slide": s, "id": t, "text": words(json!([{ "t": "x", "highlight": bad }])) }),
            )
            .expect_err("not a colour")
            .to_string();
        assert!(err.contains("is not a theme colour"), "{bad}: {err}");
        assert_eq!(bytes(e.deck()), before);
    }
    // The same goes for words put in an element when it is added.
    let err = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [{ "type": "text", "x": 0, "y": 0, "w": 100, "h": 40,
                "text": words(json!([{ "t": "x", "highlight": "yellow" }])) }] }),
        )
        .expect_err("not a colour")
        .to_string();
    assert!(err.contains("`yellow` is not a theme colour"), "{err}");
}

#[test]
fn words_in_markdown_never_carry_a_highlight_and_a_copy_keeps_the_one_it_has() {
    let mut e = engine();
    let s = first_slide(&e);
    let t = text_box(&mut e, &s, 100.0, 300.0, 400.0, 60.0, "x");
    e.apply(
        "set_text",
        json!({ "slide": s, "id": t, "markdown": "**bold** and `code`" }),
    )
    .unwrap();
    assert_eq!(version(&e), 1);
    e.apply(
        "set_rich_text",
        json!({ "slide": s, "id": t, "text": words(json!([{ "t": "marked", "highlight": "accent1" }])) }),
    )
    .unwrap();
    let copy = e
        .apply("duplicate_elements", json!({ "slide": s, "ids": [t] }))
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let run = &e
        .deck()
        .slide(&s)
        .and_then(|sl| sl.element(&copy))
        .and_then(Element::text)
        .unwrap()
        .paragraphs[0]
        .runs[0];
    assert_eq!(run.highlight.as_deref(), Some("accent1"));
}

#[test]
fn a_citation_that_links_its_works_makes_the_deck_version_two_until_it_stops() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    e.apply(
        "add_elements",
        json!({ "slide": s, "elements": [{ "type": "citation", "id": "cite", "x": 64, "y": 480, "w": 600, "h": 30, "keys": ["a"] }] }),
    )
    .unwrap();
    assert_eq!(version(&e), 1);
    let plain = bytes(e.deck());
    e.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": "cite", "patch": { "links": true } }] }),
    )
    .unwrap();
    assert_eq!(version(&e), 2);
    let Some(Element::Citation(c)) = e.deck().slide(&s).and_then(|sl| sl.element("cite")) else {
        panic!("a citation")
    };
    assert!(c.links);
    // Adding a key to the citation does not change whether it links.
    e.apply("add_citation", json!({ "slide": s, "keys": ["b"] }))
        .unwrap();
    assert_eq!(version(&e), 2);
    e.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": "cite", "patch": { "links": null } }] }),
    )
    .unwrap();
    assert_eq!(version(&e), 1);
    assert!(!bytes(e.deck()).contains("\"links\""), "off is not written");
    assert_ne!(bytes(e.deck()), plain, "the extra key is still there");
}

#[test]
fn a_page_source_that_says_how_it_was_made_is_kept_through_an_update_and_makes_version_two() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let source = json!({ "page": "library/plan.md", "kind": "contents", "sync": true, "made": "storyboard" });
    e.apply(
        "add_page_contents",
        json!({ "slide": s, "markdown": "Some words.", "source": source }),
    )
    .unwrap();
    assert_eq!(version(&e), 2);
    let (id, made) = {
        let el = e
            .deck()
            .slide(&s)
            .unwrap()
            .elements
            .iter()
            .find(|el| el.base().source.is_some())
            .unwrap();
        (
            el.id().to_owned(),
            el.base().source.as_ref().and_then(|src| src.made.clone()),
        )
    };
    assert_eq!(made.as_deref(), Some("storyboard"));
    e.apply(
        "update_page_contents",
        json!({ "slide": s, "id": id, "markdown": "Other words.", "title": "Plan" }),
    )
    .unwrap();
    let after = e
        .deck()
        .slide(&s)
        .and_then(|sl| sl.element(&id))
        .and_then(|el| el.base().source.as_ref())
        .and_then(|src| src.made.clone());
    assert_eq!(after.as_deref(), Some("storyboard"));
    // Breaking the link takes the source, and the deck is version 1 again.
    e.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": id, "patch": { "source": null } }] }),
    )
    .unwrap();
    assert_eq!(version(&e), 1);
}
