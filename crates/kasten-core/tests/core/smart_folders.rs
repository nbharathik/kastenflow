//! Checks added when the smart page core was verified, about the folder as a
//! sidecar: a big one is trashed, restored and undone whole, a copy that cannot
//! be made leaves nothing, a page cannot be nested under itself, a folder
//! another program holds open is never parted from its page, a leftover folder
//! keeps its name, and a file is taken out by its exact name.

use crate::common::NOW;
use crate::smart_support::{
    DIR, PAGE, all_files, changed, delete, dir_of, expected, make_page, open, put_folder, session,
    smart, smart_page, snapshot, there, tree, undo_last,
};

use std::fs;

use kasten_core::history::Actor;

#[test]
fn a_folder_of_five_hundred_files_is_trashed_restored_and_undone_whole() {
    let (t, k) = open();
    let page = make_page(&k, "Tracker", None, None);
    let mut files: Vec<(String, Vec<u8>)> = (0..499)
        .map(|n| {
            (
                format!("data/f{n:03}.json"),
                format!("{{\"n\": {n}}}\r\n").into_bytes(),
            )
        })
        .collect();
    files.push(("index.html".to_owned(), b"<p>no final newline".to_vec()));
    let borrowed: Vec<(&str, Vec<u8>)> =
        files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
    put_folder(&t, &k, &page.meta.path, &borrowed);
    let dir = dir_of(&page.meta.path);
    let before = tree(&t);
    let files_before = all_files(&t);

    let trashed = k.trash(&Actor::Human, &page.meta.path, NOW).unwrap();
    assert!(!there(&t, &dir));
    let paths = changed(&k);
    assert!(paths.len() >= 1000, "{}", paths.len());
    // The trash lists the page, and the 500 files are not 500 pages.
    assert_eq!(k.list_trash().unwrap().len(), 1);
    let back = k.restore_trashed(&Actor::Human, &trashed).unwrap();
    assert_eq!(back.meta.path, page.meta.path);
    assert_eq!(tree(&t), before);
    assert_eq!(all_files(&t), files_before);

    undo_last(&k);
    assert!(!there(&t, &dir));
    undo_last(&k);
    assert_eq!(tree(&t), before);
    assert_eq!(all_files(&t), files_before);
}

#[test]
fn a_copy_that_cannot_be_made_leaves_no_page_and_no_files() {
    let (t, k) = open();
    let page = smart_page(&t, &k, "Tracker");
    let dir = dir_of(&page.meta.path);
    // A folder filled by hand past the limit: the page cannot be copied.
    fs::write(
        t.vault.root().join(&dir).join("big.js"),
        vec![b'a'; 11 * 1024 * 1024],
    )
    .unwrap();
    k.commit_external().unwrap();
    let before = all_files(&t);
    let head = k.log(None, 1).unwrap()[0].id.clone();
    let err = k
        .duplicate(&Actor::Human, &page.meta.path, NOW)
        .unwrap_err();
    assert!(
        err.to_string().contains("more than a smart page may"),
        "{err}"
    );
    assert_eq!(all_files(&t), before);
    assert_eq!(k.log(None, 1).unwrap()[0].id, head);
    assert!(
        !k.list()
            .unwrap()
            .iter()
            .any(|n| n.path.contains("tracker-2"))
    );
    assert!(!there(&t, "library/tracker-2.smart"));
}

#[test]
fn a_page_cannot_be_nested_under_itself_or_its_own_sub_page() {
    let (t, k) = open();
    let page = smart_page(&t, &k, "Tracker");
    let child = make_page(&k, "Child", None, Some(page.meta.path.clone()));
    let before = all_files(&t);
    let tree_before = tree(&t);
    let under = |parent: &str| k.nest(&Actor::Human, &page.meta.path, Some(parent), NOW);
    assert!(under(&page.meta.path).is_err());
    assert!(under(&child.meta.path).is_err());
    assert_eq!(all_files(&t), before);
    assert_eq!(tree(&t), tree_before);
    assert_eq!(snapshot(&t, &dir_of(&page.meta.path)), expected());
}

