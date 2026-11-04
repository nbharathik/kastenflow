//! The deck's own word list and font files: one step of undo each, refusals leave the deck alone,
//! and a deck that has neither writes nothing for them.

use serde_json::{Value, json};

use super::{bytes, engine};
use crate::ops::Engine;

fn done(e: &mut Engine, op: &str, input: Value) {
    let before = bytes(e.deck());
    e.apply(op, input)
        .unwrap_or_else(|err| panic!("{op}: {err}"));
    let after = bytes(e.deck());
    assert_ne!(before, after, "{op} changed nothing");
    e.undo().expect("undo");
    assert_eq!(bytes(e.deck()), before, "undo of {op}");
    e.redo().expect("redo");
    assert_eq!(bytes(e.deck()), after, "redo of {op}");
}

fn refused(e: &mut Engine, op: &str, input: Value) -> String {
    let before = bytes(e.deck());
    let err = e.apply(op, input).expect_err("refused").to_string();
    assert_eq!(bytes(e.deck()), before, "{op} changed the deck");
    err
}

#[test]
fn a_new_deck_writes_neither_words_nor_fonts() {
    // The theme always names its own fonts; what the deck carries is under `present`.
    let value: Value = serde_json::from_str(&bytes(engine().deck())).expect("json");
    let present = value["present"].as_object().expect("present");
    assert!(!present.contains_key("dictionary") && !present.contains_key("fonts"));
}

#[test]
fn words_are_added_once_whatever_their_case_and_taken_out_again() {
    let mut e = engine();
    done(
        &mut e,
        "set_dictionary",
        json!({ "add": ["Kasten", "kasten", " Zod "] }),
    );
    assert_eq!(e.deck().present.dictionary, ["Kasten", "Zod"]);
    done(
        &mut e,
        "set_dictionary",
        json!({ "remove": ["KASTEN"], "add": ["Hexa"] }),
    );
    assert_eq!(e.deck().present.dictionary, ["Zod", "Hexa"]);
}

#[test]
fn a_phrase_or_an_empty_word_is_refused() {
    let mut e = engine();
    assert!(
        refused(&mut e, "set_dictionary", json!({ "add": ["two words"] })).contains("two words")
    );
    refused(&mut e, "set_dictionary", json!({ "add": ["fine", "   "] }));
    assert!(e.deck().present.dictionary.is_empty(), "all or nothing");
    let long = "x".repeat(65);
    refused(&mut e, "set_dictionary", json!({ "add": [long] }));
}

#[test]
fn font_files_are_kept_in_the_order_given_and_are_not_embeddable_by_default() {
    let mut e = engine();
    done(
        &mut e,
        "set_deck_fonts",
        json!({ "fonts": [
            { "family": "Inter", "src": "assets/fonts/Inter-Regular.woff2" },
            { "family": "Inter", "src": "assets/fonts/Inter-Bold.woff2", "bold": true, "embeddable": true },
        ] }),
    );
    let fonts = &e.deck().present.fonts;
    assert_eq!(fonts.len(), 2);
    assert!(!fonts[0].embeddable && fonts[1].embeddable && fonts[1].bold);
    done(&mut e, "set_deck_fonts", json!({ "fonts": [] }));
    assert!(e.deck().present.fonts.is_empty());
}

#[test]
fn a_font_that_could_break_out_of_a_style_rule_or_the_vault_is_refused() {
    let mut e = engine();
    for font in [
        json!({ "family": "Bad\"; x{", "src": "assets/fonts/a.ttf" }),
        json!({ "family": "Ok", "src": "assets/../secret.ttf" }),
        json!({ "family": "Ok", "src": "/etc/passwd.ttf" }),
        json!({ "family": "Ok", "src": "assets/fonts/a.ttf) url(x" }),
        json!({ "family": "Ok", "src": "assets/fonts/a.exe" }),
        json!({ "family": "  ", "src": "assets/fonts/a.ttf" }),
    ] {
        refused(&mut e, "set_deck_fonts", json!({ "fonts": [font] }));
    }
    let twice = json!({ "fonts": [
        { "family": "A", "src": "assets/fonts/a.ttf" },
        { "family": "A", "src": "assets/fonts/b.ttf" },
    ] });
    assert!(refused(&mut e, "set_deck_fonts", twice).contains("already has"));
}

fn add_one(e: &mut Engine, element: Value) -> Result<Value, String> {
    let slide = super::first_slide(e);
    e.apply(
        "add_elements",
        json!({ "slide": slide, "elements": [element] }),
    )
    .map(|out| out.output)
    .map_err(|err| err.to_string())
}

#[test]
fn text_columns_are_one_to_three_and_the_gap_a_sane_space() {
    let mut e = engine();
    let words = json!({ "paragraphs": [{ "runs": [{ "t": "a b c d" }] }] });
    let two = json!({ "type": "text", "x": 10, "y": 10, "w": 400, "h": 200, "text": words, "columns": 2, "columnGap": 24 });
    add_one(&mut e, two).expect("two columns");
    let Some(crate::model::Element::Text(made)) = e.deck().slides[0].elements.last() else {
        panic!("the text box")
    };
    assert_eq!((made.columns, made.column_gap), (Some(2), Some(24.0)));
    for bad in [
        json!({ "columns": 4 }),
        json!({ "columns": 0 }),
        json!({ "columns": 2, "columnGap": -1 }),
        json!({ "columns": 2, "columnGap": 9999 }),
    ] {
        let mut element =
            json!({ "type": "text", "x": 10, "y": 10, "w": 400, "h": 200, "text": words });
        element
            .as_object_mut()
            .expect("object")
            .extend(bad.as_object().expect("object").clone());
        assert!(add_one(&mut e, element).is_err());
    }
}

#[test]
fn an_audio_element_is_added_and_a_volume_out_of_range_is_refused() {
    let mut e = engine();
    let audio = json!({ "type": "audio", "x": 20, "y": 20, "w": 160, "h": 120, "src": "assets/theme.mp3", "across": 3, "hidden": true });
    add_one(&mut e, audio).expect("an audio");
    let loud = json!({ "type": "audio", "x": 20, "y": 20, "w": 160, "h": 120, "src": "assets/theme.mp3", "volume": 3 });
    assert!(
        add_one(&mut e, loud)
            .expect_err("too loud")
            .contains("volume")
    );
    let video = json!({ "type": "video", "x": 20, "y": 20, "w": 320, "h": 180, "src": "assets/clip.mp4", "volume": -0.5 });
    assert!(add_one(&mut e, video).is_err());
}

#[test]
fn unknown_fields_of_a_font_survive_a_round_trip() {
    let mut e = engine();
    e.apply(
        "set_deck_fonts",
        json!({ "fonts": [{ "family": "Inter", "src": "assets/fonts/i.ttf", "licence": "OFL" }] }),
    )
    .expect("fonts");
    assert!(bytes(e.deck()).contains("\"licence\""));
}
