//! `edit_page` in a chat that previews its changes: the page edit is staged
//! as part of the thread's change set (the person sees the page before and
//! after), a later read of the page's blocks sees it, applying writes it once
//! and discarding writes nothing.

use std::fs;

use kasten_core::agent::ApplyOutcome;
use serde_json::{Value, json};

use super::turns::{request, results, turn};
use super::{Fake, Seen, Step, Vault, vault};
use crate::chat::changes::{apply, discard, view_of};
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

/// The first paragraph of the page, as a step names it.
fn first_paragraph(v: &Vault) -> (Value, String) {
    let page = v.kasten.read_page_blocks(WELCOME, 1, 1000).unwrap();
    let block = page
        .blocks
        .iter()
        .find(|b| serde_json::to_value(b.kind).unwrap() == "paragraph")
        .unwrap();
    (
        json!({ "block": block.id, "hash": block.hash }),
        block.text.clone(),
    )
}

fn laying_out(block: &Value) -> std::sync::Arc<Fake> {
    Fake::new(vec![
        Step::Reply(
            "Laying out.",
            vec![(
                "edit_page",
                json!({
                    "note": WELCOME,
                    "reason": "set the intro apart",
                    "steps": [{ "op": "callout", "blocks": [block], "kind": "tip", "title": "In short" }],
                }),
            )],
            Stop::Tools,
        ),
        Step::Reply("Staged.", vec![], Stop::End),
    ])
}

#[test]
fn a_page_edit_is_staged_with_the_page_before_and_after_for_the_person_to_look_at() {
    let v = vault();
    let before = file(&v, WELCOME);
    let head = v.kasten.log(None, 1).unwrap()[0].id.clone();
    let (block, _) = first_paragraph(&v);
    let chats = Chats::default();
    let model = laying_out(&block);
    let seen = Seen::new();
    turn(
        &chats,
        &v,
        &model,
        &seen,
        previewing("c1", "Lay out this page"),
    );

    // Nothing was written, committed or kept as a proposal.
    assert_eq!(file(&v, WELCOME), before);
    assert_eq!(v.kasten.log(None, 1).unwrap()[0].id, head);
    assert!(v.kasten.proposals().unwrap().is_empty());

    // The window is told the call was staged, and which page it changed.
    let told = seen.of(EventKind::ToolResult);
    assert_eq!(told.len(), 1);
    let result = told[0].result.as_ref().unwrap();
    assert!(result.ok && result.staged, "{result:?}");
    let changes = seen.of(EventKind::Changes);
    assert_eq!(
        changes.last().unwrap().changes.as_ref().unwrap().paths,
        [WELCOME]
    );

    // The model was told it is staged, not done.
    let sent = model.sent();
    let back = &results(sent[1].last().unwrap())[0];
    assert!(back.content.contains("\"status\":\"staged\""), "{back:?}");

    // The change set shows the page's diff.
    let set = chats.changes("c1").unwrap();
    let view = view_of(&v.kasten, &set.lock().unwrap()).unwrap();
    assert_eq!(view.files.len(), 1);
    let page = &view.files[0];
    assert_eq!(page.path, WELCOME);
    assert!(!page.new && !page.stale);
    assert_eq!(page.before.as_deref(), Some(before.as_str()));
    assert!(page.after.contains("> [!tip] In short"), "{}", page.after);
    assert!(page.diff.contains("+> [!tip] In short"), "{}", page.diff);
    assert_eq!(view.steps.len(), 1);
}

#[test]
fn accepting_writes_the_page_edit_once_and_discarding_writes_nothing() {
    let v = vault();
    let before = file(&v, WELCOME);
    let (block, _) = first_paragraph(&v);
    let chats = Chats::default();
    turn(
        &chats,
        &v,
        &laying_out(&block),
        &Seen::new(),
        previewing("c1", "Lay out this page"),
    );
    let set = chats.changes("c1").unwrap();

    // Discarding: the page is as it was.
    discard(&v.kasten, &set).unwrap();
    assert_eq!(file(&v, WELCOME), before);

    // Staged again and accepted: one commit, the callout once.
    turn(
        &chats,
        &v,
        &laying_out(&block),
        &Seen::new(),
        previewing("c1", "Lay out this page"),
    );
    let set = chats.changes("c1").unwrap();
    let commits = v.kasten.log(None, 100).unwrap().len();
    let ApplyOutcome::Applied { paths, .. } = apply(&v.kasten, &set).unwrap() else {
        panic!("expected it to apply")
    };
    assert_eq!(paths, [WELCOME]);
    let after = file(&v, WELCOME);
    assert_eq!(after.matches("[!tip] In short").count(), 1, "{after}");
    let log = v.kasten.log(None, 100).unwrap();
    assert_eq!(log.len(), commits + 1);
    assert!(log[0].approved_by.is_some());
    assert!(set.lock().unwrap().is_empty());
}

#[test]
fn a_later_read_of_the_blocks_in_the_same_chat_sees_the_staged_page() {
    let v = vault();
    let (block, text) = first_paragraph(&v);
    let chats = Chats::default();
    turn(
        &chats,
        &v,
        &laying_out(&block),
        &Seen::new(),
        previewing("c1", "Lay out this page"),
    );
    let reading = Fake::new(vec![
        Step::Reply(
            "",
            vec![(
                "read_page_blocks",
                json!({ "note": WELCOME, "limit": 1000 }),
            )],
            Stop::Tools,
        ),
        Step::Reply("Read.", vec![], Stop::End),
    ]);
    turn(
        &chats,
        &v,
        &reading,
        &Seen::new(),
        previewing("c1", "Read it again"),
    );
    let sent = reading.sent();
    let back = &results(sent[1].last().unwrap())[0];
    assert!(!back.is_error, "{back:?}");
    let page: Value = serde_json::from_str(&back.content).unwrap();
    assert_eq!(page["staged"], true);
    let kinds: Vec<&str> = page["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|b| b["kind"].as_str())
        .collect();
    assert!(kinds.contains(&"callout"), "{kinds:?}");
    assert!(page.to_string().contains(&text[..text.len().min(20)]));
}
