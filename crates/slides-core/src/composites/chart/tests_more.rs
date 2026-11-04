//! The kinds of chart that came after bars, lines and pies, and what a chart says about its axes.

use serde_json::{Value, json};

use super::*;
use crate::composites::expand as expand_element;

/// A chart at (100, 100), 600 by 360, with `more` added to (or replacing) its fields.
fn chart(more: Value) -> ChartEl {
    let mut base = json!({
        "id": "c-1", "x": 100, "y": 100, "w": 600, "h": 360, "kind": "bar",
        "categories": ["A", "B"], "series": [{ "name": "S", "values": [1, 2] }]
    });
    if let (Value::Object(target), Value::Object(fields)) = (&mut base, more) {
        target.extend(fields);
    }
    serde_json::from_value(base).unwrap()
}

fn parts_of(el: ChartEl) -> Vec<Element> {
    let theme = crate::themes::light();
    expand_element(&theme, "blank", &Element::Chart(el)).unwrap_or_default()
}

fn texts(parts: &[Element]) -> Vec<String> {
    parts
        .iter()
        .filter_map(|p| p.text().map(|t| t.plain_text()))
        .collect()
}

fn shapes<'a>(parts: &'a [Element], preset: &str) -> Vec<&'a Element> {
    parts
        .iter()
        .filter(|p| matches!(p, Element::Shape(s) if s.shape == preset))
        .collect()
}

fn fill_of(part: &Element) -> String {
    part.base()
        .style
        .as_ref()
        .and_then(|s| s.fill.as_ref())
        .map(|f| f.color.clone())
        .unwrap_or_default()
}

fn alpha_of(part: &Element) -> Option<f64> {
    part.base()
        .style
        .as_ref()
        .and_then(|s| s.fill.as_ref())
        .and_then(|f| f.alpha)
}

fn rect_of(part: &Element) -> (f64, f64, f64, f64) {
    part.base().rect().expect("a box")
}

fn two(values: [[f64; 2]; 2]) -> Value {
    json!([{ "name": "X", "values": values[0] }, { "name": "Y", "values": values[1] }])
}

#[test]
fn the_numbers_follow_the_charts_format_and_the_axes_have_their_titles() {
    let parts = parts_of(chart(json!({
        "series": [{ "name": "S", "values": [1200, 800] }], "labels": true,
        "spec": { "encoding": { "x": { "title": "Team" }, "y": { "title": "Revenue", "format": "$#,##0" } } }
    })));
    let words = texts(&parts);
    for wanted in ["$1,200", "$800", "$0", "$1,500", "Team", "Revenue"] {
        assert!(words.contains(&wanted.to_owned()), "{wanted} in {words:?}");
    }
}

#[test]
fn a_format_that_cannot_be_read_leaves_the_numbers_as_they_were() {
    let parts = parts_of(chart(
        json!({ "series": [{ "name": "S", "values": [1200, 800] }], "labels": true,
            "spec": { "encoding": { "y": { "format": "no digits" } } } }),
    ));
    let words = texts(&parts);
    assert!(
        words.contains(&"1,200".to_owned()) && words.contains(&"800".to_owned()),
        "{words:?}"
    );
}

#[test]
fn titles_are_numbered_after_the_other_parts_so_a_chart_keeps_the_ids_it_had() {
    let plain = parts_of(chart(json!({})));
    let titled = parts_of(chart(
        json!({ "spec": { "encoding": { "x": { "title": "Team" }, "y": { "title": "Units" } } } }),
    ));
    let ids =
        |parts: &[Element]| -> Vec<String> { parts.iter().map(|p| p.id().to_owned()).collect() };
    let (before, after) = (ids(&plain), ids(&titled));
    assert_eq!(after[..before.len()], before[..]);
    assert_eq!(after.len(), before.len() + 2);
    assert!(
        after[before.len()..]
            .iter()
            .all(|id| id.starts_with("c-1.t.")),
        "{after:?}"
    );
    // A plain chart has the ids 1, 2, 3 ... and nothing else.
    assert!(before.iter().all(|id| !id.contains(".t.")), "{before:?}");
}

