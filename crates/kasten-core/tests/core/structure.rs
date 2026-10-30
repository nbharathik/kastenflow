//! Structure ops: putting a page inside another or out again (`set_parent`),
//! by a person and by an agent, and the helpers the other `structure_*` tests
//! share. The order of sub-pages is in `structure_order`, what an agent may do
//! under the modes and in batches in `structure_agent`, projects in
//! `structure_projects`, tag views in `structure_views`.

use std::fs;

use crate::change_sets::{open, snapshot};
use crate::comments::say;
use crate::common::{NOW, TempVault};
use kasten_core::agent::AgentOp;
use kasten_core::frontmatter::split;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote, NoteFile, Outcome};

pub const HANDBOOK: &str = "library/handbook.md";

/// A parent page with keys, a comment and spacing Kasten does not know.
pub const HANDBOOK_TEXT: &str = "---\nid: 01HANDBOOK00000000000000A\ntitle: Handbook\ntype: page\n# kept as written\nx-other: {a: 1, b: [2, 3]}\nicon: 📘\n---\nBody stays.\n\n## Part\n\nMore.\n";

pub fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

pub fn page(k: &Kasten, title: &str, project: Option<&str>, parent: Option<&str>) -> NoteFile {
    k.create(
        &Actor::Human,
        &NewNote {
            kind: Kind::Page,
            title: title.to_owned(),
            date: "2026-10-10".to_owned(),
            project: project.map(str::to_owned),
            parent: parent.map(str::to_owned),
            template: None,
            icon: None,
        },
        NOW,
    )
    .unwrap()
}

/// The handbook, written by hand so its bytes are known.
pub fn handbook(t: &TempVault, k: &Kasten, text: &str) {
    fs::write(t.vault.root().join(HANDBOOK), text).unwrap();
    k.reindex().unwrap();
}

pub fn text_of(t: &TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

pub fn id_of(note: &NoteFile) -> String {
    note.meta.id.clone().unwrap()
}

pub fn done(outcome: Outcome) -> serde_json::Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected the change to be made, got {other:?}"),
    }
}

pub fn pending(outcome: Outcome) -> String {
    match outcome {
        Outcome::PendingReview { proposal, .. } => proposal,
        other => panic!("expected the change to wait for review, got {other:?}"),
    }
}

/// `text` with `children_order: <list>` as the last key of its frontmatter.
pub fn with_order(text: &str, ids: &[&str]) -> String {
    let parts = split(text);
    format!(
        "{}children_order: [{}]\n---\n{}",
        parts.prefix.strip_suffix("---\n").unwrap(),
        ids.join(", "),
        parts.body
    )
}

#[test]
fn a_page_goes_inside_another_and_comes_out_again() {
    let (_t, k, _s) = open();
    let outer = page(&k, "Trip notes", None, None);
    let inner = page(&k, "Packing list", None, None);
    let before = commits(&k);

    let placed = k
        .set_parent(&Actor::Human, &inner.meta.path, Some(&outer.meta.path), NOW)
        .unwrap();
    // Beside it already: it stays where it is and only gains its parent.
    assert_eq!(placed.note.meta.path, inner.meta.path);
    assert_eq!(placed.note.meta.parent, outer.meta.id);
    assert!(placed.moves.is_empty());
    assert_eq!(commits(&k), before + 1);

    let out = k
        .set_parent(&Actor::Human, &placed.note.meta.path, None, NOW)
        .unwrap();
    assert_eq!(out.note.meta.parent, None);
    assert_eq!(
        out.note.text, inner.text,
        "the page is byte for byte as it was"
    );
    assert_eq!(commits(&k), before + 2);

    // Taking out a page that is in nothing changes nothing.
    k.set_parent(&Actor::Human, &out.note.meta.path, None, NOW)
        .unwrap();
    assert_eq!(commits(&k), before + 2);
}

