//! A page's comments file goes wherever the page goes: renamed, moved to a
//! project or the inbox, nested, converted, duplicated (copied), trashed with
//! its sub-pages and restored (under a free name too). Both ends of every move
//! are in the commit, so Undo takes the file back with the page.

use std::fs;

use super::{open, page, say, sidecar};
use crate::common::{self, NOW};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote};

fn there(t: &common::TempVault, rel: &str) -> bool {
    t.vault.root().join(rel).is_file()
}

fn comments_path(page: &str) -> String {
    page.replace(".md", ".comments.json")
}

fn undo_last(k: &Kasten) {
    let commit = k.log(None, 1).unwrap()[0].id.clone();
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
}

fn page_in(
    k: &Kasten,
    title: &str,
    project: Option<&str>,
    parent: Option<String>,
) -> kasten_core::NoteFile {
    k.create(
        &Actor::Human,
        &NewNote {
            kind: Kind::Page,
            title: title.to_owned(),
            date: "2026-10-10".to_owned(),
            project: project.map(str::to_owned),
            parent,
            template: None,
            icon: None,
        },
        NOW,
    )
    .unwrap()
}

#[test]
fn rename_takes_the_comments_along() {
    let (t, k) = open();
    let p = page(&k, "Trip plan");
    let c = say(&k, &p.meta.path, "Check this");
    let renamed = k
        .rename(&Actor::Human, &p.meta.path, "Summer trip", NOW)
        .unwrap();
    let now_at = renamed.note.meta.path.clone();
    assert_ne!(now_at, p.meta.path);
    assert!(!there(&t, &sidecar(&p)));
    assert!(there(&t, &comments_path(&now_at)));
    assert_eq!(k.comments(&now_at).unwrap()[0].id, c.id);

    undo_last(&k);
    assert!(t.vault.exists(&p.meta.path));
    assert!(there(&t, &sidecar(&p)));
    assert!(!there(&t, &comments_path(&now_at)));
}

#[test]
fn a_move_to_a_project_the_library_and_the_inbox_takes_the_comments() {
    let (t, k) = open();
    let p = page(&k, "Trip plan");
    let c = say(&k, &p.meta.path, "Check this");

    let in_project = k
        .move_note(&Actor::Human, &p.meta.path, Some("photo-organiser"))
        .unwrap();
    assert_eq!(
        in_project.meta.path,
        "projects/photo-organiser/pages/trip-plan.md"
    );
    assert!(!there(&t, &sidecar(&p)));
    assert!(there(
        &t,
        "projects/photo-organiser/pages/trip-plan.comments.json"
    ));
    assert_eq!(k.comments(&in_project.meta.path).unwrap()[0].id, c.id);
    undo_last(&k);
    assert!(there(&t, &sidecar(&p)));
    assert!(!there(
        &t,
        "projects/photo-organiser/pages/trip-plan.comments.json"
    ));

    let placed = k.move_to_inbox(&Actor::Human, &p.meta.path).unwrap();
    assert_eq!(placed.note.meta.path, "inbox/trip-plan.md");
    assert!(there(&t, "inbox/trip-plan.comments.json"));
    assert!(!there(&t, &sidecar(&p)));
    // The moves reported are the pages', not their files.
    assert_eq!(placed.moves.len(), 1);
    undo_last(&k);
    assert!(there(&t, &sidecar(&p)));
    assert!(!there(&t, "inbox/trip-plan.comments.json"));
}

#[test]
fn nesting_a_page_in_another_project_takes_its_comments() {
    let (t, k) = open();
    let parent = page_in(&k, "Handbook", Some("photo-organiser"), None);
    let child = page(&k, "Packing list");
    say(&k, &child.meta.path, "Missing socks");

    let nested = k
        .nest(
            &Actor::Human,
            &child.meta.path,
            Some(&parent.meta.path),
            NOW,
        )
        .unwrap();
    assert_eq!(
        nested.meta.path,
        "projects/photo-organiser/pages/packing-list.md"
    );
    assert!(!there(&t, &sidecar(&child)));
    assert!(there(&t, &comments_path(&nested.meta.path)));
    assert_eq!(k.comments(&nested.meta.path).unwrap().len(), 1);

    undo_last(&k);
    assert!(there(&t, &sidecar(&child)));
    assert!(!there(&t, &comments_path(&nested.meta.path)));
}

