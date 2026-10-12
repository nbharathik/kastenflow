//! Pages of the host in a deck: contents and sections as elements, made again when the page changes, and pages as slides.

use serde_json::{Value, json};

use super::{add, bytes, element, engine, first_slide};
use crate::canonical;
use crate::error::Error;
use crate::model::{Element, ListKind, SourceKind};
use crate::ops::Engine;

const PLAN: &str =
    "---\ntitle: Plan\n---\n## Plan\n\nOne **idea** per card.\n\n- first\n- second\n";
const WITH_PICTURE: &str = "## Plan\n\nWords here.\n\n![A cat](assets/cat.png)\n";

fn source(kind: &str) -> Value {
    json!({ "page": "library/plan.md", "kind": kind, "title": "Plan", "section": if kind == "section" { json!("Plan") } else { Value::Null }, "sync": true })
}

fn blank(e: &mut Engine) -> String {
    add(e, "blank", json!({}))
}

fn put(e: &mut Engine, slide: &str, markdown: &str, kind: &str) -> Value {
    e.apply(
        "add_page_contents",
        json!({ "slide": slide, "markdown": markdown, "source": source(kind) }),
    )
    .unwrap()
    .output
}

#[test]
fn a_section_of_words_is_one_text_box_that_remembers_its_page() {
    let mut e = engine();
    let s = blank(&mut e);
    let before = bytes(e.deck());
    let out = put(&mut e, &s, PLAN, "section");
    let id = out["id"].as_str().unwrap();
    assert_eq!(
        out["parts"].as_array().unwrap().len(),
        0,
        "a text box holds nothing"
    );
    let held = element(&e, &s, id);
    let Element::Text(text) = held else {
        panic!("a text box")
    };
    assert_eq!(text.text.paragraphs[0].style.as_deref(), Some("subtitle"));
    assert_eq!(text.text.paragraphs[2].list, Some(ListKind::Bullet));
    let source = held.base().source.as_ref().expect("a source");
    assert_eq!(
        (
            source.page.as_str(),
            source.kind.clone(),
            source.section.as_deref()
        ),
        ("library/plan.md", SourceKind::Section, Some("Plan"))
    );
    assert!(source.sync);
    assert_eq!(source.hash.as_deref().map(str::len), Some(16));
    assert_eq!(source.markdown, None, "the elements are the snapshot");
    assert_eq!(held.base().name.as_deref(), Some("Section: Plan"));
    // It is in the body place of the layout, or under the title: inside the slide.
    let (x, y, w, h) = held.base().rect().unwrap();
    assert!(x >= 0.0 && y >= 0.0 && x + w <= 960.0 && y + h <= 540.0);
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
    e.redo().unwrap();
    assert!(e.deck().slide(&s).unwrap().element(id).is_some());
}

#[test]
fn the_contents_of_a_whole_page_are_marked_as_contents_even_when_asked_for_as_a_section_with_no_heading()
 {
    let mut e = engine();
    let s = blank(&mut e);
    let out = put(&mut e, &s, PLAN, "contents");
    let kind = element(&e, &s, out["id"].as_str().unwrap())
        .base()
        .source
        .as_ref()
        .unwrap()
        .kind
        .clone();
    assert_eq!(kind, SourceKind::Contents);
    assert_eq!(
        element(&e, &s, out["id"].as_str().unwrap())
            .base()
            .name
            .as_deref(),
        Some("Page: Plan")
    );
}

#[test]
fn contents_with_no_source_are_plain_elements_that_remember_nothing() {
    let mut e = engine();
    let s = blank(&mut e);
    let out = e
        .apply(
            "add_page_contents",
            json!({ "slide": s, "markdown": WITH_PICTURE }),
        )
        .unwrap()
        .output;
    let held = element(&e, &s, out["id"].as_str().unwrap());
    assert!(held.base().source.is_none());
    assert_eq!(held.base().name.as_deref(), Some("Page contents"));
    assert!(
        matches!(held, Element::Group(g) if g.children.iter().all(|c| c.base().source.is_none()))
    );
}

