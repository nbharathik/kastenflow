//! `reorder_children`: the order of a page's sub-pages is `children_order` in
//! the parent's frontmatter, and nothing else in the file changes.

use crate::change_sets::{open, snapshot};
use crate::common::NOW;
use crate::structure::{
    HANDBOOK, HANDBOOK_TEXT, commits, handbook, id_of, page, text_of, with_order,
};
use kasten_core::NoteFile;
use kasten_core::history::Actor;
use kasten_core::structure::arranged;

#[test]
fn the_order_is_stored_in_the_parents_frontmatter_and_nothing_else_changes() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let a = page(&k, "Alpha", None, Some(HANDBOOK));
    let b = page(&k, "Beta", None, Some(HANDBOOK));
    let c = page(&k, "Gamma", None, Some(HANDBOOK));
    // The sub-pages gave the handbook nothing: it had an id already.
    assert_eq!(text_of(&t, HANDBOOK), HANDBOOK_TEXT);
    let others = snapshot(t.vault.root());
    let commits_before = commits(&k);
    let ids = [id_of(&c), id_of(&a), id_of(&b)];

    let note = k
        .reorder_children(&Actor::Human, HANDBOOK, &ids, NOW)
        .unwrap();
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    assert_eq!(text_of(&t, HANDBOOK), with_order(HANDBOOK_TEXT, &refs));
    assert_eq!(note.meta.children_order, ids);
    assert_eq!(commits(&k), commits_before + 1, "one file, one commit");
    let after = snapshot(t.vault.root());
    for (path, bytes) in &others {
        if path != HANDBOOK {
            assert_eq!(after.get(path), Some(bytes), "{path} is as it was");
        }
    }
    assert_eq!(after.len(), others.len());

    // The index tells the order, and saying it again writes nothing.
    assert_eq!(k.read(HANDBOOK).unwrap().meta.children_order, ids);
    k.reorder_children(&Actor::Human, HANDBOOK, &ids, NOW)
        .unwrap();
    assert_eq!(commits(&k), commits_before + 1);
    assert_eq!(text_of(&t, HANDBOOK), with_order(HANDBOOK_TEXT, &refs));
}

#[test]
fn unknown_ids_are_ignored_and_missing_ones_follow_alphabetically() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let zebra = page(&k, "Zebra", None, Some(HANDBOOK));
    let apple = page(&k, "apple", None, Some(HANDBOOK));
    let mango = page(&k, "Mango", None, Some(HANDBOOK));
    let stranger = page(&k, "Stranger", None, None);
    let ids = vec![
        id_of(&mango),
        "NOT-AN-ID".to_owned(),
        id_of(&mango),
        id_of(&stranger),
        String::new(),
    ];
    let note = k
        .reorder_children(&Actor::Human, HANDBOOK, &ids, NOW)
        .unwrap();
    // Mango as asked, then the rest by title, ignoring case: apple, Zebra.
    let want = vec![id_of(&mango), id_of(&apple), id_of(&zebra)];
    assert_eq!(note.meta.children_order, want);
    let refs: Vec<&str> = want.iter().map(String::as_str).collect();
    assert_eq!(text_of(&t, HANDBOOK), with_order(HANDBOOK_TEXT, &refs));
}

#[test]
fn a_list_written_the_long_way_is_replaced_and_the_other_keys_stay() {
    let (t, k, _s) = open();
    let long = HANDBOOK_TEXT.replace(
        "icon: 📘\n",
        "children_order:\n  - OLD1\n  - OLD2\nicon: 📘\n",
    );
    handbook(&t, &k, &long);
    let a = page(&k, "Alpha", None, Some(HANDBOOK));
    let b = page(&k, "Beta", None, Some(HANDBOOK));
    k.reorder_children(&Actor::Human, HANDBOOK, &[id_of(&b), id_of(&a)], NOW)
        .unwrap();
    let want = HANDBOOK_TEXT.replace(
        "icon: 📘\n",
        &format!("children_order: [{}, {}]\nicon: 📘\n", id_of(&b), id_of(&a)),
    );
    assert_eq!(text_of(&t, HANDBOOK), want);
}

