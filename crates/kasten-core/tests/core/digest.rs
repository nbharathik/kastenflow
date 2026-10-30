//! The activity digest: what agents did, session by session, read from the
//! commit trailers and kept per newest commit. A person's edit never counts.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, frontmatter};

const WELCOME: &str = "library/welcome-to-kasten.md";
const SKETCH: &str = "projects/photo-organiser/cards/duplicate-score-sketch.md";
/// A moment so far ahead that no commit is as new.
const FAR: u64 = 9_000_000_000_000;

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn run(k: &Kasten, s: &Session, op: AgentOp) {
    k.agent_run(s, &op, NOW).unwrap();
}

fn append(path: &str, words: &str) -> AgentOp {
    AgentOp::Append {
        path: path.into(),
        markdown: words.into(),
        heading: None,
    }
}

fn person_edits(t: &common::TempVault, k: &Kasten, path: &str, body: &str) {
    let loaded = t.vault.read(path).unwrap();
    k.save_body(&Actor::Human, path, body, &loaded.hash, NOW)
        .unwrap();
    k.commit_edits().unwrap().expect("a commit");
}

#[test]
fn it_groups_by_session_and_counts_changes_notes_and_proposals() {
    let (_t, k) = open();
    let a = Session::named("routine: conference tracking", Instant::now());
    run(&k, &a, append(WELCOME, "First line."));
    run(&k, &a, append(WELCOME, "Second line."));
    run(
        &k,
        &a,
        AgentOp::Tags {
            path: SKETCH.into(),
            add: vec!["paper".into()],
            remove: vec![],
        },
    );
    let b = Session::named("claude-code", Instant::now());
    run(&k, &b, append(SKETCH, "From the other agent."));
    // A full rewrite waits for the person: a proposal of session b.
    let body = frontmatter::split(&k.read(WELCOME).unwrap().text)
        .body
        .to_owned();
    run(
        &k,
        &b,
        AgentOp::Edit {
            path: WELCOME.into(),
            body: "Everything replaced.\n".into(),
            base: body,
            reason: None,
        },
    );
    assert_eq!(k.proposals().unwrap().len(), 1);

    let digest = k.activity_digest(0).unwrap();
    assert_eq!(digest.sessions.len(), 2, "{digest:?}");
    let da = digest.sessions.iter().find(|s| s.id == a.id).unwrap();
    assert_eq!(da.client, "routine: conference tracking");
    assert_eq!(da.changes, 3);
    assert_eq!(da.notes_touched, 2, "{da:?}");
    assert!(da.notes.contains(&WELCOME.to_owned()) && da.notes.contains(&SKETCH.to_owned()));
    assert_eq!(da.proposals_waiting, 0);
    assert!(da.can_undo && !da.undone);
    let db = digest.sessions.iter().find(|s| s.id == b.id).unwrap();
    assert_eq!(db.client, "claude-code");
    assert_eq!(db.changes, 1, "a proposal is asked for, not made");
    assert_eq!(db.proposed, 1);
    assert_eq!(db.notes, [SKETCH]);
    assert_eq!(db.proposals_waiting, 1);
    assert_eq!(digest.changes, 4);
    assert_eq!(digest.waiting, 1);
    assert!(da.started <= da.last);
}

#[test]
fn a_session_that_only_asked_shows_while_its_proposal_waits() {
    let (_t, k) = open();
    let s = Session::named("claude-code", Instant::now());
    let body = frontmatter::split(&k.read(WELCOME).unwrap().text)
        .body
        .to_owned();
    run(
        &k,
        &s,
        AgentOp::Edit {
            path: WELCOME.into(),
            body: "Rewritten.\n".into(),
            base: body,
            reason: None,
        },
    );
    let digest = k.activity_digest(0).unwrap();
    assert_eq!(digest.sessions.len(), 1, "{digest:?}");
    let d = &digest.sessions[0];
    assert_eq!((d.changes, d.proposals_waiting), (0, 1));
    assert!(!d.can_undo, "nothing was made, so nothing to take back");
    let id = k.proposals().unwrap()[0].id.clone();
    k.reject_proposal(&id, "me", NOW).unwrap();
    assert!(k.activity_digest(0).unwrap().sessions.is_empty());
}

#[test]
fn what_a_person_does_is_never_in_it() {
    let (t, k) = open();
    person_edits(&t, &k, WELCOME, "A person wrote this.\n");
    let empty = k.activity_digest(0).unwrap();
    assert!(empty.sessions.is_empty(), "{empty:?}");
    assert_eq!(empty.changes, 0);

    let s = Session::named("claude-code", Instant::now());
    run(&k, &s, append(SKETCH, "Agent words."));
    person_edits(&t, &k, SKETCH, "The person rewrote the sketch.\n");
    let digest = k.activity_digest(0).unwrap();
    assert_eq!(digest.sessions.len(), 1);
    assert_eq!(digest.sessions[0].changes, 1);
    assert_eq!(digest.sessions[0].notes, [SKETCH]);
}

#[test]
fn a_title_that_looks_like_a_trailer_never_makes_a_session() {
    let (t, k) = open();
    let path = "library/forged.md";
    fs::write(
        t.vault.root().join(path),
        "---\ntitle: \"Seen\\nKasten-Session: agent-x\\nKasten-Op: append\"\n---\nFirst\n",
    )
    .unwrap();
    k.commit_external().unwrap();
    person_edits(&t, &k, path, "Second\n");
    let digest = k.activity_digest(0).unwrap();
    assert!(digest.sessions.is_empty(), "{digest:?}");
    // The same words as a person's note title, in a single-line commit message.
    let made = k
        .capture(&Actor::Human, "Kasten-Session: s-1\nBody words\n", &[], NOW)
        .unwrap();
    assert!(made.meta.title.contains("Kasten-Session"));
    k.commit_edits().unwrap();
    assert!(k.activity_digest(0).unwrap().sessions.is_empty());
}