#[test]
fn stacked_columns_pile_the_series_and_the_scale_reaches_the_pile() {
    let parts = parts_of(chart(json!({
        "series": two([[3.0, 1.0], [4.0, 2.0]]),
        "spec": { "mark": "bar", "encoding": { "y": { "stack": true } } }
    })));
    let bars = shapes(&parts, "rect");
    assert_eq!(bars.len(), 4);
    let (first, second) = (rect_of(bars[0]), rect_of(bars[1]));
    assert!(
        (first.0 - second.0).abs() < 0.02,
        "one column for the category"
    );
    assert!(
        (second.1 + second.3 - first.1).abs() < 0.03,
        "the second stands on the first"
    );
    assert!(
        (first.3 * 4.0 / 3.0 - second.3).abs() < 0.1,
        "heights follow the numbers"
    );
    assert!(
        texts(&parts).contains(&"8".to_owned()),
        "the scale reaches 7"
    );
    assert_eq!(fill_of(bars[0]), "accent1");
    assert_eq!(fill_of(bars[1]), "accent2");
}

#[test]
fn a_number_below_zero_hangs_from_the_zero_line_in_a_stack() {
    let parts = parts_of(chart(json!({
        "categories": ["A"], "series": two([[3.0, 0.0], [-2.0, 0.0]]),
        "spec": { "mark": "bar", "encoding": { "y": { "stack": true } } }
    })));
    let bars = shapes(&parts, "rect");
    assert_eq!(bars.len(), 2, "a zero draws nothing");
    let (up, down) = (rect_of(bars[0]), rect_of(bars[1]));
    assert!((up.1 + up.3 - down.1).abs() < 0.03, "{up:?} {down:?}");
}

#[test]
fn an_area_is_filled_down_to_zero_by_a_rectangle_and_a_slope_and_a_negative_number_is_drawn_as_zero()
 {
    let parts = parts_of(chart(json!({
        "kind": "line", "categories": ["A", "B", "C"],
        "series": [{ "name": "S", "values": [2, 4, -3] }], "spec": { "mark": "area" }
    })));
    let slopes = shapes(&parts, "rtTriangle");
    assert_eq!(slopes.len(), 2);
    assert!(
        slopes[0].base().flip_h && !slopes[1].base().flip_h,
        "the first climbs, the second falls"
    );
    assert_eq!(
        shapes(&parts, "rect").len(),
        1,
        "only the rising part has a floor"
    );
    assert_eq!(
        alpha_of(slopes[0]),
        Some(0.55),
        "areas that overlap are see-through"
    );
    let edges = parts
        .iter()
        .filter(|p| {
            matches!(p, Element::Line(_))
                && p.base()
                    .style
                    .as_ref()
                    .and_then(|s| s.stroke.as_ref())
                    .and_then(|s| s.width)
                    == Some(2.5)
        })
        .count();
    assert_eq!(edges, 2, "the top edge is a line");
}

#[test]
fn stacked_areas_are_solid_and_the_highest_is_drawn_first() {
    let parts = parts_of(chart(json!({
        "kind": "line", "series": two([[1.0, 2.0], [1.0, 2.0]]),
        "spec": { "mark": "area", "encoding": { "y": { "stack": true } } }
    })));
    let fills: Vec<&Element> = parts
        .iter()
        .filter(|p| matches!(p, Element::Shape(s) if s.shape == "rect" || s.shape == "rtTriangle"))
        .collect();
    assert!(!fills.is_empty());
    assert_eq!(
        fill_of(fills[0]),
        "accent2",
        "the pile's top goes down first"
    );
    assert!(
        fills.iter().all(|f| alpha_of(f).is_none()),
        "solid, so what is under it is hidden"
    );
    assert_eq!(fill_of(fills[fills.len() - 1]), "accent1");
}

