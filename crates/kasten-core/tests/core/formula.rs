//! Formula properties on the rows of a tag database: values as of a given
//! day, sort and filter by a formula, relations and backlinks, a bad cell
//! that never hides its row, and files that stay as they were.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::NoteMeta;
use kasten_core::history::Actor;
use kasten_core::tag_query::apply_view;
use kasten_core::tags::formula::{Day, Problems};
use kasten_core::tags::{TagSchema, load_schemas};
use serde_json::{Map, Value, json};

const REPORT: &str = "projects/note-taking-study/pages/report-draft.md";
const ROADMAP: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";
const CARD: &str = "projects/photo-organiser/cards/duplicate-score-for-photos.md";
const ODD: &str = "projects/note-taking-study/pages/odd-paper.md";

pub fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

pub fn today() -> Day {
    Day::from_ymd(2026, 10, 23).unwrap()
}

pub fn schema_json(formulas: Value) -> Value {
    let mut properties = vec![
        json!({"key": "status", "type": "select", "options": ["Idea", "Drafting", "Submitted"]}),
        json!({"key": "venue", "type": "text"}),
        json!({"key": "deadline", "type": "date"}),
        json!({"key": "pages", "type": "number"}),
        json!({"key": "related", "type": "relation"}),
    ];
    properties.extend(formulas.as_array().unwrap().iter().cloned());
    json!({"color": "blue", "properties": properties,
        "views": [{"name": "All", "type": "table"}]})
}

pub fn days_left() -> Value {
    json!([{"key": "days_left", "type": "formula", "formula": "days_until(deadline)"}])
}

pub fn use_schema(k: &Kasten, formulas: Value) -> TagSchema {
    k.write_tag_schema(&Actor::Human, "paper", &schema_json(formulas), NOW)
        .unwrap();
    k.tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "paper")
        .unwrap()
}

/// The notes tagged paper with their formulas filled, and the problems.
pub fn rows(k: &Kasten, schema: &TagSchema) -> (Vec<NoteMeta>, Problems) {
    let all = k.list().unwrap();
    let mut rows: Vec<NoteMeta> = all
        .iter()
        .filter(|n| n.tags.iter().any(|t| t == "paper") && n.kind != "template")
        .cloned()
        .collect();
    let problems = k.fill_formulas(schema, &mut rows, &all, today()).unwrap();
    (rows, problems)
}

pub fn row<'a>(rows: &'a [NoteMeta], path: &str) -> &'a NoteMeta {
    rows.iter().find(|n| n.path == path).unwrap()
}

fn set(k: &Kasten, path: &str, changes: Value) {
    let map: Map<String, Value> = changes.as_object().unwrap().clone();
    k.update_props(&Actor::Human, path, &map, NOW).unwrap();
}

#[test]
fn days_until_deadline_is_right_in_a_row() {
    let (_t, k) = open();
    let schema = use_schema(&k, days_left());
    assert_eq!(
        schema.properties.last().unwrap().formula.as_deref(),
        Some("days_until(deadline)")
    );
    let (rows, problems) = rows(&k, &schema);
    assert_eq!(row(&rows, REPORT).props["days_left"], json!(39));
    assert_eq!(row(&rows, ROADMAP).props["days_left"], json!(-8));
    assert_eq!(row(&rows, CARD).props["days_left"], json!(-8));
    assert!(problems.is_empty(), "{problems:?}");
}

