//! Formatting the paragraphs of a text without rewriting its words, and what a box does with words
//! that do not fit it.

use serde_json::json;

use super::{add, bytes, engine, text_box};
use crate::error::Error;
use crate::list;
use crate::model::{ListKind, ListStyle, Text, TextFit};
use crate::ops::Engine;

/// A text box on a new slide holding `words` as one paragraph each.
fn with_words(e: &mut Engine, words: &[&str]) -> (String, String) {
    let s = add(e, "blank", json!({}));
    let id = text_box(e, &s, 40.0, 40.0, 500.0, 300.0, "x");
    let paragraphs: Vec<_> = words
        .iter()
        .map(|w| json!({ "runs": [{ "t": w }] }))
        .collect();
    e.apply(
        "set_rich_text",
        json!({ "slide": s, "id": id, "text": { "paragraphs": paragraphs } }),
    )
    .unwrap();
    (s, id)
}

fn text(e: &Engine, slide: &str, id: &str) -> Text {
    e.deck()
        .slide(slide)
        .unwrap()
        .element(id)
        .unwrap()
        .text()
        .unwrap()
        .clone()
}

#[test]
fn paragraphs_become_a_list_in_the_style_asked_each_as_one_step_of_undo() {
    let mut e = engine();
    let (s, id) = with_words(&mut e, &["one", "two", "three"]);
    let before = bytes(e.deck());
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "set": { "list": "number", "listStyle": "upperAlpha", "level": 1 } }),
    )
    .unwrap();
    let t = text(&e, &s, &id);
    assert!(t.paragraphs.iter().all(|p| {
        p.list == Some(ListKind::Number)
            && p.list_style == Some(ListStyle::UpperAlpha)
            && p.level == Some(1)
    }));
    assert_eq!(
        list::markers(&t.paragraphs),
        [
            Some("A.".to_owned()),
            Some("B.".to_owned()),
            Some("C.".to_owned())
        ]
    );
    assert_eq!(e.undo_label(), Some("format_paragraphs"));
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before, "undo puts back the exact bytes");
}

#[test]
fn some_paragraphs_only_and_the_words_never_change() {
    let mut e = engine();
    let (s, id) = with_words(&mut e, &["one", "two", "three"]);
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "paragraphs": [1], "set": { "list": "bullet", "listStyle": "arrow", "marginLeft": 50.0, "indent": -20.0 } }),
    )
    .unwrap();
    let t = text(&e, &s, &id);
    assert_eq!(t.plain_text(), "one\ntwo\nthree");
    assert_eq!(
        t.paragraphs
            .iter()
            .map(|p| p.list.clone())
            .collect::<Vec<_>>(),
        [None, Some(ListKind::Bullet), None]
    );
    assert_eq!(t.paragraphs[1].margin_left, Some(50.0));
    assert_eq!(t.paragraphs[1].indent, Some(-20.0));
    assert!(t.paragraphs[0].list_style.is_none() && t.paragraphs[2].margin_left.is_none());
}

#[test]
fn restarting_and_continuing_a_list_is_the_number_an_item_starts_at() {
    let mut e = engine();
    let (s, id) = with_words(&mut e, &["a", "b", "c", "d"]);
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "set": { "list": "number" } }),
    )
    .unwrap();
    assert_eq!(
        list::numbers(&text(&e, &s, &id).paragraphs),
        [Some(1), Some(2), Some(3), Some(4)]
    );
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "paragraphs": [2], "set": { "start": 1 } }),
    )
    .unwrap();
    assert_eq!(
        list::numbers(&text(&e, &s, &id).paragraphs),
        [Some(1), Some(2), Some(1), Some(2)]
    );
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "paragraphs": [2], "set": { "start": 3 } }),
    )
    .unwrap();
    assert_eq!(
        list::numbers(&text(&e, &s, &id).paragraphs),
        [Some(1), Some(2), Some(3), Some(4)]
    );
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "paragraphs": [2], "clear": ["start"] }),
    )
    .unwrap();
    assert!(
        text(&e, &s, &id)
            .paragraphs
            .iter()
            .all(|p| p.start.is_none())
    );
}

#[test]
fn clearing_a_list_takes_its_marker_and_counting_with_it_and_leaves_the_rest() {
    let mut e = engine();
    let (s, id) = with_words(&mut e, &["a", "b"]);
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "set": { "list": "number", "start": 4, "bulletColor": "accent2", "bulletSize": 1.5, "align": "center", "level": 2 } }),
    )
    .unwrap();
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "clear": ["list"] }),
    )
    .unwrap();
    let t = text(&e, &s, &id);
    for p in &t.paragraphs {
        assert!(
            p.list.is_none()
                && p.start.is_none()
                && p.bullet_color.is_none()
                && p.bullet_size.is_none()
        );
        assert_eq!(
            (p.level, p.align.clone()),
            (Some(2), Some(crate::model::Align::Center))
        );
    }
}

