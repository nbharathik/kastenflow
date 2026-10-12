//! Decks of more variety: heavy with text, turned and mirrored, at 4:3, in each
//! theme, in sections, and a large one for timing.

use serde_json::{Value, json};
use slides_core::{Deck, Section};

use super::decks::{frame, labelled, pictures, with};
use super::samples;
use super::{Builder, Files, item, para, runs};

/// Text in every look the model has, on slides small enough to read in a contact sheet.
pub fn text_heavy() -> (Deck, Files) {
    let mut b = Builder::new("Serif", "A talk with words", 41);
    let looks = b.slide(
        "title-only",
        json!({ "title": "Every look a run can have" }),
    );
    let body = b.add(
        &looks.id,
        json!([with(
            json!({ "type": "text", "id": "words", "text": { "paragraphs": [] } }),
            frame(64.0, 150.0, 832.0, 340.0)
        )]),
    );
    b.words(
        &looks.id,
        &body[0],
        vec![
            runs(&[
                ("bold ", json!({ "b": true })),
                ("italic ", json!({ "i": true })),
                ("underline ", json!({ "u": true })),
                ("strike ", json!({ "s": true })),
                ("red ", json!({ "color": "#c0392b" })),
                ("accent ", json!({ "color": "accent2" })),
                ("big ", json!({ "size": 30 })),
                ("small ", json!({ "size": 9.5 })),
                ("Georgia ", json!({ "font": "Georgia" })),
                ("heading ", json!({ "font": "heading" })),
                ("code()", json!({ "code": true })),
            ]),
            runs(&[("Line one\nline two after a break, then ", json!({})), ("a link", json!({ "link": "https://example.com/a?b=1&c=2" })), (" and a jump", json!({ "link": "slide:none" }))]),
            json!({ "align": "center", "spaceBefore": 12, "spaceAfter": 6, "lineSpacing": 1.5, "runs": [{ "t": "Centred, with space around it and one and a half lines" }] }),
            json!({ "align": "right", "runs": [{ "t": "Right" }] }),
            json!({ "align": "justify", "runs": [{ "t": "Justified text needs a few more words to show what it does at the end of a line, so this sentence goes on." }] }),
        ],
    );
    b.notes(&looks.id, "# Notes\n\n**Bold** and *italic* and `code`\n\n- one\n  - two\n1. first\n\nSee [the docs](https://example.com).");

    let lists = b.slide(
        "title-only",
        json!({ "title": "Lists, numbers and fields" }),
    );
    let body = b.add(
        &lists.id,
        json!([
            with(
                json!({ "type": "text", "id": "lists", "text": { "paragraphs": [] } }),
                frame(64.0, 150.0, 400.0, 340.0)
            ),
            with(
                json!({ "type": "text", "id": "numbers", "text": { "paragraphs": [] } }),
                frame(496.0, 150.0, 400.0, 340.0)
            )
        ]),
    );
    b.words(
        &lists.id,
        &body[0],
        vec![
            item("bullet", 0, "Bullets"),
            item("bullet", 1, "on"),
            item("bullet", 2, "three"),
            item("bullet", 3, "or four levels"),
            json!({ "style": "caption", "runs": [{ "t": "A paragraph in the caption style" }] }),
            json!({ "runs": [{ "t": "Inline math: " }, { "t": "e^{i\\pi}+1=0", "math": true }, { "t": " and a field: " }, { "t": "‹#›", "field": "slideNumber" }] }),
        ],
    );
    b.words(
        &lists.id,
        &body[1],
        vec![
            item("number", 0, "Numbers"),
            item("number", 0, "count"),
            item("number", 1, "and nest"),
            item("number", 1, "twice"),
            item("number", 2, "or thrice"),
            item("number", 0, "then carry on"),
            para("A plain paragraph restarts them"),
            item("number", 0, "again from one"),
            item("number", 0, "two"),
            item("number", 0, "three"),
            item("number", 0, "four"),
            item("number", 0, "five"),
            item("number", 0, "six"),
            item("number", 0, "seven"),
            item("number", 0, "eight"),
            item("number", 0, "nine"),
            item("number", 0, "ten, which is wider"),
        ],
    );

    let columns = b.slide(
        "comparison",
        json!({ "title": "Comparison", "label": "Before", "label2": "After" }),
    );
    b.words(
        &columns.id,
        columns.slot("body"),
        vec![item("bullet", 0, "Slow"), item("bullet", 0, "Manual")],
    );
    b.words(
        &columns.id,
        columns.slot("body2"),
        vec![item("bullet", 0, "Fast"), item("bullet", 0, "Automatic")],
    );
    let big = b.slide(
        "big-number",
        json!({ "number": "42", "label": "the answer" }),
    );
    b.flags(&big.id, Some(true), None);
    let backup = b.slide("title-only", json!({ "title": "Backup: details" }));
    b.flags(&backup.id, None, Some(true));
    b.slide(
        "section",
        json!({ "title": "A section", "subtitle": "with a subtitle" }),
    );
    b.slide(
        "code",
        json!({ "title": "Code", "code": "fn main() {\n    println!(\"hi\");\n}" }),
    );
    (b.deck(), pictures())
}

