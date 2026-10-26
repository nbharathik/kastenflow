//! Formula properties through `query_tag`: the value is in the row, can be
//! sorted and filtered by, a bad cell says why, and the files stay as they
//! were. Also the tool texts that tell an agent about formulas.

mod common;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::history::Actor;
use kasten_core::tags::VIEW_KINDS;
use kasten_core::tags::formula::Day;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Map, Value, json};

const REPORT: &str = "projects/note-taking-study/pages/report-draft.md";
const ROADMAP: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    k.start_history().unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn in_days(n: i64) -> String {
    let today = Day::parse(&Instant::now().rfc3339()[..10]).unwrap();
    Day(today.0 + n).to_string()
}

fn deadline(k: &Kasten, path: &str, day: &str) {
    let changes: Map<String, Value> = json!({ "deadline": day }).as_object().unwrap().clone();
    k.update_props(&Actor::Human, path, &changes, Instant::now())
        .unwrap();
}

fn schema(k: &Kasten) {
    let schema = json!({
        "color": "blue",
        "properties": [
            {"key": "deadline", "type": "date"},
            {"key": "days_left", "type": "formula", "formula": "days_until(deadline)"},
        ],
        "views": [{"name": "Soon", "type": "table", "sort": [{"key": "days_left", "dir": "asc"}]}],
    });
    k.write_tag_schema(&Actor::Human, "paper", &schema, Instant::now())
        .unwrap();
}

fn titled<'a>(rows: &'a [Value], title: &str) -> &'a Value {
    rows.iter().find(|r| r["title"] == title).unwrap()
}

#[test]
fn query_tag_shows_the_value_sorts_and_filters_by_it() {
    let (v, k, s) = open();
    schema(&k);
    deadline(&k, REPORT, &in_days(30));
    deadline(&k, ROADMAP, &in_days(-2));
    let before = std::fs::read(v.0.join(REPORT)).unwrap();
    let told = call(&k, &s, "query_tag", json!({"tag": "paper"})).unwrap();
    let rows = told["rows"].as_array().unwrap();
    assert_eq!(
        titled(rows, "Report draft: How people find old notes")["props"]["days_left"],
        30
    );
    assert_eq!(
        titled(rows, "Photo organiser roadmap")["props"]["days_left"],
        -2
    );
    assert!(told["schema"]["properties"][1]["formula"] == "days_until(deadline)");
    // Sorted by the formula, the latest first, then by the saved view.
    let desc = call(
        &k,
        &s,
        "query_tag",
        json!({"tag": "paper", "sort": "-days_left"}),
    )
    .unwrap();
    assert_eq!(desc["rows"][0]["props"]["days_left"], 30);
    let view = call(&k, &s, "query_tag", json!({"tag": "paper", "view": "Soon"})).unwrap();
    let days: Vec<i64> = view["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["props"]["days_left"].as_i64())
        .collect();
    assert!(
        days.contains(&-2) && days.windows(2).all(|w| w[0] <= w[1]),
        "{days:?}"
    );
    // Filtered by it.
    let only = call(
        &k,
        &s,
        "query_tag",
        json!({"tag": "paper", "filter": {"days_left": 30}}),
    )
    .unwrap();
    assert_eq!(only["total"], 1, "{only}");
    // Reading changed no file.
    assert_eq!(std::fs::read(v.0.join(REPORT)).unwrap(), before);
    assert!(!String::from_utf8(before).unwrap().contains("days_left"));
}

#[test]
fn a_bad_cell_is_empty_and_says_why_without_hiding_the_row() {
    let (v, k, s) = open();
    schema(&k);
    std::fs::write(
        v.0.join("projects/note-taking-study/pages/odd.md"),
        "---\ntitle: Odd paper\ntags: [paper]\nprops:\n  deadline: soon\n---\nbody\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let told = call(&k, &s, "query_tag", json!({"tag": "paper"})).unwrap();
    let rows = told["rows"].as_array().unwrap();
    let odd = titled(rows, "Odd paper");
    assert_eq!(odd["props"]["days_left"], Value::Null);
    assert!(
        odd["problems"]["days_left"]
            .as_str()
            .unwrap()
            .contains("soon"),
        "{odd}"
    );
    // Rows that work say nothing of problems.
    let fine = titled(rows, "Report draft: How people find old notes");
    assert!(fine.get("problems").is_none(), "{fine}");
}

#[test]
fn the_tool_texts_tell_agents_about_formulas_and_name_every_view_type() {
    let all = specs();
    let text = |name: &str| {
        all.iter()
            .find(|t| t.name == name)
            .unwrap()
            .description
            .clone()
    };
    assert!(text("update_tag_schema").contains("formula"));
    assert!(text("update_tag_schema").contains("days_until"));
    assert!(text("set_tag_views").contains("formula"));
    assert!(text("query_tag").contains("Formula"));
    // The view types in the text are the ones the core knows.
    for kind in VIEW_KINDS {
        assert!(
            text("set_tag_views").contains(kind),
            "set_tag_views does not name {kind}"
        );
    }
    let schema_doc = all
        .iter()
        .find(|t| t.name == "update_tag_schema")
        .unwrap()
        .input_schema
        .to_string();
    assert!(schema_doc.contains("formula"), "{schema_doc}");
    for bad in ["commit", "sidecar", "frontmatter", "AgentOp"] {
        assert!(!text("update_tag_schema").contains(bad));
    }
}
