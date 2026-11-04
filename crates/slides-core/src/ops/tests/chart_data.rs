//! What `set_chart_data` does to a chart: the numbers and the looks set in one step (one undo), with every mistake naming
//! its field. The tool itself is tried in `agent/tests/more_tools.rs`.

use serde_json::{Value, json};

use super::{add, bytes, element, engine};
use crate::model::{ChartEl, ChartKind, ChartMark, ChartShape, Element, LegendOrient};
use crate::ops::Engine;
use crate::ops::chart_data::{ChartInput, operations};

fn with_chart(extra: Value) -> (Engine, String) {
    let mut e = engine();
    let slide = add(&mut e, "title-only", json!({ "title": "T" }));
    let mut chart = json!({
        "type": "chart", "id": "chart-1", "x": 40, "y": 140, "w": 600, "h": 340, "kind": "bar",
        "categories": ["A", "B"], "series": [{ "name": "S", "values": [1, 2] }]
    });
    if let (Value::Object(target), Value::Object(more)) = (&mut chart, extra) {
        target.extend(more);
    }
    e.apply(
        "add_elements",
        json!({ "slide": slide, "elements": [chart] }),
    )
    .unwrap();
    (e, slide)
}

fn chart<'a>(e: &'a Engine, slide: &str) -> &'a ChartEl {
    match element(e, slide, "chart-1") {
        Element::Chart(c) => c,
        other => panic!("a {}", other.kind()),
    }
}

/// What the tool does: reads the call, works out the chart, and changes the element by `patch_elements` operations that
/// are one step.
fn set(e: &mut Engine, slide: &str, input: Value) -> crate::error::Result<Value> {
    let parsed = ChartInput::read(&input)?;
    let (changed, told) = parsed.apply(chart(e, slide))?;
    e.apply_batch(operations(slide, "chart-1", &changed))?;
    Ok(serde_json::to_value(told).unwrap())
}

/// Why a call is refused; the deck is as it was.
fn refused(e: &mut Engine, slide: &str, input: Value) -> String {
    let before = bytes(e.deck());
    let error = set(e, slide, input).expect_err("should be refused");
    assert_eq!(bytes(e.deck()), before, "a refused change changes nothing");
    error.to_string()
}

#[test]
fn csv_text_fills_a_chart_and_the_kind_and_looks_are_set_in_the_same_step_that_one_undo_takes_back()
{
    let (mut e, slide) = with_chart(json!({}));
    let before = bytes(e.deck());
    let out = set(
        &mut e,
        &slide,
        json!({
            "csv": "Quarter,2025,2026\nQ1,10,12\nQ2,20,22", "kind": "stackedColumn", "title": "Sales",
            "xTitle": "Quarter", "yTitle": "Units", "format": "#,##0", "labels": true, "legendPosition": "right"
        }),
    )
    .unwrap();
    assert_eq!(out["kind"], "stackedColumn");
    assert_eq!(out["series"], json!(["2025", "2026"]));
    assert_eq!(out["categories"], 2);
    let c = chart(&e, &slide);
    assert_eq!(c.categories, ["Q1", "Q2"]);
    assert_eq!(c.series[1].values, [12.0, 22.0]);
    assert_eq!(
        (c.shape(), c.kind.clone()),
        (ChartShape::StackedColumns, ChartKind::Bar)
    );
    assert_eq!(
        (c.title.as_deref(), c.x_title(), c.y_title()),
        (Some("Sales"), Some("Quarter"), Some("Units"))
    );
    assert!(c.labels);
    assert_eq!(c.legend_orient(), Some(&LegendOrient::Right));
    assert_eq!(c.number_format().unwrap().apply(1234.0), "1,234");
    let after = bytes(e.deck());
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before, "one undo takes it all back");
    e.redo().unwrap();
    assert_eq!(bytes(e.deck()), after);
}

#[test]
fn rows_and_series_give_the_same_table_and_the_charts_categories_are_kept_when_they_fit() {
    let (mut e, slide) = with_chart(json!({}));
    set(
        &mut e,
        &slide,
        json!({ "rows": [["", "Sales"], ["Q1", 4.5], ["Q2", "7"]] }),
    )
    .unwrap();
    let c = chart(&e, &slide);
    assert_eq!(c.categories, ["Q1", "Q2"]);
    assert_eq!(c.series[0].values, [4.5, 7.0]);
    set(
        &mut e,
        &slide,
        json!({ "series": [{ "name": "New", "values": [3, 4], "color": "accent4" }, { "name": "Old", "values": [1, 1] }] }),
    )
    .unwrap();
    let c = chart(&e, &slide);
    assert_eq!(
        c.categories,
        ["Q1", "Q2"],
        "the categories fit, so they stay"
    );
    assert_eq!(
        (c.series.len(), c.series[0].color.as_deref()),
        (2, Some("accent4"))
    );
    set(
        &mut e,
        &slide,
        json!({ "categories": ["x", "y", "z"], "series": [{ "name": "S", "values": [1, 2, 3] }] }),
    )
    .unwrap();
    assert_eq!(chart(&e, &slide).categories, ["x", "y", "z"]);
}