#[test]
fn a_doughnut_is_pieces_of_a_ring_a_slice_in_a_colour_with_the_categories_at_its_side() {
    let parts = parts_of(chart(json!({
        "kind": "pie", "categories": ["Rent", "Food", "Fun"],
        "series": [{ "name": "Budget", "values": [50, 30, 20] }],
        "spec": { "mark": "arc", "innerRadius": 0.5 }
    })));
    assert!(shapes(&parts, "triangle").is_empty());
    let pieces = shapes(&parts, "rect");
    // 180, 108 and 72 degrees in pieces of 2 degrees.
    let by = |c: &str| pieces.iter().filter(|p| fill_of(p) == c).count();
    assert_eq!((by("accent1"), by("accent2"), by("accent3")), (90, 54, 36));
    assert!(pieces.iter().all(|p| p.base().rotation.is_some()));
    let words = texts(&parts);
    assert!(
        words
            .iter()
            .any(|w| w.starts_with("Rent") && w.contains("50%")),
        "{words:?}"
    );
}

#[test]
fn a_scatter_chart_puts_each_point_at_its_x_and_its_height() {
    let parts = parts_of(chart(json!({
        "kind": "line", "categories": ["a", "b", "c"],
        "series": [{ "name": "S", "values": [10, 20, 15], "x": [1, 3, 2] }],
        "spec": { "mark": "point" }
    })));
    let dots = shapes(&parts, "ellipse");
    assert_eq!(dots.len(), 3);
    let (a, b, c) = (rect_of(dots[0]), rect_of(dots[1]), rect_of(dots[2]));
    assert!(a.0 < c.0 && c.0 < b.0, "x of 1, 2, 3: {a:?} {c:?} {b:?}");
    assert!(b.1 < c.1 && c.1 < a.1, "20 is higher than 15 and 10");
    // Without an x a point stands at its place in the list.
    let plain = parts_of(chart(json!({
        "kind": "line", "series": [{ "name": "S", "values": [5, 6, 7] }], "spec": { "mark": "point" }
    })));
    let xs: Vec<f64> = shapes(&plain, "ellipse")
        .iter()
        .map(|d| rect_of(d).0)
        .collect();
    assert!(xs.windows(2).all(|w| w[0] < w[1]), "{xs:?}");
}

#[test]
fn a_combination_has_columns_for_some_series_and_a_line_for_others() {
    let parts = parts_of(chart(json!({
        "series": [
            { "name": "Sales", "values": [3, 5], "mark": "bar" },
            { "name": "Margin", "values": [1, 2], "mark": "line" }
        ]
    })));
    assert_eq!(
        shapes(&parts, "rect").len(),
        2,
        "a column for each category"
    );
    assert_eq!(
        shapes(&parts, "ellipse").len(),
        2,
        "a marker for each point of the line"
    );
    assert_eq!(
        shapes(&parts, "roundRect").len(),
        2,
        "a swatch for each series"
    );
    assert!(alt_of(&chart(json!({ "series": [
        { "name": "Sales", "values": [3, 5], "mark": "bar" }, { "name": "Margin", "values": [1, 2], "mark": "line" }
    ] }))).starts_with("Combination chart"));
}

#[test]
fn the_legend_goes_where_the_chart_puts_it() {
    let swatches = |orient: &str| -> Vec<(f64, f64)> {
        let parts = parts_of(chart(json!({
            "series": two([[1.0, 2.0], [2.0, 1.0]]),
            "spec": { "encoding": { "color": { "legend": { "orient": orient } } } }
        })));
        shapes(&parts, "roundRect")
            .iter()
            .map(|s| (rect_of(s).0, rect_of(s).1))
            .collect()
    };
    assert_eq!(swatches("bottom").len(), 2);
    assert!(
        swatches("bottom")
            .iter()
            .all(|(_, y)| *y > 100.0 + 360.0 * 0.8)
    );
    assert!(
        swatches("top")
            .iter()
            .all(|(_, y)| *y < 100.0 + 360.0 * 0.2)
    );
    assert!(
        swatches("right")
            .iter()
            .all(|(x, _)| *x > 100.0 + 600.0 * 0.6)
    );
    assert!(
        swatches("left")
            .iter()
            .all(|(x, _)| *x < 100.0 + 600.0 * 0.3)
    );
    // Turned off, there is none, and the position changes nothing.
    let parts = parts_of(chart(json!({
        "series": two([[1.0, 2.0], [2.0, 1.0]]), "legend": false,
        "spec": { "encoding": { "color": { "legend": { "orient": "right" } } } }
    })));
    assert!(shapes(&parts, "roundRect").is_empty());
}

