use serde_json::json;

use super::*;
use crate::tags::parse_schema;

const TASK: &str = "# Tasks for every project\nname: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}  # the board's columns\n  - {key: due, type: date}\n\nviews:\n  - {name: Board, type: kanban, group_by: status}\n  - {name: All, type: table}\n\n# kept below the views\nicon: ✅\n";

#[test]
fn replaces_only_the_list_and_keeps_every_other_byte() {
    let views = [
        json!({"name": "Board", "type": "kanban", "group_by": "status", "sort": [{"key": "due", "dir": "asc"}]}),
    ];
    let out = set_list(TASK, "views", &views);
    assert_eq!(
        out,
        "# Tasks for every project\nname: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}  # the board's columns\n  - {key: due, type: date}\n\nviews:\n  - {name: Board, type: kanban, group_by: status, sort: [{key: due, dir: asc}]}\n\n# kept below the views\nicon: ✅\n"
    );
    let schema = parse_schema("tags/task.yaml", &out).unwrap();
    assert_eq!(schema.views, views);
    assert_eq!(schema.properties.len(), 2);
}

#[test]
fn replaces_properties_the_same_way() {
    let props = [json!({"key": "status", "type": "select", "options": ["Todo", "Done"]})];
    let out = set_list(TASK, "properties", &props);
    assert!(out.starts_with("# Tasks for every project\nname: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Done]}\n\nviews:\n"));
    assert!(out.ends_with("# kept below the views\nicon: ✅\n"));
}

#[test]
fn writes_an_empty_list_on_one_line() {
    let out = set_list(TASK, "views", &[]);
    assert!(out.contains("\nviews: []\n\n# kept below the views\n"));
    assert!(
        parse_schema("tags/task.yaml", &out)
            .unwrap()
            .views
            .is_empty()
    );
}

#[test]
fn adds_a_missing_list_at_the_end() {
    let views = [json!({"name": "All", "type": "table"})];
    assert_eq!(
        set_list("name: idea\n", "views", &views),
        "name: idea\nviews:\n  - {name: All, type: table}\n"
    );
    assert_eq!(
        set_list("name: idea", "views", &views),
        "name: idea\nviews:\n  - {name: All, type: table}\n"
    );
    assert_eq!(
        set_list("", "views", &views),
        "views:\n  - {name: All, type: table}\n"
    );
}

#[test]
fn replaces_lists_written_flat_or_unindented() {
    let views = [json!({"name": "List", "type": "list"})];
    let flow = "name: a\nviews: [{name: X, type: table}]\ncolor: red\n";
    assert_eq!(
        set_list(flow, "views", &views),
        "name: a\nviews:\n  - {name: List, type: list}\ncolor: red\n"
    );
    let flat = "name: a\nviews:\n- name: X\n  type: table\n- {name: Y, type: kanban}\ncolor: red\n";
    assert_eq!(
        set_list(flat, "views", &views),
        "name: a\nviews:\n  - {name: List, type: list}\ncolor: red\n"
    );
}

#[test]
fn keeps_windows_line_endings() {
    let crlf = "name: a\r\nviews:\r\n  - {name: X, type: table}\r\ncolor: red\r\n";
    let views = [json!({"name": "List", "type": "list"})];
    assert_eq!(
        set_list(crlf, "views", &views),
        "name: a\r\nviews:\r\n  - {name: List, type: list}\r\ncolor: red\r\n"
    );
}

#[test]
fn leaves_a_nested_key_of_the_same_name_alone() {
    let yaml = "name: a\nproperties:\n  - key: views\n    type: number\nviews:\n  - {name: X, type: table}\n";
    let out = set_list(yaml, "views", &[]);
    assert_eq!(
        out,
        "name: a\nproperties:\n  - key: views\n    type: number\nviews: []\n"
    );
}

const VIEW: &str = "# my reading queue\nformat: 1\nname: Reading queue  # shown in the list\nicon: book\nquery: \"#capture project:photo-organiser\"\nwhen: {updated: last-30-days}\nfilter:\n  - {key: reading, op: is, value: Unread}\n\n# kept below\nextra: [1, 2]\nsort:\n  - {key: captured, dir: desc}\n";

