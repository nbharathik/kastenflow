//! Templates: a deck's look kept as a deck to start others from, and put on a deck that exists.

use serde_json::json;

use super::{bytes, text_box};
use crate::canonical;
use crate::error::Error;
use crate::model::{Deck, Element};
use crate::ops::{Engine, NewDeck, template_of};

fn made(theme: &str, size: Option<(f64, f64)>, examples: bool) -> Engine {
    Engine::create_with(&NewDeck {
        title: "Source",
        theme,
        size,
        examples,
        seed: 5,
    })
    .unwrap()
}

/// A deck of the Pitch look at 4:3, with a layout of its own, kept as a template.
fn template() -> Deck {
    let mut source = made("Pitch", Some((960.0, 720.0)), true);
    let slide = source.deck().slides[0].id.clone();
    source
        .apply(
            "save_layout",
            json!({ "slide": slide, "label": "Side stripe", "roles": {}, "useForSlide": false }),
        )
        .unwrap();
    template_of(source.deck(), "Pitch with a stripe", true, 9)
}

fn words_of(deck: &Deck) -> String {
    deck.slides
        .iter()
        .flat_map(|s| s.elements.iter())
        .filter_map(Element::text)
        .map(|t| t.plain_text())
        .collect()
}

#[test]
fn a_template_is_the_deck_s_look_with_a_new_id_and_a_name_of_its_own() {
    let source = made("Warm Paper", None, true);
    let t = template_of(source.deck(), "My template", true, 3);
    assert_eq!(t.title, "My template");
    assert_ne!(t.id, source.deck().id);
    assert_eq!(t.theme, source.deck().theme);
    assert_eq!(t.size, source.deck().size);
    assert_eq!(t.slides.len(), 7, "the example slides stay");
    canonical::check_structure(&t).unwrap();
}

#[test]
fn a_template_keeps_no_words_of_the_deck_unless_asked_to() {
    let mut source = made("Light", None, true);
    let first = source.deck().slides[0].id.clone();
    let words = words_of(source.deck());
    assert!(words.contains("Source"));
    source
        .apply("set_notes", json!({ "slide": first, "notes": "private" }))
        .unwrap();
    let plain = template_of(source.deck(), "Look only", false, 3);
    assert_eq!(plain.slides.len(), 1);
    assert_eq!(plain.slides[0].layout, "title");
    let text = canonical::write(&plain).unwrap();
    assert!(
        !text.contains("private") && !text.contains("Source"),
        "{text}"
    );
    assert!(
        plain.slides[0]
            .elements
            .iter()
            .all(|e| e.text().is_none_or(|t| t.is_blank()))
    );
    assert_eq!(plain.theme, source.deck().theme);
}

#[test]
fn a_template_is_stripped_of_what_an_assistant_marked() {
    let source = made("Light", None, true);
    let mut deck = source.deck().clone();
    deck.slides[0].extra.insert(
        "x-agent".to_owned(),
        json!([{ "at": 1, "by": "claude", "ids": ["e-1"] }]),
    );
    let t = template_of(&deck, "T", true, 1);
    assert!(!canonical::write(&t).unwrap().contains("x-agent"));
}

#[test]
fn a_deck_made_from_a_template_has_its_look_and_its_own_id_and_title() {
    let t = template();
    let e = Engine::create_from_template(&t, "Quarterly review", true, 11).unwrap();
    let deck = e.deck();
    assert_eq!(deck.title, "Quarterly review");
    assert_ne!(deck.id, t.id);
    assert_eq!(deck.theme, t.theme);
    assert_eq!(deck.size, t.size);
    assert_eq!(deck.slides.len(), t.slides.len());
    assert!(deck.theme.layout("side-stripe").is_some());
    assert!(!e.can_undo(), "a new deck has nothing to undo");
    canonical::check_structure(deck).unwrap();
}

#[test]
fn without_the_example_slides_a_new_deck_has_one_title_slide_with_its_name_on_it() {
    let t = template();
    let e = Engine::create_from_template(&t, "Quarterly review", false, 11).unwrap();
    let deck = e.deck();
    assert_eq!(deck.slides.len(), 1);
    assert_eq!(deck.slides[0].layout, "title");
    let title = deck.slides[0]
        .elements
        .iter()
        .find(|el| el.base().placeholder.as_deref() == Some("title"))
        .and_then(Element::text)
        .map(|t| t.plain_text());
    assert_eq!(title.as_deref(), Some("Quarterly review"));
    assert!(deck.sections.is_empty());
}

#[test]
fn a_template_without_a_title_layout_starts_on_the_layout_new_slides_start_from() {
    let mut t = template();
    t.theme.layouts.retain(|l| l.name != "title");
    t.slides.clear();
    t.theme.new_slide_layout = Some("two-columns".to_owned());
    let e = Engine::create_from_template(&t, "X", false, 1).unwrap();
    assert_eq!(e.deck().slides[0].layout, "two-columns");
    t.theme.new_slide_layout = None;
    let e = Engine::create_from_template(&t, "X", false, 1).unwrap();
    assert_eq!(e.deck().slides[0].layout, t.theme.layouts[0].name);
}

#[test]
fn a_template_that_is_not_a_deck_s_look_is_refused() {
    let mut t = template();
    t.theme.layouts.clear();
    t.slides.clear();
    assert!(Engine::create_from_template(&t, "X", false, 1).is_err());
    let t = template();
    assert!(Engine::create_from_template(&t, "  ", false, 1).is_err());
}

