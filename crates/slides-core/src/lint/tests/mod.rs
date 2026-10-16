//! Tests of lint. Each rule has a hand-made deck with exactly the problems
//! it should find, and a list of the issues that deck must give: no more
//! and no fewer. A finished deck gives none.

mod breaks;
mod content;
mod contrast;
mod geometry;
mod links;
mod probes;
mod speed;
mod text;

use serde_json::{Value, json};

use super::{Options, Report, Severity, lint_deck, lint_deck_with};
use crate::model::Deck;
use crate::ops::Engine;

/// One issue as the tests compare them: rule, severity, element.
pub(super) type Found = (&'static str, Severity, Option<&'static str>);

/// A deck whose title slide is finished, and a blank slide to put things on.
pub(super) struct Bench {
    pub engine: Engine,
    /// The blank slide.
    pub slide: String,
}

pub(super) fn bench() -> Bench {
    let mut engine = Engine::create("Lint tests", "Light", 7).unwrap();
    let first = engine.deck().slides[0].clone();
    let subtitle = first
        .elements
        .iter()
        .find(|e| e.base().placeholder.as_deref() == Some("subtitle"))
        .unwrap()
        .id()
        .to_owned();
    engine
        .apply(
            "set_text",
            json!({ "slide": first.id, "id": subtitle, "markdown": "A subtitle" }),
        )
        .unwrap();
    let slide = engine
        .apply("add_slide", json!({ "layout": "blank" }))
        .unwrap()
        .output["slide"]
        .as_str()
        .unwrap()
        .to_owned();
    Bench { engine, slide }
}

impl Bench {
    /// Adds elements to the blank slide.
    pub fn add(&mut self, elements: Value) {
        self.engine
            .apply(
                "add_elements",
                json!({ "slide": self.slide, "elements": elements }),
            )
            .unwrap();
    }

    /// Adds a slide of another layout; returns its id and the id of each slot.
    pub fn add_slide(&mut self, layout: &str, content: Value) -> (String, Value) {
        let out = self
            .engine
            .apply("add_slide", json!({ "layout": layout, "content": content }))
            .unwrap();
        (
            out.output["slide"].as_str().unwrap().to_owned(),
            out.output["elements"].clone(),
        )
    }

    pub fn deck(&self) -> &Deck {
        self.engine.deck()
    }

    /// The deck with something the operations cannot say changed.
    pub fn changed(&self, change: impl FnOnce(&mut Deck)) -> Deck {
        let mut deck = self.engine.deck().clone();
        change(&mut deck);
        deck
    }

    pub fn report(&self) -> Report {
        lint_deck(self.deck(), None)
    }
}

/// Measures that say every text of the deck fits: one small measure for each element.
pub(super) fn measured(deck: &Deck) -> super::Measures {
    let mut measures = super::Measures::default();
    for slide in &deck.slides {
        let sizes = slide
            .elements
            .iter()
            .map(|e| {
                let small = super::Measure {
                    text_width: 1.0,
                    text_height: 1.0,
                    area_width: None,
                    area_height: None,
                };
                (e.id().to_owned(), small)
            })
            .collect();
        measures.slides.insert(slide.id.clone(), sizes);
    }
    measures
}

pub(super) fn found(report: &Report) -> Vec<(String, Severity, Option<String>)> {
    report
        .issues
        .iter()
        .map(|i| (i.rule.clone(), i.severity, i.element.clone()))
        .collect()
}

/// What a report must say, for comparing with `found`.
pub(super) fn expect(list: &[Found]) -> Vec<(String, Severity, Option<String>)> {
    list.iter()
        .map(|(rule, severity, element)| {
            ((*rule).to_owned(), *severity, element.map(str::to_owned))
        })
        .collect()
}

/// The issues of one rule.
pub(super) fn of_rule<'a>(report: &'a Report, rule: &str) -> Vec<&'a super::Issue> {
    report.issues.iter().filter(|i| i.rule == rule).collect()
}

pub(super) fn text(id: &str, x: f64, y: f64, w: f64, h: f64, words: &str) -> Value {
    json!({ "type": "text", "id": id, "x": x, "y": y, "w": w, "h": h,
        "text": { "paragraphs": [{ "runs": [{ "t": words }] }] } })
}

/// A text box whose one run is set as given (size, colour, font ...).
pub(super) fn styled(id: &str, x: f64, y: f64, w: f64, h: f64, words: &str, run: Value) -> Value {
    let mut run = run;
    run["t"] = json!(words);
    json!({ "type": "text", "id": id, "x": x, "y": y, "w": w, "h": h,
        "text": { "paragraphs": [{ "runs": [run] }] } })
}

pub(super) fn shape(id: &str, preset: &str, x: f64, y: f64, w: f64, h: f64, fill: &str) -> Value {
    json!({ "type": "shape", "id": id, "shape": preset, "x": x, "y": y, "w": w, "h": h,
        "style": { "fill": { "color": fill } } })
}

