//! The parity ops for notes: a copy, a note back from the trash, the page
//! header, a template, a journal day, a to-do and comments. Each is made
//! under the modes, refused where a lock or a bad request says so, and a
//! proposal held in Review is made when it is accepted.

use crate::change_sets::open;
use crate::common::NOW;
use crate::structure::{commits, done, page, pending};
use crate::structure_agent::set_mode;
use kasten_core::agent::AgentOp;
use kasten_core::comments::Anchor;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten, NoteFile};

pub(crate) fn refused(k: &Kasten, s: &kasten_core::agent::Session, op: &AgentOp) -> String {
    match k.agent_run(s, op, NOW) {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

pub(crate) fn lock(k: &Kasten, path: &str) {
    k.set_meta(&Actor::Human, path, "locked", Some("true"), NOW)
        .unwrap();
}

fn empty_page(k: &Kasten, title: &str) -> NoteFile {
    let made = page(k, title, None, None);
    let hash = k.read(&made.meta.path).unwrap().hash;
    k.save_body(&Actor::Human, &made.meta.path, "", &hash, NOW)
        .unwrap();
    k.read(&made.meta.path).unwrap()
}

#[test]
fn duplicate_note_makes_a_copy_and_is_refused_for_a_locked_note() {
    let (_t, k, s) = open();
    let original = page(&k, "Alpha", None, None);
    let op = AgentOp::DuplicateNote {
        path: original.meta.path.clone(),
    };
    let before = k.list().unwrap().len();
    let told = done(k.agent_run(&s, &op, NOW).unwrap());
    assert_ne!(told["path"], original.meta.path.as_str());
    assert_eq!(k.list().unwrap().len(), before + 1);
    assert_eq!(k.log(None, 1).unwrap()[0].author, "agent:kasten-chat");

    lock(&k, &original.meta.path);
    let why = refused(&k, &s, &op);
    assert!(why.contains("locked"), "{why}");
    let not_a_note = AgentOp::DuplicateNote {
        path: "projects/photo-organiser/boards/brainstorm.canvas".into(),
    };
    assert!(refused(&k, &s, &not_a_note).contains("not a note"));
}

#[test]
fn duplicate_note_waits_in_review_and_is_made_when_accepted() {
    let (_t, k, s) = open();
    let original = page(&k, "Alpha", None, None);
    set_mode(&k, AgentMode::Review);
    let before = k.list().unwrap().len();
    let op = AgentOp::DuplicateNote {
        path: original.meta.path.clone(),
    };
    let id = pending(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(k.list().unwrap().len(), before);
    let proposal = &k.proposals().unwrap()[0];
    assert!(
        proposal.diff.contains("copy of “Alpha”"),
        "{}",
        proposal.diff
    );
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(k.list().unwrap().len(), before + 1);
}

#[test]
fn restore_note_brings_a_trashed_page_back_and_refuses_what_the_trash_does_not_list() {
    let (_t, k, s) = open();
    let gone = page(&k, "Gone page", None, None);
    let trashed = k.trash(&Actor::Human, &gone.meta.path, NOW).unwrap();
    let op = AgentOp::RestoreNote {
        path: trashed.clone(),
    };
    let told = done(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(told["title"], "Gone page");
    assert!(k.read(&gone.meta.path).is_ok());

    let nothing = AgentOp::RestoreNote {
        path: ".trash/20200101T000000Z/nothing.md".into(),
    };
    assert!(refused(&k, &s, &nothing).contains("trash lists"));
    let live = AgentOp::RestoreNote {
        path: gone.meta.path.clone(),
    };
    assert!(refused(&k, &s, &live).contains("trash lists"));
}

#[test]
fn restore_note_waits_in_review() {
    let (_t, k, s) = open();
    let gone = page(&k, "Gone page", None, None);
    let trashed = k.trash(&Actor::Human, &gone.meta.path, NOW).unwrap();
    set_mode(&k, AgentMode::Review);
    let id = pending(
        k.agent_run(&s, &AgentOp::RestoreNote { path: trashed }, NOW)
            .unwrap(),
    );
    assert!(k.read(&gone.meta.path).is_err());
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(k.read(&gone.meta.path).is_ok());
}

#[test]
fn set_note_meta_sets_a_header_key_and_refuses_the_lock_the_title_and_bad_values() {
    let (_t, k, s) = open();
    let p = page(&k, "Styled", None, None);
    let set = |key: &str, value: Option<&str>| AgentOp::SetNoteMeta {
        path: p.meta.path.clone(),
        key: key.into(),
        value: value.map(str::to_owned),
    };
    done(k.agent_run(&s, &set("font", Some("serif")), NOW).unwrap());
    done(k.agent_run(&s, &set("icon", Some("📘")), NOW).unwrap());
    let text = k.read(&p.meta.path).unwrap().text;
    assert!(
        text.contains("font: serif") && text.contains("icon: 📘"),
        "{text}"
    );
    done(k.agent_run(&s, &set("font", None), NOW).unwrap());
    assert!(!k.read(&p.meta.path).unwrap().text.contains("font:"));

    let why = refused(&k, &s, &set("locked", Some("true")));
    assert!(why.contains("person only"), "{why}");
    assert!(refused(&k, &s, &set("title", Some("X"))).contains("rename_note"));
    assert!(refused(&k, &s, &set("font", Some("comic"))).contains("serif"));
    assert!(refused(&k, &s, &set("opens", Some("tab"))).contains("icon, cover"));
    lock(&k, &p.meta.path);
    assert!(refused(&k, &s, &set("icon", Some("📗"))).contains("locked"));
}

#[test]
fn set_note_meta_waits_in_review() {
    let (_t, k, s) = open();
    let p = page(&k, "Styled", None, None);
    set_mode(&k, AgentMode::Review);
    let op = AgentOp::SetNoteMeta {
        path: p.meta.path.clone(),
        key: "width".into(),
        value: Some("wide".into()),
    };
    let id = pending(k.agent_run(&s, &op, NOW).unwrap());
    assert!(!k.read(&p.meta.path).unwrap().text.contains("width:"));
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(k.read(&p.meta.path).unwrap().text.contains("width: wide"));
}

#[test]
fn apply_template_fills_an_empty_page_only() {
    let (_t, k, s) = open();
    let blank = empty_page(&k, "Standup");
    let op = |path: &str, template: &str| AgentOp::ApplyTemplate {
        path: path.into(),
        template: template.into(),
        date: None,
    };
    let told = done(
        k.agent_run(&s, &op(&blank.meta.path, "meeting"), NOW)
            .unwrap(),
    );
    assert_eq!(told["title"], "Standup");
    assert!(
        !kasten_core::frontmatter::split(&k.read(&blank.meta.path).unwrap().text)
            .body
            .trim()
            .is_empty()
    );
    // Now it has text: a template never writes over it.
    let why = refused(&k, &s, &op(&blank.meta.path, "meeting"));
    assert!(why.contains("only start empty pages"), "{why}");
    let other = empty_page(&k, "Other");
    assert!(refused(&k, &s, &op(&other.meta.path, "No such one")).contains("No template"));
    assert!(refused(&k, &s, &op(&other.meta.path, "ai/summarise")).contains("AI action"));
    lock(&k, &other.meta.path);
    assert!(refused(&k, &s, &op(&other.meta.path, "meeting")).contains("locked"));
}

#[test]
fn journal_day_makes_the_day_once_and_refuses_a_bad_day() {
    let (t, k, s) = open();
    let op = AgentOp::JournalDay {
        date: "2026-11-03".into(),
    };
    let made = done(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(made["path"], "journal/2026/2026-11-03.md");
    assert!(t.vault.root().join("journal/2026/2026-11-03.md").exists());
    let after = commits(&k);
    done(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(commits(&k), after, "a day that is there is only opened");
    let bad = AgentOp::JournalDay {
        date: "tomorrow".into(),
    };
    assert!(refused(&k, &s, &bad).contains("Not a day"));
}

#[test]
fn journal_day_waits_in_review() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let op = AgentOp::JournalDay {
        date: "2026-11-04".into(),
    };
    let id = pending(k.agent_run(&s, &op, NOW).unwrap());
    assert!(!t.vault.root().join("journal/2026/2026-11-04.md").exists());
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(t.vault.root().join("journal/2026/2026-11-04.md").exists());
}

fn with_tasks(k: &Kasten) -> NoteFile {
    let p = page(k, "Chores", None, None);
    k.append(
        &Actor::Human,
        &p.meta.path,
        "- [ ] wash up\n- [x] shop\n\nplain line",
        None,
        NOW,
    )
    .unwrap();
    k.read(&p.meta.path).unwrap()
}

fn line_of(note: &NoteFile, text: &str) -> u32 {
    kasten_core::extract::extract(kasten_core::frontmatter::split(&note.text).body)
        .tasks
        .iter()
        .find(|t| t.text == text)
        .unwrap()
        .line as u32
}

#[test]
fn set_task_changes_one_check_box_and_refuses_a_stale_hash_and_a_line_that_is_no_to_do() {
    let (_t, k, s) = open();
    let note = with_tasks(&k);
    let line = line_of(&note, "wash up");
    let op = |line: u32, done: bool, base: &str| AgentOp::SetTask {
        path: note.meta.path.clone(),
        line,
        done,
        base: base.into(),
    };
    let told = done(k.agent_run(&s, &op(line, true, &note.hash), NOW).unwrap());
    let after = k.read(&note.meta.path).unwrap();
    assert_eq!(told["hash"], after.hash.as_str());
    let body_before = kasten_core::frontmatter::split(&note.text).body;
    let body_after = kasten_core::frontmatter::split(&after.text).body;
    assert_eq!(
        body_after,
        body_before.replacen("- [ ] wash up", "- [x] wash up", 1)
    );

    // The hash it read is out of date now.
    let why = refused(&k, &s, &op(line, false, &note.hash));
    assert!(why.contains("changed since you read it"), "{why}");
    // A line that is not a to-do names the lines that are.
    let plain = body_after.lines().count() as u32 - 1;
    let why = refused(&k, &s, &op(plain, true, &after.hash));
    assert!(
        why.contains("not a to-do") && why.contains(&line.to_string()),
        "{why}"
    );
    // Saying what is so already writes nothing.
    let count = commits(&k);
    done(k.agent_run(&s, &op(line, true, &after.hash), NOW).unwrap());
    assert_eq!(commits(&k), count);
    lock(&k, &note.meta.path);
    let locked = k.read(&note.meta.path).unwrap();
    assert!(refused(&k, &s, &op(line, false, &locked.hash)).contains("locked"));
}

#[test]
fn set_task_waits_in_review_and_a_proposal_gone_stale_is_refused_when_accepted() {
    let (_t, k, s) = open();
    let note = with_tasks(&k);
    let line = line_of(&note, "wash up");
    set_mode(&k, AgentMode::Review);
    let op = AgentOp::SetTask {
        path: note.meta.path.clone(),
        line,
        done: true,
        base: note.hash.clone(),
    };
    let id = pending(k.agent_run(&s, &op, NOW).unwrap());
    // A person edits the note meanwhile.
    k.append(&Actor::Human, &note.meta.path, "more", None, NOW)
        .unwrap();
    let why = k.accept_proposal(&id, "me", NOW).unwrap_err().to_string();
    assert!(why.contains("changed since you read it"), "{why}");
}

fn anchor() -> Anchor {
    Anchor {
        section: String::new(),
        nth: 1,
        quote: None,
        prefix: None,
        suffix: None,
    }
}

#[test]
fn comments_are_added_resolved_and_refused_on_a_locked_page() {
    let (_t, k, s) = open();
    let p = page(&k, "Reviewed", None, None);
    let add = |text: &str| AgentOp::AddComment {
        path: p.meta.path.clone(),
        anchor: anchor(),
        text: text.into(),
    };
    let told = done(
        k.agent_run(&s, &add("Check the second claim"), NOW)
            .unwrap(),
    );
    let id = told["id"].as_str().unwrap().to_owned();
    let all = k.comments(&p.meta.path).unwrap();
    assert_eq!(
        (all.len(), all[0].author.as_str()),
        (1, "agent:kasten-chat")
    );
    let resolve = |resolved: bool| AgentOp::ResolveComment {
        path: p.meta.path.clone(),
        id: id.clone(),
        resolved,
    };
    done(k.agent_run(&s, &resolve(true), NOW).unwrap());
    assert!(k.comments(&p.meta.path).unwrap()[0].resolved.is_some());
    done(k.agent_run(&s, &resolve(false), NOW).unwrap());
    assert!(k.comments(&p.meta.path).unwrap()[0].resolved.is_none());
    assert!(refused(&k, &s, &add("  ")).contains("needs some words"));
    lock(&k, &p.meta.path);
    assert!(refused(&k, &s, &add("More")).contains("locked"));
}

#[test]
fn a_comment_waits_in_review_and_is_signed_by_the_agent_when_accepted() {
    let (_t, k, s) = open();
    let p = page(&k, "Reviewed", None, None);
    set_mode(&k, AgentMode::Review);
    let op = AgentOp::AddComment {
        path: p.meta.path.clone(),
        anchor: anchor(),
        text: "Look here".into(),
    };
    let id = pending(k.agent_run(&s, &op, NOW).unwrap());
    assert!(k.comments(&p.meta.path).unwrap().is_empty());
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(
        k.comments(&p.meta.path).unwrap()[0].author,
        "agent:kasten-chat"
    );
}
