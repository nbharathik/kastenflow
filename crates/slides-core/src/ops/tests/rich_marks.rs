//! `set_rich_text` with every mark a run can carry: the words come back as they were
//! written, byte for byte, through the file and through undo and redo.

use serde_json::{Value, json};

use super::{add, bytes, engine, text_box};
use crate::canonical;
use crate::model::{ListKind, Text};
use crate::ops::Engine;

/// Every mark an assistant is told about, in two paragraphs of a bulleted list.
fn marked() -> Value {
    json!({ "paragraphs": [
        { "runs": [
            { "t": "Plain, " },
            { "t": "bold", "b": true },
            { "t": " ", "i": true },
            { "t": "italic", "i": true },
            { "t": " and ", "u": true, "s": true },
            { "t": "both", "b": true, "i": true, "u": true }
        ], "list": "bullet", "level": 0 },
        { "runs": [
            { "t": "coloured", "color": "accent1", "size": 28, "font": "heading" },
            { "t": " marked ", "highlight": "#ffee00" },
            { "t": "link", "link": "https://example.org/a" },
            { "t": "code()", "code": true },
            { "t": "x^2", "math": true }
        ], "align": "center", "list": "number", "level": 1, "start": 3 }
    ] })
}

fn text_of(e: &Engine, slide: &str, id: &str) -> Text {
    e.deck()
        .slide(slide)
        .unwrap()
        .element(id)
        .unwrap()
        .text()
        .unwrap()
        .clone()
}

fn set(e: &mut Engine, slide: &str, id: &str, text: Value) {
    e.apply(
        "set_rich_text",
        json!({ "slide": slide, "id": id, "text": text }),
    )
    .unwrap();
}

#[test]
fn runs_keep_every_mark_through_the_file() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let id = text_box(&mut e, &s, 40.0, 40.0, 500.0, 300.0, "old");
    set(&mut e, &s, &id, marked());

    let written = text_of(&e, &s, &id);
    let first = &written.paragraphs[0];
    assert_eq!(first.list, Some(ListKind::Bullet));
    assert!(first.runs[1].bold && !first.runs[1].italic);
    assert!(first.runs[3].italic);
    assert!(first.runs[4].underline && first.runs[4].strike);
    assert!(first.runs[5].bold && first.runs[5].italic && first.runs[5].underline);
    let second = &written.paragraphs[1];
    assert_eq!(second.runs[0].color.as_deref(), Some("accent1"));
    assert_eq!(second.runs[0].size, Some(28.0));
    assert_eq!(second.runs[0].font.as_deref(), Some("heading"));
    assert_eq!(second.runs[1].highlight.as_deref(), Some("#ffee00"));
    assert_eq!(
        second.runs[2].link.as_deref(),
        Some("https://example.org/a")
    );
    assert!(second.runs[3].code && second.runs[4].math);
    assert_eq!(second.start, Some(3));

    // Written, read back and written again, the file is the same bytes and the words the same.
    let file = bytes(e.deck());
    let again = canonical::parse(&file).unwrap();
    assert_eq!(bytes(&again), file);
    assert_eq!(
        again.slide(&s).unwrap().element(&id).unwrap().text(),
        Some(&written)
    );
}

#[test]
fn a_rich_text_goes_back_and_forth_with_undo_and_redo() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let id = text_box(&mut e, &s, 40.0, 40.0, 500.0, 300.0, "old");
    let before = bytes(e.deck());
    set(&mut e, &s, &id, marked());
    let after = bytes(e.deck());
    assert_ne!(before, after);
    e.undo();
    assert_eq!(bytes(e.deck()), before);
    e.redo();
    assert_eq!(bytes(e.deck()), after);
}

#[test]
fn setting_the_words_it_already_has_changes_nothing() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let id = text_box(&mut e, &s, 40.0, 40.0, 500.0, 300.0, "old");
    set(&mut e, &s, &id, marked());
    let before = bytes(e.deck());
    set(&mut e, &s, &id, marked());
    assert_eq!(bytes(e.deck()), before);
}

/// Whatever words an assistant sends are either refused with the deck untouched or
/// kept so that the file, the file read back and undo/redo all give the same bytes.
fn survives(text: Value) {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let id = text_box(&mut e, &s, 40.0, 40.0, 500.0, 300.0, "old");
    let before = bytes(e.deck());
    let applied = e.apply(
        "set_rich_text",
        json!({ "slide": s, "id": id, "text": text.clone() }),
    );
    if applied.is_err() {
        assert_eq!(bytes(e.deck()), before, "refused, so unchanged: {text}");
        return;
    }
    let after = bytes(e.deck());
    let again = canonical::parse(&after).unwrap();
    assert_eq!(bytes(&again), after, "canonical round trip");
    e.undo();
    assert_eq!(bytes(e.deck()), before, "undo");
    e.redo();
    assert_eq!(bytes(e.deck()), after, "redo");
}

