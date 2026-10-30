//! After a change, the summaries are worked out again for the projects it
//! touched only; every change kind must still give exactly what a fresh engine
//! (nothing kept) works out from the same index. Each step below is checked
//! against such an engine, and the engine under test is read after every one,
//! so the pieces it keeps are updated the way a full read would update them.

use super::{TODAY, by_folder, vault, write};
use crate::common::{self, NOW};

use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote, ProjectState, ProjectSummary};

const ALPHA_PAGE: &str = "projects/alpha/pages/p.md";

fn fresh(t: &common::TempVault) -> Vec<ProjectSummary> {
    Kasten::open(t.vault.root())
        .unwrap()
        .project_summaries(TODAY)
        .unwrap()
}

/// The engine's answer equals a fresh engine's, and says so with the step.
fn same_as_fresh(t: &common::TempVault, k: &Kasten, step: &str) -> Vec<ProjectSummary> {
    let kept = k.project_summaries(TODAY).unwrap();
    assert_eq!(kept, fresh(t), "after {step}");
    kept
}

fn new_page(project: &str, title: &str) -> NewNote {
    NewNote {
        kind: Kind::Page,
        title: title.into(),
        date: TODAY.into(),
        project: Some(project.into()),
        parent: None,
        template: None,
        icon: None,
    }
}

#[test]
fn every_kind_of_change_gives_what_a_full_read_gives() {
    let (t, k) = vault();
    let h = Actor::Human;
    same_as_fresh(&t, &k, "the first read");

    // An edit: the to-do counts and the newest note of one project.
    let page = k.read(ALPHA_PAGE).unwrap();
    k.save_body(&h, ALPHA_PAGE, "- [ ] a\n- [x] b\n", &page.hash, NOW)
        .unwrap();
    same_as_fresh(&t, &k, "an edit");

    // A new note.
    let made = k
        .create(&h, &new_page("beta", "Made in beta"), NOW)
        .unwrap();
    let all = same_as_fresh(&t, &k, "a new note");
    assert_eq!(by_folder(&all, "beta").notes, 1);

    // A move between projects: both lose or gain.
    let moved = k.move_note(&h, ALPHA_PAGE, Some("gamma")).unwrap();
    let all = same_as_fresh(&t, &k, "a move between projects");
    assert_eq!(by_folder(&all, "gamma").notes, 1);
    assert_eq!(by_folder(&all, "alpha").notes, 5);

    // Out of every project, and back into one.
    let loose = k.move_note(&h, &moved.meta.path, None).unwrap();
    same_as_fresh(&t, &k, "a move out of its project");
    k.move_note(&h, &loose.meta.path, Some("alpha")).unwrap();
    same_as_fresh(&t, &k, "a move back in");

    // Trash and restore, of a task note and of a plain page.
    let trashed = k.trash(&h, "projects/alpha/cards/t1.md", NOW).unwrap();
    let all = same_as_fresh(&t, &k, "trashing a task");
    assert_eq!(by_folder(&all, "alpha").tasks.open, 1);
    k.restore_trashed(&h, &trashed).unwrap();
    let all = same_as_fresh(&t, &k, "restoring it");
    assert_eq!(by_folder(&all, "alpha").tasks.open, 2);
    let gone = k.trash(&h, &made.meta.path, NOW).unwrap();
    same_as_fresh(&t, &k, "trashing a note");
    k.restore_trashed(&h, &gone).unwrap();
    same_as_fresh(&t, &k, "restoring a note");

    // A rename of a note and of a project page (the order of the hub moves).
    k.rename(&h, "projects/alpha/cards/t2.md", "Task two, renamed", NOW)
        .unwrap();
    same_as_fresh(&t, &k, "renaming a note");
    k.rename(&h, "projects/gamma/_project.md", "Zeta", NOW)
        .unwrap();
    let all = same_as_fresh(&t, &k, "renaming a project page");
    assert_eq!(all.last().map(|p| p.folder.as_str()), Some("gamma"));

    // A project's state, a task's properties.
    let state = ProjectState {
        next_action: Some(Some("Task two, renamed".into())),
        ..ProjectState::default()
    };
    k.set_project_state(&h, "projects/alpha/_project.md", &state, NOW)
        .unwrap();
    same_as_fresh(&t, &k, "a project's state");
    let props = serde_json::json!({"status": "Done", "due": "2020-02-02"})
        .as_object()
        .unwrap()
        .clone();
    k.update_props(&h, "projects/alpha/cards/t2.md", &props, NOW)
        .unwrap();
    same_as_fresh(&t, &k, "a task's properties");

    // A board, which only the walk knows of.
    k.create_board(&h, "Another", Some("beta"), NOW).unwrap();
    same_as_fresh(&t, &k, "a new board");
}

