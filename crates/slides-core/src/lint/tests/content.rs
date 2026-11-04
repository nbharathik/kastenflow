//! The rules about what is on the slide: empty-placeholder, empty-text-box,
//! missing-alt, unresolved-citation, step-orphan and pptx-unsafe; and composites.

use serde_json::json;

use super::{bench, expect, found, image, of_rule, text};
use crate::lint::Severity::{Error, Info, Warning};
use crate::lint::{Options, Refs, lint_deck_with};
use crate::model::{StepState, TransitionKind};

#[test]
fn empty_placeholder_finds_slots_left_empty() {
    let mut b = bench();
    let (bodyless, slots) = b.add_slide("title-body", json!({ "title": "A title" }));
    let (pictureless, more) = b.add_slide(
        "title-image",
        json!({ "title": "Another", "body": "- with words" }),
    );
    let body = slots["body"].as_str().unwrap();
    let picture = more["image"].as_str().unwrap();
    let report = b.report();
    assert_eq!(report.issues.len(), 2, "{:?}", found(&report));
    let (first, second) = (&report.issues[0], &report.issues[1]);
    assert_eq!(
        (
            first.rule.as_str(),
            first.severity,
            first.slide.as_str(),
            first.element.as_deref()
        ),
        ("empty-placeholder", Warning, bodyless.as_str(), Some(body))
    );
    assert_eq!(
        (
            second.rule.as_str(),
            second.slide.as_str(),
            second.element.as_deref()
        ),
        ("empty-placeholder", pictureless.as_str(), Some(picture))
    );
    assert!(
        first.message.contains("body") && first.message.contains("Title + body"),
        "{}",
        first.message
    );
    assert!(second.hint.as_deref().unwrap_or("").contains("place_image"));
}

#[test]
fn empty_text_box_reports_a_box_of_its_own_with_nothing_in_it() {
    let mut b = bench();
    let mut filled = text("filled", 64.0, 300.0, 200.0, 40.0, "");
    filled["style"] = json!({ "fill": { "color": "accent1" } });
    b.add(json!([
        text("blank", 64.0, 100.0, 300.0, 40.0, ""),
        text("spaces", 64.0, 160.0, 300.0, 40.0, "   "),
        text("words", 64.0, 220.0, 300.0, 40.0, "Hello there"),
        filled,
    ]));
    let report = b.report();
    assert_eq!(
        found(&report),
        expect(&[
            ("empty-text-box", Warning, Some("blank")),
            ("empty-text-box", Warning, Some("spaces")),
        ])
    );
    let first = &report.issues[0];
    assert!(first.message.contains("no words"), "{}", first.message);
    assert!(
        first
            .hint
            .as_deref()
            .is_some_and(|h| h.contains("set_text")),
        "{:?}",
        first.hint
    );
}

#[test]
fn empty_text_box_leaves_a_layout_slot_to_its_own_rule() {
    let mut b = bench();
    let (bodyless, slots) = b.add_slide("title-body", json!({ "title": "A title" }));
    let report = b.report();
    assert!(
        of_rule(&report, "empty-text-box").is_empty(),
        "{:?}",
        found(&report)
    );
    let body = slots["body"].as_str().unwrap().to_owned();
    assert_eq!(
        found(&report),
        vec![("empty-placeholder".to_owned(), Warning, Some(body))]
    );
    assert_eq!(report.issues[0].slide, bodyless);
}

#[test]
fn missing_alt_wants_words_for_a_picture_that_has_a_file() {
    let mut b = bench();
    let mut nofile = image("empty", 400.0, 200.0, 100.0, 100.0, None);
    nofile["src"] = json!("");
    b.add(json!([
        image("noalt", 64.0, 100.0, 200.0, 100.0, None),
        image(
            "alt",
            64.0,
            300.0,
            200.0,
            100.0,
            Some("A bar chart of latency")
        ),
        image("blank-alt", 300.0, 300.0, 100.0, 100.0, Some("   ")),
        nofile,
    ]));
    assert_eq!(
        found(&b.report()),
        expect(&[
            ("missing-alt", Info, Some("noalt")),
            ("missing-alt", Info, Some("blank-alt")),
        ])
    );
}

#[test]
fn unresolved_citation_checks_keys_against_the_references_when_it_has_them() {
    let mut b = bench();
    b.add(json!([
        { "type": "citation", "id": "cite", "x": 64, "y": 470, "w": 500, "h": 30, "keys": ["vaswani2017attention", "vaswani2017"] },
    ]));
    let refs = Refs::new(["vaswani2017attention", "he2016resnet"]);
    let options = Options {
        measures: None,
        refs: Some(&refs),
    };
    let report = lint_deck_with(b.deck(), &options);
    let unresolved = of_rule(&report, "unresolved-citation");
    assert_eq!(unresolved.len(), 1, "{:?}", found(&report));
    assert_eq!(
        (unresolved[0].severity, unresolved[0].element.as_deref()),
        (Error, Some("cite"))
    );
    assert!(
        unresolved[0].message.contains("vaswani2017\"")
            && unresolved[0].message.contains("vaswani2017attention"),
        "{}",
        unresolved[0].message
    );
    assert!(
        report
            .skipped
            .iter()
            .all(|s| s.rule != "unresolved-citation")
    );
    // Without a list nothing is reported, and the report says why.
    let unchecked = b.report();
    assert!(of_rule(&unchecked, "unresolved-citation").is_empty());
    assert!(
        unchecked
            .skipped
            .iter()
            .any(|s| s.rule == "unresolved-citation" && s.reason.contains("reference list"))
    );
}

