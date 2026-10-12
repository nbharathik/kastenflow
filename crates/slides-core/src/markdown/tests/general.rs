//! The serializer for paragraphs that did not come from `parse`: any runs
//! with any looks and any words, and Markdown still reads them back as the
//! same words with the same looks.

use proptest::prelude::*;

use super::Show;
use crate::markdown::{parse, to_markdown};
use crate::model::{ListKind, Paragraph, Run};

fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(1500)
}

fn pick(tokens: &[&'static str]) -> impl Strategy<Value = &'static str> + use<> {
    prop::sample::select(tokens.to_vec())
}

fn run() -> impl Strategy<Value = Run> {
    let words = pick(&[
        "a",
        "b c",
        "x_y",
        " lead",
        "trail ",
        "*",
        "**",
        "_",
        "~",
        "~~",
        "`",
        "``",
        "[",
        "]",
        "](u)",
        "(",
        ")",
        "<",
        ">",
        "<u>",
        "</u>",
        "$",
        "$5",
        "\\",
        "\\*",
        "1.",
        "- ",
        "# ",
        "> ",
        "a\nb",
        "\n",
        "é",
        "  ",
        "https://x.y",
        "5",
        "-",
        "+ x",
        "```",
        "~~~",
    ]);
    let formulas = pick(&["x", "a^2", "e^{i\\pi}", "a$b", "1+1"]);
    let urls = pick(&[
        "https://x.y",
        "u",
        "a(b)",
        "a\\b",
        "x_y*z",
        "slide:s-1",
        "https://x.y/z?a=1&b=2",
    ]);
    (words, formulas, 0u8..64, prop::option::of(urls)).prop_map(|(t, f, looks, link)| {
        let math = looks & 32 != 0 && looks & 16 == 0;
        // Code and math do not span lines; the parser makes them only from
        // text without a line break.
        let t = if (math || looks & 16 != 0) && t.contains('\n') {
            "a"
        } else {
            t
        };
        Run {
            bold: looks & 1 != 0,
            italic: looks & 2 != 0,
            strike: looks & 4 != 0,
            underline: looks & 8 != 0,
            code: looks & 16 != 0,
            math,
            link: link.map(str::to_owned),
            // Colour and size are not Markdown, and vanish.
            color: (looks & 3 == 3).then(|| "accent1".to_owned()),
            size: (looks & 5 == 5).then_some(18.0),
            ..Run::plain(if math { f } else { t })
        }
    })
}

fn paragraph() -> impl Strategy<Value = Paragraph> {
    let code = pick(&[
        "let x = 1;",
        "",
        "  indented",
        "trailing  ",
        "```",
        "a\\",
        "- not a list",
    ]);
    (0u8..7, 0u8..6, prop::collection::vec(run(), 0..5), code).prop_map(
        |(kind, level, runs, code)| {
            let mut p = Paragraph {
                runs,
                ..Paragraph::plain("")
            };
            match kind {
                1 | 2 => {
                    p.list = Some(if kind == 1 {
                        ListKind::Bullet
                    } else {
                        ListKind::Number
                    });
                    p.level = (level > 0).then_some(level);
                }
                3 => p.style = Some("title".to_owned()),
                4 => p.style = Some("subtitle".to_owned()),
                5 => p.style = Some("quote".to_owned()),
                6 => {
                    p.runs = vec![Run::plain(code)];
                    p.style = Some("code".to_owned());
                }
                _ => {}
            }
            p
        },
    )
}

/// What reading the Markdown of `ps` should give back, worked out on its
/// own: empty runs go, neighbours that look alike join, and an empty
/// paragraph with nothing to mark it goes too.
fn expect(ps: &[Paragraph]) -> Vec<Paragraph> {
    ps.iter()
        .filter_map(|p| {
            let mut runs: Vec<Run> = Vec::new();
            for r in p.runs.iter().filter(|r| !r.t.is_empty()) {
                let run = Run {
                    bold: r.bold,
                    italic: r.italic,
                    strike: r.strike,
                    underline: r.underline,
                    code: r.code,
                    math: r.math,
                    link: r.link.clone(),
                    ..Run::plain(r.t.clone())
                };
                match runs.last_mut() {
                    Some(last)
                        if (
                            last.bold,
                            last.italic,
                            last.strike,
                            last.underline,
                            last.code,
                            last.math,
                            &last.link,
                        ) == (
                            run.bold,
                            run.italic,
                            run.strike,
                            run.underline,
                            run.code,
                            run.math,
                            &run.link,
                        ) =>
                    {
                        last.t.push_str(&run.t)
                    }
                    _ => runs.push(run),
                }
            }
            if p.style.as_deref() == Some("code") {
                return Some(Paragraph {
                    runs: vec![Run::plain(p.text())],
                    ..p.clone()
                });
            }
            if runs.is_empty() && p.list.is_none() && p.style.is_none() {
                return None;
            }
            if runs.is_empty() {
                runs.push(Run::plain(""));
            }
            Some(Paragraph { runs, ..p.clone() })
        })
        .collect()
}

/// An empty numbered item at `level`, with no runs at all.
fn empty_item(level: u8) -> Paragraph {
    Paragraph {
        runs: Vec::new(),
        list: Some(ListKind::Number),
        level: Some(level),
        ..Paragraph::plain("")
    }
}

#[test]
fn an_empty_paragraph_that_is_left_out_does_not_make_the_next_item_begin_again() {
    // The empty paragraph between them breaks the list in the model, but no line is
    // written for it, so the second item must be written as the next number: a second
    // `1.` would read back as one that begins again.
    let nothing = Paragraph {
        runs: Vec::new(),
        ..Paragraph::plain("")
    };
    let ps = vec![empty_item(4), nothing, empty_item(4)];
    let read = parse(&to_markdown(&ps));
    assert_eq!(read, expect(&ps), "read {}", read.show());
    assert!(read.iter().all(|p| p.start.is_none()));
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(cases()))]

    #[test]
    fn any_paragraphs_come_back_as_the_same_words_with_the_same_looks(
        ps in prop::collection::vec(paragraph(), 0..6)
    ) {
        let md = to_markdown(&ps);
        let read = parse(&md);
        let want = expect(&ps);
        prop_assert!(
            read == want,
            "\nwritten {md:?}\nread    {}\nwanted  {}",
            read.show(),
            want.show()
        );
    }
}
