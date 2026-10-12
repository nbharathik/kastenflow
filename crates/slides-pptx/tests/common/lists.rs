//! A deck of lists in every style and level, markers with a look of their own,
//! and boxes that fit, wrap and set their words in every way the model has.

use serde_json::{Value, json};
use slides_core::Deck;

use super::decks::{frame, pictures, with};
use super::{Builder, Files, para, runs};

/// A list item: its kind, style (`""` for the level's own), level and words.
fn listed(kind: &str, style: &str, level: u8, text: &str) -> Value {
    let mut p = json!({ "list": kind, "level": level, "runs": [{ "t": text }] });
    if !style.is_empty() {
        p["listStyle"] = json!(style);
    }
    p
}

/// A paragraph with more set on it.
fn set(mut paragraph: Value, extra: Value) -> Value {
    if let (Some(p), Some(e)) = (paragraph.as_object_mut(), extra.as_object()) {
        p.extend(e.clone());
    }
    paragraph
}

/// A text box with what the box does (`fit`, `wrap`) and its paragraphs.
fn boxed(id: &str, at: (f64, f64, f64, f64), how: Value, paragraphs: Vec<Value>) -> Value {
    let text = set(json!({ "paragraphs": paragraphs }), how);
    with(
        json!({ "type": "text", "id": id, "text": text }),
        frame(at.0, at.1, at.2, at.3),
    )
}

