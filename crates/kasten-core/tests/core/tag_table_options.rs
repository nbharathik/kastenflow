//! The table view's grouping, calculation, sort and display settings are
//! checked where views are saved (a whole schema, and a views-only change);
//! keys the core does not know are kept as written.

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;
use kasten_core::tags::schema_yaml;
use serde_json::{Value, json};

fn schema(view: Value) -> Value {
    json!({
        "properties": [
            {"key": "status", "type": "select", "options": ["Todo", "Done"]},
            {"key": "tags2", "type": "multi_select", "options": ["a"]},
            {"key": "points", "type": "number"},
            {"key": "due", "type": "date"},
            {"key": "done", "type": "checkbox"},
            {"key": "note", "type": "text"},
            {"key": "left", "type": "formula", "formula": "points"}
        ],
        "views": [view]
    })
}

fn table(extra: Value) -> Value {
    let mut view = json!({"name": "Plan", "type": "table"});
    for (k, v) in extra.as_object().unwrap() {
        view[k] = v.clone();
    }
    view
}

fn refused(extra: Value) -> String {
    schema_yaml("task", &schema(table(extra)))
        .unwrap_err()
        .to_string()
}

#[test]
fn a_full_set_of_settings_is_accepted_and_kept_with_unknown_keys() {
    let view = table(json!({
        "group_by": "status",
        "calcs": {"points": "sum", "due": "earliest", "done": "percent_checked", "title": "count", "status": "unique", "left": "median"},
        "sort": [{"key": "status", "dir": "asc"}, {"key": "points", "dir": "desc"}],
        "wrap": true,
        "density": "compact",
        "filter_mode": "any",
        "freeze_title": false,
        "mine": {"a": 1}
    }));
    let yaml = schema_yaml("task", &schema(view)).unwrap();
    for word in [
        "group_by",
        "calcs",
        "wrap",
        "density",
        "mine",
        "percent_checked",
    ] {
        assert!(yaml.contains(word), "{word}: {yaml}");
    }
}

#[test]
fn every_groupable_type_is_accepted() {
    for key in ["status", "tags2", "done", "due", "created", "project"] {
        let view = table(json!({"group_by": key}));
        assert!(schema_yaml("task", &schema(view)).is_ok(), "{key}");
    }
    // Other kinds of view keep their own rules for the same key.
    let board = json!({"name": "B", "type": "kanban", "group_by": "anything"});
    assert!(schema_yaml("task", &schema(board)).is_ok());
}

#[test]
fn a_group_by_that_cannot_group_is_refused_in_a_sentence() {
    let err = refused(json!({"group_by": "nothing"}));
    assert!(
        err.contains("“Plan”") && err.contains("not a property"),
        "{err}"
    );
    let err = refused(json!({"group_by": "points"}));
    assert!(err.contains("number") && err.contains("select"), "{err}");
    let err = refused(json!({"group_by": 3}));
    assert!(err.contains("group_by"), "{err}");
}

#[test]
fn a_calculation_must_suit_the_column_type() {
    for (key, fun) in [
        ("note", "sum"),
        ("status", "average"),
        ("points", "percent_checked"),
        ("points", "earliest"),
        ("due", "sum"),
        ("done", "median"),
    ] {
        let err = refused(json!({"calcs": {key: fun}}));
        assert!(
            err.contains("“Plan”") && err.contains(key) && err.contains(fun),
            "{err}"
        );
    }
    for (key, fun) in [
        ("note", "count"),
        ("note", "count_empty"),
        ("points", "range"),
        ("points", "max"),
        ("due", "latest"),
        ("due", "range"),
        ("done", "count_not_empty"),
        ("status", "unique"),
        ("modified", "sum"),
    ] {
        let view = table(json!({"calcs": {key: fun}}));
        assert!(schema_yaml("task", &schema(view)).is_ok(), "{key} {fun}");
    }
}

#[test]
fn a_calculation_needs_a_known_function_and_a_known_column() {
    let err = refused(json!({"calcs": {"points": "total"}}));
    assert!(err.contains("total") && err.contains("sum"), "{err}");
    let err = refused(json!({"calcs": {"ghost": "count"}}));
    assert!(
        err.contains("ghost") && err.contains("not a property"),
        "{err}"
    );
    let err = refused(json!({"calcs": ["count"]}));
    assert!(err.contains("calcs"), "{err}");
    let err = refused(json!({"calcs": {"points": 4}}));
    assert!(err.contains("points"), "{err}");
}

