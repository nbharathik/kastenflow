//! A smart page's code folder (`<page>.smart/`) goes wherever the page goes:
//! renamed, moved to a project or the inbox, nested, duplicated (copied),
//! trashed with its sub-pages and restored (under a free name too). Every file
//! of the folder, at both ends of each move, is in the commit, so Undo and
//! session undo put page and folder back byte for byte.

use crate::common::NOW;
use crate::smart_support::{
    changed, dir_of, expected, make_page, open, smart_page, snapshot, there, tree, undo_last,
};

use std::collections::BTreeSet;
use std::fs;

use kasten_core::agent::{AgentOp, Session};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};

/// Every file of the standard folder under `dir`.
fn all_under(dir: &str) -> BTreeSet<String> {
    expected()
        .keys()
        .map(|rel| format!("{dir}/{rel}"))
        .collect()
}

#[test]
fn rename_takes_the_folder_along_and_undo_puts_both_back() {
    let (t, k) = open();
    let p = smart_page(&t, &k, "Conference tracker");
    let dir = dir_of(&p.meta.path);
    let before = tree(&t);

    let renamed = k
        .rename(&Actor::Human, &p.meta.path, "Venue tracker", NOW)
        .unwrap();
    let new_dir = dir_of(&renamed.note.meta.path);
    assert_eq!(new_dir, "library/venue-tracker.smart");
    assert!(!there(&t, &dir), "the old folder is gone");
    assert_eq!(snapshot(&t, &new_dir), expected());

    // Both ends of every file are in the commit.
    let paths = changed(&k);
    for path in all_under(&dir).into_iter().chain(all_under(&new_dir)) {
        assert!(paths.contains(&path), "{path} missing from {paths:?}");
    }

    undo_last(&k);
    assert_eq!(tree(&t), before, "undo restores the exact tree");
    assert!(t.vault.exists(&p.meta.path));
    assert_eq!(snapshot(&t, &dir), expected());
    assert!(!there(&t, &new_dir));
}

#[test]
fn a_move_to_a_project_and_the_inbox_takes_the_folder() {
    let (t, k) = open();
    let p = smart_page(&t, &k, "Conference tracker");
    let dir = dir_of(&p.meta.path);
    let before = tree(&t);

    let in_project = k
        .move_note(&Actor::Human, &p.meta.path, Some("photo-organiser"))
        .unwrap();
    assert_eq!(
        in_project.meta.path,
        "projects/photo-organiser/pages/conference-tracker.md"
    );
    let project_dir = "projects/photo-organiser/pages/conference-tracker.smart";
    assert!(!there(&t, &dir));
    assert_eq!(snapshot(&t, project_dir), expected());
    let paths = changed(&k);
    for path in all_under(&dir).into_iter().chain(all_under(project_dir)) {
        assert!(paths.contains(&path), "{path}");
    }
    undo_last(&k);
    assert_eq!(tree(&t), before);
    assert_eq!(snapshot(&t, &dir), expected());

    let placed = k.move_to_inbox(&Actor::Human, &p.meta.path).unwrap();
    assert_eq!(placed.note.meta.path, "inbox/conference-tracker.md");
    assert_eq!(snapshot(&t, "inbox/conference-tracker.smart"), expected());
    assert!(!there(&t, &dir));
    // The moves reported are the pages', not their files.
    assert_eq!(placed.moves.len(), 1);
    undo_last(&k);
    assert_eq!(tree(&t), before);
    assert!(!there(&t, "inbox/conference-tracker.smart"));
}

#[test]
fn nesting_a_page_in_another_project_takes_its_folder() {
    let (t, k) = open();
    let parent = make_page(&k, "Handbook", Some("photo-organiser"), None);
    let child = smart_page(&t, &k, "Conference tracker");
    let dir = dir_of(&child.meta.path);
    let before = tree(&t);

    let nested = k
        .nest(
            &Actor::Human,
            &child.meta.path,
            Some(&parent.meta.path),
            NOW,
        )
        .unwrap();
    let nested_dir = dir_of(&nested.meta.path);
    assert_eq!(
        nested_dir,
        "projects/photo-organiser/pages/conference-tracker.smart"
    );
    assert_eq!(snapshot(&t, &nested_dir), expected());
    assert!(!there(&t, &dir));
    let paths = changed(&k);
    for path in all_under(&dir).into_iter().chain(all_under(&nested_dir)) {
        assert!(paths.contains(&path), "{path}");
    }

    undo_last(&k);
    assert_eq!(tree(&t), before);
    assert_eq!(snapshot(&t, &dir), expected());
    assert!(!there(&t, &nested_dir));
}

