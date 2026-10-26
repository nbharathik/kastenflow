use serde_json::json;

use super::*;
use crate::tags::parse_schema;

const TASK: &str = "name: task\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n  - {key: points, type: number}\n  - {key: urgent, type: checkbox}\n";

fn note(path: &str, title: &str, props: Value) -> NoteMeta {
    NoteMeta {
        path: path.to_owned(),
        id: None,
        title: title.to_owned(),
        kind: "page".to_owned(),
        icon: None,
        cover: None,
        parent: None,
        project: None,
        tags: vec!["task".to_owned()],
        modified: 0,
        created: None,
        updated: None,
        excerpt: String::new(),
        words: 0,
        props,
        locked: false,
        children_order: Vec::new(),
    }
}

fn notes() -> Vec<NoteMeta> {
    vec![
        note(
            "a.md",
            "Write intro",
            json!({"status": "Doing", "due": "2026-10-02", "points": 3}),
        ),
        note(
            "b.md",
            "Book flights",
            json!({"status": "Todo", "due": "2026-09-30", "points": 10, "urgent": true}),
        ),
        note(
            "c.md",
            "Plan budget",
            json!({"status": "Done", "points": 1}),
        ),
        note("d.md", "Loose end", json!({"status": "Blocked"})),
        note("e.md", "No status yet", json!({})),
    ]
}

fn schema() -> TagSchema {
    parse_schema("tags/task.yaml", TASK).unwrap()
}

fn paths(rows: &[NoteMeta]) -> Vec<&str> {
    rows.iter().map(|n| n.path.as_str()).collect()
}

#[test]
fn filters_by_value_emptiness_and_day() {
    let s = schema();
    let def = |key: &str| s.properties.iter().find(|p| p.key == key);
    let b = &notes()[1];
    assert!(passes(
        b,
        &json!({"key": "status", "op": "is", "value": "todo"}),
        def("status")
    ));
    assert!(!passes(
        b,
        &json!({"key": "status", "op": "is_not", "value": "Todo"}),
        def("status")
    ));
    assert!(passes(
        b,
        &json!({"key": "title", "op": "contains", "value": "FLIGHT"}),
        None
    ));
    assert!(passes(
        b,
        &json!({"key": "due", "op": "before", "value": "2026-10-01"}),
        def("due")
    ));
    assert!(!passes(
        b,
        &json!({"key": "due", "op": "after", "value": "2026-10-01"}),
        def("due")
    ));
    assert!(passes(
        &notes()[2],
        &json!({"key": "due", "op": "empty"}),
        def("due")
    ));
    assert!(passes(
        &notes()[0],
        &json!({"key": "urgent", "op": "empty"}),
        def("urgent")
    ));
    assert!(passes(
        b,
        &json!({"key": "urgent", "op": "is", "value": true}),
        def("urgent")
    ));
    // A filter it cannot read lets everything through.
    assert!(passes(b, &json!({"op": "is"}), None));
}

#[test]
fn sorts_by_type_with_empty_values_last() {
    let s = schema();
    let order = |sort: Value| {
        let rows = apply_view(
            notes(),
            &json!({"name": "x", "type": "table", "sort": sort}),
            Some(&s),
        );
        paths(&rows)
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        order(json!([{"key": "status", "dir": "asc"}])),
        ["b.md", "a.md", "c.md", "d.md", "e.md"]
    );
    assert_eq!(
        order(json!([{"key": "points", "dir": "desc"}])),
        ["b.md", "a.md", "c.md", "d.md", "e.md"]
    );
    assert_eq!(
        order(json!([{"key": "due", "dir": "asc"}])),
        ["b.md", "a.md", "d.md", "e.md", "c.md"]
    );
    assert_eq!(order(json!([])), ["b.md", "d.md", "e.md", "c.md", "a.md"]);
}

#[test]
fn applies_a_saved_views_filters_and_sorts() {
    let s = schema();
    let view = json!({"name": "Open", "type": "list", "filter": [{"key": "status", "op": "is_not", "value": "Done"}], "sort": [{"key": "due", "dir": "asc"}]});
    assert_eq!(
        paths(&apply_view(notes(), &view, Some(&s))),
        ["b.md", "a.md", "d.md", "e.md"]
    );
}

#[test]
fn counts_a_boards_columns_in_option_order() {
    let s = schema();
    let columns = board_columns(&notes(), &s.properties[0]);
    assert_eq!(
        columns,
        json!([
            {"value": null, "label": "No status", "count": 1},
            {"value": "Todo", "label": "Todo", "count": 1},
            {"value": "Doing", "label": "Doing", "count": 1},
            {"value": "Done", "label": "Done", "count": 1},
            {"value": "Blocked", "label": "Blocked", "count": 1}
        ])
    );
}

#[test]
fn sorts_numbers_that_are_not_numbers_without_a_panic() {
    let s = schema();
    // YAML's `.nan` reaches the props as "NaN"; sorting must still be total.
    let rows: Vec<NoteMeta> = (0..40)
        .map(|i| {
            let points = match i % 3 {
                0 => json!("NaN"),
                1 => json!(i),
                _ => json!(-i),
            };
            note(
                &format!("n{i}.md"),
                &format!("N{i}"),
                json!({ "points": points }),
            )
        })
        .collect();
    let sorted = apply_view(
        rows,
        &json!({"name": "x", "type": "table", "sort": [{"key": "points", "dir": "asc"}]}),
        Some(&s),
    );
    assert_eq!(sorted.len(), 40);
}
