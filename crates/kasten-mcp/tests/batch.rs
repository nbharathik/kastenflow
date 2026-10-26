//! The `batch` tool: many changes as one, called as an external client calls
//! it and as a chat that previews its changes does.

mod common;

use std::fs;
use std::sync::Mutex;

use common::{TempDir, vault};
use kasten_core::agent::{ApplyOutcome, ChangeSet, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::{Value, json};

const WELCOME: &str = "library/welcome-to-kasten.md";
const SKETCH: &str = "projects/photo-organiser/cards/duplicate-score-sketch.md";
const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

fn item(tool: &str, args: Value) -> Value {
    json!({ "tool": tool, "args": args })
}

#[test]
fn the_batch_tool_is_listed_with_its_arguments() {
    let tool = specs().into_iter().find(|t| t.name == "batch").unwrap();
    assert!(!tool.read_only);
    let schema = tool.input_schema.to_string();
    assert!(
        schema.contains("\"ops\"") && schema.contains("\"tool\""),
        "{schema}"
    );
    assert!(tool.description.contains("100"), "{}", tool.description);
}

#[test]
fn every_kind_of_change_goes_in_one_commit_and_one_undo() {
    let (v, k, s) = open();
    let before = commits(&k);
    let told = call(
        &k,
        &s,
        "batch",
        json!({
            "reason": "tidy up",
            "ops": [
                item("capture", json!({"markdown": "A captured idea", "tags": ["idea"]})),
                item("create_note", json!({"type": "page", "title": "Batch page", "body": "Body.\n"})),
                item("append", json!({"note": WELCOME, "markdown": "Appended by the batch."})),
                item("replace_section", json!({"note": WELCOME, "heading": "Dump now, organise later", "markdown": "Replaced.\n"})),
                item("add_tags", json!({"note": WELCOME, "tags": ["batched"]})),
                item("remove_tags", json!({"note": SKETCH, "tags": ["nothing-here"]})),
                item("update_props", json!({"note": DRAFT, "props": {"venue": "CHI"}})),
                item("rename_note", json!({"note": SKETCH, "title": "Renamed by batch"})),
                item("journal_append", json!({"date": "2026-09-23", "markdown": "From the batch."})),
                item("create_board", json!({"title": "Batch board"})),
            ],
        }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(told["result"]["changes"], 10);
    assert_eq!(told["session"], json!(s.id));
    assert_eq!(commits(&k), before + 1, "one commit");
    let head = &k.log(None, 1).unwrap()[0];
    assert_eq!(head.op.as_deref(), Some("batch"));
    assert!(head.message.contains("Kasten-Batch: 10"));
    let welcome = fs::read_to_string(v.0.join(WELCOME)).unwrap();
    assert!(welcome.contains("Appended by the batch.") && welcome.contains("batched"));
    assert!(
        k.list()
            .unwrap()
            .iter()
            .any(|n| n.title == "Renamed by batch")
    );

    let undone = k.undo_session(&s.id, Instant::now()).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(undone.reverted.len(), 1, "one undo");
    assert!(
        !fs::read_to_string(v.0.join(WELCOME))
            .unwrap()
            .contains("Appended by the batch.")
    );
}

#[test]
fn a_change_that_cannot_be_built_or_is_not_allowed_refuses_the_batch() {
    let (v, k, s) = open();
    let before = fs::read_to_string(v.0.join(WELCOME)).unwrap();
    let count = commits(&k);
    let err = call(
        &k,
        &s,
        "batch",
        json!({"ops": [
            item("append", json!({"note": WELCOME, "markdown": "First."})),
            item("append", json!({"note": "No such note", "markdown": "Second."})),
        ]}),
    )
    .unwrap_err();
    assert!(err.contains("Change 2 of 2 (append)"), "{err}");
    assert!(err.contains("No note called"), "{err}");
    assert!(err.contains("Nothing in the batch was changed"), "{err}");

    let err = call(
        &k,
        &s,
        "batch",
        json!({"ops": [
            item("append", json!({"note": WELCOME, "markdown": "First."})),
            item("trash_note", json!({"note": SKETCH})),
        ]}),
    )
    .unwrap_err();
    assert!(
        err.contains("Change 2 of 2 (trash_note) cannot be part of a batch"),
        "{err}"
    );
    assert!(err.contains("append"), "it names what a batch holds: {err}");

    let err = call(
        &k,
        &s,
        "batch",
        json!({"ops": [item("append", json!({"markdown": "x"}))]}),
    )
    .unwrap_err();
    assert!(err.contains("Change 1 of 1 (append)"), "{err}");

    let err = call(&k, &s, "batch", json!({"ops": []})).unwrap_err();
    assert!(err.contains("at least one"), "{err}");
    let many: Vec<Value> = (0..101)
        .map(|n| {
            item(
                "append",
                json!({"note": WELCOME, "markdown": format!("L{n}")}),
            )
        })
        .collect();
    let err = call(&k, &s, "batch", json!({"ops": many})).unwrap_err();
    assert!(err.contains("at most 100"), "{err}");
    assert_eq!(fs::read_to_string(v.0.join(WELCOME)).unwrap(), before);
    assert_eq!(commits(&k), count);
}

#[test]
fn review_everything_holds_the_batch_as_one_proposal() {
    let (v, k, s) = open();
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Review),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
    let before = fs::read_to_string(v.0.join(WELCOME)).unwrap();
    let told = call(
        &k,
        &s,
        "batch",
        json!({"ops": [
            item("append", json!({"note": WELCOME, "markdown": "One."})),
            item("add_tags", json!({"note": SKETCH, "tags": ["two"]})),
        ]}),
    )
    .unwrap();
    assert_eq!(told["status"], "pending_review", "{told}");
    assert_eq!(k.proposals().unwrap().len(), 1);
    assert_eq!(fs::read_to_string(v.0.join(WELCOME)).unwrap(), before);
    // The person accepts the one proposal: both changes, one commit.
    let id = told["proposal"].as_str().unwrap();
    k.accept_proposal(id, "Ada", Instant::now()).unwrap();
    assert!(
        fs::read_to_string(v.0.join(WELCOME))
            .unwrap()
            .contains("One.")
    );
    let batches = k
        .log(None, 50)
        .unwrap()
        .into_iter()
        .filter(|c| c.op.as_deref() == Some("batch"))
        .count();
    assert_eq!(batches, 1);
}

#[test]
fn a_chat_that_previews_stages_the_whole_batch_as_one_step() {
    let (v, k, s) = open();
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let before = fs::read_to_string(v.0.join(WELCOME)).unwrap();
    let told = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "batch",
        json!({"ops": [
            item("create_note", json!({"type": "card", "title": "Staged card", "body": "Hi."})),
            item("append", json!({"note": WELCOME, "markdown": "Staged line."})),
        ]}),
    )
    .unwrap();
    assert_eq!(told["status"], "staged", "{told}");
    assert_eq!(fs::read_to_string(v.0.join(WELCOME)).unwrap(), before);
    let staged: ChangeSet = set.lock().unwrap().clone();
    assert_eq!(staged.steps.len(), 1);
    let count = commits(&k);
    match k.apply_changes(&staged, "Ada", Instant::now()).unwrap() {
        ApplyOutcome::Applied { paths, .. } => assert_eq!(paths.len(), 2),
        stale => panic!("{stale:?}"),
    }
    assert_eq!(commits(&k), count + 1);
}