#[test]
fn a_duplicate_has_its_own_copy_of_the_folder() {
    let (t, k) = open();
    let p = smart_page(&t, &k, "Conference tracker");
    let dir = dir_of(&p.meta.path);
    let before = tree(&t);

    let copy = k.duplicate(&Actor::Human, &p.meta.path, NOW).unwrap();
    assert_ne!(copy.meta.path, p.meta.path);
    let copy_dir = dir_of(&copy.meta.path);
    assert_ne!(copy_dir, dir);
    assert_eq!(snapshot(&t, &copy_dir), expected());
    assert_eq!(snapshot(&t, &dir), expected(), "the original keeps its own");
    let paths = changed(&k);
    for path in all_under(&copy_dir) {
        assert!(paths.contains(&path), "{path}");
    }
    // The copy's files are its own: changing one leaves the original's alone.
    fs::write(t.vault.root().join(&copy_dir).join("app.js"), "changed").unwrap();
    assert_eq!(snapshot(&t, &dir), expected());
    fs::write(
        t.vault.root().join(&copy_dir).join("app.js"),
        &expected()["app.js"],
    )
    .unwrap();

    undo_last(&k);
    assert_eq!(tree(&t), before);
    assert!(!t.vault.exists(&copy.meta.path));
    assert!(!there(&t, &copy_dir));
}

#[test]
fn trashing_a_page_takes_its_folder_and_its_sub_pages_folders_to_the_trash() {
    let (t, k) = open();
    let top = smart_page(&t, &k, "Conference tracker");
    let sub = make_page(&k, "Venue map", None, Some(top.meta.path.clone()));
    crate::smart_support::put_folder(
        &t,
        &k,
        &sub.meta.path,
        &crate::smart_support::folder_files(),
    );
    let (top_dir, sub_dir) = (dir_of(&top.meta.path), dir_of(&sub.meta.path));
    let before = tree(&t);

    let trashed = k.trash(&Actor::Human, &top.meta.path, NOW).unwrap();
    let stamp = trashed.strip_suffix(&top.meta.path).unwrap().to_owned();
    assert!(!there(&t, &top_dir) && !there(&t, &sub_dir));
    assert_eq!(snapshot(&t, &format!("{stamp}{top_dir}")), expected());
    assert_eq!(snapshot(&t, &format!("{stamp}{sub_dir}")), expected());
    // The commit counts pages, the trash lists the page alone, and no file of
    // a folder is a page of its own.
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "trash: Conference tracker and 1 sub-page"
    );
    let listed = k.list_trash().unwrap();
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(
        (listed[0].title.as_str(), listed[0].inside),
        ("Conference tracker", 1)
    );
    // Both ends of every file are in the commit.
    let paths = changed(&k);
    for dir in [&top_dir, &sub_dir] {
        for path in all_under(dir) {
            assert!(paths.contains(&path), "{path}");
            assert!(paths.contains(&format!("{stamp}{path}")), "{stamp}{path}");
        }
    }

    undo_last(&k);
    assert_eq!(
        tree(&t),
        before,
        "undo puts both pages and both folders back"
    );
    assert_eq!(snapshot(&t, &top_dir), expected());
    assert_eq!(snapshot(&t, &sub_dir), expected());
    assert!(!there(&t, &format!("{stamp}{top_dir}")));
}

#[test]
fn restoring_a_page_brings_its_folder_back_beside_it() {
    let (t, k) = open();
    let top = smart_page(&t, &k, "Conference tracker");
    let sub = make_page(&k, "Venue map", None, Some(top.meta.path.clone()));
    crate::smart_support::put_folder(
        &t,
        &k,
        &sub.meta.path,
        &crate::smart_support::folder_files(),
    );
    let (top_dir, sub_dir) = (dir_of(&top.meta.path), dir_of(&sub.meta.path));
    let before = tree(&t);
    let trashed = k.trash(&Actor::Human, &top.meta.path, NOW).unwrap();
    let after_trash = tree(&t);

    let back = k.restore_trashed(&Actor::Human, &trashed).unwrap();
    assert_eq!(back.meta.path, top.meta.path);
    assert_eq!(snapshot(&t, &top_dir), expected());
    assert_eq!(snapshot(&t, &sub_dir), expected());
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "restore: Conference tracker and 1 sub-page"
    );
    assert_eq!(tree(&t), before);
    // Nothing is left in the trash, not even its folders.
    assert!(k.list_trash().unwrap().is_empty());
    assert!(
        !there(&t, ".trash") || fs::read_dir(t.vault.root().join(".trash")).unwrap().count() == 0
    );

    // Undo puts the pages and their folders back in the trash.
    undo_last(&k);
    assert_eq!(tree(&t), after_trash);
    let stamp = trashed.strip_suffix(&top.meta.path).unwrap();
    assert_eq!(snapshot(&t, &format!("{stamp}{top_dir}")), expected());
    assert!(!there(&t, &top_dir));
}

