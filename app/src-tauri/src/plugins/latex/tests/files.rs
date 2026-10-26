//! The file tree of a document lists plain files only.

use super::support::{Dir, FOLDER, link, put, vault};
use crate::plugins::latex::files::{MAX_FILES, list_files};

#[test]
fn lists_the_documents_files_with_the_editable_ones_marked() {
    let dir = Dir::new("files-list");
    let root = vault(&dir);
    put(&root, &format!("{FOLDER}/refs.bib"), "@book{a}\n");
    put(&root, &format!("{FOLDER}/figs/plot.png"), "png");
    let files = list_files(&root, FOLDER);
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            "projects/p/latex/a/figs/plot.png",
            "projects/p/latex/a/main.tex",
            "projects/p/latex/a/refs.bib",
            "projects/p/latex/a/sections/intro.tex",
        ]
    );
    let editable: Vec<bool> = files.iter().map(|f| f.editable).collect();
    assert_eq!(editable, [false, true, true, true]);
    // The vault's other notes are not part of it.
    assert!(!paths.iter().any(|p| p.contains("secret")));
}

#[test]
fn hidden_entries_and_a_missing_folder_give_nothing_extra() {
    let dir = Dir::new("files-hidden");
    let root = vault(&dir);
    put(&root, &format!("{FOLDER}/.hidden.tex"), "x");
    put(&root, &format!("{FOLDER}/.git/config.tex"), "x");
    let files = list_files(&root, FOLDER);
    assert_eq!(files.len(), 2, "{files:?}");
    assert!(list_files(&root, "projects/none").is_empty());
}

#[test]
fn links_are_not_followed_or_listed() {
    let dir = Dir::new("files-links");
    let root = vault(&dir);
    let outside = dir.join("outside");
    put(&outside, "leak.tex", "secret");
    if !link(&outside, &root.join(format!("{FOLDER}/out")), true) {
        return;
    }
    let files = list_files(&root, FOLDER);
    assert!(files.iter().all(|f| !f.path.contains("leak")), "{files:?}");
    assert!(files.iter().all(|f| !f.path.ends_with("/out")), "{files:?}");
}

#[test]
fn a_huge_folder_is_cut_at_the_limit() {
    let dir = Dir::new("files-many");
    let root = vault(&dir);
    for n in 0..(MAX_FILES + 20) {
        put(&root, &format!("{FOLDER}/many/f{n}.tex"), "x");
    }
    assert_eq!(list_files(&root, FOLDER).len(), MAX_FILES);
}