#[test]
fn adversarial_runs_never_panic_and_never_break_the_file() {
    survives(json!({ "paragraphs": [] }));
    survives(json!({ "paragraphs": [{ "runs": [] }] }));
    // Empty runs, runs of only marks, many adjacent runs with the same marks.
    survives(json!({ "paragraphs": [{ "runs": [
        { "t": "", "b": true }, { "t": "" }, { "t": "a", "b": true }, { "t": "b", "b": true },
        { "t": "", "i": true, "u": true, "s": true, "code": true, "math": true }
    ] }] }));
    // Marks that overlap by every flag at once, in one run and over neighbours.
    survives(json!({ "paragraphs": [{ "runs": [
        { "t": "a", "b": true, "i": true, "u": true, "s": true, "code": true, "math": true,
          "color": "accent1", "highlight": "#00ff00", "size": 1, "font": "mono", "link": "https://x.org" },
        { "t": "b", "b": true, "color": "#112233" }
    ] }] }));
    // Emoji, joiners, combining marks, right-to-left, nulls and line breaks inside a run.
    for t in [
        "\u{1F600}\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} \u{1F1EE}\u{1F1F3}",
        "e\u{301}\u{0301}\u{0301}",
        "\u{05E9}\u{05DC}\u{05D5}\u{05DD} \u{0645}\u{0631}\u{062D}\u{0628}\u{0627} \u{202E}abc\u{202C}",
        "line one\nline two\r\nline three\ttab",
        "nul\u{0}inside",
        "\u{FEFF}bom and \u{2028} separators \u{2029}",
        "\\ \" ' <script>alert(1)</script> --- ``` $$",
    ] {
        survives(json!({ "paragraphs": [{ "runs": [
            { "t": t, "b": true }, { "t": t, "link": "https://example.org/?q=\u{1F600}" }
        ] }] }));
    }
    // Lists, levels and starts out of range.
    for bad in [
        json!({ "paragraphs": [{ "runs": [{ "t": "x" }], "level": 99 }] }),
        json!({ "paragraphs": [{ "runs": [{ "t": "x" }], "list": "number", "start": 4294967295u64 }] }),
        json!({ "paragraphs": [{ "runs": [{ "t": "x", "size": -3 }] }] }),
        json!({ "paragraphs": [{ "runs": [{ "t": "x", "size": 1e300 }] }] }),
        json!({ "paragraphs": [{ "runs": [{ "t": "x", "link": "javascript:alert(1)" }] }] }),
        json!({ "paragraphs": [{ "runs": [{ "t": "x", "font": "\u{0}" }] }] }),
    ] {
        survives(bad);
    }
}

#[test]
fn text_of_emoji_and_right_to_left_comes_back_as_it_went_in() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let id = text_box(&mut e, &s, 40.0, 40.0, 500.0, 300.0, "old");
    let words = "\u{1F468}\u{200D}\u{1F469} \u{05E9}\u{05DC}\u{05D5}\u{05DD} e\u{301} \"q\" \\ \n";
    set(
        &mut e,
        &s,
        &id,
        json!({ "paragraphs": [{ "runs": [{ "t": words, "b": true }] }] }),
    );
    let file = bytes(e.deck());
    let read = canonical::parse(&file).unwrap();
    let kept = read
        .slide(&s)
        .unwrap()
        .element(&id)
        .unwrap()
        .text()
        .unwrap();
    assert_eq!(kept.paragraphs[0].runs[0].t, words);
}

#[test]
fn a_very_large_text_is_handled_without_a_panic() {
    // 200 KB of one run, and thousands of tiny runs.
    survives(json!({ "paragraphs": [{ "runs": [{ "t": "x".repeat(200 * 1024), "b": true }] }] }));
    let runs: Vec<Value> = (0..5000)
        .map(|i| json!({ "t": format!("w{i} "), "b": i % 2 == 0, "i": i % 3 == 0 }))
        .collect();
    survives(json!({ "paragraphs": [{ "runs": runs }] }));
    let paragraphs: Vec<Value> = (0..2000)
        .map(|i| json!({ "runs": [{ "t": format!("p{i}") }], "list": "bullet", "level": i % 4 }))
        .collect();
    survives(json!({ "paragraphs": paragraphs }));
}

#[test]
fn a_mark_that_is_not_valid_is_refused_and_nothing_changes() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let id = text_box(&mut e, &s, 40.0, 40.0, 500.0, 300.0, "old");
    let before = bytes(e.deck());
    for bad in [
        json!({ "paragraphs": [{ "runs": [{ "t": "x", "highlight": "not a colour" }] }] }),
        json!({ "paragraphs": [{ "runs": [{ "t": "x", "color": "nope" }] }] }),
    ] {
        assert!(
            e.apply(
                "set_rich_text",
                json!({ "slide": s, "id": id, "text": bad })
            )
            .is_err(),
            "{bad}"
        );
    }
    assert!(
        e.apply(
            "set_rich_text",
            json!({ "slide": s, "id": "e-none", "text": marked() })
        )
        .is_err()
    );
    assert_eq!(bytes(e.deck()), before);
}