#[test]
fn every_mistake_names_its_field_and_changes_nothing() {
    let (mut e, slide) = with_chart(json!({}));
    for (input, why) in [
        (
            json!({ "kind": "waterfall" }),
            "`kind` is one of column, stackedColumn",
        ),
        (json!({ "colour": "red" }), "`colour` is not a field"),
        (json!({ "labels": "yes" }), "`labels` must be true or false"),
        (json!({ "rows": "a,b" }), "`rows` must be a list"),
        (
            json!({ "csv": "a,b\n1,2", "series": [] }),
            "give the numbers once",
        ),
        (
            json!({ "categories": ["a"] }),
            "`categories` goes with `series`",
        ),
        (json!({ "csv": "Q,Sales\nQ1,ten" }), "`csv` row 2, column"),
        (json!({ "csv": "Q,Sales" }), "`csv` needs a header row"),
        (
            json!({ "series": [{ "name": "S", "values": [1, 2, 3] }], "categories": ["a", "b"] }),
            "`series[0].values` has 3 numbers",
        ),
        (
            json!({ "format": "no digits" }),
            "`format` needs a place for the digits",
        ),
        (json!({ "legendPosition": "middle" }), "`legendPosition`"),
        (json!({ "lines": ["S"] }), "`lines` is for a combo chart"),
        (
            json!({ "innerRadius": 0.5 }),
            "`innerRadius` is for a doughnut",
        ),
        (json!({ "kind": "combo" }), "needs at least two series"),
    ] {
        let message = refused(&mut e, &slide, input.clone());
        assert!(message.contains(why), "{input}: {message}");
        assert!(message.contains("set_chart_data"), "{message}");
    }
    let many: String = std::iter::once("Q,S".to_owned())
        .chain((0..41).map(|i| format!("c{i},{i}")))
        .collect::<Vec<_>>()
        .join("\n");
    let message = refused(&mut e, &slide, json!({ "csv": many }));
    assert!(
        message.contains("41 categories but a chart draws at most 40"),
        "{message}"
    );
    let wide = format!(
        "Q,{}\nA,{}",
        (0..13)
            .map(|i| format!("s{i}"))
            .collect::<Vec<_>>()
            .join(","),
        vec!["1"; 13].join(",")
    );
    assert!(refused(&mut e, &slide, json!({ "csv": wide })).contains("13 series"));
}

#[test]
fn a_combination_draws_the_series_lines_names_as_lines_and_the_rest_as_columns() {
    let (mut e, slide) = with_chart(json!({}));
    let csv = "Q,Sales,Cost,Margin\nQ1,10,6,4\nQ2,12,7,5";
    let out = set(
        &mut e,
        &slide,
        json!({ "csv": csv, "kind": "combo", "lines": ["margin"] }),
    )
    .unwrap();
    assert_eq!(out["kind"], "combo");
    let marks = |e: &Engine| -> Vec<Option<ChartMark>> {
        chart(e, &slide)
            .series
            .iter()
            .map(|s| s.mark.clone())
            .collect()
    };
    assert_eq!(
        marks(&e),
        [
            Some(ChartMark::Bar),
            Some(ChartMark::Bar),
            Some(ChartMark::Line)
        ]
    );
    assert_eq!(chart(&e, &slide).shape(), ChartShape::Combo);
    // New numbers under the same names keep what each series was.
    set(&mut e, &slide, json!({ "csv": csv })).unwrap();
    assert_eq!(
        marks(&e),
        [
            Some(ChartMark::Bar),
            Some(ChartMark::Bar),
            Some(ChartMark::Line)
        ]
    );
    // Without `lines` and with new names, the first is columns and the others are lines.
    set(
        &mut e,
        &slide,
        json!({ "csv": "Q,A,B,C\nQ1,1,2,3\nQ2,4,5,6", "kind": "combo" }),
    )
    .unwrap();
    assert_eq!(
        marks(&e),
        [
            Some(ChartMark::Bar),
            Some(ChartMark::Line),
            Some(ChartMark::Line)
        ]
    );
    // A name that is not a series says which are.
    let message = refused(
        &mut e,
        &slide,
        json!({ "kind": "combo", "lines": ["nope"] }),
    );
    assert!(
        message.contains("`lines` names `nope`") && message.contains("The series are: A, B, C"),
        "{message}"
    );
    let message = refused(
        &mut e,
        &slide,
        json!({ "kind": "combo", "lines": ["a", "b", "c"] }),
    );
    assert!(
        message.contains("at least one series drawn as columns"),
        "{message}"
    );
    // Back to plain columns: the marks go.
    set(&mut e, &slide, json!({ "kind": "column" })).unwrap();
    let c = chart(&e, &slide);
    assert!(c.series.iter().all(|s| s.mark.is_none()) && c.spec.is_none());
    assert_eq!(c.shape(), ChartShape::Columns);
}