#[test]
fn step_orphan_finds_changes_at_steps_the_slide_does_not_have() {
    let mut b = bench();
    b.add(json!([
        text("late", 64.0, 100.0, 300.0, 40.0, "changes at step three"),
        text("early", 64.0, 200.0, 300.0, 40.0, "changes at step one"),
        json!({ "type": "text", "id": "list", "x": 64, "y": 300, "w": 400, "h": 100,
            "text": { "paragraphs": [{ "list": "bullet", "step": 5, "runs": [{ "t": "appears at step five" }] }] } }),
    ]));
    let deck = b.changed(|deck| {
        let slide = deck.slide_mut(&b.slide).unwrap();
        slide.steps = 2;
        for e in &mut slide.elements {
            match e.id() {
                "late" => {
                    e.base_mut().step_states.insert(3, StepState::Hidden);
                }
                "early" => {
                    e.base_mut().step_states.insert(1, StepState::Hidden);
                }
                _ => {}
            }
        }
    });
    let report = crate::lint::lint_deck(&deck, None);
    assert_eq!(
        found(&report),
        expect(&[
            ("step-orphan", Warning, Some("late")),
            ("step-orphan", Warning, Some("list")),
        ])
    );
    assert!(
        report.issues[0].message.contains("step 3") && report.issues[0].message.contains("2 steps"),
        "{}",
        report.issues[0].message
    );
    assert!(
        report.issues[1].message.contains("step 5"),
        "{}",
        report.issues[1].message
    );
}

#[test]
fn a_sound_plays_only_in_the_show_and_gets_its_icon_elsewhere() {
    let mut b = bench();
    b.add(json!([
        { "type": "audio", "id": "tune", "x": 64, "y": 320, "w": 160, "h": 140, "src": "assets/theme.mp3" },
    ]));
    let report = crate::lint::lint_deck(b.deck(), None);
    let issues = of_rule(&report, "pptx-unsafe");
    let who: Vec<Option<&str>> = issues.iter().map(|i| i.element.as_deref()).collect();
    assert_eq!(who, [Some("tune")]);
    assert!(
        issues[0].message.contains("plays only when presenting"),
        "{}",
        issues[0].message
    );
    assert!(issues[0].message.contains("icon"), "{}", issues[0].message);
}

#[test]
fn pptx_unsafe_names_what_powerpoint_and_google_slides_cannot_read() {
    let mut b = bench();
    let mut math = text("inline", 64.0, 420.0, 400.0, 40.0, "x");
    math["text"]["paragraphs"][0]["runs"] = json!([{ "t": "E = mc^2", "math": true }]);
    b.add(json!([
        { "type": "embed", "id": "page", "x": 64, "y": 100, "w": 400, "h": 200, "url": "https://example.com/demo" },
        { "type": "embed", "id": "shot", "x": 500, "y": 100, "w": 400, "h": 200, "url": "https://example.com/demo", "poster": "assets/shot.png" },
        { "type": "video", "id": "clip", "x": 64, "y": 320, "w": 300, "h": 90, "src": "assets/clip.mp4", "poster": "assets/clip.png" },
        { "type": "raw", "id": "chart", "x": 500, "y": 320, "w": 300, "h": 90, "original": "pptx:chart" },
        math,
    ]));
    let deck = b.changed(|deck| {
        deck.slide_mut(&b.slide).unwrap().transition = Some(crate::model::Transition {
            kind: TransitionKind::Morph,
            duration: None,
            direction: None,
            easing: None,
            extra: crate::model::Extra::new(),
        });
    });
    let report = crate::lint::lint_deck(&deck, None);
    let unsafe_issues = of_rule(&report, "pptx-unsafe");
    let who: Vec<Option<&str>> = unsafe_issues.iter().map(|i| i.element.as_deref()).collect();
    assert_eq!(
        who,
        [
            None,
            Some("page"),
            Some("clip"),
            Some("chart"),
            Some("inline")
        ]
    );
    assert!(
        unsafe_issues
            .iter()
            .all(|i| i.severity == Warning && i.hint.is_some())
    );
    assert!(
        unsafe_issues[0].message.contains("Morph"),
        "{}",
        unsafe_issues[0].message
    );
    assert!(
        unsafe_issues[4].message.contains("LaTeX"),
        "{}",
        unsafe_issues[4].message
    );
}

#[test]
fn an_issue_in_a_part_of_a_composite_is_reported_once_on_the_composite() {
    let mut b = bench();
    b.add(json!([
        { "type": "code", "id": "snippet", "x": 880, "y": 100, "w": 200, "h": 120, "language": "python", "code": "print(1)\nprint(2)" },
        { "type": "card-grid", "id": "cards", "x": 64, "y": 100, "w": 500, "h": 200, "cards": [{ "title": "One" }, { "title": "Two" }, { "title": "Three" }] },
    ]));
    let report = b.report();
    let out = of_rule(&report, "off-slide");
    assert_eq!(out.len(), 1, "{:?}", found(&report));
    assert_eq!(out[0].element.as_deref(), Some("snippet"));
    assert!(out[0].message.contains("code block"), "{}", out[0].message);
    // Nothing is reported on a part's own id.
    assert!(
        report
            .issues
            .iter()
            .all(|i| i.element.as_deref().is_none_or(|e| !e.contains('.')))
    );
}
