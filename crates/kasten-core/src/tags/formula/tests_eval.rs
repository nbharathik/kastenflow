//! Every function with its edge cases, as of a fixed day.

use std::collections::HashMap;

use serde_json::{Value, json};

use super::*;

fn note(id: &str, title: &str, props: Value) -> NoteMeta {
    NoteMeta {
        path: format!("{id}.md"),
        id: Some(id.to_owned()),
        title: title.to_owned(),
        kind: "page".to_owned(),
        icon: None,
        cover: None,
        parent: None,
        project: None,
        tags: vec!["paper".to_owned()],
        modified: 0,
        created: Some("2026-01-02".to_owned()),
        updated: None,
        excerpt: String::new(),
        words: 0,
        props,
        locked: false,
        children_order: Vec::new(),
    }
}

fn today() -> Day {
    Day::from_ymd(2026, 10, 23).unwrap()
}

/// The first note's value for `source`, with the others for relations.
fn run(source: &str, notes: &[NoteMeta]) -> Result<Value, String> {
    let mut env = Env::new(today(), notes);
    env.backlinks = Some(HashMap::from([("a.md".to_owned(), 4)]));
    Formula::parse(source).unwrap().eval(&notes[0], &env)
}

fn one(source: &str, props: Value) -> Result<Value, String> {
    run(source, &[note("a", "A", props)])
}

#[test]
fn days_are_counted_from_the_given_day_and_round_trip() {
    assert_eq!(Day::parse("1970-01-01"), Some(Day(0)));
    assert_eq!(Day::from_ymd(2026, 10, 23), Day::parse("2026-10-23"));
    for n in (-700_000..2_900_000).step_by(997) {
        let day = Day(n);
        assert_eq!(Day::parse(&day.to_string()), Some(day), "{n}");
    }
    assert!(Day::parse("2026-02-30").is_none());
    assert!(Day::parse("2028-02-29").is_some());
    assert!(Day::parse("2027-02-29").is_none());
    assert!(Day::parse("2026-13-01").is_none());
    assert!(Day::parse("2026-1-01").is_none());
    assert!(Day::parse("26-10-2026").is_none());
    assert!(Day::parse("2026-10-23x").is_none());
    assert!(Day::parse("2026-10-23T09:00").is_some());
    assert!(Day::parse("é026-10-23").is_none());
}

#[test]
fn days_until_and_days_since() {
    let due = |d: &str| json!({ "deadline": d });
    assert_eq!(
        one("days_until(deadline)", due("2026-11-02")),
        Ok(json!(10))
    );
    assert_eq!(
        one("days_until(deadline)", due("2026-10-20")),
        Ok(json!(-3))
    );
    assert_eq!(one("days_until(deadline)", due("2026-10-23")), Ok(json!(0)));
    assert_eq!(
        one("days_until(deadline)", due("2026-10-25T10:00")),
        Ok(json!(2))
    );
    assert_eq!(one("days_since(deadline)", due("2026-10-20")), Ok(json!(3)));
    assert_eq!(
        one("days_since(deadline)", due("2026-10-30")),
        Ok(json!(-7))
    );
    assert_eq!(one("days_until(\"2026-10-24\")", json!({})), Ok(json!(1)));
    assert_eq!(one("days_until(created)", json!({})), Ok(json!(-294)));
    // Across a leap day.
    assert_eq!(
        one("days_until(deadline)", due("2027-10-23")),
        Ok(json!(365))
    );
    assert_eq!(
        one("days_until(deadline)", due("2028-10-23")),
        Ok(json!(731))
    );
}

#[test]
fn a_missing_date_is_empty_and_a_wrong_one_is_a_problem() {
    for props in [
        json!({}),
        json!({"deadline": null}),
        json!({"deadline": ""}),
        json!({"deadline": "  "}),
    ] {
        assert_eq!(
            one("days_until(deadline)", props.clone()),
            Ok(Value::Null),
            "{props}"
        );
        assert_eq!(one("days_since(deadline)", props), Ok(Value::Null));
    }
    let soon = one("days_until(deadline)", json!({"deadline": "soon"})).unwrap_err();
    assert!(
        soon.contains("soon") && soon.contains("YYYY-MM-DD"),
        "{soon}"
    );
    assert!(one("days_until(deadline)", json!({"deadline": "2026-02-30"})).is_err());
    assert!(
        one("days_until(deadline)", json!({"deadline": 5}))
            .unwrap_err()
            .contains("needs a date")
    );
    assert!(one("days_until(deadline)", json!({"deadline": ["2026-10-24"]})).is_err());
    assert!(one("days_until(deadline)", json!({"deadline": true})).is_err());
}

#[test]
fn count_counts_lists_and_nothing() {
    assert_eq!(
        one("count(related)", json!({"related": ["x", "y", "z"]})),
        Ok(json!(3))
    );
    assert_eq!(one("count(related)", json!({"related": []})), Ok(json!(0)));
    assert_eq!(one("count(related)", json!({})), Ok(json!(0)));
    assert_eq!(
        one("count(related)", json!({"related": null})),
        Ok(json!(0))
    );
    assert_eq!(one("count(related)", json!({"related": ""})), Ok(json!(0)));
    assert_eq!(
        one("count(coauthors)", json!({"coauthors": "Ada"})),
        Ok(json!(1))
    );
    assert!(one("count(coauthors)", json!({"coauthors": {"a": 1}})).is_err());
}

