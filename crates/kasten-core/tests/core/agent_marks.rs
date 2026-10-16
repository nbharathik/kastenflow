//! Agent marks: the lines of a note an agent
//! wrote, until a person edits or accepts them. Derived from git history and
//! cached in the index; nothing is ever written into the note.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::history::Actor;
use kasten_core::{AgentMark, Kasten, Outcome, frontmatter};
use serde_json::Map;

const WELCOME: &str = "library/welcome-to-kasten.md";
const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";
const IDEAS: &str = "First idea.\n\nSecond idea.\n\nThird idea.\n";

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn done(k: &Kasten, s: &Session, op: AgentOp) -> serde_json::Value {
    match k.agent_run(s, &op, NOW).unwrap() {
        Outcome::Done { result } => result,
        Outcome::PendingReview { reason, .. } => panic!("expected it to run, it waits: {reason}"),
        Outcome::Staged { .. } => unreachable!("agent_run never stages"),
    }
}

/// A card an agent writes; its path.
fn card(k: &Kasten, s: &Session, title: &str, body: &str) -> String {
    let made = done(
        k,
        s,
        AgentOp::CreateNote {
            note_type: "card".into(),
            title: title.into(),
            body: body.into(),
            project: None,
            tags: vec![],
            props: Map::new(),
            parent: None,
            template: None,
        },
    );
    made["path"].as_str().unwrap().to_owned()
}

fn append(path: &str, markdown: &str, heading: Option<&str>) -> AgentOp {
    AgentOp::Append {
        path: path.into(),
        markdown: markdown.into(),
        heading: heading.map(Into::into),
    }
}

fn body(k: &Kasten, path: &str) -> String {
    frontmatter::split(&k.read(path).unwrap().text)
        .body
        .to_owned()
}

/// The body line (from 0) that contains `needle`.
fn line(body: &str, needle: &str) -> usize {
    body.lines()
        .position(|l| l.contains(needle))
        .unwrap_or_else(|| panic!("no line with {needle:?} in {body:?}"))
}

fn spans(marks: &[AgentMark]) -> Vec<(usize, usize)> {
    marks.iter().map(|m| (m.start, m.end)).collect()
}

fn bytes(t: &common::TempVault, path: &str) -> Vec<u8> {
    fs::read(t.vault.root().join(path)).unwrap()
}

#[test]
fn a_note_an_agent_wrote_is_marked_whole_with_its_session() {
    let (t, k, s) = open();
    let path = card(&k, &s, "Brainstorm", IDEAS);
    let text = body(&k, &path);
    let before = bytes(&t, &path);

    let marks = k.agent_marks(&path).unwrap();
    let commit = &k.log(Some(&path), 1).unwrap()[0];
    assert_eq!(
        marks,
        [AgentMark {
            start: line(&text, "First idea."),
            end: line(&text, "Third idea.") + 1,
            session: s.id.clone(),
            client: "claude-code".into(),
            commit: commit.id.clone(),
            time: commit.time,
        }]
    );
    // A person's note has none, and nothing is written into either note.
    assert!(k.agent_marks(WELCOME).unwrap().is_empty());
    assert_eq!(bytes(&t, &path), before);
    assert!(k.dirty().unwrap().is_empty());
}

#[test]
fn a_person_s_edit_unmarks_the_paragraph_it_touches_before_and_after_its_commit() {
    let (t, k, s) = open();
    let path = card(&k, &s, "Brainstorm", IDEAS);
    let note = k.read(&path).unwrap();
    let edited = frontmatter::split(&note.text)
        .body
        .replace("Second idea.", "Second idea, in my words.");
    k.save_body(&Actor::Human, &path, &edited, &note.hash, NOW)
        .unwrap();
    // Typing waits for its commit; the marks follow the file at once.
    assert_eq!(k.pending_edits(), std::slice::from_ref(&path));
    let first = line(&edited, "First idea.");
    let third = line(&edited, "Third idea.");
    let marks = k.agent_marks(&path).unwrap();
    assert_eq!(spans(&marks), [(first, first + 1), (third, third + 1)]);
    assert!(marks.iter().all(|m| m.session == s.id));

    let before = bytes(&t, &path);
    k.commit_edits().unwrap().expect("the typing is committed");
    assert_eq!(k.agent_marks(&path).unwrap(), marks);
    k.forget_agent_marks().unwrap();
    assert_eq!(k.agent_marks(&path).unwrap(), marks);
    assert_eq!(bytes(&t, &path), before);
}