/// Lists in every style, restarted and counted on from a number, with markers coloured and sized.
pub fn list_looks() -> (Deck, Files) {
    let mut b = Builder::new("Light", "Lists and the settings of a box", 81);
    let markers = b.slide("title-only", json!({ "title": "Markers of every style" }));
    b.add(
        &markers.id,
        json!([
            boxed(
                "glyphs",
                (40.0, 150.0, 280.0, 340.0),
                json!({}),
                vec![
                    listed("bullet", "disc", 0, "Disc"),
                    listed("bullet", "circle", 1, "Circle"),
                    listed("bullet", "square", 2, "Square"),
                    listed("bullet", "arrow", 0, "Arrow"),
                    listed("bullet", "check", 0, "Check"),
                    listed("bullet", "dash", 0, "Dash"),
                    listed("bullet", "", 1, "The level's own"),
                    listed("bullet", "", 2, "and the next"),
                    listed("bullet", "", 3, "and the next"),
                    listed("bullet", "arrow", 4, "A fifth level"),
                    listed("bullet", "", 8, "The ninth level"),
                ]
            ),
            boxed(
                "counts",
                (340.0, 150.0, 280.0, 340.0),
                json!({}),
                vec![
                    listed("number", "decimal", 0, "One"),
                    listed("number", "decimal", 0, "Two"),
                    listed("number", "lowerAlpha", 1, "a"),
                    listed("number", "lowerAlpha", 1, "b"),
                    listed("number", "lowerRoman", 2, "i"),
                    listed("number", "decimal", 0, "Three"),
                    set(
                        listed("number", "decimal", 0, "Starts again at ten"),
                        json!({ "start": 10 })
                    ),
                    listed("number", "decimal", 0, "Eleven"),
                    para("A paragraph ends the list"),
                    listed("number", "decimalParen", 0, "Parenthesis"),
                    listed("number", "decimalParen", 0, "after"),
                    para("Again"),
                    set(
                        listed("number", "upperRoman", 0, "Four in capitals"),
                        json!({ "start": 4 })
                    ),
                    listed("number", "upperRoman", 0, "Five"),
                    listed("number", "upperAlpha", 1, "A"),
                    listed("number", "upperAlpha", 1, "B"),
                ]
            ),
            boxed(
                "looks",
                (640.0, 150.0, 280.0, 340.0),
                json!({}),
                vec![
                    set(
                        listed("bullet", "square", 0, "A red marker"),
                        json!({ "bulletColor": "#c0392b" })
                    ),
                    set(
                        listed("bullet", "disc", 0, "A big accent marker"),
                        json!({ "bulletColor": "accent2", "bulletSize": 1.4 })
                    ),
                    set(
                        listed("bullet", "disc", 0, "A small one"),
                        json!({ "bulletSize": 0.6 })
                    ),
                    set(
                        listed("bullet", "check", 0, "Hung from further in"),
                        json!({ "marginLeft": 60.0, "indent": -30.0 })
                    ),
                    set(
                        listed("number", "decimal", 0, "Numbers coloured and sized"),
                        json!({ "bulletColor": "accent1", "bulletSize": 1.2 })
                    ),
                    set(
                        listed("number", "decimal", 1, "and hung wide"),
                        json!({ "marginLeft": 80.0, "indent": -40.0 })
                    ),
                    set(
                        para("A plain paragraph indented"),
                        json!({ "marginLeft": 36.0, "indent": 18.0 })
                    ),
                ]
            ),
        ]),
    );

    let boxes = b.slide(
        "title-only",
        json!({ "title": "What a box does with its words" }),
    );
    let long = "Words that run on for a good while, so that the box they are in is too small to hold them at the size they were set in, and something has to give way. ";
    b.add(
        &boxes.id,
        json!([
            boxed(
                "shrinks",
                (40.0, 150.0, 220.0, 120.0),
                json!({ "fit": "shrink" }),
                vec![para(&long.repeat(2))]
            ),
            boxed(
                "grows",
                (300.0, 150.0, 220.0, 120.0),
                json!({ "fit": "resize" }),
                vec![para(long)]
            ),
            boxed(
                "spills",
                (560.0, 150.0, 220.0, 120.0),
                json!({ "fit": "none" }),
                vec![para("Left as it is, as the default is")]
            ),
            boxed(
                "one line",
                (40.0, 310.0, 300.0, 50.0),
                json!({ "wrap": false }),
                vec![para("A line that never wraps, however long")]
            ),
            boxed(
                "marks",
                (380.0, 310.0, 540.0, 190.0),
                json!({}),
                vec![
                    runs(&[
                        ("E = mc", json!({})),
                        ("2", json!({ "script": "super" })),
                        (" and H", json!({})),
                        ("2", json!({ "script": "sub" })),
                        ("O", json!({})),
                    ]),
                    runs(&[
                        ("Small caps ", json!({ "smallCaps": true })),
                        ("ALL CAPS ", json!({ "allCaps": true })),
                        ("spread ", json!({ "spacing": 2.0 })),
                        ("tight ", json!({ "spacing": -0.5 })),
                        ("and plain", json!({})),
                    ]),
                    set(
                        runs(&[
                            ("Raised ", json!({ "script": "super", "size": 30 })),
                            ("lowered", json!({ "script": "sub", "bold": true }))
                        ]),
                        json!({ "align": "center" })
                    ),
                ]
            ),
        ]),
    );

    // Empty paragraphs measured by their mark, and markers sized as a share of their words.
    let marks = b.slide(
        "title-only",
        json!({ "title": "Marks of empty paragraphs" }),
    );
    let small = |t: &str, extra: Value| json!({ "list": "bullet", "runs": [set(json!({ "t": t, "size": 12 }), extra)] });
    b.add(
        &marks.id,
        json!([
            boxed(
                "marked",
                (40.0, 150.0, 420.0, 340.0),
                json!({}),
                vec![
                    small("How are you doing", json!({})),
                    small("", json!({})),
                    small("", json!({ "color": "accent2", "b": true })),
                    set(
                        json!({ "runs": [{ "t": "", "size": 40 }] }),
                        json!({ "align": "right" })
                    ),
                    set(
                        small("Last, with a larger marker", json!({})),
                        json!({ "bulletSize": 2.0 })
                    ),
                    set(
                        small("", json!({})),
                        json!({ "bulletSize": 2.0, "bulletColor": "#c0392b" })
                    ),
                ]
            ),
            boxed(
                "shares",
                (500.0, 150.0, 420.0, 340.0),
                json!({}),
                vec![
                    set(
                        small("A quarter", json!({ "size": 24 })),
                        json!({ "bulletSize": 0.25 })
                    ),
                    set(
                        small("Half", json!({ "size": 24 })),
                        json!({ "bulletSize": 0.5 })
                    ),
                    set(
                        small("The size of the words", json!({ "size": 24 })),
                        json!({})
                    ),
                    set(
                        small("Four times", json!({ "size": 24 })),
                        json!({ "bulletSize": 4.0 })
                    ),
                    set(
                        small("", json!({ "size": 24 })),
                        json!({ "bulletSize": 4.0 })
                    ),
                ]
            ),
        ]),
    );
    (b.deck(), pictures())
}
