//! A tag database's views and properties, saved into its `tags/<name>.yaml`
//! without touching the rest of the file.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;
use serde_json::json;

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn saves_views_into_the_tag_file_and_keeps_the_rest() {
    let (t, k) = open();
    let file = t.vault.root().join("tags/task.yaml");
    let before = fs::read_to_string(&file).unwrap();
    let with_comment = before.replacen(
        "properties:\n",
        "# Everything on my plate\nproperties:\n",
        1,
    );
    fs::write(&file, &with_comment).unwrap();
    k.commit_edits().unwrap();

    let views = [
        json!({"name": "Board", "type": "kanban", "group_by": "priority"}),
        json!({"name": "Soon", "type": "list", "sort": [{"key": "due", "dir": "asc"}], "filter": [{"key": "status", "op": "is_not", "value": "Done"}]}),
    ];
    let schema = k.set_tag_views(&Actor::Human, "Task", &views, NOW).unwrap();
    assert_eq!(schema.views, views);
    assert_eq!(schema.properties.len(), 3);

    let after = fs::read_to_string(&file).unwrap();
    let (head, _) = with_comment.split_once("views:").unwrap();
    assert!(after.starts_with(head), "{after}");
    assert!(after.contains("  - {name: Soon, type: list, sort: [{key: due, dir: asc}], filter: [{key: status, op: is_not, value: Done}]}\n"));
    assert_eq!(
        k.tag_schemas()
            .unwrap()
            .iter()
            .find(|s| s.name == "task")
            .unwrap()
            .views,
        views
    );

    // A person's view changes are batched like typing, then committed.
    k.commit_edits().unwrap();
    let last = &k.log(Some("tags/task.yaml"), 1).unwrap()[0];
    assert!(last.summary.contains("task"), "{}", last.summary);
}

#[test]
fn finds_the_file_by_the_name_written_in_it() {
    let (t, k) = open();
    fs::write(
        t.vault.root().join("tags/reading-list.yaml"),
        "name: Reading\nproperties:\n  - {key: stage, type: text}\n",
    )
    .unwrap();
    let views = [json!({"name": "All", "type": "table"})];
    let schema = k
        .set_tag_views(&Actor::Human, "reading", &views, NOW)
        .unwrap();
    assert_eq!(schema.path, "tags/reading-list.yaml");
    assert!(!t.vault.root().join("tags/reading.yaml").exists());
}

#[test]
fn makes_a_file_for_a_tag_without_one() {
    let (t, k) = open();
    let views = [json!({"name": "Ideas", "type": "kanban", "group_by": "stage"})];
    let schema = k
        .set_tag_views(&Actor::Human, "#Side projects", &views, NOW)
        .unwrap();
    assert_eq!(schema.path, "tags/side-projects.yaml");
    assert_eq!(schema.name, "Side projects");
    let yaml = fs::read_to_string(t.vault.root().join("tags/side-projects.yaml")).unwrap();
    assert_eq!(
        yaml,
        "name: Side projects\nviews:\n  - {name: Ideas, type: kanban, group_by: stage}\n"
    );
}

#[test]
fn refuses_views_it_cannot_show() {
    let (_t, k) = open();
    for bad in [
        json!({"type": "table"}),
        json!({"name": "", "type": "table"}),
        json!({"name": "X", "type": "roadmap"}),
        json!({"name": "X", "type": "timeline"}),
        json!("table"),
    ] {
        assert!(
            k.set_tag_views(&Actor::Human, "task", std::slice::from_ref(&bad), NOW)
                .is_err(),
            "{bad}"
        );
    }
    let twice = [
        json!({"name": "A", "type": "table"}),
        json!({"name": "a", "type": "list"}),
    ];
    assert!(k.set_tag_views(&Actor::Human, "task", &twice, NOW).is_err());
}

