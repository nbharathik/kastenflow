//! A chat that previews its changes: its writes are staged and not written,
//! the window hears how many there are, and the person applies or discards
//! them as one.

use std::fs;
use std::sync::Arc;

use kasten_core::agent::ApplyOutcome;
use serde_json::json;

use super::turns::{request, results, turn};
use super::{Fake, Seen, Step, Vault, vault};
use crate::chat::changes::{apply, discard, recalculate, view_of};
use crate::chat::model::Stop;
use crate::chat::threads::Chats;
use crate::chat::{ChatRequest, EventKind, WriteMode};

const WELCOME: &str = "library/welcome-to-kasten.md";

fn previewing(chat: &str, text: &str) -> ChatRequest {
    ChatRequest {
        writes: WriteMode::Preview,
        ..request(chat, text)
    }
}

fn file(v: &Vault, path: &str) -> String {
    fs::read_to_string(v.dir.join(path)).unwrap()
}

/// A model that stages a note, adds to another, and says so.
fn busy() -> Arc<Fake> {
    Fake::new(vec![
        Step::Reply(
            "Staging.",
            vec![
                (
                    "create_note",
                    json!({"type": "page", "title": "Trip plan", "body": "Day one.\n"}),
                ),
                (
                    "append",
                    json!({"note": "library/welcome-to-kasten.md", "markdown": "From the chat."}),
                ),
            ],
            Stop::Tools,
        ),
        Step::Reply("Staged both.", vec![], Stop::End),
    ])
}

