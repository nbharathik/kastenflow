//! The `sub_items` option of a view is a true-or-false setting, checked where
//! views are saved: by `update_tag_schema` (a whole schema) and by `set_tag_views`.

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;
use kasten_core::tags::schema_yaml;
use serde_json::{Value, json};

fn schema(view: Value) -> Value {
    json!({"properties": [{"key": "begin", "type": "date"}], "views": [view]})
}

#[test]
fn true_false_and_absent_are_accepted_for_every_kind_of_view() {
    for kind in ["table", "kanban", "list", "gallery", "calendar"] {
        for sub_items in [json!(true), json!(false), json!(null)] {
            let view = json!({"name": "V", "type": kind, "sub_items": sub_items, "extra": 1});
            let yaml = schema_yaml("task", &schema(view)).unwrap();
            assert!(yaml.contains("extra"), "{kind}: {yaml}");
        }
        let plain = json!({"name": "V", "type": kind});
        assert!(schema_yaml("task", &schema(plain)).is_ok(), "{kind}");
    }
}

#[test]
fn the_setting_is_kept_as_written() {
    let view = json!({"name": "Plan", "type": "table", "sub_items": true});
    let yaml = schema_yaml("task", &schema(view)).unwrap();
    assert!(yaml.contains("sub_items"), "{yaml}");
}

#[test]
fn anything_but_true_or_false_is_refused_with_a_sentence_naming_the_view() {
    for bad in [json!("yes"), json!(1), json!([true]), json!({"a": 1})] {
        let view = json!({"name": "Plan", "type": "table", "sub_items": bad});
        let err = schema_yaml("task", &schema(view)).unwrap_err().to_string();
        assert!(err.contains("“Plan”") && err.contains("sub_items"), "{err}");
        assert!(err.contains("true or false"), "{err}");
    }
}

#[test]
fn set_tag_views_checks_it_and_keeps_it() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let before = std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap();
    let bad = json!({"name": "All", "type": "table", "sub_items": "yes"});
    let err = k
        .set_tag_views(&Actor::Human, "task", std::slice::from_ref(&bad), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("true or false"), "{err}");
    assert_eq!(
        std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap(),
        before,
        "a refused change writes nothing"
    );

    let good = json!({"name": "All", "type": "table", "sub_items": true, "mine": [1, 2]});
    let saved = k
        .set_tag_views(&Actor::Human, "task", std::slice::from_ref(&good), NOW)
        .unwrap();
    assert_eq!(saved.views[0]["sub_items"], json!(true));
    assert_eq!(saved.views[0]["mine"], json!([1, 2]));
}