#[test]
fn an_agent_s_line_in_a_person_s_list_stays_marked_until_the_list_is_edited() {
    let (_t, k, s) = open();
    done(
        &k,
        &s,
        append(WELCOME, "- [ ] Accept the agent's text", Some("Try these")),
    );
    let text = body(&k, WELCOME);
    let added = line(&text, "Accept the agent's text");
    // Written into the person's to-do list, and newer than it: marked.
    assert_eq!(
        spans(&k.agent_marks(WELCOME).unwrap()),
        [(added, added + 1)]
    );

    // Ticking another item of that list is editing the list.
    let note = k.read(WELCOME).unwrap();
    let ticked = text.replace("- [ ] Type `/` on", "- [x] Type `/` on");
    assert_ne!(ticked, text);
    k.save_body(&Actor::Human, WELCOME, &ticked, &note.hash, NOW)
        .unwrap();
    assert!(k.agent_marks(WELCOME).unwrap().is_empty());
    k.commit_edits().unwrap();
    k.forget_agent_marks().unwrap();
    assert!(k.agent_marks(WELCOME).unwrap().is_empty());
}

#[test]
fn accepting_clears_the_marks_in_history_and_later_agent_text_is_marked_again() {
    let (t, k, s) = open();
    let path = card(&k, &s, "Brainstorm", IDEAS);
    assert_eq!(k.agent_marks(&path).unwrap().len(), 1);
    let before = bytes(&t, &path);

    // Agents cannot accept their own text.
    assert!(k.accept_agent_marks(&s.actor(), &path, NOW).is_err());
    k.accept_agent_marks(&Actor::Human, &path, NOW).unwrap();
    assert!(k.agent_marks(&path).unwrap().is_empty());
    assert_eq!(bytes(&t, &path), before, "no marker enters the note");
    let accept = k.log(None, 1).unwrap().remove(0);
    assert_eq!(accept.summary, "accept: Brainstorm");
    assert!(!accept.agent);
    assert!(accept.message.contains(&format!("Kasten-Accept: {path}\n")));
    assert!(
        k.commit_changes(&accept.id).unwrap().is_empty(),
        "the accept changes no file"
    );
    // Nothing left to accept makes no commit.
    k.accept_agent_marks(&Actor::Human, &path, NOW).unwrap();
    assert_eq!(k.log(None, 1).unwrap()[0].id, accept.id);
    // The cache knows nothing more than history does.
    k.forget_agent_marks().unwrap();
    assert!(k.agent_marks(&path).unwrap().is_empty());

    let later = Session::start("claude-desktop", NOW);
    done(&k, &later, append(&path, "A later thought.", None));
    let text = body(&k, &path);
    let added = line(&text, "A later thought.");
    let marks = k.agent_marks(&path).unwrap();
    assert_eq!(spans(&marks), [(added, added + 1)]);
    assert_eq!(
        (marks[0].session.as_str(), marks[0].client.as_str()),
        (later.id.as_str(), "claude-desktop")
    );
    k.forget_agent_marks().unwrap();
    assert_eq!(k.agent_marks(&path).unwrap(), marks);
}

#[test]
fn undoing_the_session_takes_its_marks_away() {
    let (t, k, s) = open();
    done(&k, &s, append(WELCOME, "An agent's closing line.", None));
    done(
        &k,
        &s,
        AgentOp::ReplaceSection {
            path: DRAFT.into(),
            heading: "3. Method".into(),
            markdown: "We rewrote the method.\nIn two lines.\n".into(),
        },
    );
    assert_eq!(k.agent_marks(WELCOME).unwrap().len(), 1);
    let text = body(&k, DRAFT);
    let first = line(&text, "We rewrote the method.");
    assert_eq!(spans(&k.agent_marks(DRAFT).unwrap()), [(first, first + 2)]);

    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert_eq!(undone.conflict, None);
    // The session's lines are gone, and the ones the undo put back are the
    // undo's: a person's.
    assert!(k.agent_marks(WELCOME).unwrap().is_empty());
    assert!(k.agent_marks(DRAFT).unwrap().is_empty());
    k.forget_agent_marks().unwrap();
    assert!(k.agent_marks(DRAFT).unwrap().is_empty());
    assert!(
        k.agent_marked(&[WELCOME.into(), DRAFT.into()])
            .unwrap()
            .is_empty()
    );
    assert!(t.vault.root().join(DRAFT).exists());
}

