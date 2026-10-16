use slides_core::Run;

use super::*;
use crate::testing::with_cx;
use crate::text::resolve;

fn written(run: &Run, opacity: f64) -> String {
    with_cx(|cx| {
        let style = resolve::style(&cx.deck.theme, "body");
        let mut x = Xml::fragment();
        write(&mut x, cx, run, &style, opacity);
        x.into_string()
    })
}

const BODY: &str = r#"lang="en-US" sz="2200" b="0" i="0" dirty="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr>"#;

#[test]
fn plain_text_takes_its_look_from_the_style_and_spells_it_all_out() {
    assert_eq!(
        written(&Run::plain("Hello"), 1.0),
        format!("<a:r><a:rPr {BODY}<a:t>Hello</a:t></a:r>")
    );
}

#[test]
fn a_run_says_bold_italic_underline_strike_size_colour_and_font() {
    let run = Run {
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        size: Some(10.5),
        color: Some("#1a73e8".into()),
        font: Some("Georgia".into()),
        ..Run::plain("x")
    };
    assert_eq!(
        written(&run, 1.0),
        concat!(
            r#"<a:r><a:rPr lang="en-US" sz="1050" b="1" i="1" u="sng" strike="sngStrike" dirty="0">"#,
            r#"<a:solidFill><a:srgbClr val="1A73E8"/></a:solidFill>"#,
            r#"<a:latin typeface="Georgia" pitchFamily="18" charset="0"/></a:rPr><a:t>x</a:t></a:r>"#
        )
    );
}

#[test]
fn a_style_that_is_bold_makes_its_runs_bold() {
    with_cx(|cx| {
        let style = resolve::style(&cx.deck.theme, "title");
        let look = props(cx, &style, &Run::plain("T"), 1.0);
        assert!(look.bold && look.size == 36.0);
        assert_eq!(look.face.typeface, "+mj-lt");
    });
}

