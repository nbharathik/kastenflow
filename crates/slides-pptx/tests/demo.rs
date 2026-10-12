//! Generators for looking at the output by hand. Both are ignored: run them
//! with `cargo test -p slides-pptx demo -- --ignored` (the six-slide demo deck,
//! written to `/tmp/claude-0/pptx-check/demo.pptx`) and
//! `cargo test -p slides-pptx samples -- --ignored` (every sample deck, written
//! to `/tmp/claude-0/pptx-check/samples/`, each with the deck it came from).

mod common;

use std::fs;
use std::path::PathBuf;

use slides_core::Deck;
use slides_pptx::{Options, export};

use common::{Files, decks, lists, variety};

fn out_dir() -> PathBuf {
    std::env::var_os("PPTX_CHECK_DIR")
        .map_or_else(|| PathBuf::from("/tmp/claude-0/pptx-check"), PathBuf::from)
}

/// Exports `deck` to `dir/name.pptx`, and writes the deck and its warnings beside it.
fn write(dir: &std::path::Path, name: &str, deck: &Deck, files: &Files) {
    write_with(dir, name, deck, files, &Options::default());
}

fn write_with(dir: &std::path::Path, name: &str, deck: &Deck, files: &Files, options: &Options) {
    fs::create_dir_all(dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display()));
    let exported = export(deck, files, options).unwrap_or_else(|e| panic!("{name}: {e}"));
    fs::write(dir.join(format!("{name}.pptx")), &exported.bytes).unwrap_or_else(|e| panic!("{e}"));
    let json = slides_core::write(deck).unwrap_or_else(|e| panic!("{e}"));
    fs::write(dir.join(format!("{name}.deck")), json).unwrap_or_else(|e| panic!("{e}"));
    let warnings: Vec<String> = exported
        .warnings
        .iter()
        .map(|w| {
            format!(
                "{} {} {}",
                w.slide.as_deref().unwrap_or("-"),
                w.element.as_deref().unwrap_or("-"),
                w.message
            )
        })
        .collect();
    fs::write(
        dir.join(format!("{name}.warnings.txt")),
        warnings.join("\n"),
    )
    .unwrap_or_else(|e| panic!("{e}"));
    println!(
        "{name}: {} bytes, {} warnings",
        exported.bytes.len(),
        warnings.len()
    );
}

#[test]
#[ignore = "writes /tmp/claude-0/pptx-check/demo.pptx; run by hand"]
fn demo() {
    let (deck, files) = decks::demo();
    write(&out_dir(), "demo", &deck, &files);
}

#[test]
#[ignore = "writes /tmp/claude-0/pptx-check/samples; run by hand"]
fn samples() {
    let dir = out_dir().join("samples");
    for theme in ["Light", "Dark", "Serif", "Lecture"] {
        let (deck, files) = decks::every_element(theme);
        write(
            &dir,
            &format!("every-element-{}", theme.to_lowercase()),
            &deck,
            &files,
        );
    }
    for (name, deck, files) in variety::every_theme() {
        write(
            &dir,
            &format!("theme-{}", name.to_lowercase()),
            &deck,
            &files,
        );
    }
    let (deck, files) = variety::text_heavy();
    write(&dir, "text-heavy", &deck, &files);
    let (deck, files) = lists::list_looks();
    write(&dir, "list-looks", &deck, &files);
    let (deck, files) = variety::turned();
    write(&dir, "turned", &deck, &files);
    let (deck, files) = variety::four_three();
    write(&dir, "four-three", &deck, &files);
    let (deck, files) = variety::sectioned();
    write(&dir, "sectioned", &deck, &files);
    let trimmed = Options {
        include_hidden: false,
        ..Options::default()
    };
    write_with(&dir, "sectioned-trimmed", &deck, &files, &trimmed);
    let (mut none, files) = decks::demo();
    none.slides.iter_mut().for_each(|slide| slide.hidden = true);
    write_with(&dir, "no-slides", &none, &files, &trimmed);
}