#[test]
fn a_page_put_in_one_elsewhere_moves_there_with_its_sub_pages() {
    let (t, k, _s) = open();
    let outer = page(&k, "Roadmap notes", Some("photo-organiser"), None);
    let ideas = page(&k, "Ideas", None, None);
    let one = page(&k, "Idea one", None, Some(&ideas.meta.path));
    let before = commits(&k);

    let placed = k
        .set_parent(&Actor::Human, &ideas.meta.path, Some(&outer.meta.path), NOW)
        .unwrap();
    assert_eq!(
        placed.note.meta.path,
        "projects/photo-organiser/pages/ideas.md"
    );
    assert_eq!(placed.note.meta.parent, outer.meta.id);
    let moved = k
        .read("projects/photo-organiser/pages/idea-one.md")
        .unwrap();
    assert_eq!(
        moved.meta.parent, ideas.meta.id,
        "the sub-page stays in its page"
    );
    assert!(!t.vault.exists(&ideas.meta.path) && !t.vault.exists(&one.meta.path));
    assert_eq!(placed.moves.len(), 2);
    assert_eq!(
        commits(&k),
        before + 1,
        "one commit for the page and its sub-pages"
    );
}

#[test]
fn a_page_cannot_go_inside_itself_or_its_own_sub_page() {
    let (t, k, _s) = open();
    let outer = page(&k, "Outer", None, None);
    let inner = page(&k, "Inner", None, Some(&outer.meta.path));
    let deepest = page(&k, "Deepest", None, Some(&inner.meta.path));
    let before = snapshot(t.vault.root());
    let commits_before = commits(&k);
    for (path, into) in [
        (&outer.meta.path, &outer.meta.path),
        (&outer.meta.path, &inner.meta.path),
        (&outer.meta.path, &deepest.meta.path),
        (&inner.meta.path, &deepest.meta.path),
    ] {
        let err = k
            .set_parent(&Actor::Human, path, Some(into), NOW)
            .unwrap_err()
            .to_string();
        assert!(err.contains("inside itself"), "{path} into {into}: {err}");
    }
    assert_eq!(snapshot(t.vault.root()), before, "nothing was written");
    assert_eq!(commits(&k), commits_before);
}

#[test]
fn only_a_page_holds_pages_and_only_a_page_or_card_goes_inside() {
    let (t, k, _s) = open();
    let inner = page(&k, "Inner", None, None);
    let before = snapshot(t.vault.root());
    for into in [
        "journal/2026/2026-09-23.md",
        "projects/photo-organiser/_project.md",
        "projects/photo-organiser/cards/duplicate-score-sketch.md",
    ] {
        assert!(
            k.set_parent(&Actor::Human, &inner.meta.path, Some(into), NOW)
                .is_err(),
            "{into}"
        );
    }
    let outer = page(&k, "Outer", None, None);
    for path in [
        "journal/2026/2026-09-23.md",
        "projects/photo-organiser/_project.md",
    ] {
        assert!(
            k.set_parent(&Actor::Human, path, Some(&outer.meta.path), NOW)
                .is_err(),
            "{path}"
        );
    }
    assert_eq!(snapshot(t.vault.root()).len(), before.len() + 1);
}