#[test]
fn code_runs_use_the_code_font_and_an_explicit_font_wins() {
    let code = Run {
        code: true,
        ..Run::plain("x")
    };
    assert!(
        written(&code, 1.0)
            .contains(r#"<a:latin typeface="Roboto Mono" pitchFamily="49" charset="0"/>"#)
    );
    let both = Run {
        code: true,
        font: Some("Arial".into()),
        ..Run::plain("x")
    };
    assert!(written(&both, 1.0).contains(r#"typeface="Arial""#));
    let blank = Run {
        code: true,
        font: Some("  ".into()),
        ..Run::plain("x")
    };
    assert!(
        written(&blank, 1.0).contains("Roboto Mono"),
        "a blank font names none"
    );
}

#[test]
fn inline_code_has_the_ground_the_editor_lays_behind_it() {
    let code = Run {
        code: true,
        ..Run::plain("x")
    };
    // The light theme's text colour at 8% over its page, between the fill and the face.
    let out = written(&code, 1.0);
    assert!(
        out.contains(
            r#"</a:solidFill><a:highlight><a:srgbClr val="EDEDED"/></a:highlight><a:latin "#
        ),
        "{out}"
    );
    assert!(!written(&Run::plain("x"), 1.0).contains("highlight"));
}

#[test]
fn a_highlight_is_the_ground_behind_the_words_and_beats_the_ground_code_has() {
    let marked = Run {
        highlight: Some("accent2".into()),
        ..Run::plain("x")
    };
    let out = written(&marked, 1.0);
    assert!(
        out.contains(
            r#"</a:solidFill><a:highlight><a:schemeClr val="accent2"/></a:highlight><a:latin "#
        ),
        "{out}"
    );
    let pen = Run {
        highlight: Some("#ffee00".into()),
        ..Run::plain("x")
    };
    assert!(written(&pen, 1.0).contains(r#"<a:highlight><a:srgbClr val="FFEE00"/></a:highlight>"#));
    // The short form of a hex colour is read as the file's long one.
    let short = Run {
        highlight: Some("#fe0".into()),
        ..Run::plain("x")
    };
    assert!(written(&short, 1.0).contains(r#"<a:srgbClr val="FFEE00"/>"#));
    // Code is drawn on its own ground unless it is marked: then the mark is the ground.
    let code = Run {
        code: true,
        highlight: Some("#112233".into()),
        ..Run::plain("x")
    };
    let out = written(&code, 1.0);
    assert!(
        out.contains(r#"<a:highlight><a:srgbClr val="112233"/></a:highlight>"#)
            && !out.contains("EDEDED"),
        "{out}"
    );
    assert_eq!(out.matches("<a:highlight>").count(), 1);
    // An element that fades fades its highlight by as much.
    assert!(written(&marked, 0.5).contains(
        r#"<a:highlight><a:schemeClr val="accent2"><a:alpha val="50000"/></a:schemeClr></a:highlight>"#
    ));
}

#[test]
fn a_highlight_that_is_no_colour_is_left_out_and_reported_and_a_blank_one_is_none() {
    let broken = Run {
        highlight: Some("yellowish".into()),
        ..Run::plain("x")
    };
    let (out, warned) = with_cx(|cx| {
        let style = resolve::style(&cx.deck.theme, "body");
        let mut x = Xml::fragment();
        write(&mut x, cx, &broken, &style, 1.0);
        (x.into_string(), cx.shared.warnings.len())
    });
    assert!(!out.contains("highlight"), "{out}");
    assert_eq!(warned, 1, "the highlight is reported");
    let blank = Run {
        highlight: Some("  ".into()),
        ..Run::plain("x")
    };
    assert!(!written(&blank, 1.0).contains("highlight"));
}

#[test]
fn math_is_italic_in_the_font_of_its_style() {
    let math = Run {
        math: true,
        ..Run::plain("x")
    };
    let out = written(&math, 1.0);
    assert!(out.contains(r#" i="1""#) && out.contains("+mn-lt"), "{out}");
}

#[test]
fn a_size_or_colour_that_means_nothing_is_the_styles() {
    let broken = Run {
        size: Some(-4.0),
        color: Some("nonsense".into()),
        ..Run::plain("x")
    };
    let (out, warned) = with_cx(|cx| {
        let style = resolve::style(&cx.deck.theme, "body");
        let mut x = Xml::fragment();
        write(&mut x, cx, &broken, &style, 1.0);
        (x.into_string(), cx.shared.warnings.len())
    });
    assert_eq!(out, format!("<a:r><a:rPr {BODY}<a:t>x</a:t></a:r>"));
    assert_eq!(warned, 1, "the colour is reported");
    for size in [0.0, f64::NAN, f64::INFINITY, -1.0] {
        let run = Run {
            size: Some(size),
            ..Run::plain("x")
        };
        assert!(written(&run, 1.0).contains(r#"sz="2200""#), "{size}");
    }
}

#[test]
fn opacity_becomes_the_alpha_of_the_text_colour() {
    assert!(written(&Run::plain("x"), 0.5).contains(
        r#"<a:solidFill><a:schemeClr val="tx1"><a:alpha val="50000"/></a:schemeClr></a:solidFill>"#
    ));
}

#[test]
fn a_line_break_in_the_text_is_a_br_with_the_same_look() {
    let out = written(&Run::plain("one\ntwo\r\nthree"), 1.0);
    assert_eq!(out.matches("<a:br>").count(), 2, "{out}");
    assert_eq!(out.matches("<a:r>").count(), 3, "{out}");
    assert!(
        out.contains(&format!("<a:br><a:rPr {BODY}</a:br>")),
        "{out}"
    );
    assert!(out.find("one").unwrap_or(0) < out.find("two").unwrap_or(0));
    assert_eq!(
        written(&Run::plain("a\n\nb"), 1.0)
            .matches("<a:br>")
            .count(),
        2
    );
    assert_eq!(written(&Run::plain(""), 1.0), "");
}

#[test]
fn a_link_is_an_hlinkclick_on_an_external_relationship() {
    let run = Run {
        link: Some("https://example.com/a b".into()),
        ..Run::plain("site")
    };
    let out = with_cx(|cx| {
        let style = resolve::style(&cx.deck.theme, "body");
        let mut x = Xml::fragment();
        write(&mut x, cx, &run, &style, 1.0);
        let rels = String::from_utf8(cx.rels.to_xml()).unwrap_or_default();
        (x.into_string(), rels)
    });
    assert!(
        out.0
            .contains(r#"<a:hlinkClick r:id="rId1"/></a:rPr><a:t>site</a:t>"#),
        "{}",
        out.0
    );
    // The theme's link colour and a line, for programs that do not add them themselves.
    assert!(
        out.0.contains(r#"u="sng""#)
            && out
                .0
                .contains(r#"<a:schemeClr val="accent1"/></a:solidFill>"#),
        "{}",
        out.0
    );
    assert!(
        out.1
            .contains(r#"Target="https://example.com/a%20b" TargetMode="External""#),
        "{}",
        out.1
    );
}

#[test]
fn an_unsafe_link_is_left_out_with_a_warning() {
    let run = Run {
        link: Some("javascript:alert(1)".into()),
        ..Run::plain("x")
    };
    let (out, warnings) = with_cx(|cx| {
        let style = resolve::style(&cx.deck.theme, "body");
        let mut x = Xml::fragment();
        write(&mut x, cx, &run, &style, 1.0);
        (x.into_string(), cx.shared.warnings.len())
    });
    assert!(!out.contains("hlinkClick"), "{out}");
    assert!(
        !out.contains("u=") && out.contains(r#"<a:schemeClr val="tx1"/>"#),
        "a link that is left out does not look like one: {out}"
    );
    assert_eq!(warnings, 1);
}

#[test]
fn a_paragraph_mark_after_a_link_is_not_a_link() {
    let run = Run {
        link: Some("https://example.com".into()),
        ..Run::plain("site")
    };
    let mark = with_cx(|cx| {
        let style = resolve::style(&cx.deck.theme, "body");
        write(&mut Xml::fragment(), cx, &run, &style, 1.0)
    });
    assert!(!mark.underline && mark.color == Color::Scheme("tx1"));
}

#[test]
fn the_slide_number_field_shows_the_number_of_its_slide() {
    let field = Run {
        field: Some("slideNumber".into()),
        ..Run::plain("‹#›")
    };
    let out = with_cx(|cx| {
        cx.number = 7;
        let style = resolve::style(&cx.deck.theme, "caption");
        let mut x = Xml::fragment();
        write(&mut x, cx, &field, &style, 1.0);
        x.into_string()
    });
    assert!(
        out.starts_with(
            r#"<a:fld id="{464C4407-0000-4000-8000-000000000001}" type="slidenum"><a:rPr "#
        ),
        "{out}"
    );
    assert!(out.ends_with("<a:t>7</a:t></a:fld>"), "{out}");
}

#[test]
fn inline_math_is_kept_as_latex_and_reported() {
    let math = Run {
        math: true,
        ..Run::plain("e^{i\\pi}")
    };
    let (out, warned) = with_cx(|cx| {
        let style = resolve::style(&cx.deck.theme, "body");
        let mut x = Xml::fragment();
        write(&mut x, cx, &math, &style, 1.0);
        (x.into_string(), cx.shared.warnings.len())
    });
    assert!(
        out.contains(r#" i="1""#) && out.contains("e^{i\\pi}"),
        "{out}"
    );
    assert_eq!(warned, 1);
}

/// Writes a run with a step's dimming (`dim`) already part of its `opacity`, as the element writers hand it over.
fn dimmed(run: &Run, dim: f64, opacity: f64) -> String {
    with_cx(|cx| {
        cx.dim = dim;
        let style = resolve::style(&cx.deck.theme, "body");
        let mut x = Xml::fragment();
        write(&mut x, cx, run, &style, opacity);
        x.into_string()
    })
}

#[test]
fn text_a_step_dims_is_mixed_toward_the_page_and_not_made_see_through() {
    // #202124 laid over white at a quarter, channel by channel: 199, 200, 200.
    let out = dimmed(&Run::plain("dim"), 0.25, 0.25);
    assert!(
        out.contains(r#"<a:solidFill><a:srgbClr val="C7C8C8"/></a:solidFill>"#),
        "{out}"
    );
    assert!(
        !out.contains("alpha"),
        "a program that ignores it would show the words at full strength: {out}"
    );
    let accent = Run {
        color: Some("accent1".into()),
        ..Run::plain("blue")
    };
    assert!(dimmed(&accent, 0.25, 0.25).contains(r#"<a:srgbClr val="C6DCF9"/>"#));
}

#[test]
fn what_a_step_does_not_dim_stays_transparency_and_a_slides_own_colour_is_the_page() {
    let both = dimmed(&Run::plain("x"), 0.25, 0.125);
    assert!(
        both.contains(r#"<a:srgbClr val="C7C8C8"><a:alpha val="50000"/></a:srgbClr>"#),
        "the element's own half opacity is what is left over: {both}"
    );
    let own = dimmed(&Run::plain("x"), 1.0, 0.5);
    assert!(
        own.contains(r#"<a:schemeClr val="tx1"><a:alpha val="50000"/></a:schemeClr>"#),
        "{own}"
    );
    let dark = with_cx(|cx| {
        let mut deck = cx.deck.clone();
        deck.slides[0].background = Some(slides_core::Background {
            color: Some("#000000".into()),
            image: None,
            extra: slides_core::Extra::new(),
        });
        crate::testing::with_deck(&deck, &Default::default(), |cx| {
            cx.slide = Some(deck.slides[0].id.clone());
            cx.dim = 0.25;
            let style = resolve::style(&cx.deck.theme, "body");
            let mut x = Xml::fragment();
            write(&mut x, cx, &Run::plain("x"), &style, 0.25);
            x.into_string()
        })
    });
    assert!(
        dark.contains(r#"<a:srgbClr val="080809"/>"#),
        "toward black: {dark}"
    );
}

#[test]
fn text_that_is_not_there_yet_takes_the_colour_of_the_page_as_well_as_no_opacity() {
    let out = dimmed(&Run::plain("later"), 1.0, 0.0);
    assert!(
        out.contains(r#"<a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr>"#),
        "invisible even where transparency is ignored: {out}"
    );
}

#[test]
fn the_step_label_field_is_written_as_the_words_for_the_page_and_left_as_it_is_without_steps() {
    let label = Run {
        field: Some("stepLabel".into()),
        ..Run::plain("Step 1 / 3")
    };
    let words = |slide: Option<&str>, step: Option<u32>| {
        with_cx(|cx| {
            let mut deck = cx.deck.clone();
            deck.slides[0].steps = 3;
            crate::testing::with_deck(&deck, &Default::default(), |cx| {
                cx.slide = slide
                    .map(str::to_owned)
                    .or_else(|| Some(deck.slides[0].id.clone()));
                cx.step = step;
                let style = resolve::style(&cx.deck.theme, "body");
                let mut x = Xml::fragment();
                write(&mut x, cx, &label, &style, 1.0);
                x.into_string()
            })
        })
    };
    assert!(words(None, Some(2)).contains("<a:t>Step 2 / 3</a:t>"));
    assert!(
        words(None, Some(0)).contains("<a:t>Step 0 / 3</a:t>"),
        "the slide as it appears"
    );
    assert!(
        words(None, None).contains("<a:t>Step 1 / 3</a:t>"),
        "without a step, its own words"
    );
    assert!(
        words(Some("s-none"), Some(2)).contains("<a:t>Step 1 / 3</a:t>"),
        "a slide the deck lacks has no steps"
    );
}