#[test]
fn converting_a_card_takes_its_comments_to_its_new_folder() {
    let (t, k) = open();
    let card = "inbox/capture-ideas-here.md";
    say(&k, card, "A thought");
    assert!(there(&t, "inbox/capture-ideas-here.comments.json"));
    let page = k.convert_note(&Actor::Human, card, "page", NOW).unwrap();
    assert_eq!(page.meta.path, "library/capture-ideas-here.md");
    assert!(!there(&t, "inbox/capture-ideas-here.comments.json"));
    assert!(there(&t, "library/capture-ideas-here.comments.json"));
    assert_eq!(k.comments(&page.meta.path).unwrap().len(), 1);

    undo_last(&k);
    assert!(there(&t, "inbox/capture-ideas-here.comments.json"));
    assert!(!there(&t, "library/capture-ideas-here.comments.json"));
}

#[test]
fn a_duplicate_has_its_own_copy_of_the_comments() {
    let (t, k) = open();
    let p = page(&k, "Trip plan");
    let c = say(&k, &p.meta.path, "Check this");
    let copy = k.duplicate(&Actor::Human, &p.meta.path, NOW).unwrap();
    assert_ne!(copy.meta.path, p.meta.path);
    let copied = comments_path(&copy.meta.path);
    assert!(there(&t, &copied));
    // The original keeps its own; the two files are the same bytes.
    assert!(there(&t, &sidecar(&p)));
    assert_eq!(
        fs::read(t.vault.root().join(&copied)).unwrap(),
        fs::read(t.vault.root().join(sidecar(&p))).unwrap()
    );
    assert_eq!(k.comments(&copy.meta.path).unwrap()[0].id, c.id);

    // A comment on the copy is the copy's alone.
    say(&k, &copy.meta.path, "Only here");
    assert_eq!(k.comments(&p.meta.path).unwrap().len(), 1);
    assert_eq!(k.comments(&copy.meta.path).unwrap().len(), 2);

    // Undo the duplicate's own commit: the copy and its file go.
    let log = k.log(None, 5).unwrap();
    let made = log
        .iter()
        .find(|c| c.summary.starts_with("duplicate"))
        .unwrap();
    // The later comment on the copy is in the way; undo that one first.
    undo_last(&k);
    let undone = k.undo_commit(&made.id, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
    assert!(!t.vault.exists(&copy.meta.path));
    assert!(!there(&t, &copied));
    assert!(there(&t, &sidecar(&p)));
}

#[test]
fn trashing_a_page_takes_its_comments_and_its_sub_pages_comments_to_the_trash() {
    let (t, k) = open();
    let top = page(&k, "Trip plan");
    let sub = page_in(&k, "Packing", None, Some(top.meta.path.clone()));
    say(&k, &top.meta.path, "On the top page");
    say(&k, &sub.meta.path, "On the sub-page");

    let trashed = k.trash(&Actor::Human, &top.meta.path, NOW).unwrap();
    let stamp = trashed.strip_suffix(&top.meta.path).unwrap().to_owned();
    assert!(!there(&t, &sidecar(&top)));
    assert!(!there(&t, &sidecar(&sub)));
    assert!(there(&t, &format!("{stamp}{}", sidecar(&top))));
    assert!(there(&t, &format!("{stamp}{}", sidecar(&sub))));
    // The commit counts pages, and the trash lists the page alone.
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "trash: Trip plan and 1 sub-page"
    );
    let listed = k.list_trash().unwrap();
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(
        (listed[0].title.as_str(), listed[0].inside),
        ("Trip plan", 1)
    );

    // Emptying the trash takes the files with the pages (history holds them all).
    let emptied = k.empty_trash(&Actor::Human, NOW).unwrap();
    assert_eq!((emptied.removed, emptied.kept.len()), (4, 0), "{emptied:?}");
    undo_last(&k);
    assert!(there(&t, &format!("{stamp}{}", sidecar(&top))));

    // Undo of the trashing itself puts both pages and both files back.
    let trash_commit = k
        .log(None, 5)
        .unwrap()
        .into_iter()
        .find(|c| c.summary.starts_with("trash: Trip plan"))
        .unwrap();
    let undone = k.undo_commit(&trash_commit.id, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
    assert!(there(&t, &sidecar(&top)));
    assert!(there(&t, &sidecar(&sub)));
    assert!(!there(&t, &format!("{stamp}{}", sidecar(&top))));
}

#[test]
fn restoring_a_page_brings_its_comments_back_beside_it() {
    let (t, k) = open();
    let top = page(&k, "Trip plan");
    let sub = page_in(&k, "Packing", None, Some(top.meta.path.clone()));
    say(&k, &top.meta.path, "On the top page");
    say(&k, &sub.meta.path, "On the sub-page");
    let before = fs::read(t.vault.root().join(sidecar(&top))).unwrap();
    let trashed = k.trash(&Actor::Human, &top.meta.path, NOW).unwrap();

    let back = k.restore_trashed(&Actor::Human, &trashed).unwrap();
    assert_eq!(back.meta.path, top.meta.path);
    assert_eq!(
        fs::read(t.vault.root().join(sidecar(&top))).unwrap(),
        before
    );
    assert_eq!(k.comments(&sub.meta.path).unwrap().len(), 1);
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "restore: Trip plan and 1 sub-page"
    );
    // Nothing is left in the trash, not even the folders.
    assert!(k.list_trash().unwrap().is_empty());
    assert!(!t.vault.root().join(&trashed).exists());

    // Undo puts the pages and their files back in the trash.
    undo_last(&k);
    let stamp = trashed.strip_suffix(&top.meta.path).unwrap();
    assert!(there(&t, &format!("{stamp}{}", sidecar(&top))));
    assert!(there(&t, &format!("{stamp}{}", sidecar(&sub))));
    assert!(!there(&t, &sidecar(&top)));
    assert_eq!(k.list_trash().unwrap().len(), 1);
}