#[test]
fn keeps_the_views_another_tool_wrote() {
    let (t, k) = open();
    fs::write(
        t.vault.root().join("tags/reading-list.yaml"),
        "name: Reading\nviews:\n  - {name: All, type: table}\n  - {name: Roadmap, type: roadmap, start: due}\n  - {type: table, note: unnamed}\n",
    )
    .unwrap();
    let views = [json!({"name": "Shelf", "type": "gallery"})];
    let schema = k
        .set_tag_views(&Actor::Human, "reading", &views, NOW)
        .unwrap();
    assert_eq!(
        schema.views,
        [
            json!({"name": "Shelf", "type": "gallery"}),
            json!({"name": "Roadmap", "type": "roadmap", "start": "due"}),
            json!({"type": "table", "note": "unnamed"}),
        ]
    );
}

#[test]
fn keeps_a_gallery_view() {
    let (_t, k) = open();
    let views = [
        json!({"name": "Board", "type": "kanban", "group_by": "status"}),
        json!({"name": "Cards", "type": "gallery", "cover": "icon"}),
    ];
    let schema = k.set_tag_views(&Actor::Human, "task", &views, NOW).unwrap();
    assert_eq!(schema.views[1]["type"], "gallery");
    assert_eq!(schema.views[1]["cover"], "icon");
}

#[test]
fn replaces_properties_checked_and_keeps_the_views() {
    let (t, k) = open();
    let props = [
        json!({"key": "status", "type": "select", "options": ["Todo", "Doing", "Waiting", "Done"]}),
        json!({"key": "due", "type": "date"}),
        json!({"key": "estimate", "type": "number"}),
    ];
    let commits = k.log(None, 500).unwrap().len();
    let schema = k
        .set_tag_properties(&Actor::Human, "task", &props, NOW)
        .unwrap();
    assert_eq!(schema.properties.len(), 3);
    assert_eq!(
        schema.properties[0].options,
        ["Todo", "Doing", "Waiting", "Done"]
    );
    assert_eq!(schema.views.len(), 2);
    // A schema change commits at once: notes are checked against it.
    assert_eq!(k.log(None, 500).unwrap().len(), commits + 1);
    let yaml = fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap();
    assert!(yaml.starts_with("name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Waiting, Done]}\n"));

    for bad in [
        json!({"type": "text"}),
        json!({"key": "a", "type": "nope"}),
        json!({"key": "a", "type": "select", "options": "Todo"}),
    ] {
        assert!(
            k.set_tag_properties(&Actor::Human, "task", std::slice::from_ref(&bad), NOW)
                .is_err(),
            "{bad}"
        );
    }
    let twice = [
        json!({"key": "a", "type": "text"}),
        json!({"key": "a", "type": "number"}),
    ];
    assert!(
        k.set_tag_properties(&Actor::Human, "task", &twice, NOW)
            .is_err()
    );
}

/// A kanban drag updates the file and commits; views persist in the tag
/// YAML.
#[test]
fn a_kanban_move_is_one_commit_of_the_note_and_the_board_stays_in_the_yaml() {
    let (t, k) = open();
    let card = "inbox/look-at-json-canvas-spec.md";
    // The board, as the view bar saves it: grouped by status, coloured by priority.
    let views =
        [json!({"name": "Board", "type": "kanban", "group_by": "status", "color_by": "priority"})];
    k.set_tag_views(&Actor::Human, "task", &views, NOW).unwrap();
    k.commit_edits().unwrap();
    let yaml = fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap();
    assert!(
        yaml.contains("  - {name: Board, type: kanban, group_by: status, color_by: priority}\n"),
        "{yaml}"
    );

    // Dragging the card from Todo to Doing: the board sends one property.
    let before = k.log(None, 500).unwrap().len();
    let mut change = serde_json::Map::new();
    change.insert("status".into(), json!("doing"));
    let note = k.update_props(&Actor::Human, card, &change, NOW).unwrap();
    assert!(
        note.text.contains("props:\n  status: Doing\n"),
        "{}",
        note.text
    );
    assert_eq!(
        fs::read_to_string(t.vault.root().join(card)).unwrap(),
        note.text
    );
    let log = k.log(None, 500).unwrap();
    assert_eq!(log.len(), before + 1, "one commit, at once");
    let changed = k.commit_changes(&log[0].id).unwrap();
    assert_eq!(
        changed.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(),
        [card]
    );

    // A fresh engine on the same folder still has the board.
    drop(k);
    let again = Kasten::open(t.vault.root()).unwrap();
    let task = again
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task")
        .unwrap();
    assert_eq!(task.views, views);
}
