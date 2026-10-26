//! A formula that cannot be read is refused wherever a tag schema is saved,
//! with the position of the mistake, and nothing is written.

use crate::common::NOW;
use crate::formula::{days_left, open, schema_json, use_schema};

use std::fs;

use kasten_core::Outcome;
use kasten_core::agent::{AgentOp, Session};
use kasten_core::history::Actor;
use kasten_core::tags::{KINDS, schema_yaml};
use serde_json::{Value, json};

fn formula(source: &str) -> Value {
    json!([{"key": "days_left", "type": "formula", "formula": source}])
}

#[test]
fn formula_is_a_property_type() {
    assert!(KINDS.contains(&"formula"));
    assert!(schema_yaml("paper", &schema_json(days_left())).is_ok());
}

#[test]
fn a_bad_formula_is_refused_with_its_position_by_the_schema_check() {
    for (source, position) in [
        ("days_until(deadlin)", "position 12"),
        ("days_until(", "position 12"),
        ("nope(deadline)", "position 1)"),
        ("days_until(deadline, 1)", "position 22"),
        ("", "position 1)"),
    ] {
        let err = schema_yaml("paper", &schema_json(formula(source)))
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("days_left") && err.contains(position),
            "{source}: {err}"
        );
    }
    // A formula that uses another formula, or itself, is refused too.
    let both = json!([
        {"key": "a", "type": "formula", "formula": "days_until(deadline)"},
        {"key": "b", "type": "formula", "formula": "count(a)"},
    ]);
    let err = schema_yaml("paper", &schema_json(both))
        .unwrap_err()
        .to_string();
    assert!(err.contains("another formula"), "{err}");
    let missing = json!([{"key": "b", "type": "formula"}]);
    assert!(schema_yaml("paper", &schema_json(missing)).is_err());
}

#[test]
fn a_person_saving_or_editing_properties_is_held_to_it() {
    let (t, k) = open();
    let before = fs::read(t.vault.root().join("tags/paper.yaml")).unwrap();
    let err = k
        .write_tag_schema(
            &Actor::Human,
            "paper",
            &schema_json(formula("days_until(deadlin)")),
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("position 12"), "{err}");
    let props = schema_json(formula("count(related.x)"))["properties"]
        .as_array()
        .unwrap()
        .clone();
    let err = k
        .set_tag_properties(&Actor::Human, "paper", &props, NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("position 7"), "{err}");
    assert_eq!(
        fs::read(t.vault.root().join("tags/paper.yaml")).unwrap(),
        before,
        "nothing written"
    );
    // The good one goes through the properties path too, and the views stay.
    let good = schema_json(days_left())["properties"]
        .as_array()
        .unwrap()
        .clone();
    k.set_tag_properties(&Actor::Human, "paper", &good, NOW)
        .unwrap();
    let yaml = fs::read_to_string(t.vault.root().join("tags/paper.yaml")).unwrap();
    assert!(
        yaml.contains("days_until(deadline)") && yaml.contains("Deadlines"),
        "{yaml}"
    );
}

#[test]
fn an_agent_is_refused_before_anything_waits_and_a_good_one_waits() {
    let (t, k) = open();
    let s = Session::start("claude-code", NOW);
    let before = fs::read(t.vault.root().join("tags/paper.yaml")).unwrap();
    let bad = AgentOp::TagSchema {
        tag: "paper".into(),
        schema: schema_json(formula("days_until(deadlin)")),
    };
    let err = k.agent_run(&s, &bad, NOW).unwrap_err().to_string();
    assert!(err.contains("position 12"), "{err}");
    let good = AgentOp::TagSchema {
        tag: "paper".into(),
        schema: schema_json(days_left()),
    };
    let outcome = k.agent_run(&s, &good, NOW).unwrap();
    assert!(
        matches!(outcome, Outcome::PendingReview { .. }),
        "{outcome:?}"
    );
    assert_eq!(
        fs::read(t.vault.root().join("tags/paper.yaml")).unwrap(),
        before
    );
}

#[test]
fn a_formula_with_quotes_and_commas_survives_the_file() {
    let (_t, k) = open();
    let source = "if_empty(venue, \"to be, decided: \\\"soon\\\"\")";
    let schema = use_schema(&k, formula(source));
    assert_eq!(
        schema.properties.last().unwrap().formula.as_deref(),
        Some(source)
    );
    // Editing only the views leaves the properties as they were.
    k.set_tag_views(
        &Actor::Human,
        "paper",
        &[json!({"name": "All", "type": "table"})],
        NOW,
    )
    .unwrap();
    let again = k
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "paper")
        .unwrap();
    assert_eq!(again.properties, schema.properties);
}