#[test]
fn sort_wrap_density_and_filter_mode_are_checked() {
    assert!(refused(json!({"sort": "status"})).contains("sort"));
    assert!(refused(json!({"sort": [{"dir": "asc"}]})).contains("key"));
    assert!(refused(json!({"sort": [{"key": "status", "dir": "up"}]})).contains("asc"));
    assert!(refused(json!({"wrap": "yes"})).contains("wrap"));
    assert!(refused(json!({"density": "tiny"})).contains("compact"));
    assert!(refused(json!({"filter_mode": "some"})).contains("any"));
    assert!(refused(json!({"freeze_title": 1})).contains("freeze_title"));
    for ok in [
        json!({"wrap": null}),
        json!({"density": "comfortable"}),
        json!({"sort": []}),
    ] {
        assert!(schema_yaml("task", &schema(table(ok))).is_ok());
    }
}

#[test]
fn filter_mode_any_keeps_a_note_that_passes_one_filter() {
    use kasten_core::tag_query::apply_view;
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let notes: Vec<_> = k
        .list()
        .unwrap()
        .into_iter()
        .filter(|n| n.tags.iter().any(|t| t == "task"))
        .collect();
    let all = json!({"name": "V", "type": "table", "filter": [
        {"key": "status", "op": "is", "value": "Todo"},
        {"key": "status", "op": "is", "value": "Done"}
    ]});
    let any = json!({"name": "V", "type": "table", "filter_mode": "any", "filter": [
        {"key": "status", "op": "is", "value": "Todo"},
        {"key": "status", "op": "is", "value": "Done"}
    ]});
    let schema = k
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task");
    assert!(apply_view(notes.clone(), &all, schema.as_ref()).is_empty());
    let kept = apply_view(notes.clone(), &any, schema.as_ref());
    assert!(!kept.is_empty(), "the dev vault has Todo or Done tasks");
    assert!(kept.iter().all(|n| {
        let s = n.props.get("status").and_then(Value::as_str);
        s == Some("Todo") || s == Some("Done")
    }));
}

#[test]
fn a_view_naming_a_property_that_has_gone_does_not_block_saving_other_views() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let grouped = json!({"name": "All", "type": "table", "group_by": "status", "calcs": {"priority": "unique"}});
    k.set_tag_views(&Actor::Human, "task", std::slice::from_ref(&grouped), NOW)
        .unwrap();
    // The properties are changed on their own: no check of the views.
    let kept: Vec<Value> = k
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task")
        .unwrap()
        .properties
        .iter()
        .filter(|p| p.key != "status" && p.key != "priority")
        .map(|p| json!({"key": p.key, "type": p.kind}))
        .collect();
    k.set_tag_properties(&Actor::Human, "task", &kept, NOW)
        .unwrap();
    // Another view can be added and the stale one is saved as it was.
    let board = json!({"name": "Due", "type": "calendar", "date": "due"});
    let saved = k
        .set_tag_views(&Actor::Human, "task", &[grouped.clone(), board], NOW)
        .unwrap();
    assert_eq!(saved.views[0]["group_by"], json!("status"));
    // A change to the stale view itself is checked again.
    let mut edited = grouped;
    edited["wrap"] = json!(true);
    let err = k
        .set_tag_views(&Actor::Human, "task", &[edited], NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("status"), "{err}");
}

#[test]
fn set_tag_views_checks_them_and_a_refused_change_writes_nothing() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let before = std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap();
    let bad = json!({"name": "All", "type": "table", "calcs": {"nosuchprop": "count"}});
    let err = k
        .set_tag_views(&Actor::Human, "task", std::slice::from_ref(&bad), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("nosuchprop"), "{err}");
    assert_eq!(
        std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap(),
        before
    );
    let good = json!({"name": "All", "type": "table", "group_by": "status", "calcs": {"title": "count"}, "wrap": true, "mine": [1]});
    let saved = k
        .set_tag_views(&Actor::Human, "task", std::slice::from_ref(&good), NOW)
        .unwrap();
    assert_eq!(saved.views[0]["group_by"], json!("status"));
    assert_eq!(saved.views[0]["calcs"]["title"], json!("count"));
    assert_eq!(saved.views[0]["mine"], json!([1]));
}
