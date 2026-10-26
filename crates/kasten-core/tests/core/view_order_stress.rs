//! `set_view_order` on odd files and big lists: only the view's own line
//! changes, or the file is still read back the same, and nothing is lost.

use std::fs;

use kasten_core::Kasten;
use kasten_core::history::Actor;
use serde_json::json;

use crate::common::{NOW, TempVault, dev_vault};

const FILE: &str = "tags/task.yaml";

fn open_with(yaml: &[u8]) -> (TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    fs::write(t.vault.root().join(FILE), yaml).unwrap();
    k.commit_external().unwrap();
    k.reindex().unwrap();
    (t, k)
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

fn bytes(t: &TempVault) -> Vec<u8> {
    fs::read(t.vault.root().join(FILE)).unwrap()
}

fn order_of(k: &Kasten, view: usize) -> serde_json::Value {
    k.tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task")
        .unwrap()
        .views[view]["order"]
        .clone()
}

#[test]
fn five_thousand_ids_are_one_line_and_read_back_whole() {
    let yaml =
        "name: task\nviews:\n  - {name: All, type: table}\n  - {name: Due, type: calendar}\n";
    let (t, k) = open_with(yaml.as_bytes());
    let many: Vec<String> = (0..5000).map(|n| format!("01H{n:023}")).collect();
    k.set_view_order(&Actor::Human, "task", "All", &many, NOW)
        .unwrap();
    let after = String::from_utf8(bytes(&t)).unwrap();
    assert_eq!(after.lines().count(), 4, "still one line per view");
    assert!(after.ends_with("  - {name: Due, type: calendar}\n"));
    assert_eq!(order_of(&k, 0).as_array().unwrap().len(), 5000);
    // The same list again: nothing to write.
    let before = bytes(&t);
    k.set_view_order(&Actor::Human, "task", "All", &many, NOW)
        .unwrap();
    assert_eq!(bytes(&t), before);
    // One id too many is refused whole.
    let mut over = many.clone();
    over.push("extra".into());
    assert!(
        k.set_view_order(&Actor::Human, "task", "All", &over, NOW)
            .is_err()
    );
    assert_eq!(bytes(&t), before);
}

#[test]
fn ids_with_unusual_characters_are_stored_whole_or_refused_never_garbled() {
    let yaml =
        "name: task\nviews:\n  - {name: All, type: table}\n  - {name: Due, type: calendar}\n";
    let odd = [
        "line\u{2028}separator",
        "para\u{2029}separator",
        "next\u{85}line",
        "tab\there",
        "nul\0x",
        "bell\u{7}",
        "bom\u{feff}inside",
        "emoji \u{1f600}",
        "quote ' and \" both",
        "back\\slash",
        "- dash",
        "? key",
        "&anchor",
        "*alias",
        "!tag",
        "%dir",
        "@at",
        "`tick",
        "| bar",
        "> fold",
        "~",
        "0x1F",
        "0o17",
        ".inf",
        "-.INF",
        ".nan",
        "2026-10-23",
        "yes",
        "No",
        "off",
        "=",
        "<<",
    ];
    let (t, k) = open_with(yaml.as_bytes());
    for one in odd {
        // The file as it began, for each id in turn.
        fs::write(t.vault.root().join(FILE), yaml).unwrap();
        k.commit_external().unwrap();
        k.reindex().unwrap();
        let outcome = k.set_view_order(&Actor::Human, "task", "All", &ids(&[one]), NOW);
        match outcome {
            Err(_) => assert_eq!(bytes(&t), yaml.as_bytes(), "{one:?}: refused, untouched"),
            Ok(_) => {
                assert_eq!(order_of(&k, 0), json!([one]), "{one:?}");
                let after = String::from_utf8(bytes(&t)).unwrap();
                assert_eq!(after.lines().count(), 4, "{one:?}: {after:?}");
                assert!(
                    after.ends_with("  - {name: Due, type: calendar}\n"),
                    "{one:?}"
                );
            }
        }
    }
}

#[test]
fn odd_shapes_of_the_views_list_keep_every_other_byte_or_fall_back_whole() {
    let cases: [(&str, &str); 7] = [
        // A byte order mark, tabs, a lone dash and a nested list.
        (
            "\u{feff}name: task\nviews:\n\t- {name: All, type: table}\n",
            "tab-indented item",
        ),
        (
            "name: task\nviews:\n-\n  {name: All, type: table}\n",
            "dash alone",
        ),
        (
            "name: task\nviews:\n- {name: All, type: table}\n- {name: Due, type: calendar}\nmore: 1\n",
            "items at the left edge",
        ),
        (
            "name: task\nviews:\n  - name: All\n    columns:\n      - a\n      - b\n    type: table\nmore: 1\n",
            "block item holding a list",
        ),
        (
            "name: task\nviews: [{name: All, type: table}]\nmore: 1\n",
            "flow list on the key's line",
        ),
        (
            "name: task\nviews:\n\n  - {name: All, type: table}\n\n  # a note\n\n  - {name: Due, type: calendar}\n",
            "blank lines and a comment between items",
        ),
        (
            "name: task\nviews:\n  - {name: All, type: table} # }\n",
            "a comment that ends in a brace",
        ),
    ];
    for (yaml, what) in cases {
        let (t, k) = open_with(yaml.as_bytes());
        // A file that is no schema to begin with (tabs for indent) has no views to order.
        let Some(schema_before) = k
            .tag_schemas()
            .unwrap()
            .into_iter()
            .find(|s| s.name == "task")
        else {
            let why = k
                .set_view_order(&Actor::Human, "task", "All", &ids(&["a"]), NOW)
                .unwrap_err()
                .to_string();
            assert!(why.contains("no schema"), "{what}: {why}");
            assert_eq!(bytes(&t), yaml.as_bytes(), "{what}: untouched");
            continue;
        };
        let outcome = k.set_view_order(&Actor::Human, "task", "All", &ids(&["a", "b"]), NOW);
        let after = String::from_utf8(bytes(&t)).unwrap();
        outcome.unwrap_or_else(|err| panic!("{what}: {err}\n{after}"));
        let schema = k
            .tag_schemas()
            .unwrap()
            .into_iter()
            .find(|s| s.name == "task")
            .unwrap();
        assert_eq!(
            schema.views.len(),
            schema_before.views.len(),
            "{what}\n{after}"
        );
        assert_eq!(
            schema.views[0]["order"],
            json!(["a", "b"]),
            "{what}\n{after}"
        );
        for (n, view) in schema_before.views.iter().enumerate().skip(1) {
            assert_eq!(
                &schema.views[n], view,
                "{what}: view {n} untouched\n{after}"
            );
        }
        if yaml.contains("more: 1\n") {
            assert!(after.contains("more: 1\n"), "{what}\n{after}");
        }
    }
}

#[test]
fn a_comment_between_the_views_key_and_its_items_is_not_turned_into_a_second_list() {
    // A comment at the left edge ends the key's lines for the writers that walk
    // them; the items after it must not be left behind as a second copy.
    let yaml = "name: task\nviews:\n# the views\n  - {name: All, type: table}\n  - {name: Due, type: calendar}\n";
    let (t, k) = open_with(yaml.as_bytes());
    let before = k
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task")
        .unwrap()
        .views;
    let outcome = k.set_view_order(&Actor::Human, "task", "All", &ids(&["a"]), NOW);
    let after = String::from_utf8(bytes(&t)).unwrap();
    let views = k
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task")
        .unwrap()
        .views;
    match outcome {
        Err(_) => assert_eq!(after, yaml, "refused: untouched"),
        Ok(_) => {
            assert_eq!(views.len(), before.len(), "no view is doubled:\n{after}");
            assert_eq!(views[0]["order"], json!(["a"]), "{after}");
        }
    }
}

#[test]
fn a_view_whose_order_is_not_a_list_in_the_file_is_refused_by_the_op_that_writes_it() {
    let yaml = "name: task\nviews:\n  - {name: All, type: table, order: 5}\n";
    let (t, k) = open_with(yaml.as_bytes());
    let outcome = k.set_view_order(&Actor::Human, "task", "All", &ids(&["a"]), NOW);
    // Either it repairs the setting with the new list, or says why not; never a mixed file.
    let after = String::from_utf8(bytes(&t)).unwrap();
    match outcome {
        Err(_) => assert_eq!(after, yaml),
        Ok(_) => assert_eq!(order_of(&k, 0), json!(["a"]), "{after}"),
    }
}
