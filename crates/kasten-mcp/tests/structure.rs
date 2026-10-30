//! The structure tools: `set_parent`, `reorder_children`, `create_project`,
//! `set_project_state` and `set_tag_views`, called as an external client calls
//! them, inside a batch, and from a chat that previews its changes.

mod common;

use std::fs;
use std::sync::Mutex;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, Kind, NewNote};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::{Value, json};

const PROJECT: &str = "projects/note-taking-study/_project.md";

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn page(k: &Kasten, s: &Session, title: &str, parent: Option<&str>) -> Value {
    let told = call(
        k,
        s,
        "create_note",
        json!({ "type": "page", "title": title, "parent": parent }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    told["result"].clone()
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

#[test]
fn the_tools_are_listed_in_plain_words() {
    let all = specs();
    for (name, words) in [
        ("set_parent", "sub-page"),
        ("reorder_children", "alphabetical"),
        ("create_project", "setup"),
        ("set_project_state", "update_props"),
        ("set_tag_views", "review"),
    ] {
        let tool = all.iter().find(|t| t.name == name).unwrap();
        assert!(!tool.read_only, "{name}");
        assert!(
            tool.description.contains(words),
            "{name}: {}",
            tool.description
        );
        for bad in ["commit", "sidecar", "frontmatter", "children_order"] {
            assert!(!tool.description.contains(bad), "{name}: {bad}");
        }
        assert_eq!(tool.input_schema["type"], "object");
    }
    let state = all.iter().find(|t| t.name == "set_project_state").unwrap();
    let schema = state.input_schema.to_string();
    assert!(
        schema.contains("nextAction") && schema.contains("reviewAfter"),
        "{schema}"
    );
}

#[test]
fn a_page_goes_inside_another_and_out_again_and_a_cycle_is_told_plainly() {
    let (v, k, s) = open();
    let outer = page(&k, &s, "Outer page", None);
    let inner = page(&k, &s, "Inner page", None);
    let told = call(
        &k,
        &s,
        "set_parent",
        json!({ "note": "Inner page", "parent": "Outer page" }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    let read = k.read(inner["path"].as_str().unwrap()).unwrap();
    assert_eq!(read.meta.parent.as_deref(), outer["id"].as_str());

    let err = call(
        &k,
        &s,
        "set_parent",
        json!({ "note": "Outer page", "parent": "Inner page" }),
    )
    .unwrap_err();
    assert!(err.contains("inside itself"), "{err}");

    let out = call(&k, &s, "set_parent", json!({ "note": "Inner page" })).unwrap();
    assert_eq!(out["status"], "done", "{out}");
    assert_eq!(
        k.read(inner["path"].as_str().unwrap()).unwrap().meta.parent,
        None
    );
    drop(v);
}

#[test]
fn sub_pages_are_put_in_order_by_title_or_id_and_a_stranger_is_told() {
    let (v, k, s) = open();
    let parent = page(&k, &s, "Handbook", None);
    let a = page(&k, &s, "Alpha", Some("Handbook"));
    let b = page(&k, &s, "Beta", Some("Handbook"));
    let c = page(&k, &s, "Gamma", Some("Handbook"));
    let before = commits(&k);
    let told = call(
        &k,
        &s,
        "reorder_children",
        json!({ "note": "Handbook", "children": ["Gamma", b["id"], a["path"]] }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(commits(&k), before + 1);
    let want = [&c, &b, &a].map(|n| n["id"].as_str().unwrap().to_owned());
    assert_eq!(
        k.read(parent["path"].as_str().unwrap())
            .unwrap()
            .meta
            .children_order,
        want
    );
    assert_eq!(told["result"]["children"], json!(want));

    let err = call(
        &k,
        &s,
        "reorder_children",
        json!({ "note": "Handbook", "children": ["Gamma", "No such page"] }),
    )
    .unwrap_err();
    assert!(
        err.contains("Sub-page 2") && err.contains("No such page"),
        "{err}"
    );
    let reset = call(
        &k,
        &s,
        "reorder_children",
        json!({ "note": "Handbook", "children": [] }),
    )
    .unwrap();
    assert_eq!(reset["status"], "done");
    assert!(
        k.read(parent["path"].as_str().unwrap())
            .unwrap()
            .meta
            .children_order
            .is_empty()
    );
    drop(v);
}

#[test]
fn a_project_is_made_empty_or_from_a_setup() {
    let (v, k, s) = open();
    let empty = call(&k, &s, "create_project", json!({ "title": "Orchard plan" })).unwrap();
    assert_eq!(empty["status"], "done", "{empty}");
    assert_eq!(empty["result"]["path"], "projects/orchard-plan/_project.md");
    let writing = call(
        &k,
        &s,
        "create_project",
        json!({ "title": "Orchard book", "setup": "writing" }),
    )
    .unwrap();
    assert_eq!(writing["status"], "done", "{writing}");
    assert!(v.0.join("projects/orchard-book/pages/outline.md").is_file());
    // A setup that makes tag schemas waits for the user.
    let research = call(
        &k,
        &s,
        "create_project",
        json!({ "title": "Orchard study", "setup": "research" }),
    )
    .unwrap();
    assert_eq!(research["status"], "pending_review", "{research}");
    assert!(!v.0.join("projects/orchard-study").exists());
    let bad = call(&k, &s, "create_project", json!({ "title": "A | B" })).unwrap_err();
    assert!(bad.contains("title"), "{bad}");
    let unknown = call(
        &k,
        &s,
        "create_project",
        json!({ "title": "Fine", "setup": "baking" }),
    )
    .unwrap_err();
    assert!(unknown.contains("baking"), "{unknown}");
}

#[test]
fn a_projects_state_is_set_by_name_and_update_props_points_to_it() {
    let (_v, k, s) = open();
    let told = call(
        &k,
        &s,
        "set_project_state",
        json!({ "project": "Note-taking study", "change": { "status": "Paused", "reviewAfter": "2026-12-01" } }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    let page = k.read(PROJECT).unwrap();
    assert_eq!(page.meta.props["status"], "Paused");
    assert_eq!(page.meta.props["review_after"], "2026-12-01");
    // By folder name, with the property spellings, and null takes one away.
    call(
        &k,
        &s,
        "set_project_state",
        json!({ "project": "note-taking-study", "change": { "review_after": null, "health": "At risk" } }),
    )
    .unwrap();
    let page = k.read(PROJECT).unwrap();
    assert!(page.meta.props.get("review_after").is_none());
    assert_eq!(page.meta.props["health"], "At risk");

    for (change, words) in [
        (json!({ "statuss": "Paused" }), "statuss"),
        (json!({ "status": "Someday" }), "status"),
        (json!({ "reviewed": "2026-02-30" }), "YYYY-MM-DD"),
        (json!({}), "Say what to change"),
    ] {
        let err = call(
            &k,
            &s,
            "set_project_state",
            json!({ "project": PROJECT, "change": change }),
        )
        .unwrap_err();
        assert!(err.contains(words), "{words}: {err}");
    }
    let err = call(
        &k,
        &s,
        "update_props",
        json!({ "note": PROJECT, "props": { "status": "Done" } }),
    )
    .unwrap_err();
    assert!(err.contains("use set_project_state"), "{err}");
}

#[test]
fn views_are_set_checked_and_a_view_left_out_waits() {
    let (v, k, s) = open();
    let file = v.0.join("tags/paper.yaml");
    let before = fs::read_to_string(&file).unwrap();
    let views = |extra: Value| {
        let mut list = vec![
            json!({"name": "Pipeline", "type": "kanban", "group_by": "status"}),
            json!({"name": "Deadlines", "type": "calendar", "date": "deadline"}),
            // The stored view keeps its sort: sending it without one would drop a setting and wait for review.
            json!({"name": "All", "type": "table", "sort": [{"key": "deadline", "dir": "asc"}]}),
        ];
        list.push(extra);
        list
    };
    let told = call(
        &k,
        &s,
        "set_tag_views",
        json!({ "tag": "#paper", "views": views(json!({"name": "Venues", "type": "table"})) }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("Venues") && after.starts_with(before.split("views:").next().unwrap()));

    let err = call(
        &k,
        &s,
        "set_tag_views",
        json!({ "tag": "paper", "views": [{"name": "Plan", "type": "gantt"}] }),
    )
    .unwrap_err();
    assert!(err.contains("gantt") && err.contains("table"), "{err}");

    let fewer = call(
        &k,
        &s,
        "set_tag_views",
        json!({ "tag": "paper", "views": [{"name": "All", "type": "table"}] }),
    )
    .unwrap();
    assert_eq!(fewer["status"], "pending_review", "{fewer}");
}

#[test]
fn a_batch_moves_a_page_and_puts_the_sub_pages_in_order_as_one_commit() {
    let (_v, k, s) = open();
    // The pages are the person's, so undoing the agent's session leaves them.
    let made = |title: &str, parent: Option<&str>| {
        let note = k
            .create(
                &Actor::Human,
                &NewNote {
                    kind: Kind::Page,
                    title: title.to_owned(),
                    date: "2026-10-10".to_owned(),
                    project: None,
                    parent: parent.map(str::to_owned),
                    template: None,
                    icon: None,
                },
                Instant::now(),
            )
            .unwrap();
        json!({ "path": note.meta.path, "id": note.meta.id })
    };
    let holder = made("Holder", None);
    let first = made("First", Some(holder["path"].as_str().unwrap()));
    let loose = made("Loose", None);
    let before = commits(&k);
    let told = call(
        &k,
        &s,
        "batch",
        json!({ "ops": [
            { "tool": "set_parent", "args": { "note": "Loose", "parent": "Holder" } },
            { "tool": "reorder_children", "args": { "note": "Holder", "children": [loose["id"], first["id"]] } },
        ], "reason": "tidy" }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(commits(&k), before + 1);
    let holder_now = k.read(holder["path"].as_str().unwrap()).unwrap();
    assert_eq!(
        holder_now.meta.children_order,
        [&loose, &first].map(|n| n["id"].as_str().unwrap().to_owned())
    );
    let undone = k.undo_session(&s.id, Instant::now()).unwrap();
    assert!(undone.conflict.is_none());
    assert!(
        k.read(loose["path"].as_str().unwrap())
            .unwrap()
            .meta
            .parent
            .is_none()
    );
}

#[test]
fn a_chat_that_previews_its_changes_gets_these_held_for_review() {
    let (v, k, s) = open();
    let inner = page(&k, &s, "Inner", None);
    page(&k, &s, "Outer", None);
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let before = fs::read_to_string(v.0.join(inner["path"].as_str().unwrap())).unwrap();
    let told = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "set_parent",
        json!({ "note": "Inner", "parent": "Outer" }),
    )
    .unwrap();
    assert_eq!(told["status"], "pending_review", "{told}");
    assert_eq!(
        fs::read_to_string(v.0.join(inner["path"].as_str().unwrap())).unwrap(),
        before
    );
    assert_eq!(k.proposals().unwrap().len(), 1);
}