/// Shapes turned and mirrored every way, and lines in every direction.
pub fn turned() -> (Deck, Files) {
    let mut b = Builder::new("Light", "Turned", 51);
    let s = b.slide("blank", json!({}));
    let mut elements = Vec::new();
    for (i, (rotation, flip_h, flip_v)) in [
        (0.0, false, false),
        (30.0, false, false),
        (90.0, false, false),
        (-45.0, true, false),
        (200.0, false, true),
        (315.5, true, true),
    ]
    .into_iter()
    .enumerate()
    {
        let x = 60.0 + (i % 3) as f64 * 300.0;
        let y = 40.0 + (i / 3) as f64 * 200.0;
        elements.push(with(
            with(
                labelled(
                    &format!("t{i}"),
                    "rightArrow",
                    (x, y, 200.0, 90.0),
                    (i % 6) as u8 + 1,
                    &format!("{rotation}"),
                ),
                json!({ "rotation": rotation }),
            ),
            json!({ "flipH": flip_h, "flipV": flip_v }),
        ));
    }
    for (i, (flip_h, flip_v)) in [(false, false), (true, false), (false, true), (true, true)]
        .into_iter()
        .enumerate()
    {
        elements.push(with(
            json!({ "type": "line", "id": format!("d{i}"), "flipH": flip_h, "flipV": flip_v, "style": { "stroke": { "color": "accent1", "width": 2 }, "endArrow": "triangle" } }),
            frame(60.0 + i as f64 * 120.0, 440.0, 90.0, 70.0),
        ));
    }
    elements.push(with(json!({ "type": "image", "id": "spin", "src": "assets/figure.png", "rotation": 15, "mask": "roundRect" }), frame(600.0, 430.0, 120.0, 75.0)));
    elements.push(with(json!({ "type": "text", "id": "tilt", "rotation": -8, "text": { "paragraphs": [para("A tilted text box")] } }), frame(740.0, 440.0, 190.0, 40.0)));
    b.add(&s.id, Value::Array(elements));
    (b.deck(), pictures())
}

/// A 4:3 deck.
pub fn four_three() -> (Deck, Files) {
    let mut deck = Builder::new("Lecture", "Four by three", 61).deck();
    deck.size = slides_core::Size {
        w: 720.0,
        h: 540.0,
        extra: slides_core::Extra::new(),
    };
    let mut b = Builder::from_deck(deck, 62);
    let s = b.slide("title-body", json!({ "title": "An older screen" }));
    b.words(
        &s.id,
        s.slot("body"),
        vec![
            item("bullet", 0, "720 by 540 units"),
            item("bullet", 0, "7.5 by 5.625 inches"),
        ],
    );
    b.apply("set_logo", json!({ "src": "assets/logo.png" }));
    (b.deck(), pictures())
}