#[test]
fn a_page_restored_under_a_free_name_takes_its_comments_to_that_name() {
    let (t, k) = open();
    let top = page(&k, "Trip plan");
    let said = say(&k, &top.meta.path, "Old comment");
    let trashed = k.trash(&Actor::Human, &top.meta.path, NOW).unwrap();
    // A new page takes the old name, and has comments of its own.
    let again = page_in(&k, "Trip plan", None, None);
    assert_eq!(again.meta.path, top.meta.path);
    say(&k, &again.meta.path, "New comment");

    let back = k.restore_trashed(&Actor::Human, &trashed).unwrap();
    assert_ne!(back.meta.path, top.meta.path);
    let theirs = comments_path(&back.meta.path);
    assert!(there(&t, &theirs));
    assert_eq!(k.comments(&back.meta.path).unwrap()[0].id, said.id);
    // The page that took the name keeps its own comment, untouched.
    let other = k.comments(&again.meta.path).unwrap();
    assert_eq!(other.len(), 1);
    assert_eq!(other[0].text, "New comment");

    // Undo puts the restored page and its file back in the trash.
    undo_last(&k);
    assert!(!there(&t, &theirs));
    assert!(there(
        &t,
        &format!(
            "{}{}",
            trashed.strip_suffix(&top.meta.path).unwrap(),
            sidecar(&top)
        )
    ));
    assert_eq!(k.comments(&again.meta.path).unwrap().len(), 1);
}

#[test]
fn a_stray_comments_file_keeps_its_name_off_new_pages() {
    let (t, k) = open();
    // What a page deleted outside the app leaves behind.
    fs::write(
        t.vault.root().join("library/trip-plan.comments.json"),
        "{\"comments\": [{\"id\": \"c-old\", \"text\": \"old\"}]}",
    )
    .unwrap();
    let p = page(&k, "Trip plan");
    assert_eq!(p.meta.path, "library/trip-plan-2.md");
    assert!(k.comments(&p.meta.path).unwrap().is_empty());
    // And a rename onto that name goes to the next free one too.
    let other = page(&k, "Other");
    let renamed = k
        .rename(&Actor::Human, &other.meta.path, "Trip plan", NOW)
        .unwrap();
    assert_eq!(renamed.note.meta.path, "library/trip-plan-3.md");
    assert!(there(&t, "library/trip-plan.comments.json"));
}
