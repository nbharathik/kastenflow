//! A smart page's folder against names and links: names that differ only in
//! case are one file, a file where a folder should be is not written through,
//! and nothing is written, read or trashed through a link.

use crate::common::NOW;
use crate::smart_support::{all_files, make_page, open};

use std::fs;

use kasten_core::history::Actor;

fn human() -> Actor {
    Actor::Human
}

const PAGE: &str = "library/tracker.md";
const DIR: &str = "library/tracker.smart";

#[test]
fn names_that_differ_only_in_case_are_one_file() {
    let (t, k) = open();
    make_page(&k, "Tracker", None, None);
    k.smart_write_file(&human(), PAGE, "App.js", b"one", Some(""), NOW)
        .unwrap();
    let before = all_files(&t);
    assert!(
        k.smart_write_file(&human(), PAGE, "app.js", b"two", Some(""), NOW)
            .is_err()
    );
    assert!(
        k.smart_write_file(&human(), PAGE, "APP.JS", b"two", None, NOW)
            .is_err()
    );
    assert!(
        k.smart_write_file(&human(), PAGE, "Sub/x.js", b"one", Some(""), NOW)
            .is_ok()
    );
    assert!(
        k.smart_write_file(&human(), PAGE, "sub/Y.js", b"one", Some(""), NOW)
            .is_ok()
    );
    assert_eq!(all_files(&t).len(), before.len() + 2);
}

#[test]
fn a_file_where_a_folder_should_be_is_not_written_through() {
    let (t, k) = open();
    make_page(&k, "Tracker", None, None);
    // The folder's own name taken by a file.
    fs::write(t.vault.root().join(DIR), "I am a file").unwrap();
    let before = all_files(&t);
    assert!(
        k.smart_write_file(&human(), PAGE, "index.html", b"x", None, NOW)
            .is_err()
    );
    assert!(k.smart_read(PAGE).is_err());
    assert_eq!(all_files(&t), before);
    fs::remove_file(t.vault.root().join(DIR)).unwrap();
    // A file where a sub-folder should be.
    k.smart_write_file(&human(), PAGE, "data", b"", None, NOW)
        .unwrap_err();
    fs::create_dir_all(t.vault.root().join(DIR)).unwrap();
    fs::write(t.vault.root().join(DIR).join("sub.js"), "a file").unwrap();
    assert!(
        k.smart_write_file(&human(), PAGE, "sub.js/x.json", b"x", None, NOW)
            .is_err()
    );
    assert_eq!(
        fs::read(t.vault.root().join(DIR).join("sub.js")).unwrap(),
        b"a file"
    );
}

/// Makes a link to a folder, or says the computer would not (no right to make links).
fn link_dir(target: &std::path::Path, link: &std::path::Path) -> bool {
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(target, link);
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(target, link);
    made.is_ok()
}

#[test]
fn nothing_is_written_read_or_trashed_through_a_link() {
    let (t, k) = open();
    let outside = t.vault.root().parent().unwrap().join(format!(
        "kasten-outside-{}",
        kasten_core::ulid_at(NOW.millis)
    ));
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.json"), "outside").unwrap();
    make_page(&k, "Tracker", None, None);
    k.smart_write_file(&human(), PAGE, "index.html", b"<p>mine</p>", Some(""), NOW)
        .unwrap();
    k.commit_edits().unwrap();

    // A link inside the folder.
    if !link_dir(&outside, &t.vault.root().join(DIR).join("link")) {
        eprintln!("skipped: this computer would not make a link");
        let _ = fs::remove_dir_all(&outside);
        return;
    }
    assert!(
        k.smart_write_file(&human(), PAGE, "link/new.json", b"x", None, NOW)
            .is_err()
    );
    assert!(
        k.smart_write_file(&human(), PAGE, "link/secret.json", b"x", None, NOW)
            .is_err()
    );
    assert!(k.smart_file(PAGE, "link/secret.json").is_err());
    assert!(
        k.smart_delete_file(&human(), PAGE, "link/secret.json", NOW)
            .is_err()
    );
    // Links are not listed, and not counted.
    let listing = k.smart_read(PAGE).unwrap();
    assert!(
        listing.files.iter().all(|f| !f.path.starts_with("link")),
        "{:?}",
        listing.files
    );
    assert_eq!(fs::read(outside.join("secret.json")).unwrap(), b"outside");
    assert!(!outside.join("new.json").exists());

    // The folder itself a link: nothing follows it, and the page moves alone.
    let moved = t.vault.root().join("library/tracker.smart");
    fs::remove_dir_all(&moved).unwrap_or_default();
    if !moved.exists() && link_dir(&outside, &moved) {
        assert!(
            k.smart_write_file(&human(), PAGE, "index.html", b"x", None, NOW)
                .is_err()
        );
        assert!(k.smart_read(PAGE).is_err());
        let trashed = k.trash(&human(), PAGE, NOW).unwrap();
        assert!(t.vault.root().join(&trashed).is_file());
        assert_eq!(fs::read(outside.join("secret.json")).unwrap(), b"outside");
        assert!(
            fs::symlink_metadata(&moved).is_ok(),
            "the link stays where it was"
        );
    }
    let _ = fs::remove_dir_all(&outside);
}