#[test]
fn words_with_a_picture_are_a_group_and_the_group_carries_the_source() {
    let mut e = engine();
    let s = blank(&mut e);
    let out = put(&mut e, &s, WITH_PICTURE, "section");
    let id = out["id"].as_str().unwrap();
    let Element::Group(group) = element(&e, &s, id) else {
        panic!("a group")
    };
    assert_eq!(group.children.len(), 2);
    assert!(
        matches!(&group.children[0], Element::Text(_))
            && matches!(&group.children[1], Element::Image(i) if i.src == "assets/cat.png")
    );
    assert_eq!(out["parts"].as_array().unwrap().len(), 2);
    assert!(
        group.base.source.is_some() && group.children.iter().all(|c| c.base().source.is_none())
    );
    assert!(
        group
            .children
            .iter()
            .all(|c| !c.id().is_empty() && c.id() != id)
    );
    canonical::check_structure(e.deck()).unwrap();
}

#[test]
fn the_place_may_be_named_and_the_picture_sizes_kept_in_shape() {
    let mut e = engine();
    let s = blank(&mut e);
    let out = e
        .apply(
            "add_page_contents",
            json!({ "slide": s, "markdown": "![x](assets/wide.png)", "source": source("contents"),
                "area": { "x": 100, "y": 100, "w": 400, "h": 300 }, "sizes": { "assets/wide.png": [800, 200] } }),
        )
        .unwrap()
        .output;
    let held = element(&e, &s, out["id"].as_str().unwrap());
    let (x, y, w, h) = held.base().rect().unwrap();
    assert_eq!((x, y, w, h), (100.0, 100.0, 400.0, 100.0));
}

#[test]
fn a_page_with_nothing_on_it_is_refused_and_changes_nothing() {
    let mut e = engine();
    let s = blank(&mut e);
    let before = bytes(e.deck());
    let error = e
        .apply("add_page_contents", json!({ "slide": s, "markdown": "---\ntitle: Empty\n---\n", "source": source("contents") }))
        .unwrap_err();
    assert!(matches!(error, Error::BadInput { .. }));
    assert_eq!(bytes(e.deck()), before);
    assert!(matches!(
        e.apply(
            "add_page_contents",
            json!({ "slide": "s-none", "markdown": PLAN, "source": source("contents") })
        ),
        Err(Error::NoSuchSlide { .. })
    ));
}

#[test]
fn update_from_page_makes_it_again_in_the_same_place_keeping_what_the_person_set() {
    let mut e = engine();
    let s = blank(&mut e);
    let out = put(&mut e, &s, PLAN, "section");
    let id = out["id"].as_str().unwrap().to_owned();
    e.apply("patch_elements", json!({ "slide": s, "patches": [{ "id": id, "patch": { "name": "My notes", "link": "https://example.com", "alt": "Plan" } }] })).unwrap();
    e.apply(
        "transform_elements",
        json!({ "slide": s, "items": [{ "id": id, "x": 80, "y": 120, "w": 500, "h": 300 }] }),
    )
    .unwrap();
    e.apply("set_slide_steps", json!({ "slide": s, "steps": 2 }))
        .unwrap();
    e.apply(
        "set_step_states",
        json!({ "slide": s, "id": id, "states": { "0": "hidden", "1": "normal" } }),
    )
    .unwrap();
    let before = bytes(e.deck());

    let changed = e
        .apply("update_page_contents", json!({ "slide": s, "id": id, "markdown": "## Plan\n\nA new idea.\n\n- only one\n", "title": "Plan v2" }))
        .unwrap()
        .output;
    assert_eq!(changed["changed"], true);
    let held = element(&e, &s, &id);
    assert_eq!(
        held.base().rect(),
        Some((80.0, 120.0, 500.0, 300.0)),
        "the same place and size"
    );
    assert_eq!(
        held.base().name.as_deref(),
        Some("My notes"),
        "a name the person gave stays"
    );
    assert_eq!(
        (held.base().link.as_deref(), held.base().alt.as_deref()),
        (Some("https://example.com"), Some("Plan"))
    );
    assert_eq!(held.base().step_states.len(), 2);
    assert_eq!(
        held.base().source.as_ref().unwrap().title.as_deref(),
        Some("Plan v2")
    );
    assert!(held.text().unwrap().plain_text().contains("A new idea."));
    assert_eq!(e.deck().slide(&s).unwrap().elements.len(), 1);
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);

    // The same page again says nothing has changed, and the element is made again all the same.
    let same = e
        .apply(
            "update_page_contents",
            json!({ "slide": s, "id": id, "markdown": PLAN }),
        )
        .unwrap()
        .output;
    assert_eq!(same["changed"], false);
}