#[test]
fn count_backlinks_needs_the_counts_and_gives_zero_for_no_links() {
    assert_eq!(one("count_backlinks()", json!({})), Ok(json!(4)));
    let other = vec![note("b", "B", json!({}))];
    assert_eq!(run("count_backlinks()", &other), Ok(json!(0)));
    let notes = [note("a", "A", json!({}))];
    let env = Env::new(today(), &notes);
    let why = Formula::parse("count_backlinks()")
        .unwrap()
        .eval(&notes[0], &env)
        .unwrap_err();
    assert!(why.contains("backlinks"), "{why}");
    assert!(
        Formula::parse("if_empty(title, count_backlinks())")
            .unwrap()
            .uses_backlinks()
    );
    assert!(!Formula::parse("count(related)").unwrap().uses_backlinks());
}

fn family(related: Value) -> Vec<NoteMeta> {
    vec![
        note("a", "A", json!({ "related": related })),
        note("p", "P", json!({"points": 3})),
        note("q", "Q", json!({"points": 4.5})),
        note("r", "R", json!({"points": "5"})),
        note("s", "S", json!({"points": "many"})),
        note("t", "T", json!({})),
        note("u", "U", json!({"points": -2})),
    ]
}

#[test]
fn sum_min_and_max_follow_a_relation_to_a_number() {
    let all = family(json!(["p", "q", "r"]));
    assert_eq!(run("sum(related.points)", &all), Ok(json!(12.5)));
    assert_eq!(run("min(related.points)", &all), Ok(json!(3)));
    assert_eq!(run("max(related.points)", &all), Ok(json!(5)));
    // Mixed types: text that is no number, a note without the property, an
    // id no note has and null are left out.
    let mixed = family(json!(["p", "s", "t", "ghost", null, "u"]));
    assert_eq!(run("sum(related.points)", &mixed), Ok(json!(1)));
    assert_eq!(run("min(related.points)", &mixed), Ok(json!(-2)));
    assert_eq!(run("max(related.points)", &mixed), Ok(json!(3)));
    // Built-in fields of the related notes can be summed too.
    assert_eq!(run("min(related.modified)", &all), Ok(json!(0)));
}

#[test]
fn an_empty_or_missing_relation_sums_to_nothing() {
    for related in [json!([]), json!(null), json!("ghost")] {
        let all = family(related);
        assert_eq!(run("sum(related.points)", &all), Ok(json!(0)));
        assert_eq!(run("min(related.points)", &all), Ok(Value::Null));
        assert_eq!(run("max(related.points)", &all), Ok(Value::Null));
    }
    assert_eq!(one("sum(related.points)", json!({})), Ok(json!(0)));
    // One related id given as plain text.
    assert_eq!(
        run("sum(related.points)", &family(json!("p"))),
        Ok(json!(3))
    );
}

#[test]
fn a_list_of_numbers_on_the_note_itself_can_be_summed() {
    assert_eq!(
        one("sum(scores)", json!({"scores": [1, 2, "3", "x"]})),
        Ok(json!(6))
    );
    assert_eq!(one("max(scores)", json!({"scores": 7})), Ok(json!(7)));
    assert_eq!(one("min(scores)", json!({})), Ok(Value::Null));
}

#[test]
fn if_empty_takes_the_other_value_for_anything_blank() {
    let said = |props: Value| one("if_empty(venue, \"to be decided\")", props);
    for blank in [
        json!({}),
        json!({"venue": null}),
        json!({"venue": ""}),
        json!({"venue": "  "}),
        json!({"venue": []}),
    ] {
        assert_eq!(said(blank), Ok(json!("to be decided")));
    }
    assert_eq!(said(json!({"venue": "CHI"})), Ok(json!("CHI")));
    // Zero and false are values.
    assert_eq!(one("if_empty(pages, 9)", json!({"pages": 0})), Ok(json!(0)));
    assert_eq!(
        one("if_empty(done, 9)", json!({"done": false})),
        Ok(json!(false))
    );
    assert_eq!(
        one("if_empty(days_until(deadline), \"no date\")", json!({})),
        Ok(json!("no date"))
    );
    assert_eq!(
        one(
            "if_empty(days_until(deadline), \"no date\")",
            json!({"deadline": "2026-10-24"})
        ),
        Ok(json!(1))
    );
    // A problem in the first value is not hidden by the second.
    assert!(
        one(
            "if_empty(days_until(deadline), 0)",
            json!({"deadline": "soon"})
        )
        .is_err()
    );
    assert_eq!(one("if_empty(title, \"x\")", json!({})), Ok(json!("A")));
}

#[test]
fn the_same_input_gives_the_same_answer_and_the_day_is_the_only_clock() {
    let notes = [note("a", "A", json!({"deadline": "2026-11-02"}))];
    let formula = Formula::parse("days_until(deadline)").unwrap();
    let env = Env::new(today(), &notes);
    assert_eq!(formula.eval(&notes[0], &env), formula.eval(&notes[0], &env));
    let later = Env::new(Day(today().0 + 5), &notes);
    assert_eq!(formula.eval(&notes[0], &later), Ok(json!(5)));
}

#[test]
fn a_whole_number_comes_out_as_an_integer() {
    assert_eq!(
        one("sum(scores)", json!({"scores": [1.5, 1.5]})),
        Ok(json!(3))
    );
    assert_eq!(
        one("sum(scores)", json!({"scores": [0.1, 0.2]})),
        Ok(json!(0.30000000000000004))
    );
    assert!(
        one("sum(scores)", json!({"scores": [1e308, 1e308]})).is_err(),
        "infinity is a problem"
    );
}
