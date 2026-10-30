//! The formula grammar: what parses, where mistakes are reported, the limits,
//! and that no text makes the parser panic.

use proptest::prelude::*;
use serde_json::json;

use super::*;

fn err(source: &str) -> FormulaError {
    Formula::parse(source).expect_err(source)
}

#[test]
fn every_function_parses_with_nesting() {
    for source in [
        "days_until(deadline)",
        "days_since(\"2026-01-01\")",
        "count(related)",
        "count_backlinks()",
        "sum(related.points)",
        "min(related.points)",
        "max(points)",
        "if_empty(venue, \"to be decided\")",
        "if_empty(days_until(deadline), 0)",
        "  days_until( deadline )  ",
        "title",
        "12.5",
        "\"say \\\"hi\\\"\"",
    ] {
        assert!(
            Formula::parse(source).is_ok(),
            "{source}: {:?}",
            Formula::parse(source)
        );
    }
}

#[test]
fn a_mistake_is_reported_at_its_position() {
    let at = |source: &str| err(source).position;
    assert_eq!(at("days_until("), 12, "value missing at the end");
    assert_eq!(at("days_until(deadline"), 20, "closing bracket missing");
    assert_eq!(at("nope(x)"), 1, "unknown function");
    assert_eq!(at("days_until(a, b)"), 15, "the extra value");
    assert_eq!(at("if_empty(a)"), 11, "a value missing");
    assert_eq!(at("count(\"x\")"), 7, "count wants a property");
    assert_eq!(at("days_until(deadline) x"), 22, "text after the end");
    assert_eq!(at("a.b"), 1, "a dotted name outside sum");
    assert_eq!(at("count(a.b)"), 7, "a dotted name in count");
    assert_eq!(at("\"abc"), 1, "text never closed");
    assert_eq!(at("1x"), 2, "a number running into letters");
    assert_eq!(at("a + b"), 3, "an operator");
    assert_eq!(at("a.b.c"), 1, "three-part name");
    assert_eq!(at("  "), 1, "empty");
    assert_eq!(at("count_backlinks(x)"), 17, "a value where none is taken");
    assert_eq!(at("if_empty(,1)"), 10, "empty argument");
    assert_eq!(at("\"a\\n\""), 3, "bad escape");
}

#[test]
fn the_message_names_the_position() {
    let shown = err("days_until(a, b)").to_string();
    assert!(shown.contains("at position 15"), "{shown}");
    assert!(shown.contains("takes 1 value"), "{shown}");
    let unknown = err("tomorrow(x)").to_string();
    for (name, _) in FUNCTIONS {
        assert!(unknown.contains(name), "{unknown}");
    }
}

fn nested(depth: usize) -> String {
    let mut s = "x".to_owned();
    for _ in 0..depth {
        s = format!("if_empty({s}, 1)");
    }
    s
}

fn tree(depth: usize) -> String {
    if depth == 0 {
        return "1".to_owned();
    }
    let inner = tree(depth - 1);
    format!("if_empty({inner},{inner})")
}

#[test]
fn nesting_and_size_are_bounded() {
    assert!(Formula::parse(&nested(MAX_DEPTH)).is_ok());
    let deep = err(&nested(MAX_DEPTH + 1));
    assert!(deep.message.contains("nested"), "{deep}");
    // The 60 parts: a tree five calls deep is 63 parts in under 400 characters.
    assert!(Formula::parse(&tree(4)).is_ok());
    let wide = err(&tree(5));
    assert!(wide.message.contains("60 parts"), "{wide}");
    // Very long text is refused before it is read.
    let long = err(&"a".repeat(1000));
    assert_eq!(long.position, 401);
    assert!(Formula::parse(&"(".repeat(100_000)).is_err());
    assert!(Formula::parse(&"if_empty(".repeat(100_000)).is_err());
}

#[test]
fn a_formula_is_checked_against_the_schema_it_belongs_to() {
    let defs: Vec<(String, String)> = [
        ("deadline", "date"),
        ("related", "relation"),
        ("points", "number"),
        ("other", "formula"),
        ("days_left", "formula"),
    ]
    .iter()
    .map(|(k, t)| ((*k).to_owned(), (*t).to_owned()))
    .collect();
    let check = |source: &str| {
        Formula::parse(source)
            .unwrap()
            .check_against("days_left", &defs)
    };
    assert!(check("days_until(deadline)").is_ok());
    assert!(check("sum(related.points)").is_ok());
    assert!(
        check("if_empty(title, \"none\")").is_ok(),
        "built-in fields"
    );
    let typo = check("days_until(deadlin)").unwrap_err();
    assert_eq!(
        (typo.position, typo.message.contains("deadlin")),
        (12, true)
    );
    assert!(
        check("sum(points.x)")
            .unwrap_err()
            .message
            .contains("not a relation")
    );
    assert!(
        check("count(other)")
            .unwrap_err()
            .message
            .contains("another formula")
    );
    assert!(
        check("count(days_left)")
            .unwrap_err()
            .message
            .contains("itself")
    );
}

#[test]
fn the_schema_list_check_names_the_property_and_the_position() {
    let good = vec![
        json!({"key": "deadline", "type": "date"}),
        json!({"key": "days_left", "type": "formula", "formula": "days_until(deadline)"}),
    ];
    assert!(check_list(&good).is_ok());
    let bad = vec![
        json!({"key": "deadline", "type": "date"}),
        json!({"key": "days_left", "type": "formula", "formula": "days_until(deadlin)"}),
    ];
    let why = check_list(&bad).unwrap_err();
    assert!(
        why.contains("days_left") && why.contains("position 12"),
        "{why}"
    );
    let none = vec![json!({"key": "x", "type": "formula"})];
    assert!(check_list(&none).unwrap_err().contains("empty"));
}

proptest! {
    #[test]
    fn random_text_never_panics(source in ".{0,600}") {
        if let Err(e) = Formula::parse(&source) {
            prop_assert!(e.position >= 1 && e.position <= source.chars().count().max(1) + 1);
        }
    }

    #[test]
    fn random_formula_like_text_never_panics(source in "[a-z_0-9.,()\" \\\\-]{0,300}") {
        let _ = Formula::parse(&source);
    }

    #[test]
    fn random_calls_never_panic(
        names in proptest::collection::vec(
            prop_oneof![
                Just("days_until"), Just("count"), Just("sum"), Just("if_empty"),
                Just("count_backlinks"), Just("x"), Just("\"t\""), Just("1"),
            ],
            0..40,
        ),
        glue in proptest::collection::vec(prop_oneof![Just("("), Just(")"), Just(","), Just("")], 0..40),
    ) {
        let mut source = String::new();
        for (i, n) in names.iter().enumerate() {
            source.push_str(n);
            source.push_str(glue.get(i).copied().unwrap_or(""));
        }
        let _ = Formula::parse(&source);
    }
}