#[test]
fn update_from_page_turns_a_text_box_into_a_group_when_the_page_gained_a_picture() {
    let mut e = engine();
    let s = blank(&mut e);
    let out = put(&mut e, &s, "## Plan\n\nWords.\n", "section");
    let id = out["id"].as_str().unwrap().to_owned();
    e.apply(
        "update_page_contents",
        json!({ "slide": s, "id": id, "markdown": WITH_PICTURE }),
    )
    .unwrap();
    let held = element(&e, &s, &id);
    assert!(matches!(held, Element::Group(g) if g.children.len() == 2));
    assert_eq!(
        held.base().source.as_ref().unwrap().kind,
        SourceKind::Section
    );
    canonical::check_structure(e.deck()).unwrap();
    e.apply(
        "update_page_contents",
        json!({ "slide": s, "id": id, "markdown": "## Plan\n\nBack to words.\n" }),
    )
    .unwrap();
    assert!(matches!(element(&e, &s, &id), Element::Text(_)));
}

#[test]
fn only_what_came_from_a_page_can_be_updated_from_it() {
    let mut e = engine();
    let s = blank(&mut e);
    let plain = super::text_box(&mut e, &s, 0.0, 0.0, 100.0, 40.0, "typed");
    let before = bytes(e.deck());
    let Error::Refused { message } = e
        .apply(
            "update_page_contents",
            json!({ "slide": s, "id": plain, "markdown": PLAN }),
        )
        .unwrap_err()
    else {
        panic!("refused")
    };
    assert!(message.contains("not made from a page"), "{message}");
    assert_eq!(bytes(e.deck()), before);
    assert!(matches!(
        e.apply(
            "update_page_contents",
            json!({ "slide": s, "id": "e-none", "markdown": PLAN })
        ),
        Err(Error::NoSuchElement { .. })
    ));
}

#[test]
fn breaking_the_link_is_a_patch_that_leaves_the_elements_as_they_are() {
    let mut e = engine();
    let s = blank(&mut e);
    let out = put(&mut e, &s, WITH_PICTURE, "section");
    let id = out["id"].as_str().unwrap().to_owned();
    e.apply(
        "patch_elements",
        json!({ "slide": s, "patches": [{ "id": id, "patch": { "source": null } }] }),
    )
    .unwrap();
    let held = element(&e, &s, &id);
    assert!(held.base().source.is_none());
    assert!(matches!(held, Element::Group(g) if g.children.len() == 2));
    assert!(matches!(
        e.apply(
            "update_page_contents",
            json!({ "slide": s, "id": id, "markdown": PLAN })
        ),
        Err(Error::Refused { .. })
    ));
}

#[test]
fn a_deck_with_a_page_in_it_writes_and_reads_back_the_same() {
    let mut e = engine();
    let s = blank(&mut e);
    put(&mut e, &s, WITH_PICTURE, "section");
    let text = bytes(e.deck());
    assert!(text.contains("\"source\""));
    assert_eq!(bytes(&canonical::parse(&text).unwrap()), text);
}