#[test]
fn a_rename_onto_the_title_of_another_smart_page_keeps_both_folders() {
    let (t, k) = open();
    let a = smart_page(&t, &k, "Alpha");
    let b = smart_page(&t, &k, "Beta");
    fs::write(
        t.vault.root().join(dir_of(&b.meta.path)).join("app.js"),
        "beta's own",
    )
    .unwrap();
    k.commit_external().unwrap();
    let renamed = k.rename(&Actor::Human, &b.meta.path, "Alpha", NOW).unwrap();
    assert_ne!(renamed.note.meta.path, a.meta.path);
    assert_eq!(snapshot(&t, &dir_of(&a.meta.path)), expected());
    assert_eq!(
        snapshot(&t, &dir_of(&renamed.note.meta.path))["app.js"],
        b"beta's own"
    );
    assert!(!there(&t, &dir_of(&b.meta.path)));
}

/// A program that holds a file of the folder open (Windows refuses to rename
/// a folder then): whatever the system does, page and folder are never apart.
#[test]
fn a_folder_another_program_holds_open_is_never_parted_from_its_page() {
    let (t, k) = open();
    let page = smart_page(&t, &k, "Tracker");
    let dir = dir_of(&page.meta.path);
    let held = fs::File::open(t.vault.root().join(&dir).join("app.js")).unwrap();
    // Every place the page can be: wherever a page is, its folder is, whole.
    let together = || {
        for place in [
            "library/tracker.md",
            "library/venue-tracker.md",
            "projects/photo-organiser/pages/tracker.md",
            "projects/photo-organiser/pages/venue-tracker.md",
            "inbox/tracker.md",
        ] {
            let folder = place.replace(".md", ".smart");
            assert_eq!(there(&t, place), there(&t, &folder), "{place}");
            if there(&t, &folder) {
                assert_eq!(snapshot(&t, &folder), expected(), "{folder}");
            }
        }
    };
    let human = Actor::Human;
    let renamed = k.rename(&human, &page.meta.path, "Venue tracker", NOW);
    // Windows refuses to move a folder with a file open in it; the page stays with it.
    if cfg!(windows) {
        assert!(renamed.is_err());
    }
    together();
    let _ = k.move_note(&human, "library/venue-tracker.md", Some("photo-organiser"));
    let _ = k.move_note(&human, "library/tracker.md", Some("photo-organiser"));
    together();
    let _ = k.move_to_inbox(&human, "library/tracker.md");
    together();
    let _ = k.duplicate(&human, "library/tracker.md", NOW);
    together();
    let _ = k.trash(&human, "library/tracker.md", NOW);
    together();
    drop(held);
}

#[test]
fn a_leftover_folder_at_the_next_free_name_is_not_taken_by_a_restored_page() {
    let (t, k) = open();
    let top = smart_page(&t, &k, "Conference tracker");
    let trashed = k.trash(&Actor::Human, &top.meta.path, NOW).unwrap();
    // A new page takes the old name; a stray folder holds the next free one.
    let again = make_page(&k, "Conference tracker", None, None);
    assert_eq!(again.meta.path, top.meta.path);
    let stray = t.vault.root().join("library/conference-tracker-2.smart");
    fs::create_dir_all(&stray).unwrap();
    fs::write(stray.join("index.html"), "stray").unwrap();
    let back = k.restore_trashed(&Actor::Human, &trashed).unwrap();
    assert_eq!(back.meta.path, "library/conference-tracker-3.md");
    assert_eq!(snapshot(&t, &dir_of(&back.meta.path)), expected());
    assert_eq!(fs::read(stray.join("index.html")).unwrap(), b"stray");
}

#[test]
fn a_file_is_taken_out_by_its_exact_name_only() {
    let (t, k) = open();
    smart(&t, &k);
    let s = session();
    // The page's typed layout is committed by the first op, whatever it is.
    let _ = k.smart_delete_file(&Actor::Human, PAGE, "nope.js", NOW);
    let head = k.log(None, 1).unwrap()[0].id.clone();
    for wrong in ["APP.JS", "App.js", "DATA/venues.json", "data/Venues.json"] {
        let human = k.smart_delete_file(&Actor::Human, PAGE, wrong, NOW);
        assert!(human.is_err(), "{wrong}");
        assert!(
            k.agent_run(&s, &delete(PAGE, wrong), NOW).is_err(),
            "{wrong}"
        );
    }
    assert_eq!(snapshot(&t, DIR), expected());
    assert_eq!(k.log(None, 1).unwrap()[0].id, head);
    // The right name still works and is undone whole.
    k.smart_delete_file(&Actor::Human, PAGE, "app.js", NOW)
        .unwrap();
    undo_last(&k);
    assert_eq!(snapshot(&t, DIR), expected());
}
