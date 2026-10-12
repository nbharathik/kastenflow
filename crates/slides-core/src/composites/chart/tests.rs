use super::*;
use crate::composites::expand as expand_element;
use crate::model::{Base, ChartSeries, Extra};

fn series(name: &str, values: &[f64]) -> ChartSeries {
    ChartSeries {
        name: name.to_owned(),
        values: values.to_vec(),
        color: None,
        extra: Extra::new(),
    }
}

fn chart(kind: ChartKind, categories: &[&str], all: Vec<ChartSeries>) -> ChartEl {
    ChartEl {
        base: Base::new("c-1").place(100.0, 100.0, 600.0, 360.0),
        kind,
        title: None,
        categories: categories.iter().map(|c| (*c).to_owned()).collect(),
        series: all,
        labels: false,
        legend: None,
        extra: Extra::new(),
    }
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

#[test]
fn numbers_are_written_as_a_person_writes_them() {
    assert_eq!(number(0.0), "0");
    assert_eq!(number(-0.001), "0");
    assert_eq!(number(12.0), "12");
    assert_eq!(number(3.5), "3.5");
    assert_eq!(number(0.25), "0.25");
    assert_eq!(number(1234.0), "1,234");
    assert_eq!(number(-12500.5), "-12,500.5");
    assert_eq!(number(2_500_000.0), "2.5M");
    assert_eq!(number(3_000_000_000.0), "3B");
}

#[test]
fn the_scale_is_round_numbers_that_hold_zero_and_the_data() {
    assert_eq!(scale(0.0, 100.0, 5), (0.0, 100.0, 20.0));
    assert_eq!(scale(0.0, 87.0, 5), (0.0, 100.0, 20.0));
    assert_eq!(scale(-30.0, 90.0, 5), (-50.0, 100.0, 50.0));
    assert_eq!(scale(0.0, 7.0, 5), (0.0, 8.0, 2.0));
    // Nothing to draw still has a scale to draw it on.
    let (lo, hi, step) = scale(0.0, 0.0, 5);
    assert!(lo == 0.0 && hi > 0.0 && step > 0.0);
    for top in [0.3, 4.0, 9.9, 99.0, 1234.0, 1.0e7] {
        let (lo, hi, step) = scale(0.0, top, 5);
        assert!(lo <= 0.0 && hi >= top && step > 0.0, "{top}");
        assert!(((hi - lo) / step).round() <= 12.0, "{top}");
    }
}

#[test]
fn bars_are_as_tall_as_their_numbers_on_a_scale_that_starts_at_zero() {
    let mut el = chart(
        ChartKind::Bar,
        &["A", "B", "C"],
        vec![series("Sales", &[10.0, 20.0, 5.0])],
    );
    el.title = Some("Sales by team".to_owned());
    let parts = parts_of(el);
    let bars = shapes(&parts, "rect");
    assert_eq!(bars.len(), 3);
    let heights: Vec<f64> = bars.iter().map(|b| b.base().h.unwrap()).collect();
    assert!((heights[1] / heights[0] - 2.0).abs() < 0.05, "{heights:?}");
    assert!((heights[1] / heights[2] - 4.0).abs() < 0.1, "{heights:?}");
    // They stand on one line, which is the zero line, and all in the first accent colour.
    let feet: Vec<f64> = bars
        .iter()
        .map(|b| b.base().y.unwrap() + b.base().h.unwrap())
        .collect();
    assert!(
        feet.windows(2).all(|p| (p[0] - p[1]).abs() < 0.02),
        "{feet:?}"
    );
    assert!(bars.iter().all(|b| fill_of(b) == "accent1"));
    let words = texts(&parts);
    for wanted in ["Sales by team", "A", "B", "C", "0", "20"] {
        assert!(words.iter().any(|w| w == wanted), "{wanted} in {words:?}");
    }
    // One series needs no legend.
    assert!(!words.iter().any(|w| w == "Sales"));
}

#[test]
fn series_are_beside_each_other_in_the_colours_in_turn_and_named_in_a_legend() {
    let mut blue = series("2025", &[3.0, 4.0]);
    blue.color = Some("#336699".to_owned());
    let parts = parts_of(chart(
        ChartKind::Bar,
        &["Q1", "Q2"],
        vec![
            blue,
            series("2026", &[5.0, 6.0]),
            series("Plan", &[1.0, 2.0]),
        ],
    ));
    let bars = shapes(&parts, "rect");
    assert_eq!(bars.len(), 6);
    let colours: Vec<String> = bars.iter().map(|b| fill_of(b)).collect();
    assert_eq!(colours[..3], ["#336699", "accent2", "accent3"]);
    assert!(
        bars[0].base().x.unwrap() < bars[1].base().x.unwrap()
            && bars[1].base().x.unwrap() < bars[2].base().x.unwrap()
    );
    let words = texts(&parts);
    assert!(
        ["2025", "2026", "Plan"]
            .iter()
            .all(|n| words.contains(&(*n).to_owned())),
        "{words:?}"
    );
    assert_eq!(
        shapes(&parts, "roundRect").len(),
        3,
        "a swatch for each series"
    );
}

#[test]
fn a_number_below_zero_hangs_from_the_zero_line() {
    let parts = parts_of(chart(
        ChartKind::Bar,
        &["A", "B"],
        vec![series("Change", &[10.0, -10.0])],
    ));
    let bars = shapes(&parts, "rect");
    let (up, down) = (bars[0].base(), bars[1].base());
    assert!(
        (up.y.unwrap() + up.h.unwrap() - down.y.unwrap()).abs() < 0.02,
        "the second starts where the first ends"
    );
    assert!((up.h.unwrap() - down.h.unwrap()).abs() < 0.02);
}

#[test]
fn the_numbers_may_be_written_on_the_bars() {
    let mut el = chart(
        ChartKind::Bar,
        &["A", "B"],
        vec![series("S", &[1234.0, 5.5])],
    );
    el.labels = true;
    let words = texts(&parts_of(el));
    assert!(
        words.iter().any(|w| w == "1,234") && words.iter().any(|w| w == "5.5"),
        "{words:?}"
    );
}

#[test]
fn a_line_joins_its_points_with_a_segment_each_and_a_marker_at_each() {
    let parts = parts_of(chart(
        ChartKind::Line,
        &["A", "B", "C"],
        vec![series("S", &[1.0, 3.0, 2.0])],
    ));
    let markers = shapes(&parts, "ellipse");
    assert_eq!(markers.len(), 3);
    let segments: Vec<&Element> = parts
        .iter()
        .filter(|p| {
            matches!(p, Element::Line(_))
                && p.base()
                    .style
                    .as_ref()
                    .and_then(|s| s.stroke.as_ref())
                    .and_then(|s| s.width)
                    == Some(3.0)
        })
        .collect();
    assert_eq!(segments.len(), 2);
    // The first goes up (so it is flipped), the second down.
    assert!(segments[0].base().flip_v && !segments[1].base().flip_v);
    let ys: Vec<f64> = markers.iter().map(|m| m.base().y.unwrap()).collect();
    assert!(
        ys[1] < ys[2] && ys[2] < ys[0],
        "higher numbers are higher up: {ys:?}"
    );
}

#[test]
fn a_pie_is_wedges_of_a_colour_a_slice_with_the_categories_named_at_its_side() {
    let parts = parts_of(chart(
        ChartKind::Pie,
        &["Rent", "Food", "Fun"],
        vec![series("Budget", &[50.0, 30.0, 20.0])],
    ));
    let wedges = shapes(&parts, "triangle");
    // 180, 108 and 72 degrees in wedges of 3 degrees.
    let by_colour = |c: &str| wedges.iter().filter(|w| fill_of(w) == c).count();
    assert_eq!(
        (
            by_colour("accent1"),
            by_colour("accent2"),
            by_colour("accent3")
        ),
        (60, 36, 24)
    );
    assert!(wedges.iter().all(|w| w.base().rotation.is_some()));
    let words = texts(&parts);
    assert!(
        words
            .iter()
            .any(|w| w.starts_with("Rent") && w.contains("50%")),
        "{words:?}"
    );
    assert!(
        words
            .iter()
            .any(|w| w.starts_with("Fun") && w.contains("20%")),
        "{words:?}"
    );
}

#[test]
fn a_pie_with_nothing_to_share_is_an_empty_ring_that_says_so() {
    let parts = parts_of(chart(
        ChartKind::Pie,
        &["A", "B"],
        vec![series("S", &[0.0, -3.0])],
    ));
    assert!(shapes(&parts, "triangle").is_empty());
    assert!(texts(&parts).iter().any(|w| w == "No data"));
}

#[test]
fn a_chart_with_no_numbers_is_a_panel_that_asks_for_them() {
    for el in [
        chart(ChartKind::Bar, &[], vec![]),
        chart(ChartKind::Pie, &["A"], vec![]),
        chart(ChartKind::Line, &[], vec![series("S", &[])]),
    ] {
        let parts = parts_of(el);
        assert!(!parts.is_empty());
        assert!(texts(&parts).iter().any(|w| w.contains("Add the numbers")));
    }
}

#[test]
fn what_is_not_a_number_is_drawn_as_zero_and_a_missing_value_too() {
    let mut odd = series("S", &[f64::NAN, 4.0]);
    odd.values.push(f64::INFINITY);
    let parts = parts_of(chart(
        ChartKind::Bar,
        &["A", "B", "C"],
        vec![odd, series("T", &[1.0])],
    ));
    for p in &parts {
        let (x, y, w, h) = p.base().rect().expect("a box");
        assert!([x, y, w, h].iter().all(|v| v.is_finite()));
    }
}

#[test]
fn the_parts_stay_inside_the_box_whatever_its_shape_and_the_data() {
    let categories: Vec<String> = (0..30).map(|i| format!("Category number {i}")).collect();
    let names: Vec<&str> = categories.iter().map(String::as_str).collect();
    for kind in [ChartKind::Bar, ChartKind::Line, ChartKind::Pie] {
        for (w, h) in [
            (600.0, 360.0),
            (120.0, 80.0),
            (30.0, 400.0),
            (400.0, 20.0),
            (0.0, 0.0),
        ] {
            let mut el = chart(
                kind.clone(),
                &names,
                vec![
                    series(
                        "A",
                        &(0..30)
                            .map(|i| f64::from(i) * 1.7 - 9.0)
                            .collect::<Vec<_>>(),
                    ),
                    series("B", &[3.0, 4.0]),
                ],
            );
            el.base = Base::new("c-1").place(100.0, 100.0, w, h);
            el.title = Some("A rather long title for this chart of many categories".to_owned());
            el.labels = true;
            for p in parts_of(el) {
                if p.base().rotation.is_some() {
                    continue;
                }
                let (x, y, pw, ph) = p.base().rect().expect("a box");
                assert!(
                    x >= 100.0 - 0.011
                        && y >= 100.0 - 0.011
                        && x + pw <= 100.0 + w + 0.011
                        && y + ph <= 100.0 + h + 0.011,
                    "{kind:?} {w}x{h}: {x} {y} {pw} {ph}"
                );
            }
        }
    }
}

#[test]
fn the_words_for_a_person_who_cannot_see_it_say_what_kind_and_what_about() {
    let mut el = chart(ChartKind::Pie, &["A"], vec![series("S", &[1.0])]);
    assert_eq!(alt_of(&el), "Pie chart");
    el.title = Some("  Budget ".to_owned());
    assert_eq!(alt_of(&el), "Pie chart: Budget");
}

#[test]
fn the_colours_are_the_themes_so_a_new_theme_recolours_the_chart() {
    for kind in [ChartKind::Bar, ChartKind::Line, ChartKind::Pie] {
        let parts = parts_of(chart(
            kind,
            &["A", "B"],
            vec![series("S", &[1.0, 2.0]), series("T", &[2.0, 1.0])],
        ));
        for p in &parts {
            let mut colours: Vec<String> = Vec::new();
            if let Some(style) = &p.base().style {
                colours.extend(style.fill.iter().map(|f| f.color.clone()));
                colours.extend(style.stroke.iter().map(|l| l.color.clone()));
            }
            if let Some(text) = p.text() {
                for run in text.paragraphs.iter().flat_map(|q| q.runs.iter()) {
                    colours.extend(run.color.clone());
                }
            }
            for c in colours {
                assert!(!c.starts_with('#'), "{c}");
            }
        }
    }
}
