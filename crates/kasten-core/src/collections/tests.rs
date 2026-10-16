use serde_json::json;

use super::*;

const FILE: &str = "# my own note about this one\nformat: 1\nname: Reading queue\nicon: book\nquery: \"#capture project:photo-organiser\"   # keep\nwhen: {updated: last-30-days}\nfilter:\n  - {key: reading, op: is, value: Unread}\nsort:\n  - {key: captured, dir: desc}\ndisplay: {type: table, columns: [title, site, captured, reading], limit: 500}\nowner: bharathi   # a key this version does not know\nextra:\n  - a\n  - b\n";

fn map(value: serde_json::Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

#[test]
fn reads_every_key() {
    let c = read("views/reading-queue.yaml", FILE, 7);
    assert_eq!(c.problem, None);
    assert!(!c.read_only);
    assert_eq!(c.slug, "reading-queue");
    assert_eq!(c.name, "Reading queue");
    assert_eq!(c.icon.as_deref(), Some("book"));
    assert_eq!(c.query, "#capture project:photo-organiser");
    assert_eq!(c.when, Some(json!({"updated": "last-30-days"})));
    assert_eq!(
        c.filter,
        [json!({"key": "reading", "op": "is", "value": "Unread"})]
    );
    assert_eq!(c.sort, [json!({"key": "captured", "dir": "desc"})]);
    assert_eq!(
        c.display,
        Some(
            json!({"type": "table", "columns": ["title", "site", "captured", "reading"], "limit": 500})
        )
    );
    assert_eq!((c.format, c.modified), (1, 7));
    assert_eq!(c.hash, crate::note::content_hash(FILE));
}

#[test]
fn a_file_with_only_a_name_is_a_collection_and_a_missing_name_is_the_file_name() {
    let c = read("views/x.yaml", "name: Only a name\n", 0);
    assert_eq!((c.problem, c.format, c.query.as_str()), (None, 1, ""));
    assert!(c.filter.is_empty() && c.sort.is_empty() && c.when.is_none());
    let c = read("views/some-file.yaml", "query: tag:x\n", 0);
    assert_eq!((c.name.as_str(), c.problem), ("some-file", None));
}

#[test]
fn a_file_that_cannot_be_used_is_listed_read_only_with_the_reason() {
    let long = format!("name: Long\nquery: {}\n", "a".repeat(MAX_QUERY + 1));
    for (text, why) in [
        ("{ not: [valid", "not valid YAML"),
        ("", "holds no collection"),
        ("- a\n- b\n", "holds no collection"),
        ("name: A\nformat: soon\n", "format"),
        ("name: A\nformat: 0\n", "format"),
        ("name: A\nquery: 5\n", "query"),
        (long.as_str(), "at most 2000"),
        ("name: A\nwhen: {updated: soon}\n", "span of days"),
        (
            "name: A\nwhen: {edited: today}\n",
            "not something to look for",
        ),
        (
            "name: A\nfilter: [{key: a, op: sounds_like, value: b}]\n",
            "sounds_like",
        ),
        (
            "name: A\nfilter: [{key: a, op: before, value: yesterday}]\n",
            "needs a day",
        ),
        ("name: A\nfilter: [{op: is, value: b}]\n", "needs a key"),
        ("name: A\nsort: [{key: a, dir: up}]\n", "asc or desc"),
        ("name: A\ndisplay: {type: pie}\n", "one of"),
        ("name: A\ndisplay: {limit: 0}\n", "from 1 to 5000"),
        ("name: A\ndisplay: {columns: [a, 5]}\n", "list of up to"),
    ] {
        let c = read("views/bad.yaml", text, 0);
        let problem = c.problem.clone().unwrap_or_default();
        assert!(problem.contains(why), "{text:?} -> {problem:?}");
        assert!(c.read_only, "{text:?}");
        assert_eq!(c.path, "views/bad.yaml");
    }
}

#[test]
fn a_newer_format_is_shown_but_not_writable() {
    let c = read(
        "views/new.yaml",
        "format: 2\nname: From the future\nquery: tag:x\nwhatever: 1\n",
        0,
    );
    assert_eq!(
        (c.name.as_str(), c.query.as_str(), c.format),
        ("From the future", "tag:x", 2)
    );
    assert!(c.read_only);
    assert!(c.problem.unwrap().contains("newer version"));
}

#[test]
fn knows_a_collections_path() {
    for good in ["views/a.yaml", "views/reading-queue.yaml", "views/Ünï.yaml"] {
        assert!(is_path(good), "{good}");
    }
    for bad in [
        "",
        "views/",
        "views/.yaml",
        "views/a.yml",
        "views/a.md",
        "views/sub/a.yaml",
        "Views/a.yaml",
        "tags/a.yaml",
        "a.yaml",
        "views/../a.yaml",
        "views/..yaml",
        "views\\a.yaml",
        "/views/a.yaml",
        "views/a:b.yaml",
        "views/.hidden.yaml",
    ] {
        assert!(!is_path(bad), "{bad}");
    }
    assert_eq!(slug_of("views/a-b.yaml"), "a-b");
}

#[test]
fn an_edit_changes_only_its_keys() {
    let out = edit_text(
        FILE,
        &map(json!({
            "query": "tag:paper",
            "icon": null,
            "filter": [{"key": "reading", "op": "is_not", "value": "Finished"}],
            "when": {"created": "this-year"},
        })),
    )
    .unwrap();
    let want = FILE
        .replace(
            "query: \"#capture project:photo-organiser\"   # keep\n",
            "query: tag:paper   # keep\n",
        )
        .replace("icon: book\n", "")
        .replace(
            "  - {key: reading, op: is, value: Unread}",
            "  - {key: reading, op: is_not, value: Finished}",
        )
        .replace(
            "when: {updated: last-30-days}",
            "when: {created: this-year}",
        );
    assert_eq!(out, want);
    // The unknown keys and every comment are still there, byte for byte.
    for kept in [
        "# my own note about this one\n",
        "owner: bharathi   # a key this version does not know\n",
        "extra:\n  - a\n  - b\n",
    ] {
        assert!(out.contains(kept), "{kept}");
    }
    let c = read("views/reading-queue.yaml", &out, 0);
    assert_eq!(c.problem, None);
    assert_eq!(c.query, "tag:paper");
    assert_eq!(c.icon, None);
}

#[test]
fn an_edit_that_says_what_is_already_so_changes_nothing() {
    let same = map(json!({
        "when": {"updated": "last-30-days"},
        "sort": [{"key": "captured", "dir": "desc"}],
    }));
    // Not byte-equal in general, but a no-op edit of a one-line value is.
    let out = edit_text(FILE, &map(json!({"when": same["when"]}))).unwrap();
    assert_eq!(out, FILE);
    assert_eq!(edit_text(FILE, &Map::new()).unwrap(), FILE);
    assert_eq!(
        edit_text(FILE, &map(json!({"display": null, "icon": null}))).unwrap(),
        FILE.replace("icon: book\n", "").replace(
            "display: {type: table, columns: [title, site, captured, reading], limit: 500}\n",
            ""
        )
    );
}

#[test]
fn an_edit_with_a_bad_key_or_value_is_refused_whole() {
    for edits in [
        json!({"name": "Other"}),
        json!({"format": 2}),
        json!({"owner": "me"}),
        json!({"query": "x".repeat(MAX_QUERY + 1)}),
        json!({"query": 5}),
        json!({"query": "a\nb"}),
        json!({"icon": ""}),
        json!({"when": {"updated": "someday"}}),
        json!({"when": {}}),
        json!({"when": "today"}),
        json!({"filter": [{"key": "a", "op": "like", "value": "b"}]}),
        json!({"filter": {"key": "a"}}),
        json!({"filter": [{"key": "a", "op": "is"}]}),
        json!({"sort": [{"key": "a", "dir": "sideways"}]}),
        json!({"display": {"limit": 5001}}),
        // One bad edit refuses the good one beside it.
        json!({"query": "fine", "display": {"type": "pie"}}),
    ] {
        assert!(edit_text(FILE, &map(edits.clone())).is_err(), "{edits}");
    }
}

#[test]
fn filter_values_follow_the_ops_that_need_them() {
    let ok =
        |filter: serde_json::Value| edit_text("name: A\n", &map(json!({"filter": filter}))).is_ok();
    assert!(ok(json!([{"key": "due", "op": "empty"}])));
    assert!(ok(json!([{"key": "due", "op": "not_empty"}])));
    assert!(ok(json!([{"key": "n", "op": "is", "value": 3}])));
    assert!(ok(json!([{"key": "done", "op": "is", "value": true}])));
    assert!(ok(
        json!([{"key": "due", "op": "before", "value": "2026-10-01"}])
    ));
    assert!(ok(
        json!([{"key": "due", "op": "after", "value": "2026-10-01T10:00"}])
    ));
    assert!(!ok(
        json!([{"key": "due", "op": "before", "value": "2026-02-30"}])
    ));
    assert!(!ok(json!([{"key": "due", "op": "before", "value": 5}])));
    assert!(!ok(json!([{"key": "t", "op": "contains", "value": ["a"]}])));
    let many: Vec<_> = (0..=MAX_FILTERS)
        .map(|n| json!({"key": format!("k{n}"), "op": "empty"}))
        .collect();
    assert!(!ok(json!(many)));
}

#[test]
fn a_new_collection_is_written_in_a_fixed_order() {
    let text = new_text(
        "  Reading queue ",
        &map(json!({
            "display": {"type": "table", "limit": 500},
            "query": "#capture",
            "sort": [{"key": "captured", "dir": "desc"}],
            "when": {"updated": "last-7-days"},
            "icon": "book",
            "filter": [],
        })),
    )
    .unwrap();
    assert_eq!(
        text,
        "format: 1\nname: Reading queue\nicon: book\nquery: \"#capture\"\nwhen: {updated: last-7-days}\nfilter: []\nsort:\n  - {key: captured, dir: desc}\ndisplay: {type: table, limit: 500}\n"
    );
    assert_eq!(read("views/reading-queue.yaml", &text, 0).problem, None);
    assert_eq!(
        new_text("Plain", &Map::new()).unwrap(),
        "format: 1\nname: Plain\n"
    );
    assert_eq!(
        new_text("Tricky: #1 \"quoted\"", &Map::new()).unwrap(),
        "format: 1\nname: \"Tricky: #1 \\\"quoted\\\"\"\n"
    );
    for bad in ["", "   ", "a\nb"] {
        assert!(new_text(bad, &Map::new()).is_err(), "{bad:?}");
    }
    assert!(new_text(&"n".repeat(MAX_NAME + 1), &Map::new()).is_err());
    assert!(new_text(&"n".repeat(MAX_NAME), &Map::new()).is_ok());
}

#[test]
fn renaming_rewrites_only_the_name_line() {
    let out = rename_text(FILE, "Papers to read").unwrap();
    assert_eq!(
        out,
        FILE.replace("name: Reading queue\n", "name: Papers to read\n")
    );
    assert!(rename_text(FILE, " ").is_err());
}
