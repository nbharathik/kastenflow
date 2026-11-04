//! A small set of decks, each about one thing PowerPoint files carry (a gradient, a chart, a transition, an animation),
//! made here, written to a file, read back, and compared structurally. They are made from the exporter so no deck of anyone's
//! is needed, and each is small enough to read.

use std::io::Cursor;

use serde_json::{Value, json};
use slides_core::{Deck, Element, Engine, MotionDirection, TransitionKind};
use slides_pptx::import::{ImportOptions, import};
use slides_pptx::{Media, Options, StepsMode, export};
use zip::ZipArchive;

struct NoPictures;

impl Media for NoPictures {
    fn read(&self, _: &str) -> Option<Vec<u8>> {
        None
    }
}

fn deck_with(elements: Vec<Value>) -> (Deck, String) {
    let mut e = Engine::create("Fidelity", "Light", 11).unwrap_or_else(|x| panic!("{x}"));
    let slide = e
        .apply("add_slide", json!({ "layout": "blank" }))
        .unwrap_or_else(|x| panic!("{x}"))
        .output["slide"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    e.apply(
        "add_elements",
        json!({ "slide": slide, "elements": elements }),
    )
    .unwrap_or_else(|x| panic!("{x}"));
    (e.into_deck(), slide)
}

fn names_in(bytes: &[u8]) -> Vec<String> {
    let archive = ZipArchive::new(Cursor::new(bytes)).unwrap_or_else(|x| panic!("{x}"));
    archive.file_names().map(str::to_owned).collect()
}

fn there_and_back(deck: &Deck, options: &Options) -> (Vec<u8>, Deck) {
    let out = export(deck, &NoPictures, options).unwrap_or_else(|x| panic!("{x}"));
    let back = import(
        &out.bytes,
        &ImportOptions {
            native_charts: true,
            ..ImportOptions::default()
        },
    )
    .unwrap_or_else(|x| panic!("{x}"));
    (out.bytes, back.deck)
}

/// The elements of the last slide that has any: the slide these decks are made of (the title slide a new deck starts with comes first).
fn elements_of(deck: &Deck) -> Vec<Element> {
    deck.slides
        .iter()
        .rev()
        .find(|s| !s.elements.is_empty())
        .map(|s| s.elements.clone())
        .unwrap_or_default()
}

#[test]
fn a_gradient_comes_back_with_its_stops_and_angle() {
    let (deck, _) = deck_with(vec![json!({
        "type": "shape", "shape": "rect", "x": 40, "y": 40, "w": 300, "h": 160,
        "style": { "fill": { "color": "#808080" }, "gradient": { "kind": "linear", "angle": 45,
            "stops": [{ "pos": 0, "color": "#ff0000" }, { "pos": 0.5, "color": "#00ff00" }, { "pos": 1, "color": "#0000ff" }] } }
    })]);
    let (bytes, back) = there_and_back(&deck, &Options::default());
    assert!(
        names_in(&bytes)
            .iter()
            .any(|n| n.starts_with("ppt/slides/slide"))
    );
    let gradient = elements_of(&back)
        .iter()
        .find_map(|e| e.base().style.as_ref().and_then(|s| s.gradient.clone()))
        .unwrap_or_else(|| panic!("a gradient"));
    assert_eq!(gradient.stops.len(), 3);
    assert_eq!(gradient.angle, Some(45.0));
    assert!((gradient.stops[1].pos - 0.5).abs() < 0.001);
}

#[test]
fn a_bar_chart_goes_out_as_a_chart_part_with_its_workbook_and_comes_back_a_chart() {
    let (deck, _) = deck_with(vec![json!({
        "type": "chart", "kind": "bar", "x": 40, "y": 40, "w": 600, "h": 360, "title": "Sales", "labels": true,
        "categories": ["Q1", "Q2", "Q3"],
        "series": [{ "name": "North", "values": [1, 2.5, 3] }, { "name": "South", "values": [3, 2, 1] }]
    })]);
    let (bytes, back) = there_and_back(&deck, &Options::default());
    let names = names_in(&bytes);
    assert!(
        names.iter().any(|n| n == "ppt/charts/chart1.xml"),
        "{names:?}"
    );
    assert!(names.iter().any(|n| n.ends_with(".xlsx")), "{names:?}");
    let chart = elements_of(&back)
        .into_iter()
        .find_map(|e| match e {
            Element::Chart(c) => Some(c),
            _ => None,
        })
        .unwrap_or_else(|| panic!("a chart"));
    assert_eq!(chart.categories, ["Q1", "Q2", "Q3"]);
    assert_eq!(chart.title.as_deref(), Some("Sales"));
    assert_eq!(chart.series.len(), 2);
    assert_eq!(chart.series[0].name, "North");
    assert_eq!(chart.series[0].values, [1.0, 2.5, 3.0]);
    assert!(chart.labels);
}

#[test]
fn line_and_pie_charts_come_back_too() {
    for kind in ["line", "pie"] {
        let (deck, _) = deck_with(vec![json!({
            "type": "chart", "kind": kind, "x": 40, "y": 40, "w": 500, "h": 300,
            "categories": ["A", "B"], "series": [{ "name": "S", "values": [4, 6] }]
        })]);
        let (_, back) = there_and_back(&deck, &Options::default());
        let kinds: Vec<String> = elements_of(&back)
            .iter()
            .map(|e| e.kind().to_owned())
            .collect();
        assert!(kinds.iter().any(|k| k == "chart"), "{kind}: {kinds:?}");
    }
}

#[test]
fn without_the_option_a_chart_is_kept_as_the_object_it_was() {
    let (deck, _) = deck_with(vec![json!({
        "type": "chart", "kind": "bar", "x": 40, "y": 40, "w": 500, "h": 300,
        "categories": ["A"], "series": [{ "name": "S", "values": [4] }]
    })]);
    let out = export(&deck, &NoPictures, &Options::default()).unwrap_or_else(|x| panic!("{x}"));
    let back = import(&out.bytes, &ImportOptions::default()).unwrap_or_else(|x| panic!("{x}"));
    let kinds: Vec<String> = elements_of(&back.deck)
        .iter()
        .map(|e| e.kind().to_owned())
        .collect();
    assert!(kinds.iter().any(|k| k == "raw"), "{kinds:?}");
}

#[test]
fn every_transition_comes_back_with_its_kind_side_and_time() {
    let cases = [
        ("fade", None),
        ("push", Some(MotionDirection::Left)),
        ("wipe", Some(MotionDirection::Up)),
        ("cover", Some(MotionDirection::Right)),
        ("uncover", Some(MotionDirection::Down)),
        ("zoom", None),
        ("dissolve", None),
        ("flip", Some(MotionDirection::Left)),
        ("morph", None),
    ];
    for (name, side) in cases {
        let (mut deck, slide) = deck_with(vec![
            json!({ "type": "shape", "shape": "rect", "x": 10, "y": 10, "w": 50, "h": 50 }),
        ]);
        let mut transition = json!({ "kind": name, "duration": 0.75 });
        if let Some(side) = &side {
            transition["direction"] = serde_json::to_value(side).unwrap_or_default();
        }
        deck.slide_mut(&slide)
            .unwrap_or_else(|| panic!("slide"))
            .transition = serde_json::from_value(transition).ok();
        let (_, back) = there_and_back(&deck, &Options::default());
        let got = back
            .slides
            .iter()
            .find_map(|s| s.transition.clone())
            .unwrap_or_else(|| panic!("{name}: a transition"));
        let kind: TransitionKind =
            serde_json::from_value(json!(name)).unwrap_or(TransitionKind::None);
        assert_eq!(got.kind, kind, "{name}");
        assert_eq!(got.direction, side, "{name}");
        assert!(
            got.duration.is_some_and(|d| (d - 0.75).abs() < 0.01),
            "{name}: {:?}",
            got.duration
        );
    }
}

#[test]
fn clicks_become_an_animation_sequence_in_animate_mode() {
    let (start, slide) = deck_with(vec![
        json!({ "type": "shape", "shape": "rect", "x": 10, "y": 10, "w": 50, "h": 50 }),
    ]);
    let mut e = Engine::new(start, 12);
    let id = e
        .deck()
        .slide(&slide)
        .map(|s| s.elements[0].id().to_owned())
        .unwrap_or_default();
    e.apply(
        "set_step_states",
        json!({ "slide": slide, "id": id, "states": { "0": "hidden", "1": "normal" } }),
    )
    .unwrap_or_else(|x| panic!("{x}"));
    e.apply(
        "set_step_fx",
        json!({ "slide": slide, "id": id, "fx": { "1": { "kind": "fly", "direction": "left" } } }),
    )
    .unwrap_or_else(|x| panic!("{x}"));
    let deck = e.into_deck();
    let out = export(
        &deck,
        &NoPictures,
        &Options {
            steps: StepsMode::Animate,
            ..Options::default()
        },
    )
    .unwrap_or_else(|x| panic!("{x}"));
    let names = names_in(&out.bytes);
    assert_eq!(
        names
            .iter()
            .filter(|n| n.starts_with("ppt/slides/slide"))
            .count(),
        2,
        "title slide and the animated one, not a slide for each click: {names:?}"
    );
}