#[test]
fn level_zero_is_no_level_and_a_paragraph_that_is_not_there_is_refused() {
    let mut e = engine();
    let (s, id) = with_words(&mut e, &["a", "b"]);
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "set": { "level": 3 } }),
    )
    .unwrap();
    e.apply(
        "format_paragraphs",
        json!({ "slide": s, "id": id, "set": { "level": 0 } }),
    )
    .unwrap();
    assert!(
        text(&e, &s, &id)
            .paragraphs
            .iter()
            .all(|p| p.level.is_none())
    );

    // A marker can be drawn at 25% to 400% of its words, as a file can say.
    for share in [0.25, 1.0, 4.0] {
        e.apply(
            "format_paragraphs",
            json!({ "slide": s, "id": id, "set": { "bulletSize": share } }),
        )
        .unwrap();
    }

    let before = bytes(e.deck());
    for bad in [
        json!({ "slide": s, "id": id, "paragraphs": [2], "set": { "align": "left" } }),
        json!({ "slide": s, "id": id, "set": { "level": 9 } }),
        json!({ "slide": s, "id": id, "set": { "bulletSize": 0 } }),
        json!({ "slide": s, "id": id, "set": { "bulletSize": 0.24 } }),
        json!({ "slide": s, "id": id, "set": { "bulletSize": 4.01 } }),
        json!({ "slide": s, "id": id, "set": { "bulletColor": "nonsense" } }),
        json!({ "slide": s, "id": id, "set": { "start": 100000 } }),
        json!({ "slide": s, "id": id, "set": { "marginLeft": -4 } }),
        json!({ "slide": s, "id": id, "set": { "listStyle": "wavy" } }),
    ] {
        assert!(
            matches!(
                e.apply("format_paragraphs", bad.clone()),
                Err(Error::BadInput { .. } | Error::Invalid { .. })
            ),
            "{bad}"
        );
    }
    assert_eq!(bytes(e.deck()), before, "a refusal changes nothing");
}

#[test]
fn an_element_with_no_words_is_refused() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let out = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [{ "type": "line", "x": 0, "y": 0, "w": 100, "h": 10 }] }),
        )
        .unwrap();
    let id = out.output["ids"][0].as_str().unwrap().to_owned();
    assert!(matches!(
        e.apply(
            "format_paragraphs",
            json!({ "slide": s, "id": id, "set": { "align": "left" } })
        ),
        Err(Error::Refused { .. })
    ));
}

#[test]
fn the_operation_is_a_tool_an_agent_can_read() {
    assert!(crate::ops::names().contains(&"format_paragraphs"));
    let spec = crate::ops::specs()
        .into_iter()
        .find(|s| s.name == "format_paragraphs")
        .unwrap();
    assert!(spec.about.contains("numbering"), "{}", spec.about);
    let schema = spec.input.to_string();
    assert!(
        schema.contains("listStyle") && schema.contains("lowerRoman"),
        "{schema}"
    );
    assert!(
        crate::agent::tools()
            .iter()
            .any(|t| t.name == "format_paragraphs")
    );
}

#[test]
fn a_slot_fills_to_shrink_its_words_and_set_text_keeps_what_a_box_does_with_them() {
    let mut e = engine();
    let s = add(&mut e, "title-body", json!({ "title": "T", "body": "- a" }));
    let slide = e.deck().slide(&s).unwrap();
    for element in &slide.elements {
        if let Some(role) = element.base().placeholder.as_deref() {
            let fit = element.text().and_then(|t| t.fit.clone());
            assert_eq!(fit, Some(TextFit::Shrink), "{role}");
        }
    }
    let id = slide
        .elements
        .iter()
        .find(|x| x.base().placeholder.as_deref() == Some("body"))
        .unwrap()
        .id()
        .to_owned();
    // A text box of one's own says what it does with words that do not fit, and set_text leaves that alone.
    let mut rich = text(&e, &s, &id);
    rich.fit = Some(TextFit::Resize);
    rich.wrap = Some(false);
    e.apply(
        "set_rich_text",
        json!({ "slide": s, "id": id, "text": rich }),
    )
    .unwrap();
    e.apply(
        "set_text",
        json!({ "slide": s, "id": id, "markdown": "new words" }),
    )
    .unwrap();
    let after = text(&e, &s, &id);
    assert_eq!(after.plain_text(), "new words");
    assert_eq!(
        (after.fit, after.wrap),
        (Some(TextFit::Resize), Some(false))
    );
}

#[test]
fn what_a_box_does_with_its_words_survives_the_file() {
    let mut e = engine();
    let (s, id) = with_words(&mut e, &["x"]);
    let mut t = text(&e, &s, &id);
    t.fit = Some(TextFit::Shrink);
    t.wrap = Some(false);
    t.paragraphs[0].runs[0].script = Some(crate::model::Script::Super);
    t.paragraphs[0].runs[0].small_caps = true;
    t.paragraphs[0].runs[0].spacing = Some(1.5);
    t.paragraphs[0].list = Some(ListKind::Number);
    t.paragraphs[0].start = Some(7);
    e.apply("set_rich_text", json!({ "slide": s, "id": id, "text": t }))
        .unwrap();
    let written = bytes(e.deck());
    assert!(written.contains("\"fit\": \"shrink\"") && written.contains("\"wrap\": false"));
    assert!(written.contains("\"script\": \"super\"") && written.contains("\"smallCaps\": true"));
    assert!(written.contains("\"start\": 7") && written.contains("\"spacing\": 1.5"));
    let back = crate::canonical::parse(&written).unwrap();
    assert_eq!(bytes(&back), written);
}