#[test]
fn a_page_restored_under_a_free_name_takes_its_folder_to_that_name() {
    let (t, k) = open();
    let top = smart_page(&t, &k, "Conference tracker");
    let top_dir = dir_of(&top.meta.path);
    let trashed = k.trash(&Actor::Human, &top.meta.path, NOW).unwrap();
    // A new page takes the old name, with a folder of its own.
    let again = make_page(&k, "Conference tracker", None, None);
    assert_eq!(again.meta.path, top.meta.path);
    crate::smart_support::put_folder(
        &t,
        &k,
        &again.meta.path,
        &[("index.html", b"<p>the new page</p>".to_vec())],
    );

    let back = k.restore_trashed(&Actor::Human, &trashed).unwrap();
    assert_ne!(back.meta.path, top.meta.path);
    let back_dir = dir_of(&back.meta.path);
    assert_eq!(back_dir, "library/conference-tracker-2.smart");
    assert_eq!(snapshot(&t, &back_dir), expected());
    // The page that took the name keeps its own folder, untouched.
    let other = snapshot(&t, &top_dir);
    assert_eq!(other.len(), 1);
    assert_eq!(other["index.html"], b"<p>the new page</p>".to_vec());

    undo_last(&k);
    assert!(!there(&t, &back_dir));
    assert_eq!(snapshot(&t, &top_dir).len(), 1);
}

#[test]
fn emptying_the_trash_takes_the_folders_files_and_undo_brings_them_back() {
    let (t, k) = open();
    let p = smart_page(&t, &k, "Conference tracker");
    let dir = dir_of(&p.meta.path);
    let trashed = k.trash(&Actor::Human, &p.meta.path, NOW).unwrap();
    let stamp = trashed.strip_suffix(&p.meta.path).unwrap().to_owned();
    let in_trash = tree(&t);

    let emptied = k.empty_trash(&Actor::Human, NOW).unwrap();
    assert_eq!(emptied.removed, 1 + expected().len(), "{emptied:?}");
    assert!(emptied.kept.is_empty(), "{emptied:?}");
    assert!(!there(&t, &format!("{stamp}{dir}")));

    undo_last(&k);
    assert_eq!(tree(&t), in_trash);
    assert_eq!(snapshot(&t, &format!("{stamp}{dir}")), expected());
}

#[test]
fn a_stray_folder_keeps_its_name_off_new_pages() {
    let (t, k) = open();
    // What a page deleted outside the app leaves behind.
    let stray = t.vault.root().join("library/trip-plan.smart");
    fs::create_dir_all(&stray).unwrap();
    fs::write(stray.join("index.html"), "old").unwrap();
    let p = make_page(&k, "Trip plan", None, None);
    assert_eq!(p.meta.path, "library/trip-plan-2.md");
    assert!(!there(&t, "library/trip-plan-2.smart"));
    // And a rename onto that name goes to the next free one too.
    let other = make_page(&k, "Other", None, None);
    let renamed = k
        .rename(&Actor::Human, &other.meta.path, "Trip plan", NOW)
        .unwrap();
    assert_eq!(renamed.note.meta.path, "library/trip-plan-3.md");
    assert_eq!(fs::read(stray.join("index.html")).unwrap(), b"old");
}

#[test]
fn a_session_that_renamed_moved_and_trashed_a_smart_page_undoes_to_the_exact_tree() {
    let (t, k) = open();
    let p = smart_page(&t, &k, "Conference tracker");
    let before = tree(&t);
    let s = Session::start("claude-code", NOW);

    let run = |k: &Kasten, op: AgentOp| match k.agent_run(&s, &op, NOW).unwrap() {
        Outcome::Done { result } => result,
        other => panic!("expected the op to run: {other:?}"),
    };
    let renamed = run(
        &k,
        AgentOp::Rename {
            path: p.meta.path.clone(),
            title: "Venue tracker".into(),
        },
    );
    let at = renamed["note"]["path"].as_str().unwrap().to_owned();
    assert_eq!(snapshot(&t, &dir_of(&at)), expected());
    let moved = run(
        &k,
        AgentOp::Move {
            path: at,
            project: Some("photo-organiser".into()),
        },
    );
    let moved_at = moved["path"].as_str().unwrap().to_owned();
    assert_eq!(snapshot(&t, &dir_of(&moved_at)), expected());
    run(
        &k,
        AgentOp::Trash {
            path: moved_at.clone(),
            reason: None,
        },
    );
    assert!(!there(&t, &dir_of(&moved_at)));
    assert_ne!(tree(&t), before);

    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert_eq!(undone.conflict, None);
    assert_eq!(undone.reverted.len(), 3);
    assert_eq!(tree(&t), before, "session undo restores page and folder");
    assert_eq!(snapshot(&t, &dir_of(&p.meta.path)), expected());
}
