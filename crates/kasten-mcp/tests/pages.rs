//! The page-block tools: `read_page_blocks` and `edit_page`, called as an
//! external client calls them, inside a batch, and from a chat that previews
//! its changes.

mod common;

use std::fs;
use std::sync::Mutex;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::{Value, json};

const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn read(k: &Kasten, s: &Session) -> Value {
    call(
        k,
        s,
        "read_page_blocks",
        json!({ "note": DRAFT, "limit": 1000 }),
    )
    .unwrap()
}

/// The first paragraph of the page, as a step names it.
fn first_paragraph(page: &Value) -> Value {
    let block = page["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["kind"] == "paragraph")
        .unwrap();
    json!({ "block": block["id"], "hash": block["hash"] })
}

#[test]
fn the_tools_are_listed_with_their_steps() {
    let all = specs();
    let read = all.iter().find(|t| t.name == "read_page_blocks").unwrap();
    let edit = all.iter().find(|t| t.name == "edit_page").unwrap();
    assert!(read.read_only && !edit.read_only);
    let schema = edit.input_schema.to_string();
    assert!(
        schema.contains("\"steps\"") && schema.contains("\"note\""),
        "{schema}"
    );
    for word in ["wrap_columns", "table_cells", "40%", "hash"] {
        let told = format!("{} {schema}", edit.description);
        assert!(told.contains(word), "{word} in {told}");
    }
}

#[test]
fn a_page_is_read_by_block_and_edited_by_the_ids_and_hashes_it_gave() {
    let (v, k, s) = open();
    let page = read(&k, &s);
    assert_eq!(page["path"], DRAFT);
    assert!(page["total"].as_u64().unwrap() > 5);
    let block = first_paragraph(&page);
    let told = call(
        &k,
        &s,
        "edit_page",
        json!({
            "note": "Report draft: How people find old notes",
            "reason": "tighten the intro",
            "steps": [{ "op": "replace", "block": block, "markdown": "Rewritten by the test." }],
        }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(told["result"]["changed"], true);
    assert_eq!(told["session"], json!(s.id));
    assert!(
        fs::read_to_string(v.0.join(DRAFT))
            .unwrap()
            .contains("Rewritten by the test.")
    );
    let head = &k.log(Some(DRAFT), 1).unwrap()[0];
    assert_eq!(head.op.as_deref(), Some("edit_page"));

    // The same ids and hashes are stale now: the page is as the first call left it.
    let again = call(
        &k,
        &s,
        "edit_page",
        json!({ "note": DRAFT, "steps": [{ "op": "delete", "block": block }] }),
    )
    .unwrap_err();
    assert!(again.contains("changed since"), "{again}");
}

#[test]
fn a_step_the_tool_does_not_know_is_told_in_plain_words() {
    let (_v, k, s) = open();
    let block = first_paragraph(&read(&k, &s));
    for (steps, words) in [
        (
            json!([{ "op": "explode", "block": block }]),
            "Step 1 (explode)",
        ),
        (json!([{ "op": "delete" }]), "Step 1 (delete)"),
        (
            json!([{ "op": "delete", "block": block, "extra": 1 }]),
            "unknown field",
        ),
    ] {
        let why = call(
            &k,
            &s,
            "edit_page",
            json!({ "note": DRAFT, "steps": steps }),
        )
        .unwrap_err();
        assert!(
            why.contains(words) && why.contains("Nothing was written"),
            "{why}"
        );
    }
    let empty = call(&k, &s, "edit_page", json!({ "note": DRAFT, "steps": [] })).unwrap_err();
    assert!(empty.contains("at least one step"), "{empty}");
}

#[test]
fn a_batch_can_hold_a_page_edit() {
    let (v, k, s) = open();
    let block = first_paragraph(&read(&k, &s));
    let before = k.log(None, 10_000).unwrap().len();
    let told = call(
        &k,
        &s,
        "batch",
        json!({ "ops": [
            { "tool": "edit_page", "args": { "note": DRAFT, "steps": [{ "op": "replace", "block": block, "markdown": "From a batch." }] } },
            { "tool": "append", "args": { "note": DRAFT, "markdown": "Appended after." } },
        ] }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(k.log(None, 10_000).unwrap().len(), before + 1);
    let text = fs::read_to_string(v.0.join(DRAFT)).unwrap();
    assert!(text.contains("From a batch.") && text.contains("Appended after."));
}

#[test]
fn a_chat_that_previews_its_changes_stages_a_page_edit_and_reads_the_staged_blocks() {
    let (v, k, s) = open();
    let block = first_paragraph(&read(&k, &s));
    let before = fs::read_to_string(v.0.join(DRAFT)).unwrap();
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let told = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "edit_page",
        json!({ "note": DRAFT, "steps": [{ "op": "replace", "block": block, "markdown": "Previewed." }] }),
    )
    .unwrap();
    assert_eq!(told["status"], "staged", "{told}");
    assert_eq!(told["paths"], json!([DRAFT]));
    assert_eq!(fs::read_to_string(v.0.join(DRAFT)).unwrap(), before);
    assert!(k.proposals().unwrap().is_empty());

    // The chat reads the page as staged; the vault's read does not have it.
    let staged_page = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "read_page_blocks",
        json!({ "note": DRAFT, "limit": 1000 }),
    )
    .unwrap();
    assert_eq!(staged_page["staged"], true);
    assert!(staged_page.to_string().contains("Previewed."));
    assert!(!read(&k, &s).to_string().contains("Previewed."));
    // The old hash is stale in the staged chat; the new one works.
    let stale = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "edit_page",
        json!({ "note": DRAFT, "steps": [{ "op": "delete", "block": block }] }),
    )
    .unwrap_err();
    assert!(stale.contains("changed since"), "{stale}");
    let again = first_paragraph(&staged_page);
    let ok = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "edit_page",
        json!({ "note": DRAFT, "steps": [{ "op": "replace", "block": again, "markdown": "Previewed twice." }] }),
    )
    .unwrap();
    assert_eq!(ok["status"], "staged", "{ok}");

    // Accepting writes both steps in one commit.
    let n = k.log(None, 10_000).unwrap().len();
    let held = set.lock().unwrap().clone();
    k.apply_changes(&held, "Ada", Instant::now()).unwrap();
    assert!(
        fs::read_to_string(v.0.join(DRAFT))
            .unwrap()
            .contains("Previewed twice.")
    );
    assert!(k.log(None, 10_000).unwrap().len() <= n + 1);
}