pub(super) fn image(id: &str, x: f64, y: f64, w: f64, h: f64, alt: Option<&str>) -> Value {
    let mut image = json!({ "type": "image", "id": id, "src": "assets/figure.png", "x": x, "y": y, "w": w, "h": h });
    if let Some(alt) = alt {
        image["alt"] = json!(alt);
    }
    image
}

#[test]
fn a_finished_deck_has_no_issues_and_says_what_it_could_not_check() {
    let report = bench().report();
    assert_eq!(report.issues, vec![]);
    let skipped: Vec<&str> = report.skipped.iter().map(|s| s.rule.as_str()).collect();
    assert_eq!(skipped, ["text-overflow", "unresolved-citation"]);
    assert!(report.skipped.iter().all(|s| s.reason.len() > 20));
}

#[test]
fn a_rule_that_was_given_what_it_needs_is_not_skipped() {
    let bench = bench();
    let measures = measured(bench.deck());
    let refs = super::Refs::new(["a"]);
    let options = Options {
        measures: Some(&measures),
        refs: Some(&refs),
    };
    let report = lint_deck_with(bench.deck(), &options);
    assert_eq!(report.skipped, vec![]);
    assert_eq!(report.issues, vec![]);
}

#[test]
fn the_same_deck_gives_the_same_report_in_a_fixed_order() {
    let mut b = bench();
    b.add(json!([
        text("late", 800.0, 200.0, 200.0, 60.0, "off the edge"),
        styled(
            "small",
            100.0,
            100.0,
            300.0,
            40.0,
            "tiny",
            json!({ "size": 9 })
        ),
        image("noalt", 100.0, 300.0, 200.0, 100.0, None),
    ]));
    let (second, slots) = b.add_slide("title-body", json!({ "title": "A title" }));
    assert!(slots["body"].is_string());
    let report = b.report();
    assert_eq!(report, b.report());
    let order = expect(&[
        ("off-slide", Severity::Error, Some("late")),
        ("min-font", Severity::Warning, Some("small")),
        ("missing-alt", Severity::Info, Some("noalt")),
        (
            "empty-placeholder",
            Severity::Warning,
            slots["body"].as_str().map(|_| ""),
        ),
    ]);
    let got = found(&report);
    // Slide order first, then severity, then rule, then the stack.
    assert_eq!(&got[..3], &order[..3], "{got:?}");
    assert_eq!(got.len(), 4);
    assert_eq!(report.issues[3].slide, second);
    assert_eq!(report.count(Severity::Error), 1);
    assert_eq!(report.count(Severity::Warning), 2);
    assert!(report.has_errors());
}

#[test]
fn lint_slide_gives_what_the_deck_report_holds_for_that_slide() {
    let mut b = bench();
    b.add(json!([text(
        "late",
        800.0,
        200.0,
        200.0,
        60.0,
        "off the edge"
    )]));
    let whole = b.report();
    let one = super::lint_slide(b.deck(), &b.slide, None).unwrap();
    assert_eq!(
        one.issues,
        whole.of_slide(&b.slide).cloned().collect::<Vec<_>>()
    );
    let first = super::lint_slide(b.deck(), &b.deck().slides[0].id, None).unwrap();
    assert_eq!(first.issues, vec![]);
    let error = super::lint_slide(b.deck(), "s-nope", None).unwrap_err();
    assert!(error.to_string().contains("s-nope"), "{error}");
}

#[test]
fn the_table_of_rules_has_fifteen_rules_and_every_issue_names_one() {
    let rules = super::rules();
    assert_eq!(rules.len(), 15);
    let mut names: Vec<&str> = rules.iter().map(|r| r.name).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), 15);
    assert!(
        rules
            .iter()
            .any(|r| r.name == "broken-link" && r.severity == Severity::Error)
    );
    assert!(
        rules.windows(2).all(|w| w[0].severity <= w[1].severity),
        "errors, then warnings, then info"
    );
    assert!(rules.iter().all(|r| r.summary.len() > 15));
}

#[test]
fn issues_speak_plainly_and_hints_say_the_fix() {
    let mut b = bench();
    b.add(json!([text(
        "late",
        800.0,
        200.0,
        200.0,
        60.0,
        "off the edge"
    )]));
    let report = b.report();
    let issue = &report.issues[0];
    assert!(issue.message.contains("right edge"), "{}", issue.message);
    assert!(
        issue.hint.as_deref().is_some_and(|h| h.contains("bleed")),
        "{:?}",
        issue.hint
    );
    let json = serde_json::to_value(issue).unwrap();
    assert_eq!(json["severity"], "error");
    assert_eq!(json["rule"], "off-slide");
}