#[test]
fn a_change_outside_kasten_and_a_new_project_give_what_a_full_read_gives() {
    let (t, k) = vault();
    same_as_fresh(&t, &k, "the first read");
    // A file written behind the engine's back, then told to it as the watcher does.
    write(
        &t,
        "projects/beta/pages/outside.md",
        "---\ntitle: Outside\ntype: page\ntags: [task]\nprops:\n  status: Todo\n  due: 2020-01-01\n---\n- [ ] late @2020-01-01\n",
    );
    k.outside_changes(&["projects/beta/pages/outside.md".to_owned()], NOW.millis);
    let all = same_as_fresh(&t, &k, "an outside change");
    assert_eq!(by_folder(&all, "beta").tasks.overdue, 1);
    // A project that did not exist; then one removed from disk.
    write(
        &t,
        "projects/delta/_project.md",
        "---\ntitle: Delta\ntype: project\ntags: [project]\n---\n",
    );
    k.outside_changes(&["projects/delta".to_owned()], NOW.millis);
    let all = same_as_fresh(&t, &k, "a new project folder");
    assert!(all.iter().any(|p| p.folder == "delta"));
    std::fs::remove_file(t.vault.root().join("projects/delta/_project.md")).unwrap();
    k.outside_changes(&["projects/delta/_project.md".to_owned()], NOW.millis);
    let all = same_as_fresh(&t, &k, "a project page removed");
    assert!(!all.iter().any(|p| p.folder == "delta"));
}

#[test]
fn a_change_after_a_new_day_and_a_change_then_the_old_day_still_agree() {
    let (t, k) = vault();
    let h = Actor::Human;
    k.project_summaries(TODAY).unwrap();
    k.create(&h, &new_page("alpha", "One"), NOW).unwrap();
    // The day moves: everything is read again, then a change on the new day.
    let later = k.project_summaries("2026-12-31").unwrap();
    k.create(&h, &new_page("alpha", "Two"), NOW).unwrap();
    let after = k.project_summaries("2026-12-31").unwrap();
    assert_eq!(
        by_folder(&after, "alpha").notes,
        by_folder(&later, "alpha").notes + 1
    );
    assert_eq!(
        after,
        Kasten::open(t.vault.root())
            .unwrap()
            .project_summaries("2026-12-31")
            .unwrap()
    );
    same_as_fresh(&t, &k, "back on the first day");
}

#[test]
fn many_small_changes_between_reads_are_all_picked_up() {
    let (t, k) = vault();
    let h = Actor::Human;
    k.project_summaries(TODAY).unwrap();
    for (i, project) in ["alpha", "beta", "gamma", "alpha"].into_iter().enumerate() {
        k.create(&h, &new_page(project, &format!("Batch {i}")), NOW)
            .unwrap();
    }
    let all = same_as_fresh(&t, &k, "four changes in three projects");
    assert_eq!(
        (
            by_folder(&all, "alpha").notes,
            by_folder(&all, "beta").notes,
            by_folder(&all, "gamma").notes
        ),
        (8, 1, 1)
    );
}