#[test]
fn the_comments_go_with_the_page_and_undo_puts_everything_back() {
    let (t, k, _s) = open();
    let holder = page(&k, "Holder", Some("photo-organiser"), None);
    let moving = page(&k, "Moving page", None, None);
    say(&k, &moving.meta.path, "Check this");
    let sidecar = moving.meta.path.replace(".md", ".comments.json");
    assert!(t.vault.root().join(&sidecar).is_file());
    let before = snapshot(t.vault.root());

    let placed = k
        .set_parent(
            &Actor::Human,
            &moving.meta.path,
            Some(&holder.meta.path),
            NOW,
        )
        .unwrap();
    let now_at = placed.note.meta.path.clone();
    assert_eq!(now_at, "projects/photo-organiser/pages/moving-page.md");
    assert!(
        !t.vault.root().join(&sidecar).exists(),
        "the old comments file is gone"
    );
    assert!(
        t.vault
            .root()
            .join(now_at.replace(".md", ".comments.json"))
            .is_file()
    );
    assert_eq!(k.comments(&now_at).unwrap().len(), 1);

    // One commit, and its undo brings back the page, its comments and its place.
    let commit = k.log(None, 1).unwrap()[0].id.clone();
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_page_without_an_id_is_given_one_to_hold_a_sub_page() {
    let (t, k, _s) = open();
    fs::write(
        t.vault.root().join("library/plain.md"),
        "---\ntitle: Plain\n---\nBody\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let inner = page(&k, "Inside", None, None);
    let placed = k
        .set_parent(
            &Actor::Human,
            &inner.meta.path,
            Some("library/plain.md"),
            NOW,
        )
        .unwrap();
    let plain = k.read("library/plain.md").unwrap();
    assert!(plain.meta.id.is_some());
    assert_eq!(placed.note.meta.parent, plain.meta.id);
}

#[test]
fn an_agent_nests_a_page_in_one_commit_and_a_cycle_is_refused_before_anything_waits() {
    let (_t, k, s) = open();
    let outer = page(&k, "Outer", None, None);
    let inner = page(&k, "Inner", None, Some(&outer.meta.path));
    let before = commits(&k);
    let nest = AgentOp::SetParent {
        path: outer.meta.path.clone(),
        parent: Some(inner.meta.path.clone()),
    };
    let err = k.agent_run(&s, &nest, NOW).unwrap_err().to_string();
    assert!(err.contains("inside itself"), "{err}");
    assert_eq!(commits(&k), before);
    assert!(
        k.proposals().unwrap().is_empty(),
        "a refusal is not a proposal"
    );

    let free = page(&k, "Free", None, None);
    let up = AgentOp::SetParent {
        path: free.meta.path.clone(),
        parent: Some(outer.meta.path.clone()),
    };
    let result = done(k.agent_run(&s, &up, NOW).unwrap());
    assert_eq!(result["path"], free.meta.path);
    let head = &k.log(None, 1).unwrap()[0];
    assert!(head.agent && head.op.as_deref() == Some("nest_note"));
    assert_eq!(
        commits(&k),
        before + 2,
        "the page I made, and the agent's one commit"
    );
    assert_eq!(k.read(&free.meta.path).unwrap().meta.parent, outer.meta.id);
}

#[test]
fn a_locked_page_is_not_reordered_or_nested_under_and_a_locked_sub_page_not_moved_by_an_agent() {
    let (t, k, s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let child = page(&k, "Child", None, Some(HANDBOOK));
    let other = page(&k, "Other", None, None);
    let fixed = page(&k, "Fixed", None, None);
    k.set_meta(&Actor::Human, HANDBOOK, "locked", Some("true"), NOW)
        .unwrap();
    k.set_meta(&Actor::Human, &fixed.meta.path, "locked", Some("true"), NOW)
        .unwrap();
    let before = snapshot(t.vault.root());
    for op in [
        AgentOp::ReorderChildren {
            parent: HANDBOOK.into(),
            ids: vec![id_of(&child)],
        },
        AgentOp::SetParent {
            path: other.meta.path.clone(),
            parent: Some(HANDBOOK.into()),
        },
        AgentOp::SetParent {
            path: fixed.meta.path.clone(),
            parent: Some(other.meta.path.clone()),
        },
        AgentOp::SetParent {
            path: fixed.meta.path.clone(),
            parent: None,
        },
    ] {
        let err = k.agent_run(&s, &op, NOW).unwrap_err().to_string();
        assert!(err.contains("locked"), "{}: {err}", op.name());
    }
    assert_eq!(snapshot(t.vault.root()), before);
    // The person may.
    k.reorder_children(&Actor::Human, HANDBOOK, &[id_of(&child)], NOW)
        .unwrap();
}