/// A deck in each theme, each with a title, a list, a picture and a slide in every layout.
pub fn every_theme() -> Vec<(String, Deck, Files)> {
    slides_core::themes::all()
        .into_iter()
        .map(|built_in| built_in.name)
        .map(|theme| {
            let theme = theme.as_str();
            let mut b = Builder::new(theme, &format!("{theme} theme"), 71);
            let layouts: Vec<String> = b
                .engine
                .deck()
                .theme
                .layouts
                .iter()
                .map(|l| l.name.clone())
                .collect();
            for layout in layouts.iter().filter(|l| l.as_str() != "title") {
                let mut content = serde_json::Map::new();
                for role in b
                    .engine
                    .deck()
                    .theme
                    .layout(layout)
                    .map(|l| l.placeholders.clone())
                    .unwrap_or_default()
                {
                    if role.kind == slides_core::PlaceholderKind::Text {
                        content.insert(
                            role.role.clone(),
                            json!(format!("{} {}", layout, role.role)),
                        );
                    }
                }
                let s = b.slide(layout, Value::Object(content));
                if layout == "title-image" || layout == "image-caption" {
                    b.patch(
                        &s.id,
                        s.slot("image"),
                        json!({ "src": "assets/figure.png", "alt": "figure" }),
                    );
                }
            }
            if theme == "Lecture" {
                b.apply("set_logo", json!({ "src": "assets/logo.png" }));
            }
            (theme.to_owned(), b.deck(), pictures())
        })
        .collect()
}

/// A deck with sections, hidden and backup slides and notes.
pub fn sectioned() -> (Deck, Files) {
    let mut b = Builder::new("Light", "Sections", 81);
    let mut ids = vec![b.engine.deck().slides[0].id.clone()];
    for n in 1..=6 {
        let s = b.slide("title-only", json!({ "title": format!("Slide {}", n + 1) }));
        ids.push(s.id);
    }
    b.flags(&ids[2], Some(true), None);
    b.flags(&ids[3], None, Some(true));
    b.flags(&ids[5], None, Some(true));
    b.notes(&ids[1], "Notes on slide two");
    b.notes(&ids[3], "Notes on a backup slide");
    let mut deck = b.deck();
    deck.sections = vec![
        Section {
            title: "Opening".into(),
            starts_at: ids[0].clone(),
            extra: slides_core::Extra::new(),
        },
        Section {
            title: "The middle".into(),
            starts_at: ids[2].clone(),
            extra: slides_core::Extra::new(),
        },
        Section {
            title: "Wrap up".into(),
            starts_at: ids[4].clone(),
            extra: slides_core::Extra::new(),
        },
    ];
    (deck, pictures())
}

/// `slides` slides with `images` pictures each, every picture different.
pub fn large(slides: usize, images: usize) -> (Deck, Files) {
    let mut b = Builder::new("Light", "A long talk", 91);
    let mut files = Files::default();
    for n in 0..slides {
        let s = b.slide("title-body", json!({ "title": format!("Slide {n}") }));
        b.words(
            &s.id,
            s.slot("body"),
            vec![
                item("bullet", 0, "First point"),
                item("bullet", 1, "A detail"),
                item("bullet", 0, "Second point"),
            ],
        );
        let mut elements = Vec::new();
        for i in 0..images {
            let path = format!("assets/slide{n}-{i}.png");
            let seed = (n * images + i) as u32;
            files.0.insert(
                path.clone(),
                samples::png(240, 160, |x, y| {
                    [(x + seed) as u8, (y * 2 + seed) as u8, (x ^ y ^ seed) as u8]
                }),
            );
            elements.push(with(
                json!({ "type": "image", "id": format!("i{i}"), "src": path }),
                frame(
                    500.0 + 120.0 * i as f64,
                    200.0 + 30.0 * i as f64,
                    110.0,
                    70.0,
                ),
            ));
        }
        b.add(&s.id, Value::Array(elements));
    }
    (b.deck(), files)
}
