//! `reorder_children` with ids that need quoting and with a very long list.

use std::fs;

use crate::change_sets::open;
use crate::common::NOW;
use crate::structure::{HANDBOOK, HANDBOOK_TEXT, commits, handbook};
use crate::structure_stress::kid_text;
use kasten_core::history::Actor;
use kasten_core::structure::order_text;

#[test]
fn ids_with_special_characters_are_stored_and_read_back_whole() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let ids = [
        "a, b",
        "c: d",
        "#e",
        "[f]",
        "g\"h",
        "123",
        "0x1F",
        "é",
        "true",
        "x #y",
        "- dash",
        "tab\tin",
        "back\\slash",
        "{brace}",
        "null",
        "1.5",
        "~",
    ];
    for (i, id) in ids.iter().enumerate() {
        fs::write(
            t.vault.root().join(format!("library/kid-{i:02}.md")),
            kid_text(id, &format!("Kid {i:02}")),
        )
        .unwrap();
    }
    k.reindex().unwrap();
    let wanted: Vec<String> = ids.iter().rev().map(|s| (*s).to_owned()).collect();
    k.reorder_children(&Actor::Human, HANDBOOK, &wanted, NOW)
        .unwrap();
    let note = k.read(HANDBOOK).unwrap();
    assert_eq!(note.meta.children_order, wanted);
    // Only the one key was written, and taking it away gives the file back.
    assert_eq!(order_text(&note.text, &[]).unwrap().unwrap(), HANDBOOK_TEXT);
    // Said again: nothing is written.
    let before = commits(&k);
    k.reorder_children(&Actor::Human, HANDBOOK, &wanted, NOW)
        .unwrap();
    assert_eq!(commits(&k), before);
}

#[test]
fn a_very_long_list_is_stored_on_one_key_and_stays_idempotent() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let count = 1500;
    for i in 0..count {
        fs::write(
            t.vault.root().join(format!("library/kid-{i:04}.md")),
            kid_text(&format!("01KID{i:020}"), &format!("Kid {i:04}")),
        )
        .unwrap();
    }
    k.reindex().unwrap();
    let wanted: Vec<String> = (0..count).rev().map(|i| format!("01KID{i:020}")).collect();
    k.reorder_children(&Actor::Human, HANDBOOK, &wanted, NOW)
        .unwrap();
    let note = k.read(HANDBOOK).unwrap();
    assert_eq!(note.meta.children_order, wanted);
    assert_eq!(order_text(&note.text, &[]).unwrap().unwrap(), HANDBOOK_TEXT);
    let before = commits(&k);
    k.reorder_children(&Actor::Human, HANDBOOK, &wanted, NOW)
        .unwrap();
    assert_eq!(commits(&k), before);
}