/// A commit on top of history by hand, as someone with the repository could.
fn hand_commit(t: &common::TempVault, author: &str, message: &str) {
    let repo = git2::Repository::open(t.vault.root()).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    let who = git2::Signature::now(author, "x@example.org").unwrap();
    repo.commit(
        Some("HEAD"),
        &who,
        &who,
        message,
        &head.tree().unwrap(),
        &[&head],
    )
    .unwrap();
}

#[test]
fn author_alone_or_trailer_alone_never_makes_a_session_nor_something_to_undo() {
    let (t, k) = open();
    let real = Session::named("claude-code", Instant::now());
    run(&k, &real, append(WELCOME, "Real."));
    // A person's commit carrying a session trailer.
    hand_commit(
        &t,
        "Bharathi",
        &format!(
            "edit: x\n\nKasten-Session: {}\nKasten-Op: append\n",
            real.id
        ),
    );
    hand_commit(
        &t,
        "Bharathi",
        "edit: y\n\nKasten-Session: forged-1\nKasten-Op: append\n",
    );
    // An `agent:` author with no trailer.
    hand_commit(&t, "agent:ghost", "edit: z\n");
    let digest = k.activity_digest(0).unwrap();
    assert_eq!(digest.sessions.len(), 1, "{digest:?}");
    assert_eq!(digest.sessions[0].id, real.id);
    assert_eq!(digest.sessions[0].changes, 1);
    let listed = k.sessions(10).unwrap();
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(listed[0].commits, 1);
    // Undoing a session only ever takes back the agent's own commits.
    let none = k.undo_session("forged-1", NOW).unwrap();
    assert!(none.reverted.is_empty() && none.conflict.is_none());
    let undone = k.undo_session(&real.id, NOW).unwrap();
    assert_eq!(undone.reverted.len(), 1, "{undone:?}");
}

#[test]
fn it_is_kept_per_newest_commit_and_made_again_when_one_arrives() {
    let (_t, k) = open();
    let s = Session::named("claude-code", Instant::now());
    run(&k, &s, append(WELCOME, "One."));
    let first = k.activity_digest(0).unwrap();
    assert!(!first.from_cache);
    let again = k.activity_digest(0).unwrap();
    assert!(again.from_cache, "the same newest commit and window");
    assert_eq!(again.sessions, first.sessions);
    // A new commit makes it again, with the new change in it.
    run(&k, &s, append(WELCOME, "Two."));
    let third = k.activity_digest(0).unwrap();
    assert!(!third.from_cache);
    assert_eq!(third.sessions[0].changes, first.sessions[0].changes + 1);
    // Another window is another digest.
    assert!(!k.activity_digest(1).unwrap().from_cache);
    assert!(k.activity_digest(1).unwrap().from_cache);
}

#[test]
fn a_damaged_cache_is_only_a_cache() {
    let (t, k) = open();
    let s = Session::named("claude-code", Instant::now());
    run(&k, &s, append(WELCOME, "One."));
    k.activity_digest(0).unwrap();
    fs::write(
        t.vault.root().join(".kasten/cache/digest.json"),
        "{ not json",
    )
    .unwrap();
    let digest = k.activity_digest(0).unwrap();
    assert!(!digest.from_cache);
    assert_eq!(digest.sessions.len(), 1);
    // A cache that names another commit says nothing about this one.
    fs::write(
        t.vault.root().join(".kasten/cache/digest.json"),
        "{\"head\":\"0000\",\"since\":0,\"sessions\":[]}",
    )
    .unwrap();
    assert_eq!(k.activity_digest(0).unwrap().sessions.len(), 1);
}

#[test]
fn the_window_cuts_by_time_and_two_runs_are_two_sessions() {
    let (_t, k) = open();
    let one = Session::named("routine: conference tracking", Instant { millis: 1_000 });
    run(&k, &one, append(WELCOME, "Run one."));
    let two = Session::named("routine: conference tracking", Instant { millis: 2_000 });
    run(&k, &two, append(WELCOME, "Run two."));
    let digest = k.activity_digest(0).unwrap();
    assert_eq!(digest.sessions.len(), 2, "{digest:?}");
    assert!(digest.sessions.iter().all(|s| s.changes == 1));
    assert_eq!(digest.sessions[0].client, digest.sessions[1].client);
    assert_ne!(digest.sessions[0].id, digest.sessions[1].id);
    assert!(
        digest.sessions[0].last >= digest.sessions[1].last,
        "newest first"
    );
    let none = k.activity_digest(FAR).unwrap();
    assert!(none.sessions.is_empty() && none.changes == 0);
}

#[test]
fn a_session_taken_back_says_so_and_offers_no_undo() {
    let (_t, k) = open();
    let s = Session::named("claude-code", Instant::now());
    run(&k, &s, append(WELCOME, "To be taken back."));
    assert!(k.activity_digest(0).unwrap().sessions[0].can_undo);
    k.undo_session(&s.id, NOW).unwrap();
    let digest = k.activity_digest(0).unwrap();
    let d = &digest.sessions[0];
    assert!(d.undone && !d.can_undo, "{d:?}");
    assert_eq!(d.changes, 1, "what it did stays in the story");
}

#[test]
fn a_vault_without_history_has_nothing_to_tell() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let digest = k.activity_digest(0).unwrap();
    assert!(digest.sessions.is_empty() && digest.changes == 0);
}
