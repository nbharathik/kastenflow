//! The deck's choice of slide numbers reaches the exported file: with them off no master or layout
//! carries a number field, with them on the master does, and a number a slide holds as its own text
//! is written whatever the deck says.

mod common;

use slides_core::Deck;
use slides_pptx::{Options, export};

use common::inspect;
use common::{Files, decks, variety};

/// The parts of the exported package that hold a slide number field.
fn parts_with_number(deck: &Deck, files: &Files) -> Vec<String> {
    let exported = export(deck, files, &Options::default()).unwrap_or_else(|e| panic!("{e}"));
    let package = inspect::open(&exported.bytes);
    package
        .parts
        .iter()
        .filter(|(name, _)| inspect::is_xml(name))
        .filter(|(_, bytes)| String::from_utf8_lossy(bytes).contains(r#"type="slidenum""#))
        .map(|(name, _)| name.clone())
        .collect()
}

fn with_numbers((mut deck, files): (Deck, Files), on: bool) -> (Deck, Files) {
    deck.present.slide_numbers = on;
    (deck, files)
}

#[test]
fn a_deck_without_slide_numbers_exports_no_number_in_its_master_or_layouts() {
    for theme in ["Light", "Dark", "Serif", "Lecture"] {
        let (deck, files) = with_numbers(decks::every_element(theme), false);
        let found = parts_with_number(&deck, &files);
        assert!(
            found.iter().all(|name| name.starts_with("ppt/slides/")),
            "{theme}: a master or layout still draws the number: {found:?}"
        );
    }
}

#[test]
fn a_new_deck_exports_without_numbers_and_one_that_asks_for_them_has_them_on_the_master() {
    let (deck, files) = decks::demo();
    // The decks the tests make are new decks: they start without numbers.
    assert!(!deck.present.slide_numbers);
    assert!(
        parts_with_number(&deck, &files)
            .iter()
            .all(|n| n.starts_with("ppt/slides/"))
    );
    for theme in ["Light", "Dark", "Serif", "Lecture"] {
        let (deck, files) = with_numbers(decks::every_element(theme), true);
        let found = parts_with_number(&deck, &files);
        assert!(
            found
                .iter()
                .any(|name| name.starts_with("ppt/slideMasters/")),
            "{theme}: the master has no number: {found:?}"
        );
    }
}

#[test]
fn a_number_a_slide_holds_as_its_own_text_is_written_whatever_the_deck_says() {
    let (deck, files) = with_numbers(variety::text_heavy(), false);
    let found = parts_with_number(&deck, &files);
    assert!(
        found.iter().any(|name| name.starts_with("ppt/slides/")),
        "the slide's own field is gone: {found:?}"
    );
    assert!(
        found.iter().all(|name| name.starts_with("ppt/slides/")),
        "{found:?}"
    );
}
