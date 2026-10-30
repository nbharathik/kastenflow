//! The settings of a timeline view are checked where views are saved: by
//! `update_tag_schema` (a whole schema) and by `set_tag_views`.

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;
use kasten_core::tags::schema_yaml;
use serde_json::{Value, json};

fn schema(view: Value) -> Value {
    json!({
        "properties": [
            {"key": "begin", "type": "date"},
            {"key": "finish", "type": "date"},
            {"key": "title_text", "type": "text"},
            {"key": "stage", "type": "select", "options": ["A", "B"]},
            {"key": "tags_multi", "type": "multi_select"},
            {"key": "parent", "type": "relation"}
        ],
        "views": [view]
    })
}

fn refused(view: Value) -> String {
    schema_yaml("task", &schema(view)).unwrap_err().to_string()
}

#[test]
fn a_full_timeline_is_accepted_and_written_as_given() {
    let view = json!({
        "name": "Plan", "type": "timeline", "start": "begin", "end": "finish",
        "group_by": "stage", "scale": "quarter", "sort": [{"by": "begin"}], "zoom": 3
    });
    let yaml = schema_yaml("task", &schema(view)).unwrap();
    // Keys the check does not know are kept.
    assert!(yaml.contains("sort") && yaml.contains("zoom"), "{yaml}");
}

#[test]
fn start_alone_is_enough_and_lanes_may_come_from_any_choice_property() {
    let only = json!({"name": "P", "type": "timeline", "start": "begin"});
    assert!(schema_yaml("task", &schema(only)).is_ok());
    for lane in ["stage", "tags_multi", "parent"] {
        let view = json!({"name": "P", "type": "timeline", "start": "begin", "group_by": lane});
        assert!(schema_yaml("task", &schema(view)).is_ok(), "{lane}");
    }
    for scale in ["week", "month", "quarter"] {
        let view = json!({"name": "P", "type": "timeline", "start": "begin", "scale": scale});
        assert!(schema_yaml("task", &schema(view)).is_ok(), "{scale}");
    }
}

#[test]
fn bad_settings_are_refused_with_a_sentence_naming_the_setting() {
    let err = refused(json!({"name": "P", "type": "timeline"}));
    assert!(err.contains("needs a start"), "{err}");
    let err = refused(json!({"name": "P", "type": "timeline", "start": "title_text"}));
    assert!(err.contains("start must be a date"), "{err}");
    let err = refused(json!({"name": "P", "type": "timeline", "start": "nowhere"}));
    assert!(err.contains("not a property"), "{err}");
    let err = refused(json!({"name": "P", "type": "timeline", "start": "begin", "end": "stage"}));
    assert!(err.contains("end must be a date"), "{err}");
    let err = refused(json!({"name": "P", "type": "timeline", "start": "begin", "end": "gone"}));
    assert!(err.contains("not a property"), "{err}");
    let err =
        refused(json!({"name": "P", "type": "timeline", "start": "begin", "group_by": "begin"}));
    assert!(err.contains("lanes come from"), "{err}");
    let err =
        refused(json!({"name": "P", "type": "timeline", "start": "begin", "scale": "decade"}));
    assert!(err.contains("week, month, quarter"), "{err}");
    let err = refused(json!({"name": "P", "type": "timeline", "start": "begin", "scale": 3}));
    assert!(err.contains("scale"), "{err}");
}

#[test]
fn set_tag_views_checks_a_timeline_against_the_saved_properties() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let before = std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap();
    let bad = json!({"name": "Plan", "type": "timeline", "start": "status"});
    let err = k
        .set_tag_views(&Actor::Human, "task", std::slice::from_ref(&bad), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("start must be a date"), "{err}");
    assert_eq!(
        std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap(),
        before,
        "a refused change writes nothing"
    );

    let good = json!({"name": "Plan", "type": "timeline", "start": "due", "group_by": "status", "scale": "week", "extra": true});
    let saved = k
        .set_tag_views(&Actor::Human, "task", std::slice::from_ref(&good), NOW)
        .unwrap();
    assert_eq!(saved.views[0]["extra"], json!(true));
    assert_eq!(saved.views[0]["type"], json!("timeline"));
}