#[test]
fn applying_a_template_changes_the_look_and_leaves_every_slide_as_it_was() {
    let mut e = made("Light", Some((960.0, 720.0)), true);
    let before: Vec<_> = e.deck().slides.clone();
    let colors = e.deck().theme.colors.clone();
    let t = template();
    let out = e
        .apply(
            "apply_template",
            json!({ "theme": t.theme, "size": t.size }),
        )
        .unwrap();
    assert!(!out.changes.is_empty());
    let deck = e.deck();
    assert_eq!(deck.theme.name, "Pitch");
    assert_ne!(deck.theme.colors, colors);
    assert!(
        deck.theme.layout("side-stripe").is_some(),
        "the template's own layouts come with it"
    );
    assert_eq!(
        deck.slides, before,
        "not a word, element or layout of a slide changed"
    );
    assert_eq!(deck.size, t.size);
    assert_eq!(deck.title, "Source", "the deck keeps its title");
}

#[test]
fn the_layouts_a_deck_has_that_the_template_lacks_stay_with_their_slides() {
    let mut e = made("Light", None, false);
    let s = e.deck().slides[0].id.clone();
    let heading = text_box(&mut e, &s, 80.0, 40.0, 800.0, 90.0, "Heading");
    e.apply(
        "save_layout",
        json!({ "slide": s, "label": "Poster", "roles": { heading: "title" } }),
    )
    .unwrap();
    let t = template();
    e.apply(
        "apply_template",
        json!({ "theme": t.theme, "size": t.size }),
    )
    .unwrap();
    assert_eq!(e.deck().slide(&s).unwrap().layout, "poster");
    assert!(e.deck().theme.layout("poster").is_some());
    assert!(
        e.deck()
            .theme
            .layouts
            .iter()
            .position(|l| l.name == "poster")
            .unwrap()
            >= t.theme.layouts.len(),
        "after the template's own"
    );
    canonical::check_structure(e.deck()).unwrap();
}

#[test]
fn a_template_for_another_shape_is_fitted_to_the_deck_unless_the_deck_is_to_take_its_shape() {
    let t = template();
    assert_eq!(t.size.h, 720.0);
    let mut e = made("Light", None, true);
    e.apply(
        "apply_template",
        json!({ "theme": t.theme, "size": t.size }),
    )
    .unwrap();
    assert_eq!(
        (e.deck().size.w, e.deck().size.h),
        (960.0, 540.0),
        "the deck keeps its shape"
    );
    let body = e
        .deck()
        .theme
        .layout("title-body")
        .unwrap()
        .placeholder("body")
        .unwrap()
        .clone();
    let drawn = crate::themes::by_name_sized("Pitch", &e.deck().size)
        .unwrap()
        .layout("title-body")
        .unwrap()
        .placeholder("body")
        .unwrap()
        .clone();
    assert!(
        (body.y - drawn.y).abs() < 0.1 && (body.h - drawn.h).abs() < 0.1,
        "{body:?} {drawn:?}"
    );

    let mut e = made("Light", None, true);
    let s = e.deck().slides[0].id.clone();
    let b = text_box(&mut e, &s, 100.0, 90.0, 200.0, 90.0, "box");
    e.apply(
        "apply_template",
        json!({ "theme": t.theme, "size": t.size, "resize": true }),
    )
    .unwrap();
    assert_eq!((e.deck().size.w, e.deck().size.h), (960.0, 720.0));
    let moved = e
        .deck()
        .slide(&s)
        .unwrap()
        .element(&b)
        .unwrap()
        .base()
        .rect()
        .unwrap();
    assert_eq!(
        moved,
        (100.0, 120.0, 200.0, 120.0),
        "the box grew with the slide"
    );
}

#[test]
fn a_logo_set_on_the_deck_goes_in_the_logo_slot_the_template_has() {
    let mut e = made("Light", None, true);
    e.apply("set_logo", json!({ "src": "assets/logo.png" }))
        .unwrap();
    let t = Engine::create_with(&NewDeck {
        title: "T",
        theme: "Lecture",
        size: None,
        examples: false,
        seed: 1,
    })
    .unwrap();
    e.apply(
        "apply_template",
        json!({ "theme": t.deck().theme, "size": t.deck().size }),
    )
    .unwrap();
    let has = e
        .deck()
        .theme
        .master
        .iter()
        .any(|m| matches!(m, Element::Image(i) if i.src == "assets/logo.png"));
    assert!(has, "{:?}", e.deck().theme.master);
}

#[test]
fn applying_a_template_is_one_step_of_undo_and_a_broken_one_changes_nothing() {
    let mut e = made("Light", None, true);
    let before = bytes(e.deck());
    let t = template();
    e.apply(
        "apply_template",
        json!({ "theme": t.theme, "size": t.size, "resize": true }),
    )
    .unwrap();
    assert_ne!(bytes(e.deck()), before);
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
    assert!(!e.can_undo());

    let mut bad = serde_json::to_value(&t.theme).unwrap();
    bad["colors"]["accent1"] = json!("blue");
    let Err(Error::BadInput { message, .. }) =
        e.apply("apply_template", json!({ "theme": bad, "size": t.size }))
    else {
        panic!("a colour that is not #rrggbb")
    };
    assert!(message.contains("accent1"), "{message}");
    let Err(Error::BadInput { .. }) = e.apply(
        "apply_template",
        json!({ "theme": t.theme, "size": { "w": 10, "h": 10 } }),
    ) else {
        panic!("a slide that small")
    };
    assert_eq!(bytes(e.deck()), before);
}
