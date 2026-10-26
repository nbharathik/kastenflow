//! `set_view_order`: the order a table's rows are shown in, stored in the
//! view's line in the tag file. Called as an external client calls it and
//! inside a batch, where a new tag's schema may also be made (and waits for
//! review).

mod common;

use std::fs;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

/// Two new notes with the `task` tag: their titles and ids.
fn two_tasks(k: &Kasten, s: &Session) -> [(String, String); 2] {
    ["Water the plants", "Pay the rent"].map(|title| {
        let told = call(
            k,
            s,
            "create_note",
            json!({"type": "card", "title": title, "tags": ["task"]}),
        )
        .unwrap();
        let made = &told["result"];
        (title.to_owned(), made["id"].as_str().unwrap().to_owned())
    })
}

fn item(tool: &str, args: Value) -> Value {
    json!({ "tool": tool, "args": args })
}

#[test]
fn the_tool_is_listed_in_plain_words_as_an_ordinary_write() {
    let tool = specs()
        .into_iter()
        .find(|t| t.name == "set_view_order")
        .unwrap();
    assert!(!tool.read_only);
    assert!(tool.description.contains("sort"), "{}", tool.description);
    for bad in ["commit", "sidecar", "frontmatter", "YAML", "order:"] {
        assert!(
            !tool.description.contains(bad),
            "{bad}: {}",
            tool.description
        );
    }
    let schema = tool.input_schema.to_string();
    assert!(
        schema.contains("\"rows\"") && schema.contains("\"view\"") && schema.contains("\"tag\""),
        "{schema}"
    );
}

#[test]
fn rows_named_by_title_are_stored_as_their_ids_in_that_views_line() {
    let (v, k, s) = open();
    let [(first, a), (second, b)] = two_tasks(&k, &s);
    let before = fs::read_to_string(v.0.join("tags/task.yaml")).unwrap();
    let count = commits(&k);
    let told = call(
        &k,
        &s,
        "set_view_order",
        json!({"tag": "#task", "view": "board", "rows": [second, first]}),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(told["result"]["order"], 2);
    assert_eq!(commits(&k), count + 1);
    let head = &k.log(None, 1).unwrap()[0];
    assert_eq!(head.op.as_deref(), Some("set_view_order"));
    let after = fs::read_to_string(v.0.join("tags/task.yaml")).unwrap();
    assert_eq!(
        after,
        before.replace(
            "{name: Board, type: kanban, group_by: status}",
            &format!("{{name: Board, type: kanban, group_by: status, order: [{b}, {a}]}}")
        )
    );
}

#[test]
fn a_view_or_a_row_that_is_not_there_is_refused_and_nothing_changes() {
    let (v, k, s) = open();
    let [(first, _), _] = two_tasks(&k, &s);
    let before = fs::read_to_string(v.0.join("tags/task.yaml")).unwrap();
    let count = commits(&k);
    let err = call(
        &k,
        &s,
        "set_view_order",
        json!({"tag": "task", "view": "Nope", "rows": [first]}),
    )
    .unwrap_err();
    assert!(
        err.contains("no view called “Nope”") && err.contains("“Board”"),
        "{err}"
    );
    let err = call(
        &k,
        &s,
        "set_view_order",
        json!({"tag": "task", "view": "Board", "rows": [first, "No such note"]}),
    )
    .unwrap_err();
    assert!(
        err.contains("Row 2") && err.contains("No note called"),
        "{err}"
    );
    let err = call(
        &k,
        &s,
        "set_view_order",
        json!({"tag": "nothing-here", "view": "Board", "rows": []}),
    )
    .unwrap_err();
    assert!(err.contains("no schema for the tag"), "{err}");
    assert_eq!(
        fs::read_to_string(v.0.join("tags/task.yaml")).unwrap(),
        before
    );
    assert_eq!(commits(&k), count);
}

#[test]
fn it_goes_in_a_batch_with_other_changes_as_one_commit() {
    let (v, k, s) = open();
    let [(first, a), _] = two_tasks(&k, &s);
    let count = commits(&k);
    let told = call(
        &k,
        &s,
        "batch",
        json!({"ops": [
            item("set_view_order", json!({"tag": "task", "view": "Board", "rows": [first]})),
            item("create_note", json!({"type": "card", "title": "Added with the order", "body": "Hi."})),
        ]}),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(commits(&k), count + 1);
    assert!(
        fs::read_to_string(v.0.join("tags/task.yaml"))
            .unwrap()
            .contains(&format!("order: [{a}]"))
    );
}

#[test]
fn a_batch_may_make_a_new_tags_schema_which_waits_for_review_and_never_replaces_one() {
    let (v, k, s) = open();
    let schema = json!({"properties": [{"key": "Pages", "type": "number"}], "views": [{"name": "Table", "type": "table"}]});
    let told = call(
        &k,
        &s,
        "batch",
        json!({"ops": [
            item("update_tag_schema", json!({"tag": "books", "schema": schema})),
            item("create_note", json!({"type": "card", "title": "Dune", "tags": ["books"], "props": {"Pages": 412}})),
        ]}),
    )
    .unwrap();
    assert_eq!(told["status"], "pending_review", "{told}");
    assert!(
        told["reason"].as_str().unwrap().contains("schema"),
        "{told}"
    );
    assert!(
        !v.0.join("tags/books.yaml").exists(),
        "nothing before the person looks"
    );
    let id = told["proposal"].as_str().unwrap();
    k.accept_proposal(id, "Ada", Instant::now()).unwrap();
    assert!(v.0.join("tags/books.yaml").exists());

    // The tag has a schema now, and so has `task`: a batch never replaces either.
    for tag in ["books", "task"] {
        let err = call(
            &k,
            &s,
            "batch",
            json!({"ops": [
                item("append", json!({"note": "library/welcome-to-kasten.md", "markdown": "x"})),
                item("update_tag_schema", json!({"tag": tag, "schema": {"properties": []}})),
            ]}),
        )
        .unwrap_err();
        assert!(
            err.contains("Change 2 of 2 (update_tag_schema)")
                && err.contains("already has a schema"),
            "{tag}: {err}"
        );
    }
}
