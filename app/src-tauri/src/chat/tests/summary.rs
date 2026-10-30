//! What a tool call did, in one line: counts say when a list was cut.

use serde_json::json;

use super::vault;
use crate::chat::summary::{describe, some_of};

#[test]
fn counts_say_how_many_of_how_many() {
    assert_eq!(some_of(1, 1, "note"), "1 note");
    assert_eq!(some_of(0, 0, "note"), "0 notes");
    assert_eq!(some_of(50, 300, "note"), "50 of 300 notes");
}

#[test]
fn a_batch_is_told_as_one_change_with_the_notes_it_touched() {
    let v = vault();
    let input = json!({ "ops": [{ "tool": "append" }, { "tool": "rename_note" }, { "tool": "create_board" }] });
    let made = describe(
        &v.kasten,
        "batch",
        &input,
        &Ok(json!({
            "status": "done",
            "result": { "changes": 3, "results": [
                { "path": "library/a.md", "title": "A" },
                { "note": { "path": "library/b.md", "title": "B" }, "relinked": [] },
                { "board": "library/c.canvas" },
            ] },
        })),
    );
    assert_eq!(made.summary, "Made 3 changes as one batch");
    assert_eq!(
        made.paths,
        ["library/a.md", "library/b.md", "library/c.canvas"]
    );
    let waiting = describe(
        &v.kasten,
        "batch",
        &input,
        &Ok(
            json!({ "status": "pending_review", "reason": "Review everything is on", "proposal": "p" }),
        ),
    );
    assert_eq!(
        waiting.summary,
        "Waiting for review: make 3 changes as one batch (review everything is on)"
    );
    let refused = describe(
        &v.kasten,
        "batch",
        &input,
        &Err("Change 2 of 3 (append): locked. Nothing in the batch was changed.".to_owned()),
    );
    assert!(
        !refused.ok
            && refused
                .summary
                .starts_with("Could not make 3 changes as one batch")
    );
}

#[test]
fn listed_and_tag_rows_count_the_same_way() {
    let v = vault();
    let rows = |n: usize| {
        (0..n)
            .map(|i| json!({ "path": format!("library/{i}.md") }))
            .collect::<Vec<_>>()
    };
    let listed = describe(
        &v.kasten,
        "list_notes",
        &json!({}),
        &Ok(json!({ "total": 300, "notes": rows(50) })),
    );
    assert_eq!(listed.summary, "Listed 50 of 300 notes");
    let all = describe(
        &v.kasten,
        "list_notes",
        &json!({}),
        &Ok(json!({ "total": 1, "notes": rows(1) })),
    );
    assert_eq!(all.summary, "Listed 1 note");
    let read = describe(
        &v.kasten,
        "query_tag",
        &json!({ "tag": "paper" }),
        &Ok(json!({ "tag": "paper", "total": 250, "rows": rows(100) })),
    );
    assert_eq!(read.summary, "Read #paper: 100 of 250 notes");
}

#[test]
fn the_structure_and_parity_tools_read_in_plain_words_and_not_as_op_names() {
    let v = vault();
    let said = |name: &str, input: serde_json::Value, result: serde_json::Value| {
        describe(&v.kasten, name, &input, &Ok(result)).summary
    };
    let done = |result: serde_json::Value| json!({ "status": "done", "result": result });
    assert_eq!(
        said(
            "set_parent",
            json!({ "note": "Handbook", "parent": "Guide" }),
            done(json!({ "path": "library/handbook.md", "title": "Handbook" }))
        ),
        "Put “Handbook” inside “Guide”"
    );
    assert_eq!(
        said(
            "set_parent",
            json!({ "note": "Handbook" }),
            done(json!({ "path": "library/handbook.md", "title": "Handbook" }))
        ),
        "Took “Handbook” out of its page"
    );
    assert_eq!(
        said(
            "reorder_children",
            json!({ "note": "Guide", "children": [] }),
            done(json!({ "path": "library/guide.md" }))
        ),
        "Put the sub-pages of “Guide” in order"
    );
    assert_eq!(
        said(
            "create_project",
            json!({ "title": "Trip" }),
            done(json!({ "path": "projects/trip/_project.md", "title": "Trip" }))
        ),
        "Created the project “Trip”"
    );
    assert_eq!(
        said(
            "set_project_state",
            json!({ "project": "Trip", "change": {} }),
            done(json!({ "path": "projects/trip/_project.md", "title": "Trip" }))
        ),
        "Changed the state of the project “Trip”"
    );
    assert_eq!(
        said(
            "set_tag_views",
            json!({ "tag": "#paper", "views": [] }),
            done(json!({ "path": "tags/paper.yaml" }))
        ),
        "Changed the views of #paper"
    );
    assert_eq!(
        said(
            "edit_page",
            json!({ "note": "Guide", "steps": [] }),
            done(json!({ "path": "library/guide.md", "title": "Guide" }))
        ),
        "Edited the page “Guide”"
    );
    assert_eq!(
        said(
            "set_task",
            json!({ "note": "Chores", "line": 3, "done": true }),
            done(json!({ "path": "c.md", "title": "Chores" }))
        ),
        "Ticked the to-do on line 4 of “Chores”"
    );
    assert_eq!(
        said(
            "list_tasks",
            json!({}),
            json!({ "total": 40, "tasks": [{}, {}] })
        ),
        "Listed 2 of 40 to-dos"
    );
    assert_eq!(
        said(
            "undo_session",
            json!({}),
            done(json!({ "reverted": ["a", "b"] }))
        ),
        "Took back 2 changes"
    );
    let waiting = describe(
        &v.kasten,
        "add_reference",
        &json!({ "type": "article", "key": "rivera2026saved" }),
        &Ok(
            json!({ "status": "pending_review", "reason": "A reference always waits", "proposal": "p" }),
        ),
    );
    assert_eq!(
        waiting.summary,
        "Waiting for review: add the reference rivera2026saved (a reference always waits)"
    );
    let refused = describe(
        &v.kasten,
        "set_task",
        &json!({ "note": "Chores", "line": 3, "done": false }),
        &Err("“Chores” changed since you read it.".to_owned()),
    );
    assert!(
        !refused.ok
            && refused
                .summary
                .starts_with("Could not untick a to-do in “Chores”")
    );
    // None of them is told as the tool's own name.
    for name in kasten_mcp::parity_words::TOOLS {
        let told = describe(
            &v.kasten,
            name,
            &json!({}),
            &Ok(json!({ "status": "done", "result": {} })),
        );
        assert!(!told.summary.contains('_'), "{name}: {}", told.summary);
    }
}
