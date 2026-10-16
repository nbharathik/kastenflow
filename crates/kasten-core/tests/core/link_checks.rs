//! `kasten:note/<id>` links are checked by id: a link to a note that was
//! renamed or moved still resolves, one whose note is gone is reported, and
//! nothing is changed by looking.

use std::fs;

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;

const ROADMAP: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";

fn open_with(path: &str, text: &str) -> (common::TempVault, Kasten) {
    let t = dev_vault();
    fs::write(t.vault.root().join(path), text).unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn reported(k: &Kasten) -> Vec<(String, String)> {
    let mut found: Vec<(String, String)> = k
        .kasten_link_problems()
        .unwrap()
        .into_iter()
        .map(|p| {
            assert_eq!(p.kind, "unresolved-link");
            (p.path.unwrap_or_default(), p.detail)
        })
        .collect();
    found.sort();
    found
}

#[test]
fn reports_a_link_whose_note_is_gone_and_only_that() {
    let t = dev_vault();
    let id = Kasten::open(t.vault.root())
        .unwrap()
        .read(ROADMAP)
        .unwrap()
        .meta
        .id
        .expect("the roadmap has an id");
    let text = format!(
        "---\ntitle: Linker\n---\nSee [the plan](kasten:note/{id}#Next-steps) and [again](kasten:note/{id}?section=Next%20steps&n=2).\n\nA [gone one](kasten:note/01HZZZZZZZZZZZZZZZZZZZZZZZ#Part) and [none](kasten:note/).\n\n`kasten:note/IN-CODE` and\n\n```\n[z](kasten:note/FENCED)\n```\n"
    );
    fs::write(t.vault.root().join("library/linker.md"), &text).unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    assert_eq!(
        reported(&k),
        [
            (
                "library/linker.md".to_owned(),
                "kasten:note/ names no note".to_owned()
            ),
            (
                "library/linker.md".to_owned(),
                "kasten:note/01HZZZZZZZZZZZZZZZZZZZZZZZ points to no note".to_owned()
            ),
        ]
    );
    // Looking changed nothing.
    assert_eq!(
        fs::read_to_string(t.vault.root().join("library/linker.md")).unwrap(),
        text
    );
}

#[test]
fn a_renamed_note_still_resolves_and_a_trashed_one_does_not() {
    let t = dev_vault();
    let id = Kasten::open(t.vault.root())
        .unwrap()
        .read(ROADMAP)
        .unwrap()
        .meta
        .id
        .unwrap();
    fs::write(
        t.vault.root().join("library/linker.md"),
        format!("---\ntitle: Linker\n---\n[plan](kasten:note/{id})\n"),
    )
    .unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    assert!(reported(&k).is_empty());
    let renamed = k
        .rename(&Actor::Human, ROADMAP, "A new name for the plan", NOW)
        .unwrap();
    assert_eq!(renamed.note.meta.id.as_deref(), Some(id.as_str()));
    assert!(reported(&k).is_empty(), "{:?}", reported(&k));
    k.trash(&Actor::Human, &renamed.note.meta.path, NOW)
        .unwrap();
    assert_eq!(
        reported(&k),
        [(
            "library/linker.md".to_owned(),
            format!("kasten:note/{id} points to no note")
        )]
    );
}

#[test]
fn templates_and_the_same_link_twice_are_left_alone() {
    let t = dev_vault();
    fs::write(
        t.vault.root().join("templates/with-link.md"),
        "---\ntitle: With link\n---\n[x](kasten:note/GONE)\n",
    )
    .unwrap();
    fs::write(
        t.vault.root().join("library/twice.md"),
        "---\ntitle: Twice\n---\n[a](kasten:note/GONE2) [b](kasten:note/GONE2)\n",
    )
    .unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    let found = reported(&k);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].0, "library/twice.md");
}

#[test]
fn a_vault_without_such_links_reports_none() {
    let (_t, k) = open_with("library/plain.md", "---\ntitle: Plain\n---\nNo links.\n");
    assert!(k.kasten_link_problems().unwrap().is_empty());
}