#[test]
fn sets_a_one_line_value_and_keeps_every_other_byte() {
    let out = set_value(VIEW, "query", Some(&json!("#capture tag:x")));
    assert_eq!(
        out,
        VIEW.replace(
            "query: \"#capture project:photo-organiser\"\n",
            "query: \"#capture tag:x\"\n"
        )
    );
    let out = set_value(VIEW, "when", Some(&json!({"created": "this-year"})));
    assert_eq!(
        out,
        VIEW.replace(
            "when: {updated: last-30-days}",
            "when: {created: this-year}"
        )
    );
    let out = set_value(VIEW, "icon", Some(&json!("a: b")));
    assert_eq!(out, VIEW.replace("icon: book", "icon: \"a: b\""));
}

#[test]
fn keeps_a_comment_that_follows_a_one_line_value() {
    let out = set_value(VIEW, "name", Some(&json!("Renamed")));
    assert_eq!(
        out,
        VIEW.replace(
            "name: Reading queue  # shown in the list",
            "name: Renamed  # shown in the list"
        )
    );
    // A # inside the quoted value is not a comment.
    let quoted = "query: \"a #b\"  # why\nname: x\n";
    assert_eq!(
        set_value(quoted, "query", Some(&json!("new"))),
        "query: new  # why\nname: x\n"
    );
    assert_eq!(
        set_value("query: \"a #b\"\n", "query", Some(&json!("new"))),
        "query: new\n"
    );
}

#[test]
fn a_list_item_keeps_the_comment_after_it_even_one_that_ends_in_a_brace() {
    let yaml = "name: task\nviews:\n  - {name: All, type: table} # }\n  - {name: Due, type: calendar}  # when\n";
    let first = replace_list_item(yaml, "views", 0, &json!({"name": "All", "type": "kanban"}))
        .expect("an item with a comment is replaced in place");
    assert_eq!(
        first,
        "name: task\nviews:\n  - {name: All, type: kanban} # }\n  - {name: Due, type: calendar}  # when\n"
    );
    let second =
        replace_list_item(yaml, "views", 1, &json!({"name": "Due", "type": "list"})).unwrap();
    assert!(
        second.ends_with("  - {name: Due, type: list}  # when\n"),
        "{second}"
    );
    assert!(second.starts_with("name: task\nviews:\n  - {name: All, type: table} # }\n"));
    // A # inside the mapping's own text is not a comment: the whole list is written instead.
    let quoted = "views:\n  - {name: \"A #1\", type: table}\n";
    assert!(
        replace_list_item(
            quoted,
            "views",
            0,
            &json!({"name": "A #1", "type": "table"})
        )
        .is_none()
    );
}

#[test]
fn takes_a_key_out_with_all_its_lines_and_nothing_else() {
    let out = set_value(VIEW, "filter", None);
    assert_eq!(
        out,
        VIEW.replace("filter:\n  - {key: reading, op: is, value: Unread}\n", "")
    );
    assert_eq!(
        set_value(VIEW, "icon", None),
        VIEW.replace("icon: book\n", "")
    );
    // Not there: nothing changes.
    assert_eq!(set_value(VIEW, "display", None), VIEW);
    assert_eq!(set_value("", "display", None), "");
}

#[test]
fn adds_a_missing_value_at_the_end_and_writes_maps_and_lists() {
    assert_eq!(
        set_value("format: 1\nname: A\n", "icon", Some(&json!("book"))),
        "format: 1\nname: A\nicon: book\n"
    );
    assert_eq!(
        set_value("format: 1\nname: A", "icon", Some(&json!("book"))),
        "format: 1\nname: A\nicon: book\n"
    );
    assert_eq!(
        set_value(
            "name: A\n",
            "display",
            Some(&json!({"type": "table", "columns": ["title", "site"], "limit": 500}))
        ),
        "name: A\ndisplay: {type: table, columns: [title, site], limit: 500}\n"
    );
    assert_eq!(
        set_value(
            "name: A\n",
            "sort",
            Some(&json!([{"key": "captured", "dir": "desc"}]))
        ),
        "name: A\nsort:\n  - {key: captured, dir: desc}\n"
    );
    assert_eq!(
        set_value("name: A\n", "sort", Some(&json!([]))),
        "name: A\nsort: []\n"
    );
    assert_eq!(set_value("", "name", Some(&json!("A"))), "name: A\n");
}

