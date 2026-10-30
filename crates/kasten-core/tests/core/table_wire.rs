//! The changes the database table's UI sends (bulk bar, paste, manual order,
//! sub-item rows) as the app sends them: JSON read by `ops_from_json`, made by
//! `batch_as_person`. The JSON is `fixtures/table-wire/table-wire.json`, which
//! the app's own test (table-wire.test.ts) checks the UI builds exactly, so a
//! renamed field on either side fails a test here or there.

use std::fs;
use std::path::Path;

use kasten_core::Kasten;
use kasten_core::batch::refs::ops_from_json;
use serde_json::{Value, json};

use crate::change_sets::{open, snapshot};
use crate::common::NOW;

fn fixture() -> Value {
    let file =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/table-wire/table-wire.json");
    serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap()
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

/// `text` with `@path:Title` and `@id:Title` put by the note of that title.
fn put(k: &Kasten, text: &str) -> String {
    let notes = k.list().unwrap();
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find('@') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let (kind, after) = if let Some(t) = tail.strip_prefix("@path:") {
            ("path", t)
        } else if let Some(t) = tail.strip_prefix("@id:") {
            ("id", t)
        } else {
            out.push('@');
            rest = &tail[1..];
            continue;
        };
        let end = after
            .find(|c: char| !c.is_alphanumeric())
            .unwrap_or(after.len());
        let title = &after[..end];
        let note = notes
            .iter()
            .find(|n| n.title == title)
            .unwrap_or_else(|| panic!("no note called {title}"));
        out.push_str(&if kind == "path" {
            note.path.clone()
        } else {
            note.id.clone().unwrap()
        });
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

fn changes(k: &Kasten, list: &Value) -> Vec<Value> {
    let text = put(k, &list.to_string());
    serde_json::from_str::<Vec<Value>>(&text).unwrap()
}

fn run(k: &Kasten, list: Vec<Value>) -> kasten_core::PersonBatch {
    let ops = ops_from_json(list).unwrap();
    k.batch_as_person(&ops, Some("Table change"), NOW).unwrap()
}

fn check_note(k: &Kasten, title: &str, want: &Value) {
    let notes = k.list().unwrap();
    let note = notes
        .iter()
        .find(|n| n.title == title)
        .unwrap_or_else(|| panic!("no note called {title}"));
    for (key, value) in want
        .get("props")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        assert_eq!(note.props.get(key), Some(value), "{title}: {key}");
    }
    for key in want
        .get("absent_props")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let key = key.as_str().unwrap();
        assert!(
            note.props.get(key).is_none_or(Value::is_null),
            "{title}: {key} should be gone, props {}",
            note.props
        );
    }
    if let Some(tags) = want.get("tags").and_then(Value::as_array) {
        let mut have = note.tags.clone();
        let mut tags: Vec<String> = tags
            .iter()
            .map(|t| t.as_str().unwrap().to_owned())
            .collect();
        have.sort();
        tags.sort();
        assert_eq!(have, tags, "{title}: tags");
    }
    if let Some(project) = want.get("project") {
        assert_eq!(&json!(note.project), project, "{title}: project");
    }
    if let Some(parent) = want.get("parent_of").and_then(Value::as_str) {
        let id = notes.iter().find(|n| n.title == parent).unwrap().id.clone();
        assert_eq!(note.parent, id, "{title}: parent");
    }
}

#[test]
fn every_change_the_table_sends_is_one_commit_and_one_undo_with_the_result_it_means() {
    let fixture = fixture();
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let (t, k, _) = open();
        let made = run(&k, changes(&k, &fixture["setup"]));
        assert_eq!(made.changes, 3, "{name}: setup");
        if let Some(before) = case.get("before") {
            run(&k, changes(&k, before));
        }
        let files = snapshot(t.vault.root());
        let count = commits(&k);
        let list = changes(&k, &case["changes"]);
        let done = run(&k, list.clone());
        assert_eq!(done.changes, list.len(), "{name}");
        assert_eq!(commits(&k), count + 1, "{name}: one commit");
        let head = &k.log(None, 1).unwrap()[0];
        assert_eq!(done.commit.as_deref(), Some(head.id.as_str()), "{name}");

        let expect = &case["expect"];
        for (title, want) in expect["notes"].as_object().into_iter().flatten() {
            check_note(&k, title, want);
        }
        for title in expect["absent_titles"].as_array().into_iter().flatten() {
            let title = title.as_str().unwrap();
            assert!(
                k.list().unwrap().iter().all(|n| n.title != title),
                "{name}: {title} is still there"
            );
        }
        for (path, wants) in expect["files"].as_object().into_iter().flatten() {
            let path = put(&k, path);
            let text = fs::read_to_string(t.vault.root().join(&path)).unwrap();
            for want in wants.as_array().unwrap() {
                let want = put(&k, want.as_str().unwrap());
                assert!(text.contains(&want), "{name}: {path} lacks {want}\n{text}");
            }
        }

        let undone = k.undo_commit(done.commit.as_deref().unwrap(), NOW).unwrap();
        assert!(undone.conflict.is_none(), "{name}: {:?}", undone.conflict);
        assert_eq!(snapshot(t.vault.root()), files, "{name}: every byte back");
    }
}

#[test]
fn a_paste_of_a_hundred_new_rows_is_one_commit_and_a_hundred_and_one_is_refused() {
    let (t, k, _) = open();
    let row = |n: usize| {
        json!({"kind": "create_note", "type": "page", "title": format!("Row {n}"),
            "tags": ["travel"], "props": {"status": "Idea", "budget": n}})
    };
    let files = snapshot(t.vault.root());
    let why = ops_from_json((0..101).map(row).collect())
        .and_then(|ops| k.batch_as_person(&ops, None, NOW))
        .unwrap_err()
        .to_string();
    assert!(why.contains("at most 100"), "{why}");
    assert_eq!(snapshot(t.vault.root()), files, "nothing was made");
    let count = commits(&k);
    let done = run(&k, (0..100).map(row).collect());
    assert_eq!(done.changes, 100);
    assert_eq!(commits(&k), count + 1);
    k.undo_commit(done.commit.as_deref().unwrap(), NOW).unwrap();
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn a_change_with_a_field_the_core_does_not_know_is_refused_whole() {
    // The failure the fixture guards against: a renamed field or kind on the
    // app's side must not be taken as a no-op.
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    for bad in [
        json!({"kind": "update_property", "path": "library/welcome-to-kasten.md", "props": {}}),
        json!({"kind": "tags", "path": "library/welcome-to-kasten.md", "add": "review"}),
        json!({"kind": "move", "path": "library/welcome-to-kasten.md", "project": 4}),
        json!({"kind": "set_view_order", "tag": "travel", "view": "Trips", "ids": "a"}),
    ] {
        let err = ops_from_json(vec![bad.clone()])
            .and_then(|ops| k.batch_as_person(&ops, None, NOW))
            .unwrap_err()
            .to_string();
        assert!(!err.is_empty(), "{bad}");
    }
    assert_eq!(snapshot(t.vault.root()), files);
}
