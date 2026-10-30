//! The parity tools for notes, the journal, to-dos, projects and comments,
//! called as a chat calls them: the happy path, a refusal, what the modes do,
//! and the `tools/list` snapshot (names and read-only hints) for all the
//! parity tools, so a removal is noticed.

mod common;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

pub fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

pub fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

/// A page made through the tool; what it told.
pub fn page(k: &Kasten, s: &Session, title: &str, body: &str) -> Value {
    let told = call(
        k,
        s,
        "create_note",
        json!({ "type": "page", "title": title, "body": body }),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    told["result"].clone()
}

pub fn lock(k: &Kasten, path: &str) {
    k.set_meta(&Actor::Human, path, "locked", Some("true"), Instant::now())
        .unwrap();
}

const WRITES: [&str; 15] = [
    "duplicate_note",
    "restore_note",
    "set_note_meta",
    "apply_template",
    "journal_day",
    "set_task",
    "add_comment",
    "resolve_comment",
    "create_collection",
    "update_collection",
    "add_reference",
    "board_edit",
    "rename_diagram",
    "move_diagram",
    "duplicate_diagram",
];
const READS: [&str; 7] = [
    "list_trash",
    "list_tasks",
    "list_projects",
    "list_comments",
    "list_collections",
    "list_references",
    "list_sessions",
];

#[test]
fn the_parity_tools_are_listed_with_read_hints_and_in_plain_words() {
    let all = specs();
    let want = WRITES
        .iter()
        .map(|n| (*n, false))
        .chain(READS.iter().map(|n| (*n, true)))
        .chain([("undo_session", false)]);
    for (name, read_only) in want {
        let tool = all
            .iter()
            .find(|t| t.name == name)
            .unwrap_or_else(|| panic!("{name} is not listed"));
        assert_eq!(tool.read_only, read_only, "{name}");
        assert_eq!(tool.input_schema["type"], "object", "{name}");
        assert!(tool.description.len() > 40, "{name}");
        for bad in ["commit", "sidecar", "frontmatter", "AgentOp"] {
            assert!(!tool.description.contains(bad), "{name}: {bad}");
        }
    }
    // query_tag stays a read and tells about parents.
    let query = all.iter().find(|t| t.name == "query_tag").unwrap();
    assert!(query.read_only && query.description.contains("children"));
}

#[test]
fn query_tag_rows_carry_their_parent_and_how_many_sub_pages_they_have() {
    let (_v, k, s) = open();
    let told = call(
        &k,
        &s,
        "create_note",
        json!({ "type": "page", "title": "Survey hub", "tags": ["paper"] }),
    )
    .unwrap();
    let outer = told["result"].clone();
    for title in ["Survey hub A", "Survey hub B"] {
        let made = call(
            &k,
            &s,
            "create_note",
            json!({ "type": "page", "title": title, "tags": ["paper"], "parent": "Survey hub" }),
        )
        .unwrap();
        assert_eq!(made["status"], "done", "{made}");
    }
    let rows = call(&k, &s, "query_tag", json!({ "tag": "paper" })).unwrap();
    let rows = rows["rows"].as_array().unwrap();
    let find = |title: &str| rows.iter().find(|r| r["title"] == title).unwrap();
    assert_eq!(find("Survey hub")["children"], 2);
    assert_eq!(find("Survey hub")["parent"], Value::Null);
    assert_eq!(find("Survey hub A")["parent"], outer["id"]);
    assert_eq!(find("Survey hub A")["children"], 0);
}

#[test]
fn duplicate_note_copies_and_refuses_a_locked_note_and_waits_in_review() {
    let (_v, k, s) = open();
    let p = page(&k, &s, "Original", "Some words");
    let copy = call(&k, &s, "duplicate_note", json!({ "note": "Original" })).unwrap();
    assert_eq!(copy["status"], "done", "{copy}");
    assert_ne!(copy["result"]["path"], p["path"]);
    lock(&k, p["path"].as_str().unwrap());
    let err = call(&k, &s, "duplicate_note", json!({ "note": p["path"] })).unwrap_err();
    assert!(err.contains("locked"), "{err}");
    set_mode(&k, AgentMode::Review);
    let held = call(
        &k,
        &s,
        "duplicate_note",
        json!({ "note": "Welcome to KastenFlow" }),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
}

#[test]
fn restore_note_names_a_trashed_note_by_title_and_says_when_it_is_not_there() {
    let (_v, k, s) = open();
    let p = page(&k, &s, "Short lived", "x");
    let gone = call(&k, &s, "trash_note", json!({ "note": p["path"] })).unwrap();
    assert_eq!(gone["status"], "done", "{gone}");
    let trash = call(&k, &s, "list_trash", Value::Null).unwrap();
    assert_eq!(trash["trash"][0]["title"], "Short lived");
    let back = call(&k, &s, "restore_note", json!({ "note": "short lived" })).unwrap();
    assert_eq!(back["status"], "done", "{back}");
    assert!(k.read(p["path"].as_str().unwrap()).is_ok());
    let err = call(&k, &s, "restore_note", json!({ "note": "Never trashed" })).unwrap_err();
    assert!(err.contains("list_trash"), "{err}");
}

#[test]
fn set_note_meta_changes_a_setting_and_leaves_the_lock_to_the_user() {
    let (_v, k, s) = open();
    let p = page(&k, &s, "Styled", "x");
    let ok = call(
        &k,
        &s,
        "set_note_meta",
        json!({ "note": "Styled", "key": "width", "value": "wide" }),
    )
    .unwrap();
    assert_eq!(ok["status"], "done", "{ok}");
    assert!(
        k.read(p["path"].as_str().unwrap())
            .unwrap()
            .text
            .contains("width: wide")
    );
    let err = call(
        &k,
        &s,
        "set_note_meta",
        json!({ "note": "Styled", "key": "locked", "value": "true" }),
    )
    .unwrap_err();
    assert!(err.contains("person only"), "{err}");
    set_mode(&k, AgentMode::Review);
    let held = call(
        &k,
        &s,
        "set_note_meta",
        json!({ "note": "Styled", "key": "font", "value": "mono" }),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
}

#[test]
fn apply_template_and_journal_day_start_from_templates() {
    let (v, k, s) = open();
    let blank = page(&k, &s, "Monday sync", "");
    let ok = call(
        &k,
        &s,
        "apply_template",
        json!({ "note": "Monday sync", "template": "meeting" }),
    )
    .unwrap();
    assert_eq!(ok["status"], "done", "{ok}");
    let err = call(
        &k,
        &s,
        "apply_template",
        json!({ "note": blank["path"], "template": "meeting" }),
    )
    .unwrap_err();
    assert!(err.contains("empty pages"), "{err}");

    let day = call(&k, &s, "journal_day", json!({ "date": "2026-12-24" })).unwrap();
    assert_eq!(day["result"]["path"], "journal/2026/2026-12-24.md");
    assert!(v.0.join("journal/2026/2026-12-24.md").exists());
    let err = call(&k, &s, "journal_day", json!({ "date": "soon" })).unwrap_err();
    assert!(err.contains("Not a day"), "{err}");
    set_mode(&k, AgentMode::Review);
    let held = call(&k, &s, "journal_day", json!({ "date": "2026-12-25" })).unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
}

const CHORES: &str = "- [ ] pay rent @2026-01-05\n- [ ] book trip @2099-01-01\n- [x] sent the form\n- [ ] sort photos\n";

#[test]
fn list_tasks_filters_like_the_tasks_view_and_set_task_ticks_by_line_and_hash() {
    let (_v, k, s) = open();
    let p = page(&k, &s, "Chores", CHORES);
    let list = |args: Value| call(&k, &s, "list_tasks", args).unwrap();
    let texts = |told: &Value| -> Vec<String> {
        told["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["path"] == p["path"])
            .map(|t| t["text"].as_str().unwrap().to_owned())
            .collect()
    };
    let open_tasks = texts(&list(json!({ "today": "2026-06-01" })));
    assert_eq!(open_tasks.len(), 3);
    assert!(
        open_tasks[0].starts_with("pay rent"),
        "dated ones come first: {open_tasks:?}"
    );
    let late = texts(&list(json!({ "today": "2026-06-01", "due": "overdue" })));
    assert!(
        late.len() == 1 && late[0].starts_with("pay rent"),
        "{late:?}"
    );
    assert_eq!(texts(&list(json!({ "status": "done" }))), ["sent the form"]);
    assert_eq!(
        texts(&list(json!({ "due": "none", "text": "photos" }))),
        ["sort photos"]
    );
    assert!(texts(&list(json!({ "where": "journal" }))).is_empty());
    let err = call(&k, &s, "list_tasks", json!({ "status": "late" })).unwrap_err();
    assert!(err.contains("open, done, all"), "{err}");

    let one = list(json!({ "text": "sort photos" }));
    let row = &one["tasks"][0];
    let ticked = call(
        &k,
        &s,
        "set_task",
        json!({ "note": p["path"], "line": row["line"], "done": true, "hash": row["hash"] }),
    )
    .unwrap();
    assert_eq!(ticked["status"], "done", "{ticked}");
    let after = k.read(p["path"].as_str().unwrap()).unwrap().text;
    assert!(
        after.contains("- [x] sort photos") && after.contains("- [ ] pay rent"),
        "{after}"
    );
    // The hash it listed is stale now.
    let stale = call(
        &k,
        &s,
        "set_task",
        json!({ "note": p["path"], "line": row["line"], "done": false, "hash": row["hash"] }),
    )
    .unwrap_err();
    assert!(stale.contains("changed since you read it"), "{stale}");
}

#[test]
fn list_tasks_leaves_out_a_page_that_vanished_instead_of_failing() {
    let (v, k, s) = open();
    let p = page(&k, &s, "Chores", CHORES);
    page(&k, &s, "Other chores", "- [ ] water plants\n");
    // The file goes behind the engine's back; the index still lists its to-dos.
    std::fs::remove_file(v.0.join(p["path"].as_str().unwrap())).unwrap();
    let told = call(&k, &s, "list_tasks", json!({})).expect("the list is still answered");
    let paths: Vec<&str> = told["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["path"].as_str())
        .collect();
    assert!(!paths.contains(&p["path"].as_str().unwrap()), "{paths:?}");
    assert!(
        told["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["text"] == "water plants"),
        "the other page's to-do is still listed: {told}"
    );
    // When the index had not noticed, the answer says how many were left out.
    if let Some(n) = told.get("left_out") {
        assert!(n.as_u64().unwrap() >= 1, "{told}");
    }
}

#[test]
fn set_task_waits_in_review() {
    let (_v, k, s) = open();
    let p = page(&k, &s, "Chores", CHORES);
    let read = call(&k, &s, "read_note", json!({ "note": "Chores" })).unwrap();
    let rows = call(&k, &s, "list_tasks", json!({ "text": "pay rent" })).unwrap();
    set_mode(&k, AgentMode::Review);
    let held = call(
        &k,
        &s,
        "set_task",
        json!({ "note": p["path"], "line": rows["tasks"][0]["line"], "done": true, "hash": read["hash"] }),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert!(
        k.read(p["path"].as_str().unwrap())
            .unwrap()
            .text
            .contains("- [ ] pay rent")
    );
}

#[test]
fn list_projects_summarises_the_projects() {
    let (_v, k, s) = open();
    let told = call(&k, &s, "list_projects", json!({ "today": "2026-10-10" })).unwrap();
    let projects = told["projects"].as_array().unwrap();
    assert!(projects.len() >= 2, "{told}");
    let study = projects
        .iter()
        .find(|p| p["folder"] == "note-taking-study")
        .unwrap();
    assert!(study["notes"].as_u64().unwrap() > 0 && study["status"].is_string());
    let err = call(&k, &s, "list_projects", json!({ "today": "tomorrow" })).unwrap_err();
    assert!(err.contains("YYYY-MM-DD"), "{err}");
}

#[test]
fn comments_are_added_listed_resolved_and_refused_on_a_locked_page() {
    let (_v, k, s) = open();
    let p = page(&k, &s, "Draft", "## Claims\n\nThe rate doubles.");
    let added = call(
        &k,
        &s,
        "add_comment",
        json!({ "note": "Draft", "text": "Source needed", "section": "Claims", "quote": "doubles" }),
    )
    .unwrap();
    assert_eq!(added["status"], "done", "{added}");
    let id = added["result"]["id"].as_str().unwrap().to_owned();
    let listed = call(&k, &s, "list_comments", json!({ "note": "Draft" })).unwrap();
    assert_eq!(listed["comments"][0]["author"], "agent:claude-code");
    assert_eq!(listed["comments"][0]["anchor"]["quote"], "doubles");
    call(
        &k,
        &s,
        "resolve_comment",
        json!({ "note": "Draft", "id": id }),
    )
    .unwrap();
    let open_only = call(
        &k,
        &s,
        "list_comments",
        json!({ "note": "Draft", "open_only": true }),
    )
    .unwrap();
    assert_eq!(open_only["total"], 0);
    let all = call(&k, &s, "list_comments", json!({ "note": "Draft" })).unwrap();
    assert_eq!(all["total"], 1);
    call(
        &k,
        &s,
        "resolve_comment",
        json!({ "note": "Draft", "id": id, "resolved": false }),
    )
    .unwrap();
    assert_eq!(
        call(
            &k,
            &s,
            "list_comments",
            json!({ "note": "Draft", "open_only": true })
        )
        .unwrap()["total"],
        1
    );
    lock(&k, p["path"].as_str().unwrap());
    let err = call(
        &k,
        &s,
        "add_comment",
        json!({ "note": "Draft", "text": "More" }),
    )
    .unwrap_err();
    assert!(err.contains("locked"), "{err}");
    set_mode(&k, AgentMode::Review);
    let held = call(
        &k,
        &s,
        "add_comment",
        json!({ "note": "Welcome to KastenFlow", "text": "Hi" }),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
}
