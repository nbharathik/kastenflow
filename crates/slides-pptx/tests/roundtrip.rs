//! A deck exported and imported again is the deck it was, to within half a
//! unit and a tenth of a degree: same slides, same elements in the same
//! places, same words and looks, same notes and flags. What a file cannot hold
//! is not counted against it (see `common::compare`).

mod common;

use std::fs;
use std::path::PathBuf;

use slides_core::{Deck, Element};
use slides_pptx::import::{ImportOptions, Imported, import};
use slides_pptx::{Options, export};

use common::pictures::pictures_for;
use common::{Files, compare, decks, lists, variety};

fn fixtures() -> Vec<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/decks");
    let mut found: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "deck"))
        .collect();
    found.sort();
    found
}

fn there_and_back(name: &str, deck: &Deck, files: Files) -> (Imported, Vec<String>) {
    let files = pictures_for(deck, files);
    let options = Options::default();
    let exported = export(deck, &files, &options).unwrap_or_else(|e| panic!("{name}: {e}"));
    let imported = import(&exported.bytes, &ImportOptions::default())
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    let diff = compare::compare(deck, &options, &imported, &|p| files.0.get(p).cloned());
    (imported, diff)
}

fn assert_same(name: &str, deck: &Deck, files: Files) -> Imported {
    let (imported, diff) = there_and_back(name, deck, files);
    assert!(
        diff.is_empty(),
        "{name} does not come back as it went:\n{}",
        diff.join("\n")
    );
    imported
}

#[test]
fn every_fixture_deck_comes_back_as_it_went() {
    let paths = fixtures();
    assert!(paths.len() >= 5, "the fixture decks are missing: {paths:?}");
    for path in paths {
        let name = path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
        let deck = slides_core::parse(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_same(&name, &deck, Files::default());
    }
}

#[test]
fn the_demo_deck_comes_back_as_it_went() {
    let (deck, files) = decks::demo();
    assert_same("demo", &deck, files);
}

#[test]
fn text_in_every_look_comes_back_as_it_went() {
    let (deck, files) = variety::text_heavy();
    assert_same("text heavy", &deck, files);
}

#[test]
fn lists_in_every_style_and_the_settings_of_a_box_come_back_as_they_went() {
    let (deck, files) = lists::list_looks();
    assert_same("list looks", &deck, files);
}

#[test]
fn turned_and_mirrored_shapes_come_back_in_their_places() {
    let (deck, files) = variety::turned();
    assert_same("turned", &deck, files);
}

#[test]
fn a_four_by_three_deck_and_a_deck_with_sections_and_hidden_slides_come_back() {
    let (deck, files) = variety::four_three();
    assert_same("four by three", &deck, files);
    let (deck, files) = variety::sectioned();
    let back = assert_same("sectioned", &deck, files);
    assert_eq!(
        back.report.hidden,
        back.deck.slides.iter().filter(|s| s.hidden).count()
    );
}

#[test]
fn every_theme_comes_back_with_all_its_layouts() {
    for (theme, deck, files) in variety::every_theme() {
        assert_same(&theme, &deck, files);
    }
}

/// What a person gets from New deck: each template with its example slides, at every page size on offer. Each is
/// exported and read back as it went, and the file is the size of the slide the deck has.
#[test]
fn every_template_with_its_example_slides_comes_back_at_every_page_size() {
    for theme in slides_core::themes::all() {
        for (preset, w, h) in slides_core::resize::PAGE_SIZES {
            let name = format!("{} at {preset}", theme.name);
            let deck = slides_core::Engine::create_with(&slides_core::NewDeck {
                title: "A talk about something",
                theme: &theme.name,
                size: Some((w, h)),
                examples: true,
                seed: 5,
            })
            .unwrap_or_else(|e| panic!("{name}: {e}"))
            .into_deck();
            let back = assert_same(&name, &deck, Files::default());
            assert_eq!(
                (back.deck.size.w, back.deck.size.h),
                (w, h),
                "{name} comes back at its own size"
            );
            assert_eq!(back.deck.slides.len(), 7, "{name}");
        }
    }
}

/// The comparison is only worth having if it fails when it should.
#[test]
fn the_comparison_notices_what_went_wrong() {
    let (deck, files) = decks::demo();
    let files = pictures_for(&deck, files);
    let options = Options::default();
    let exported = export(&deck, &files, &options).unwrap_or_else(|e| panic!("{e}"));
    let imported =
        import(&exported.bytes, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let media = |p: &str| files.0.get(p).cloned();
    assert!(compare::compare(&deck, &options, &imported, &media).is_empty());

    let broken = |change: &dyn Fn(&mut Deck)| {
        let mut wrong = imported.clone();
        change(&mut wrong.deck);
        compare::compare(&deck, &options, &wrong, &media)
    };
    // A shape 1.5 units from where it was.
    let moved = broken(&|d| {
        for e in &mut d.slides[3].elements {
            if let Some(x) = e.base_mut().x.as_mut() {
                *x += 1.5;
            }
        }
    });
    assert!(moved.iter().any(|m| m.contains("x ")), "{moved:?}");
    // A word changed.
    let worded = broken(&|d| {
        for e in &mut d.slides[1].elements {
            if let Element::Text(t) = e {
                t.text.paragraphs[0].runs[0].t.push('!');
            }
        }
    });
    assert!(worded.iter().any(|m| m.contains("became")), "{worded:?}");
    // A colour, a slide, a note.
    let painted = broken(&|d| {
        for e in &mut d.slides[3].elements {
            if let Element::Shape(s) = e
                && let Some(f) = s.base.style.as_mut().and_then(|s| s.fill.as_mut())
            {
                f.color = "#123456".into();
            }
        }
    });
    assert!(painted.iter().any(|m| m.contains("looks")), "{painted:?}");
    let shorter = broken(&|d| {
        d.slides.pop();
    });
    assert!(
        shorter.iter().any(|m| m.contains("pages became")),
        "{shorter:?}"
    );
    let silent = broken(&|d| d.slides[1].notes.clear());
    assert!(silent.iter().any(|m| m.contains("notes")), "{silent:?}");
    let hidden = broken(&|d| d.slides[2].hidden = !d.slides[2].hidden);
    assert!(hidden.iter().any(|m| m.contains("hidden")), "{hidden:?}");
}