#[test]
fn reading_rows_writes_nothing() {
    let (t, k) = open();
    let schema = use_schema(&k, days_left());
    let read = |p: &str| fs::read(t.vault.root().join(p)).unwrap();
    let before: Vec<Vec<u8>> = [REPORT, ROADMAP, CARD, "tags/paper.yaml"]
        .map(read)
        .to_vec();
    let commits = k.log(None, 50).unwrap().len();
    let (filled, _) = rows(&k, &schema);
    assert!(filled.iter().any(|n| n.props.get("days_left").is_some()));
    let after: Vec<Vec<u8>> = [REPORT, ROADMAP, CARD, "tags/paper.yaml"]
        .map(read)
        .to_vec();
    assert_eq!(before, after, "file bytes are unchanged");
    assert_eq!(k.log(None, 50).unwrap().len(), commits, "no commit");
    // The index and the next read of the notes do not know the value either.
    for n in k.list().unwrap() {
        assert!(n.props.get("days_left").is_none(), "{}", n.path);
    }
    let text = String::from_utf8(read(REPORT)).unwrap();
    assert!(!text.contains("days_left"));
    // The formula is kept as written in the tag's file.
    let yaml = String::from_utf8(read("tags/paper.yaml")).unwrap();
    assert!(yaml.contains("days_until(deadline)"), "{yaml}");
    assert_eq!(
        load_schemas(&t.vault)
            .unwrap()
            .iter()
            .find(|s| s.name == "paper")
            .unwrap(),
        &schema
    );
}

#[test]
fn a_view_sorts_and_filters_by_a_formula_column() {
    let (_t, k) = open();
    let schema = use_schema(&k, days_left());
    let (filled, _) = rows(&k, &schema);
    let paths = |v: &Value| -> Vec<String> {
        apply_view(filled.clone(), v, Some(&schema))
            .into_iter()
            .map(|n| n.path)
            .collect()
    };
    let desc = paths(&json!({"sort": [{"key": "days_left", "dir": "desc"}]}));
    assert_eq!(desc[0], REPORT, "the furthest deadline first: {desc:?}");
    let asc = paths(&json!({"sort": [{"key": "days_left", "dir": "asc"}]}));
    let at = |p: &str| asc.iter().position(|x| x == p).unwrap();
    assert!(at(ROADMAP) < at(REPORT) && at(CARD) < at(REPORT), "{asc:?}");
    // Notes without a deadline have no value and sort last, both ways.
    for order in ["asc", "desc"] {
        let sorted = paths(&json!({"sort": [{"key": "days_left", "dir": order}]}));
        let has = |p: &String| {
            filled
                .iter()
                .any(|n| &n.path == p && n.props["days_left"] != Value::Null)
        };
        let last_with = sorted.iter().rposition(has).unwrap();
        let first_without = sorted.iter().position(|p| !has(p));
        if let Some(first_without) = first_without {
            assert!(last_with < first_without, "{order}: {sorted:?}");
        }
    }
    let late = paths(&json!({"filter": [{"key": "days_left", "op": "lt", "value": 0}]}));
    assert_eq!(late.len(), 2, "{late:?}");
    assert!(late.contains(&ROADMAP.to_owned()) && late.contains(&CARD.to_owned()));
    assert_eq!(
        paths(&json!({"filter": [{"key": "days_left", "op": "gt", "value": 0}]})),
        [REPORT]
    );
    assert_eq!(
        paths(&json!({"filter": [{"key": "days_left", "op": "gte", "value": 39}]})),
        [REPORT]
    );
    assert_eq!(
        paths(&json!({"filter": [{"key": "days_left", "op": "lte", "value": -8}]})).len(),
        2
    );
    assert_eq!(
        paths(&json!({"filter": [{"key": "days_left", "op": "is", "value": 39}]})),
        [REPORT]
    );
    assert_eq!(
        paths(&json!({"filter": [{"key": "days_left", "op": "is", "value": "39"}]})),
        [REPORT]
    );
    let empty = paths(&json!({"filter": [{"key": "days_left", "op": "empty"}]}));
    assert!(!empty.contains(&REPORT.to_owned()));
    // Numbers sort as numbers, not as text: -8 comes before 39 and 9 before 10.
    let nine = rows_with_days(&filled, &[9, 10, -3]);
    let sorted = apply_view(
        nine,
        &json!({"sort": [{"key": "days_left", "dir": "asc"}]}),
        Some(&schema),
    );
    let order: Vec<Value> = sorted
        .iter()
        .map(|n| n.props["days_left"].clone())
        .collect();
    assert_eq!(order, [json!(-3), json!(9), json!(10)]);
}

fn rows_with_days(from: &[NoteMeta], days: &[i64]) -> Vec<NoteMeta> {
    days.iter()
        .enumerate()
        .map(|(i, d)| {
            let mut n = from[0].clone();
            n.path = format!("x{i}.md");
            n.props = json!({ "days_left": d });
            n
        })
        .collect()
}

