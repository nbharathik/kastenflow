//! LaTeX details found in review: unreadable settings are told, not hidden
//! behind defaults, and a path spelled with other capitals than the file's
//! own is not saved under the new spelling.

use crate::common;

use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/latex/article");
    copy_dir(&from, &t.vault.root().join(BASE).join("article"));
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn settings_that_cannot_be_read_are_told_not_shown_as_defaults() {
    let (t, k) = open();
    // No file: the defaults.
    assert!(!k.latex_config(ARTICLE).unwrap().locked);
    let file = t.vault.root().join(ARTICLE).join("kasten-latex.yaml");
    fs::write(&file, "locked: true\nengine: [unclosed\n").unwrap();
    let why = k.latex_config(ARTICLE).unwrap_err().to_string();
    assert!(why.contains("could not be read"), "{why}");
    // The listing says the same: locked.
    assert!(
        k.latex_docs()
            .unwrap()
            .iter()
            .any(|d| d.folder == ARTICLE && d.locked)
    );
    // A readable file is read as before.
    fs::write(&file, "locked: true\n").unwrap();
    assert!(k.latex_config(ARTICLE).unwrap().locked);
}

#[test]
fn a_save_under_other_capitals_is_not_committed_under_the_new_spelling() {
    let (t, k) = open();
    let other = format!("{ARTICLE}/Main.tex");
    if !t.vault.root().join(&other).exists() {
        // A disk that tells the two spellings apart: they really are two files.
        return;
    }
    let loaded = k.source(MAIN).unwrap();
    let text = format!("{}%\n", loaded.text);
    let why = k
        .save_source(&Actor::Human, &other, &loaded.hash, &text, NOW)
        .unwrap_err()
        .to_string();
    assert!(why.contains("other capitals"), "{why}");
    assert_eq!(
        fs::read_to_string(t.vault.root().join(MAIN)).unwrap(),
        loaded.text
    );
    // The file's own spelling still saves.
    assert!(
        k.save_source(&Actor::Human, MAIN, &loaded.hash, &text, NOW)
            .is_ok()
    );
}