#[test]
fn line_endings_and_a_byte_order_mark_are_kept() {
    let (t, k, _s) = open();
    let crlf = format!("\u{feff}{}", HANDBOOK_TEXT.replace('\n', "\r\n"));
    handbook(&t, &k, &crlf);
    let a = page(&k, "Alpha", None, Some(HANDBOOK));
    k.reorder_children(&Actor::Human, HANDBOOK, &[id_of(&a)], NOW)
        .unwrap();
    let want = crlf.replacen(
        "---\r\nBody",
        &format!("children_order: [{}]\r\n---\r\nBody", id_of(&a)),
        1,
    );
    assert_eq!(text_of(&t, HANDBOOK), want);
}

#[test]
fn an_empty_list_goes_back_to_alphabetical() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let a = page(&k, "Alpha", None, Some(HANDBOOK));
    let b = page(&k, "Beta", None, Some(HANDBOOK));
    k.reorder_children(&Actor::Human, HANDBOOK, &[id_of(&b), id_of(&a)], NOW)
        .unwrap();
    let before = commits(&k);
    let note = k
        .reorder_children(&Actor::Human, HANDBOOK, &[], NOW)
        .unwrap();
    assert!(note.meta.children_order.is_empty());
    assert_eq!(
        text_of(&t, HANDBOOK),
        HANDBOOK_TEXT,
        "the key is gone, nothing else"
    );
    assert_eq!(commits(&k), before + 1);
    // Nothing to reset: nothing is written.
    k.reorder_children(&Actor::Human, HANDBOOK, &[], NOW)
        .unwrap();
    assert_eq!(commits(&k), before + 1);
}

#[test]
fn a_page_with_no_sub_pages_is_left_alone_and_a_note_that_is_not_a_page_is_refused() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let stranger = page(&k, "Stranger", None, None);
    let before = commits(&k);
    k.reorder_children(&Actor::Human, HANDBOOK, &[id_of(&stranger)], NOW)
        .unwrap();
    assert_eq!(text_of(&t, HANDBOOK), HANDBOOK_TEXT);
    assert_eq!(commits(&k), before);
    for path in [
        "journal/2026/2026-09-23.md",
        "projects/photo-organiser/cards/duplicate-score-sketch.md",
        "templates/paper.md",
    ] {
        assert!(
            k.reorder_children(&Actor::Human, path, &[], NOW).is_err(),
            "{path}"
        );
    }
}

#[test]
fn the_order_a_reader_sees_follows_the_stored_list() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let cherry = page(&k, "Cherry", None, Some(HANDBOOK));
    let banana = page(&k, "banana", None, Some(HANDBOOK));
    let apple = page(&k, "Apple", None, Some(HANDBOOK));
    let date = page(&k, "date", None, Some(HANDBOOK));
    let parent = k.read(HANDBOOK).unwrap().meta.id;
    let kids: Vec<_> = k
        .list()
        .unwrap()
        .into_iter()
        .filter(|n| n.parent == parent)
        .collect();
    assert_eq!(kids.len(), 4);
    let names = |stored: &[&NoteFile]| {
        let stored: Vec<String> = stored.iter().map(|n| id_of(n)).collect();
        arranged(&stored, kids.clone())
            .into_iter()
            .map(|m| m.title)
            .collect::<Vec<_>>()
    };
    assert_eq!(names(&[]), ["Apple", "banana", "Cherry", "date"]);
    assert_eq!(
        names(&[&date, &cherry]),
        ["date", "Cherry", "Apple", "banana"]
    );
    // An id twice counts once; one that is not a sub-page counts for nothing.
    let stranger = page(&k, "Stranger", None, None);
    assert_eq!(
        names(&[&stranger, &apple, &apple]),
        ["Apple", "banana", "Cherry", "date"]
    );
    let _ = banana;
}