#[test]
fn a_request_that_says_nothing_about_writes_previews_them() {
    let asked: ChatRequest =
        serde_json::from_str(r#"{"chat": "c", "provider": "p", "text": "t"}"#).unwrap();
    assert_eq!(asked.writes, WriteMode::Preview);
    let direct: ChatRequest =
        serde_json::from_str(r#"{"chat": "c", "provider": "p", "text": "t", "writes": "direct"}"#)
            .unwrap();
    assert_eq!(direct.writes, WriteMode::Direct);
}

#[test]
fn a_previewing_turn_stages_its_writes_and_tells_the_window() {
    let v = vault();
    let before = file(&v, WELCOME);
    let head = v.kasten.log(None, 1).unwrap()[0].id.clone();
    let chats = Chats::default();
    let model = busy();
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, previewing("c1", "Plan my trip"));

    // Nothing was written, and nothing was committed.
    assert_eq!(file(&v, WELCOME), before);
    assert!(!v.dir.join("library/trip-plan.md").exists());
    assert_eq!(v.kasten.log(None, 1).unwrap()[0].id, head);
    assert!(v.kasten.proposals().unwrap().is_empty());

    // The window is told each result was staged, and how many changes there are.
    let results_seen = seen.of(EventKind::ToolResult);
    assert_eq!(results_seen.len(), 2);
    assert!(
        results_seen
            .iter()
            .all(|e| e.result.as_ref().unwrap().staged)
    );
    assert_eq!(
        results_seen[0].result.as_ref().unwrap().summary,
        "Created page “Trip plan”"
    );
    let changes = seen.of(EventKind::Changes);
    assert_eq!(changes.len(), 2);
    let info = changes[1].changes.clone().unwrap();
    assert_eq!(info.count, 2);
    assert_eq!(info.paths, [WELCOME, "library/trip-plan.md"]);
    assert_eq!(seen.last().kind, EventKind::Done);

    // The model was told the change was staged, not done.
    let sent = model.sent();
    let back = &results(sent[1].last().unwrap())[0];
    assert!(back.content.contains("\"status\":\"staged\""), "{back:?}");

    // The person looks at it: each file before and after.
    let set = chats.changes("c1").unwrap();
    let view = view_of(&v.kasten, &set.lock().unwrap()).unwrap();
    assert_eq!(view.files.len(), 2);
    let welcome = view.files.iter().find(|f| f.path == WELCOME).unwrap();
    assert_eq!(welcome.before.as_deref(), Some(before.as_str()));
    assert!(welcome.after.contains("From the chat.") && welcome.diff.contains("+From the chat."));
    assert!(!welcome.new && !welcome.stale);
    let made = view.files.iter().find(|f| f.new).unwrap();
    assert_eq!(
        (made.title.as_str(), made.before.as_deref()),
        ("Trip plan", None)
    );
    assert_eq!(view.steps.len(), 2);
}

#[test]
fn applying_writes_the_set_as_one_commit_approved_by_the_person() {
    let v = vault();
    let chats = Chats::default();
    let seen = Seen::new();
    let answer = turn(&chats, &v, &busy(), &seen, previewing("c1", "Plan my trip"));
    let set = chats.changes("c1").unwrap();
    let id = set.lock().unwrap().id.clone();
    let before = v.kasten.log(None, 100).unwrap().len();

    let outcome = apply(&v.kasten, &set).unwrap();
    let ApplyOutcome::Applied { commit, paths } = outcome else {
        panic!("expected it to apply")
    };
    assert_eq!(paths, ["library/trip-plan.md", WELCOME]);
    assert!(file(&v, WELCOME).contains("From the chat."));
    assert!(file(&v, "library/trip-plan.md").contains("Day one."));
    let log = v.kasten.log(None, 100).unwrap();
    assert_eq!(log.len(), before + 1);
    assert_eq!(Some(&log[0].id), commit.as_ref());
    assert_eq!(log[0].author, "agent:kasten-chat");
    assert_eq!(log[0].session.as_deref(), Some(answer.session.as_str()));
    assert!(log[0].approved_by.is_some());
    assert!(log[0].message.contains("Kasten-Change-Set:"));
    // The thread has an empty set again, with a fresh id.
    let now = set.lock().unwrap().clone();
    assert!(now.is_empty() && now.id != id);
    // Undoing the session takes the whole chat back.
    let undone = v
        .kasten
        .undo_session(&answer.session, kasten_core::Instant::now())
        .unwrap();
    assert!(undone.conflict.is_none());
    assert!(!v.dir.join("library/trip-plan.md").exists());
}

#[test]
fn discarding_throws_the_set_away_and_touches_nothing_else() {
    let v = vault();
    let before = file(&v, WELCOME);
    let chats = Chats::default();
    turn(
        &chats,
        &v,
        &busy(),
        &Seen::new(),
        previewing("c1", "Plan my trip"),
    );
    let set = chats.changes("c1").unwrap();
    let id = set.lock().unwrap().id.clone();
    let folder = v.dir.join(".kasten/cache/changes").join(&id);
    assert!(folder.is_dir());
    discard(&v.kasten, &set).unwrap();
    assert!(!folder.exists());
    assert!(set.lock().unwrap().is_empty());
    assert_eq!(file(&v, WELCOME), before);
    assert!(!v.dir.join("library/trip-plan.md").exists());
}

#[test]
fn a_later_turn_builds_on_what_an_earlier_one_staged() {
    let v = vault();
    let chats = Chats::default();
    let first = Fake::new(vec![
        Step::Reply(
            "",
            vec![(
                "create_note",
                json!({"type": "page", "title": "Trip plan", "body": "Day one.\n"}),
            )],
            Stop::Tools,
        ),
        Step::Reply("Made it.", vec![], Stop::End),
    ]);
    turn(
        &chats,
        &v,
        &first,
        &Seen::new(),
        previewing("c1", "Make a plan"),
    );
    let second = Fake::new(vec![
        Step::Reply(
            "",
            vec![(
                "append",
                json!({"note": "Trip plan", "markdown": "Day two."}),
            )],
            Stop::Tools,
        ),
        Step::Reply("Added.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &second, &seen, previewing("c1", "Add day two"));
    let result = seen.of(EventKind::ToolResult)[0].result.clone().unwrap();
    assert!(result.ok && result.staged, "{result:?}");
    let set = chats.changes("c1").unwrap();
    let set = set.lock().unwrap();
    assert_eq!(set.created_files.len(), 1);
    assert!(set.created_files[0].text.contains("Day one.\n\nDay two."));
}

#[test]
fn a_chat_that_writes_directly_writes_at_once_and_stages_nothing() {
    let v = vault();
    let chats = Chats::default();
    let seen = Seen::new();
    turn(&chats, &v, &busy(), &seen, request("c1", "Plan my trip"));
    assert!(file(&v, WELCOME).contains("From the chat."));
    assert!(seen.of(EventKind::Changes).is_empty());
    assert!(
        seen.of(EventKind::ToolResult)
            .iter()
            .all(|e| !e.result.as_ref().unwrap().staged)
    );
    assert!(chats.changes("c1").unwrap().lock().unwrap().is_empty());
}

#[test]
fn what_cannot_be_previewed_waits_for_review_and_is_not_counted_as_a_change() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply(
            "",
            vec![("rename_note", json!({"note": WELCOME, "title": "Hello"}))],
            Stop::Tools,
        ),
        Step::Reply("Asked.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, previewing("c1", "Rename it"));
    let result = seen.of(EventKind::ToolResult)[0].result.clone().unwrap();
    assert!(result.ok && !result.staged, "{result:?}");
    assert!(
        result.summary.starts_with("Waiting for review"),
        "{}",
        result.summary
    );
    assert!(seen.of(EventKind::Changes).is_empty());
    assert_eq!(v.kasten.proposals().unwrap().len(), 1);
    assert!(v.dir.join(WELCOME).exists());
}

#[test]
fn a_change_made_to_the_same_lines_meanwhile_is_stale_until_recalculated() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply(
            "",
            vec![(
                "replace_section",
                json!({"note": WELCOME, "heading": "Safe by design", "markdown": "Everything is kept."}),
            )],
            Stop::Tools,
        ),
        Step::Reply("Done.", vec![], Stop::End),
    ]);
    turn(
        &chats,
        &v,
        &model,
        &Seen::new(),
        previewing("c1", "Rewrite it"),
    );
    let set = chats.changes("c1").unwrap();
    // A person rewrites that section by hand.
    let text =
        file(&v, WELCOME).replace("only you can empty it.", "only you can empty it, for good.");
    fs::write(v.dir.join(WELCOME), text).unwrap();
    let view = view_of(&v.kasten, &set.lock().unwrap()).unwrap();
    assert!(view.files[0].stale);
    let ApplyOutcome::Stale { files } = apply(&v.kasten, &set).unwrap() else {
        panic!("expected it to be stale")
    };
    assert_eq!(files, [WELCOME]);
    assert!(!set.lock().unwrap().is_empty(), "the set is kept");
    let recalculated = recalculate(&v.kasten, &set).unwrap();
    assert!(recalculated.dropped.is_empty());
    assert!(matches!(
        apply(&v.kasten, &set).unwrap(),
        ApplyOutcome::Applied { .. }
    ));
    assert!(file(&v, WELCOME).contains("Everything is kept."));
}

#[test]
fn forgetting_a_thread_hands_back_its_staged_changes_to_be_thrown_away() {
    let v = vault();
    let chats = Chats::default();
    turn(
        &chats,
        &v,
        &busy(),
        &Seen::new(),
        previewing("c1", "Plan my trip"),
    );
    let set = chats.reset("c1").expect("the thread had a set");
    assert_eq!(set.lock().unwrap().len(), 2);
    assert!(chats.changes("c1").is_none());
    discard(&v.kasten, &set).unwrap();
    assert!(!v.dir.join("library/trip-plan.md").exists());
}

#[test]
fn the_prompt_tells_the_model_about_staged_changes() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![Step::Reply("Hi.", vec![], Stop::End)]);
    turn(&chats, &v, &model, &Seen::new(), previewing("c1", "Hello"));
    let system = &model.systems()[0];
    assert!(system.contains("a tool answers `staged`"), "{system}");
    assert!(system.contains("Do not repeat it"), "{system}");
}