#[test]
fn the_words_for_a_person_who_cannot_see_it_name_the_new_kinds() {
    for (more, wanted) in [
        (
            json!({ "kind": "line", "spec": { "mark": "area" } }),
            "Area chart",
        ),
        (
            json!({ "kind": "line", "spec": { "mark": "area", "encoding": { "y": { "stack": true } } } }),
            "Stacked area chart",
        ),
        (
            json!({ "kind": "bar", "spec": { "mark": "bar", "encoding": { "y": { "stack": true } } } }),
            "Stacked bar chart",
        ),
        (
            json!({ "kind": "pie", "spec": { "mark": "arc", "innerRadius": 0.4 } }),
            "Doughnut chart",
        ),
        (
            json!({ "kind": "line", "spec": { "mark": "point" } }),
            "Scatter chart",
        ),
        (json!({ "kind": "bar" }), "Bar chart"),
    ] {
        assert_eq!(alt_of(&chart(more)), wanted);
    }
}

#[test]
fn the_parts_of_every_kind_stay_inside_the_box_whatever_its_shape() {
    let kinds = [
        json!({ "kind": "bar", "spec": { "mark": "bar", "encoding": { "y": { "stack": true } } } }),
        json!({ "kind": "line", "spec": { "mark": "area" } }),
        json!({ "kind": "line", "spec": { "mark": "area", "encoding": { "y": { "stack": true } } } }),
        json!({ "kind": "pie", "spec": { "mark": "arc", "innerRadius": 0.6 } }),
        json!({ "kind": "line", "spec": { "mark": "point" } }),
        json!({ "kind": "bar", "series": [
            { "name": "A", "values": [1, 2, 3], "mark": "bar" }, { "name": "B", "values": [3, 2, 1], "mark": "line" }
        ] }),
    ];
    for kind in kinds {
        for (w, h) in [
            (600.0, 360.0),
            (120.0, 80.0),
            (30.0, 400.0),
            (400.0, 20.0),
            (0.0, 0.0),
        ] {
            let mut fields = kind.clone();
            fields["w"] = json!(w);
            fields["h"] = json!(h);
            fields["title"] = json!("A rather long title for this chart");
            fields["labels"] = json!(true);
            if fields.get("series").is_none() {
                fields["series"] = json!([
                    { "name": "A", "values": [1.5, -2.0, 3.0], "x": [1, 2, 3] },
                    { "name": "B", "values": [3.0, 4.0, 5.0], "x": [2, 3, 4] }
                ]);
            }
            fields["categories"] = json!(["One", "Two", "Three"]);
            let mut spec = fields["spec"].clone();
            spec["encoding"]["x"] = json!({ "title": "Horizontal" });
            spec["encoding"]["y"]["title"] = json!("Vertical");
            spec["encoding"]["y"]["format"] = json!("0.0");
            spec["encoding"]["color"] = json!({ "legend": { "orient": "right" } });
            fields["spec"] = spec;
            for p in parts_of(chart(fields)) {
                if p.base().rotation.is_some() {
                    continue;
                }
                let (x, y, pw, ph) = rect_of(&p);
                assert!(
                    x >= 100.0 - 0.011
                        && y >= 100.0 - 0.011
                        && x + pw <= 100.0 + w + 0.011
                        && y + ph <= 100.0 + h + 0.011,
                    "{kind} {w}x{h}: {x} {y} {pw} {ph}"
                );
            }
        }
    }
}
