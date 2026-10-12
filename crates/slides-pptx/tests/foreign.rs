//! Files that other programs made, in `fixtures/decks/pptx`: this crate's own export of the sample
//! deck (as it was written before list markers had styles, and as it is written now) and the same
//! file saved again by LibreOffice. They are made once and committed; a test only reads them.
//! Everything imports, and nothing is dropped.

mod common;

use std::fs;
use std::path::PathBuf;

use slides_core::{Deck, Element, ListKind, ListStyle, Slide};
use slides_pptx::{Options, export};

use common::compare;
use common::foreign::{all, fixture, sample, title, words};

/// Writes `exported-current.pptx`, this crate's export of the sample deck as decks are written
/// now. Run it by hand when the way a deck is written changes:
/// `cargo test -p slides-pptx --test foreign write_the_current_export -- --ignored`.
#[test]
#[ignore = "writes fixtures/decks/pptx/exported-current.pptx; run by hand"]
fn write_the_current_export() {
    let exported = export(&sample(), &common::Files::default(), &Options::default())
        .unwrap_or_else(|e| panic!("{e}"));
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/decks/pptx/exported-current.pptx");
    fs::write(&path, exported.bytes).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
}

#[test]
fn our_own_export_of_the_sample_deck_comes_back_as_the_sample_deck() {
    let imported = fixture("exported-current.pptx");
    assert!(
        imported.report.warnings.is_empty(),
        "{:?}",
        imported.report.warnings
    );
    assert!(imported.report.raw.is_empty());
    let diff = compare::compare(&sample(), &Options::default(), &imported, &|_| None);
    assert!(diff.is_empty(), "{}", diff.join("\n"));
}

#[test]
fn an_export_from_before_markers_had_styles_keeps_the_markers_it_wrote() {
    let imported = fixture("exported.pptx");
    assert!(
        imported.report.warnings.is_empty(),
        "{:?}",
        imported.report.warnings
    );
    assert!(imported.report.raw.is_empty());
    let (a, b) = (sample(), &imported.deck);
    assert_eq!(b.slides.len(), a.slides.len());
    for (want, got) in a.slides.iter().zip(&b.slides) {
        assert_eq!(title(got), title(want), "slide titles");
    }
    // The first slide's list: the same words and levels, each marker the one the file drew (a dash on
    // the second level, hung from 24 and 48) and not the one the deck would have given it.
    let items: Vec<_> = b
        .slides
        .iter()
        .flat_map(all)
        .filter_map(|e| match e {
            Element::Text(t) => Some(&t.text.paragraphs),
            _ => None,
        })
        .flatten()
        .filter(|p| p.list == Some(ListKind::Bullet))
        .collect();
    assert!(items.len() >= 5, "{} bullets", items.len());
    for p in items {
        let (style, margin) = match p.level.unwrap_or(0) {
            0 => (None, 24.0),
            _ => (Some(ListStyle::Dash), 48.0),
        };
        assert_eq!(p.list_style, style, "{:?}", p.runs);
        assert_eq!(p.margin_left, Some(margin), "{:?}", p.runs);
    }
}

#[test]
fn the_libreoffice_copy_keeps_every_slide_word_shape_and_join() {
    let (a, b) = (sample(), fixture("libreoffice.pptx"));
    assert!(
        b.report.raw.is_empty() && b.report.warnings.is_empty(),
        "{:?}",
        b.report
    );
    let deck = &b.deck;
    assert_eq!(deck.slides.len(), a.slides.len());
    assert_eq!((deck.size.w, deck.size.h), (a.size.w, a.size.h));
    for (want, got) in a.slides.iter().zip(&deck.slides) {
        assert_eq!(title(got), title(want), "slide titles");
        assert_eq!(
            got.notes.trim(),
            want.notes.trim(),
            "notes of {}",
            title(want)
        );
        // The same words, shape for shape, in the same order.
        let said = |s: &Slide| {
            all(s)
                .iter()
                .map(|e| words(e))
                .filter(|w| !w.is_empty())
                .collect::<Vec<_>>()
        };
        assert_eq!(said(got), said(want), "words on {}", title(want));
        let kinds = |s: &Slide| {
            let mut k: Vec<&str> = all(s).iter().map(|e| e.kind()).collect();
            k.sort_unstable();
            k
        };
        assert_eq!(kinds(got), kinds(want), "elements on {}", title(want));
    }
    // Both arrows still join the boxes they joined.
    let joined = |deck: &Deck| {
        deck.slides
            .iter()
            .flat_map(all)
            .filter(|e| matches!(e, Element::Connector(c) if c.from.is_some() && c.to.is_some()))
            .count()
    };
    assert_eq!(joined(deck), joined(&a));
    assert!(joined(deck) >= 2);
    // The table keeps its shape.
    let table = |deck: &Deck| {
        deck.slides.iter().flat_map(all).find_map(|e| match e {
            Element::Table(t) => Some((t.columns.len(), t.rows.len())),
            _ => None,
        })
    };
    assert_eq!(table(deck), table(&a));
}