#[test]
fn a_bad_cell_is_empty_with_a_problem_and_never_hides_its_row() {
    let (t, k) = open();
    let schema = use_schema(&k, days_left());
    fs::write(
        t.vault.root().join(ODD),
        "---\ntitle: Odd paper\ntags: [paper]\nprops:\n  deadline: soon\n---\nbody\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let (filled, problems) = rows(&k, &schema);
    let odd = row(&filled, ODD);
    assert_eq!(odd.props["days_left"], Value::Null);
    let why = &problems[ODD]["days_left"];
    assert!(why.contains("soon") && why.contains("YYYY-MM-DD"), "{why}");
    assert_eq!(
        problems.len(),
        1,
        "no other row has a problem: {problems:?}"
    );
    assert_eq!(row(&filled, REPORT).props["days_left"], json!(39));
    // A formula nobody can read (written by hand) gives a problem in each cell.
    fs::write(
        t.vault.root().join("tags/paper.yaml"),
        "name: paper\nproperties:\n  - {key: deadline, type: date}\n  - {key: broken, type: formula, formula: \"days_until(\"}\n",
    )
    .unwrap();
    let schema = load_schemas(&t.vault)
        .unwrap()
        .into_iter()
        .find(|s| s.name == "paper")
        .unwrap();
    let (filled, problems) = rows(&k, &schema);
    assert_eq!(filled.len(), problems.len());
    let any = problems.values().next().unwrap();
    assert!(any["broken"].contains("position 12"), "{any:?}");
    assert!(filled.iter().all(|n| n.props["broken"] == Value::Null));
}

#[test]
fn relations_and_backlinks_are_followed() {
    let (t, k) = open();
    let formulas = json!([
        {"key": "n_related", "type": "formula", "formula": "count(related)"},
        {"key": "total_pages", "type": "formula", "formula": "sum(related.pages)"},
        {"key": "longest", "type": "formula", "formula": "max(related.pages)"},
        {"key": "shortest", "type": "formula", "formula": "min(related.pages)"},
        {"key": "links", "type": "formula", "formula": "count_backlinks()"},
        {"key": "where", "type": "formula", "formula": "if_empty(venue, \"to be decided\")"},
    ]);
    let schema = use_schema(&k, formulas);
    set(&k, ROADMAP, json!({"pages": 10}));
    set(&k, CARD, json!({"pages": 5}));
    set(
        &k,
        REPORT,
        json!({"related": ["Photo organiser roadmap", "Duplicate score for photos"]}),
    );
    fs::write(
        t.vault.root().join("projects/note-taking-study/pages/linker.md"),
        "---\ntitle: Linker\n---\nSee [[Report draft: How people find old notes]] and again [[Report draft: How people find old notes]].\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let (filled, problems) = rows(&k, &schema);
    assert!(problems.is_empty(), "{problems:?}");
    let report = &row(&filled, REPORT).props;
    assert_eq!(report["n_related"], json!(2));
    assert_eq!(report["total_pages"], json!(15));
    assert_eq!(report["longest"], json!(10));
    assert_eq!(report["shortest"], json!(5));
    assert_eq!(report["links"], json!(k.backlinks(REPORT).unwrap().len()));
    assert!(report["links"].as_u64().unwrap() >= 1);
    assert_eq!(report["where"], json!("to be decided"), "an empty venue");
    // A note with no relations: zero, zero, nothing.
    let card = &row(&filled, CARD).props;
    assert_eq!(
        (card["n_related"].clone(), card["total_pages"].clone()),
        (json!(0), json!(0))
    );
    assert_eq!(card["longest"], Value::Null);
}

#[test]
fn a_formula_value_cannot_be_typed_into_a_note() {
    let (_t, k) = open();
    use_schema(&k, days_left());
    let changes = json!({"days_left": 3}).as_object().unwrap().clone();
    let err = k
        .update_props(&Actor::Human, REPORT, &changes, NOW)
        .unwrap_err();
    assert!(err.to_string().contains("formula"), "{err}");
}