#[test]
fn an_accepted_proposal_is_the_agent_s_writing() {
    let (_t, k, s) = open();
    let old = body(&k, DRAFT);
    // The first line of a three-line paragraph whose other lines stay.
    let new = old.replace(
        "Everyone keeps notes, and few can find them again. In practice, notes pile",
        "A line the agent rewrote. In practice, notes pile",
    );
    assert_ne!(new, old);
    let outcome = k
        .agent_run(
            &s,
            &AgentOp::Edit {
                path: DRAFT.into(),
                body: new.clone(),
                base: old,
                reason: Some("Tighter".into()),
            },
            NOW,
        )
        .unwrap();
    let Outcome::PendingReview { proposal, .. } = outcome else {
        panic!("a full rewrite waits for review")
    };
    // Waiting for review, it is not in the note, so not marked.
    assert!(k.agent_marks(DRAFT).unwrap().is_empty());

    k.accept_proposal(&proposal, "you", NOW).unwrap();
    let commit = k.log(Some(DRAFT), 1).unwrap().remove(0);
    assert_eq!(commit.approved_by.as_deref(), Some("you"));
    let at = line(&body(&k, DRAFT), "A line the agent rewrote.");
    let marks = k.agent_marks(DRAFT).unwrap();
    assert_eq!(spans(&marks), [(at, at + 1)]);
    assert_eq!(marks[0].session, s.id);
    assert_eq!(marks[0].client, "claude-code");
    assert_eq!(marks[0].commit, commit.id);
}

#[test]
fn the_cache_agrees_with_a_fresh_walk_and_follows_new_commits() {
    let (t, k, s) = open();
    let path = card(&k, &s, "Brainstorm", IDEAS);
    let first = k.agent_marks(&path).unwrap();
    assert_eq!(k.agent_marks(&path).unwrap(), first, "from the cache");

    // Commits to other notes leave them as they were.
    done(&k, &s, append(WELCOME, "Elsewhere.", None));
    k.capture(&Actor::Human, "A thought of mine", &[], NOW)
        .unwrap();
    assert_eq!(k.agent_marks(&path).unwrap(), first);

    // A commit to the note shows at once.
    let other = Session::start("claude-desktop", NOW);
    done(
        &k,
        &other,
        append(&path, "More, from another session.", None),
    );
    let second = k.agent_marks(&path).unwrap();
    assert_eq!(second.len(), 2);
    assert_eq!(second[0], first[0]);
    assert_eq!(second[1].session, other.id);

    // A person renaming the note keeps its marks with it.
    let renamed = k
        .rename(&Actor::Human, &path, "Brainstorm, kept", NOW)
        .unwrap();
    let moved = renamed.note.meta.path.clone();
    assert_ne!(moved, path);
    assert_eq!(k.agent_marks(&moved).unwrap(), second);

    let before = bytes(&t, &moved);
    k.forget_agent_marks().unwrap();
    assert_eq!(k.agent_marks(&moved).unwrap(), second);
    assert_eq!(bytes(&t, &moved), before);
}

#[test]
fn agent_marked_names_the_notes_with_marks() {
    let (_t, k, s) = open();
    let a = card(&k, &s, "Idea A", "Alpha.\n");
    let b = card(&k, &s, "Idea B", "Beta.\n");
    let mut paths: Vec<String> = k.list().unwrap().into_iter().map(|n| n.path).collect();
    assert!(paths.len() > 16, "enough notes to walk them together");
    paths.push("library/missing.md".into());
    paths.push("../outside.md".into());
    let mut marked = k.agent_marked(&paths).unwrap();
    marked.sort();
    assert_eq!(marked, [a.clone(), b.clone()]);
    // From the cache, the same.
    let mut again = k.agent_marked(&paths).unwrap();
    again.sort();
    assert_eq!(again, marked);

    k.accept_agent_marks(&Actor::Human, &a, NOW).unwrap();
    assert_eq!(k.agent_marked(&paths).unwrap(), std::slice::from_ref(&b));
    // Rewriting every line of B, not yet committed, takes it off too.
    let note = k.read(&b).unwrap();
    k.save_body(&Actor::Human, &b, "Mine now.\n", &note.hash, NOW)
        .unwrap();
    assert!(k.agent_marked(&paths).unwrap().is_empty());
}

#[test]
fn marks_need_history_and_a_note() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    assert!(k.agent_marks(WELCOME).unwrap().is_empty());
    assert!(k.agent_marked(&[WELCOME.into()]).unwrap().is_empty());
    k.accept_agent_marks(&Actor::Human, WELCOME, NOW).unwrap();
    k.start_history().unwrap();
    assert!(k.agent_marks("library/missing.md").is_err());
    assert!(k.agent_marks("../outside.md").is_err());
}
