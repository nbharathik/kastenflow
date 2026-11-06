//! A body save whose base hash is out of date: the file changed on disk since
//! the editor loaded it. When the file already holds the editor's body (only
//! its frontmatter moved on, say a sync tool touching `updated`), nothing is
//! lost, so nothing is kept apart. When the bodies differ, the editor's version
//! is still kept in a conflict copy and the file is left alone.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote, Saved, frontmatter, save_body};

const PATH: &str = "library/zettelkasten-method.md";

fn page(title: &str) -> NewNote {
    NewNote {
        kind: Kind::Page,
        title: title.to_owned(),
        date: "2026-09-24".to_owned(),
        project: None,
        parent: None,
        template: None,
        icon: None,
    }
}

/// `text` with only its frontmatter changed, as a sync tool would leave it.
fn touched(text: &str) -> String {
    let parts = frontmatter::split(text);
    let prefix = frontmatter::set_key(parts.prefix, "updated", Some("2030-01-01T00:00:00Z"), "\n");
    assert_ne!(prefix, parts.prefix, "the frontmatter has to change");
    format!("{prefix}{}", parts.body)
}

fn write(t: &common::TempVault, path: &str, text: &str) {
    fs::write(t.vault.path_of(path).unwrap(), text).unwrap();
}

fn note_count(t: &common::TempVault) -> usize {
    t.vault.notes().unwrap().len()
}

#[test]
fn a_body_already_on_disk_is_unchanged_not_a_conflict_when_only_the_frontmatter_moved() {
    let t = dev_vault();
    let loaded = t.vault.read(PATH).unwrap();
    let body = frontmatter::split(&loaded.text).body.to_owned();
    let outside = touched(&loaded.text);
    write(&t, PATH, &outside);
    let notes = note_count(&t);

    let saved = save_body(&t.vault, PATH, &body, &loaded.hash, NOW).unwrap();
    let Saved::Unchanged { note } = saved else {
        panic!("expected Unchanged, got {saved:?}")
    };
    assert_eq!(note.text, outside);
    assert_eq!(note.hash, t.vault.read(PATH).unwrap().hash);
    assert_eq!(
        fs::read_to_string(t.vault.path_of(PATH).unwrap()).unwrap(),
        outside
    );
    assert_eq!(note_count(&t), notes, "no conflict copy was made");
}

#[test]
fn a_different_body_still_goes_to_a_conflict_copy_and_the_file_is_left_alone() {
    let t = dev_vault();
    let loaded = t.vault.read(PATH).unwrap();
    let body = frontmatter::split(&loaded.text).body.to_owned();
    // The frontmatter moved on and a line was added to the body elsewhere.
    let outside = format!("{}Added elsewhere.\n", touched(&loaded.text));
    write(&t, PATH, &outside);

    let mine = format!("{body}Mine.\n");
    let Saved::Conflict { copy, note } =
        save_body(&t.vault, PATH, &mine, &loaded.hash, NOW).unwrap()
    else {
        panic!("expected a conflict")
    };
    assert_eq!(note.text, outside);
    assert_eq!(
        fs::read_to_string(t.vault.path_of(PATH).unwrap()).unwrap(),
        outside
    );
    assert!(t.vault.read(&copy).unwrap().text.ends_with("Mine.\n"));
}

#[test]
fn after_a_rename_a_frontmatter_only_change_outside_is_not_a_conflict() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let made = k.create(&Actor::Human, &page("Reading list"), NOW).unwrap();
    let body = "One.\nTwo.\nThree.\n";
    let saved = k
        .save_body(&Actor::Human, &made.meta.path, body, &made.hash, NOW)
        .unwrap();
    // The editor adopts the file the rename answers with.
    let renamed = k
        .rename(&Actor::Human, &saved.note().meta.path, "Books to read", NOW)
        .unwrap();
    let at = renamed.note.meta.path.clone();
    write(&t, &at, &touched(&renamed.note.text));
    let notes = note_count(&t);

    let again = k
        .save_body(&Actor::Human, &at, body, &renamed.note.hash, NOW)
        .unwrap();
    let Saved::Unchanged { .. } = again else {
        panic!("expected Unchanged, got {again:?}")
    };
    assert_eq!(note_count(&t), notes, "no conflict copy was made");
}

#[test]
fn after_a_rename_edits_made_elsewhere_merge_with_the_editors() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let made = k.create(&Actor::Human, &page("Reading list"), NOW).unwrap();
    let body = "One.\nTwo.\nThree.\n";
    let saved = k
        .save_body(&Actor::Human, &made.meta.path, body, &made.hash, NOW)
        .unwrap();
    let renamed = k
        .rename(&Actor::Human, &saved.note().meta.path, "Books to read", NOW)
        .unwrap();
    let at = renamed.note.meta.path.clone();
    write(&t, &at, &format!("{}Added elsewhere.\n", renamed.note.text));

    let mine = "One, edited.\nTwo.\nThree.\n";
    let merged = k
        .save_body(&Actor::Human, &at, mine, &renamed.note.hash, NOW)
        .unwrap();
    let Saved::Merged { note } = merged else {
        panic!("expected Merged, got {merged:?}")
    };
    assert!(
        note.text.contains("One, edited.") && note.text.ends_with("Added elsewhere.\n"),
        "{}",
        note.text
    );
}