#[test]
fn a_value_replaces_a_block_written_over_several_lines() {
    let yaml = "name: a\nwhen:\n  updated: last-7-days\n  created: this-year\nquery: q\n";
    assert_eq!(
        set_value(yaml, "when", Some(&json!({"updated": "today"}))),
        "name: a\nwhen: {updated: today}\nquery: q\n"
    );
    // A one-line value becomes a list, a list a one-line value.
    assert_eq!(
        set_value("a: 1\nb: x\n", "b", Some(&json!([1]))),
        "a: 1\nb:\n  - 1\n"
    );
    assert_eq!(
        set_value("a: 1\nb:\n  - 1\n  - 2\nc: 3\n", "b", Some(&json!("x"))),
        "a: 1\nb: x\nc: 3\n"
    );
}

#[test]
fn set_value_leaves_a_nested_key_alone_and_keeps_line_endings_and_marks() {
    let yaml = "name: a\nextras:\n  query: nested\nquery: top\n";
    assert_eq!(
        set_value(yaml, "query", Some(&json!("new"))),
        "name: a\nextras:\n  query: nested\nquery: new\n"
    );
    assert_eq!(
        set_value("name: a\r\nquery: q  # c\r\n", "query", Some(&json!("z"))),
        "name: a\r\nquery: z  # c\r\n"
    );
    assert_eq!(
        set_value("name: a\r\n", "icon", Some(&json!("book"))),
        "name: a\r\nicon: book\r\n"
    );
    assert_eq!(
        set_value("\u{feff}query: a\nname: b\n", "query", Some(&json!("z"))),
        "\u{feff}query: z\nname: b\n"
    );
    assert_eq!(
        set_value("\u{feff}query: a\nname: b\n", "query", None),
        "\u{feff}name: b\n"
    );
}

#[test]
fn a_comment_at_the_left_edge_before_the_items_does_not_leave_the_old_items_behind() {
    let yaml = "views:\n# the views\n  - {name: Old, type: table}\n  - {name: Two, type: table}\ncolor: red\n";
    let out = set_list(yaml, "views", &[json!({"name": "Board", "type": "kanban"})]);
    assert_eq!(out, "views:\n  - {name: Board, type: kanban}\ncolor: red\n");
    // A comment after the items, about the next key, is not part of the list.
    let yaml = "views:\n  - {name: Old, type: table}\n# about the color\ncolor: red\n";
    let out = set_list(yaml, "views", &[json!({"name": "Board", "type": "kanban"})]);
    assert_eq!(
        out,
        "views:\n  - {name: Board, type: kanban}\n# about the color\ncolor: red\n"
    );
    // A comment before the next key after blank lines stays too.
    let yaml = "views:\n  - {name: Old, type: table}\n\n# about the color\ncolor: red\n";
    let out = set_list(yaml, "views", &[json!({"name": "Board", "type": "kanban"})]);
    assert_eq!(
        out,
        "views:\n  - {name: Board, type: kanban}\n\n# about the color\ncolor: red\n"
    );
}

#[test]
fn keeps_a_byte_order_mark_on_the_list_it_replaces() {
    let yaml = "\u{feff}views:\n  - {name: Old, type: table}\ncolor: red\n";
    let out = set_list(yaml, "views", &[json!({"name": "Board", "type": "kanban"})]);
    assert_eq!(
        out,
        "\u{feff}views:\n  - {name: Board, type: kanban}\ncolor: red\n"
    );
}
