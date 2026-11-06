//! A rename that fails part way leaves the vault as it was: the title, the
//! file's name, the links in other notes, the page's comments and highlights
//! files and the boards. The failures are made with what Windows refuses (a
//! file held open cannot be moved, a read-only file cannot be replaced).
#![cfg(windows)]

use crate::common;

use std::collections::BTreeMap;
use std::fs;
use std::os::windows::fs::OpenOptionsExt;
use std::path::Path;

use common::{NOW, TempVault, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;

const BRAINSTORM: &str = "projects/photo-organiser/boards/brainstorm.canvas";
const METRIC: &str = "projects/photo-organiser/cards/duplicate-score-for-photos.md";
const COMMENTS: &str = "projects/photo-organiser/cards/duplicate-score-for-photos.comments.json";
const HIGHLIGHTS: &str =
    "projects/photo-organiser/cards/duplicate-score-for-photos.highlights.json";

/// Every file in the vault outside its private folders, by path, with its bytes.
fn snapshot(t: &TempVault) -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, rel: &str, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            if rel.is_empty() && name.starts_with('.') {
                continue;
            }
            let path = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            if entry.file_type().unwrap().is_dir() {
                walk(&entry.path(), &path, out);
            } else {
                out.insert(path, fs::read(entry.path()).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(t.vault.root(), "", &mut out);
    out
}

/// A vault where the metric card has both files that travel with it, other
/// notes link to it, and a board shows it.
fn open() -> (TempVault, Kasten) {
    let t = dev_vault();
    fs::write(t.vault.root().join(COMMENTS), "{\"comments\": []}\n").unwrap();
    fs::write(t.vault.root().join(HIGHLIGHTS), "{\"highlights\": []}\n").unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    (t, k)
}

#[test]
fn a_page_whose_files_cannot_follow_it_is_not_renamed_and_no_link_changes() {
    let (t, k) = open();
    let before = snapshot(&t);
    // A file held open with no sharing cannot be moved. The comments file
    // goes first and the highlights file after it, so one move was made.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(t.vault.root().join(HIGHLIGHTS))
        .unwrap();
    let result = k.rename(&Actor::Human, METRIC, "Edit distance metric", NOW);
    drop(held);

    assert!(result.is_err());
    assert_eq!(snapshot(&t), before);
    assert_eq!(
        k.read(METRIC).unwrap().meta.title,
        "Duplicate score for photos"
    );
}

#[test]
fn a_board_that_cannot_be_rewritten_leaves_the_rename_undone_whole() {
    let (t, k) = open();
    let before = snapshot(&t);
    // A read-only board cannot be replaced, after the page, its files and
    // the links in other notes were already changed.
    let board = t.vault.root().join(BRAINSTORM);
    let mut permissions = fs::metadata(&board).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&board, permissions.clone()).unwrap();
    let result = k.rename(&Actor::Human, METRIC, "Edit distance metric", NOW);
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    fs::set_permissions(&board, permissions).unwrap();

    assert!(result.is_err());
    assert_eq!(snapshot(&t), before);
    assert_eq!(
        k.read(METRIC).unwrap().meta.title,
        "Duplicate score for photos"
    );
}

#[test]
fn a_rename_that_works_still_moves_the_files_and_relinks() {
    let (t, k) = open();
    let renamed = k
        .rename(&Actor::Human, METRIC, "Edit distance metric", NOW)
        .unwrap();
    let at = renamed.note.meta.path.clone();
    assert_eq!(at, "projects/photo-organiser/cards/edit-distance-metric.md");
    let root = t.vault.root();
    assert!(!root.join(COMMENTS).exists() && !root.join(HIGHLIGHTS).exists());
    assert!(root.join(at.replace(".md", ".comments.json")).is_file());
    assert!(root.join(at.replace(".md", ".highlights.json")).is_file());
    assert!(!renamed.relinked.is_empty());
    assert!(
        fs::read_to_string(root.join(BRAINSTORM))
            .unwrap()
            .contains(&at)
    );
}