#[test]
fn a_scatter_chart_takes_its_horizontal_numbers_from_the_first_column() {
    let (mut e, slide) = with_chart(json!({}));
    set(
        &mut e,
        &slide,
        json!({ "csv": "Height,Weight\n150,50\n160,58", "kind": "scatter" }),
    )
    .unwrap();
    let c = chart(&e, &slide);
    assert_eq!(c.series[0].x, [150.0, 160.0]);
    assert_eq!(c.series[0].values, [50.0, 58.0]);
    assert_eq!(
        (c.shape(), c.kind.clone()),
        (ChartShape::Scatter, ChartKind::Line)
    );
    let message = refused(&mut e, &slide, json!({ "csv": "Group,Weight\nA,50" }));
    assert!(
        message.contains("first column") && message.contains("not a number"),
        "{message}"
    );
}

#[test]
fn a_doughnut_has_a_hole_and_a_pie_with_many_series_says_it_draws_one() {
    let (mut e, slide) = with_chart(json!({}));
    let out = set(
        &mut e,
        &slide,
        json!({ "csv": "Q,A,B\nx,1,2\ny,3,4", "kind": "doughnut", "innerRadius": 0.6 }),
    )
    .unwrap();
    assert_eq!(chart(&e, &slide).shape(), ChartShape::Doughnut);
    let notes = out["notes"].to_string();
    assert!(notes.contains("first series only"), "{notes}");
    assert!(refused(&mut e, &slide, json!({ "innerRadius": 2 })).contains("between 0.1 and 0.9"));
    set(&mut e, &slide, json!({ "kind": "pie" })).unwrap();
    assert_eq!(chart(&e, &slide).shape(), ChartShape::Pie);
    assert!(
        chart(&e, &slide).spec.is_none(),
        "the hole went with the doughnut"
    );
}

#[test]
fn titles_and_formats_are_set_and_taken_away_and_an_empty_spec_is_not_kept() {
    let (mut e, slide) = with_chart(json!({}));
    let plain = serde_json::to_value(chart(&e, &slide)).unwrap();
    set(&mut e, &slide, json!({ "xTitle": "X", "yTitle": "Y", "format": "0.0%", "legend": true, "legendPosition": "Top" })).unwrap();
    let c = chart(&e, &slide);
    assert_eq!(c.legend_orient(), Some(&LegendOrient::Top));
    assert_eq!(c.legend, Some(true));
    set(
        &mut e,
        &slide,
        json!({ "xTitle": "", "yTitle": " ", "format": "", "legendPosition": "default" }),
    )
    .unwrap();
    let mut now = serde_json::to_value(chart(&e, &slide)).unwrap();
    assert!(now.get("spec").is_none(), "{now}");
    // The rest is as it was, except the legend that was asked for.
    now.as_object_mut().unwrap().remove("legend");
    assert_eq!(now, plain);
}

#[test]
fn a_negative_number_in_an_area_is_told_and_an_old_chart_keeps_all_it_had() {
    let (mut e, slide) = with_chart(json!({ "title": "Old", "labels": true }));
    let before = serde_json::to_value(chart(&e, &slide)).unwrap();
    assert!(before.get("spec").is_none());
    let out = set(
        &mut e,
        &slide,
        json!({ "kind": "area", "series": [{ "name": "S", "values": [2, -1] }] }),
    )
    .unwrap();
    assert!(out["notes"].to_string().contains("below zero"));
    set(&mut e, &slide, json!({ "title": "New" })).unwrap();
    assert_eq!(chart(&e, &slide).title.as_deref(), Some("New"));
    assert!(chart(&e, &slide).labels, "what was not mentioned stays");
}

#[test]
fn what_a_newer_build_wrote_in_the_charts_spec_survives_a_change() {
    let (mut e, slide) = with_chart(
        json!({ "spec": { "future": { "kept": 1 }, "encoding": { "y": { "scale": "log" } } } }),
    );
    set(&mut e, &slide, json!({ "yTitle": "Y", "kind": "line" })).unwrap();
    let value = serde_json::to_value(chart(&e, &slide)).unwrap();
    assert_eq!(value["spec"]["future"]["kept"], 1);
    assert_eq!(value["spec"]["encoding"]["y"]["scale"], "log");
    assert_eq!(value["spec"]["encoding"]["y"]["title"], "Y");
}