#[test]
fn a_page_as_slides_makes_one_for_each_section_with_its_title_and_words() {
    let mut e = engine();
    let first = first_slide(&e);
    let before = bytes(e.deck());
    let page = "# Talk\n\nBefore the sections.\n\n## One\n\n- a\n- b\n\n## Two\n\nSome words.\n\n![A cat](assets/cat.png)\n";
    let out = e
        .apply(
            "add_page_slides",
            json!({ "markdown": page, "title": "The talk", "after": first }),
        )
        .unwrap()
        .output;
    let slides: Vec<String> = out["slides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        slides.len(),
        3,
        "the title's own slide, then one for each section"
    );
    assert_eq!(e.deck().slides.len(), 4);
    assert_eq!(e.deck().slides[1].id, slides[0], "after the slide named");
    let title_of = |id: &str| {
        e.deck()
            .slide(id)
            .unwrap()
            .elements
            .iter()
            .find(|x| x.base().placeholder.as_deref() == Some("title"))
            .and_then(|x| x.text().map(|t| t.plain_text()))
            .unwrap()
    };
    assert_eq!(
        [
            title_of(&slides[0]),
            title_of(&slides[1]),
            title_of(&slides[2])
        ],
        ["Talk", "One", "Two"]
    );
    let body = |id: &str| {
        e.deck()
            .slide(id)
            .unwrap()
            .elements
            .iter()
            .find(|x| x.base().placeholder.as_deref() == Some("body"))
            .cloned()
            .unwrap()
    };
    assert_eq!(
        body(&slides[0]).text().unwrap().plain_text(),
        "Before the sections."
    );
    let list = body(&slides[1]);
    assert_eq!(list.text().unwrap().plain_text(), "a\nb");
    assert_eq!(
        list.text().unwrap().paragraphs[0].list,
        Some(ListKind::Bullet)
    );
    // A section with a picture gives the words part of the place and the picture the rest.
    let words = body(&slides[2]);
    let slot = e
        .deck()
        .theme
        .layout("title-body")
        .unwrap()
        .placeholder("body")
        .unwrap()
        .w;
    assert!(words.base().w.unwrap() < slot, "narrower than the slot");
    let picture = e
        .deck()
        .slide(&slides[2])
        .unwrap()
        .elements
        .iter()
        .find(|x| matches!(x, Element::Image(_)))
        .cloned()
        .unwrap();
    assert!(picture.base().x.unwrap() > words.base().x.unwrap() + words.base().w.unwrap());
    canonical::check_structure(e.deck()).unwrap();
    // One step of undo takes every slide away.
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn a_page_may_be_cut_at_a_level_of_the_askers_choice_and_on_a_layout_of_the_decks_theme() {
    let mut e = engine();
    let page = "## One\n\nx\n\n### Inside\n\ny\n\n## Two\n\nz\n";
    let whole = e
        .apply(
            "add_page_slides",
            json!({ "markdown": page, "title": "T", "split": 3 }),
        )
        .unwrap()
        .output;
    assert_eq!(
        whole["slides"].as_array().unwrap().len(),
        3,
        "One, Inside and Two"
    );
    let two = e
        .apply(
            "add_page_slides",
            json!({ "markdown": page, "title": "T", "layout": "title-only" }),
        )
        .unwrap()
        .output;
    assert_eq!(two["slides"].as_array().unwrap().len(), 2);
    let id = two["slides"][0].as_str().unwrap();
    assert_eq!(e.deck().slide(id).unwrap().layout, "title-only");
}

#[test]
fn a_page_as_slides_refuses_what_it_cannot_do_and_changes_nothing() {
    let mut e = engine();
    let before = bytes(e.deck());
    assert!(matches!(
        e.apply(
            "add_page_slides",
            json!({ "markdown": "---\nx: 1\n---\n", "title": "T" })
        ),
        Err(Error::BadInput { .. })
    ));
    assert!(matches!(
        e.apply(
            "add_page_slides",
            json!({ "markdown": "## A\n", "title": "T", "layout": "no-such" })
        ),
        Err(Error::BadInput { .. })
    ));
    assert!(matches!(
        e.apply(
            "add_page_slides",
            json!({ "markdown": "## A\n", "title": "T", "after": "s-none" })
        ),
        Err(Error::NoSuchSlide { .. })
    ));
    assert_eq!(bytes(e.deck()), before);
    assert!(!e.can_undo());
}
