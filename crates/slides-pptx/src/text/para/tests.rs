use slides_core::{ListStyle, Paragraph, Script};

use super::*;
use crate::testing::with_cx;

fn written(para: &Paragraph, base: &str, number: Option<Number>) -> String {
    with_item(
        para,
        base,
        Item {
            number,
            ..Item::plain()
        },
    )
}

fn with_item(para: &Paragraph, base: &str, item: Item) -> String {
    with_cx(|cx| {
        let mut x = Xml::fragment();
        write(&mut x, cx, para, base, item, 1.0);
        x.into_string()
    })
}

const RPR: &str = r#"lang="en-US" sz="2200" b="0" i="0" dirty="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/>"#;

#[test]
fn a_bullet_hangs_in_the_indent_with_the_styles_spacing() {
    let para = Paragraph {
        list: Some(ListKind::Bullet),
        ..Paragraph::plain("one")
    };
    // A bullet at 22 pt needs 28 units and its air: it hangs 30 units, in steps of 6.
    assert_eq!(
        written(&para, "body", None),
        format!(
            concat!(
                r#"<a:p><a:pPr marL="285750" indent="-285750" algn="l">"#,
                r#"<a:lnSpc><a:spcPts val="2530"/></a:lnSpc>"#,
                r#"<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="600"/></a:spcAft>"#,
                r#"<a:buFont typeface="Arial"/><a:buChar char="●"/></a:pPr>"#,
                r#"<a:r><a:rPr {rpr}</a:rPr><a:t>one</a:t></a:r>"#,
                r#"<a:endParaRPr {rpr}</a:endParaRPr></a:p>"#
            ),
            rpr = RPR
        )
    );
}

#[test]
fn each_level_sits_under_the_words_of_the_one_above_and_changes_the_glyph() {
    let para = |level| Paragraph {
        list: Some(ListKind::Bullet),
        level: Some(level),
        ..Paragraph::plain("x")
    };
    // Alone, the first level has no list and keeps 24; the third needs 30 for its square.
    let two = written(&para(2), "body", None);
    assert!(
        two.contains(r#"<a:pPr marL="742950" indent="-285750" lvl="2" algn="l">"#),
        "{two}"
    );
    assert!(two.contains(r#"<a:buChar char="■"/>"#), "{two}");
    assert!(written(&para(1), "body", None).contains(r#"<a:buChar char="○"/>"#));
}

#[test]
fn a_bullet_style_is_its_glyph_and_a_marker_can_have_a_colour_and_a_size() {
    let para = |style: ListStyle| Paragraph {
        list: Some(ListKind::Bullet),
        list_style: Some(style),
        ..Paragraph::plain("x")
    };
    let arrow = written(&para(ListStyle::Arrow), "body", None);
    assert!(
        arrow.contains(r#"<a:buFont typeface="Segoe UI Symbol"/><a:buChar char="➢"/>"#),
        "{arrow}"
    );
    assert!(written(&para(ListStyle::Dash), "body", None).contains(r#"<a:buChar char="–"/>"#));
    let own = Paragraph {
        bullet_color: Some("accent2".into()),
        bullet_size: Some(1.5),
        ..para(ListStyle::Disc)
    };
    let out = written(&own, "body", None);
    assert!(
        out.contains(
            r#"<a:buClr><a:schemeClr val="accent2"/></a:buClr><a:buSzPct val="150000"/><a:buFont"#
        ),
        "{out}"
    );
    // The marker is bigger, so its room is: 43 units and its air, 48 in steps of 6.
    assert!(out.contains(r#"marL="457200""#), "{out}");
}

#[test]
fn a_paragraph_that_places_its_lines_says_where() {
    let para = Paragraph {
        margin_left: Some(40.0),
        indent: Some(12.0),
        ..Paragraph::plain("x")
    };
    let out = written(&para, "body", None);
    assert!(
        out.starts_with(r#"<a:p><a:pPr marL="381000" indent="114300" algn="l">"#),
        "{out}"
    );
}

#[test]
fn words_can_be_raised_in_capitals_or_set_apart() {
    let run = |run: Run| {
        let para = Paragraph {
            runs: vec![run],
            ..Paragraph::plain("")
        };
        written(&para, "body", None)
    };
    let sup = run(Run {
        script: Some(Script::Super),
        ..Run::plain("2")
    });
    assert!(sup.contains(r#"baseline="30000""#), "{sup}");
    let sub = run(Run {
        script: Some(Script::Sub),
        ..Run::plain("2")
    });
    assert!(sub.contains(r#"baseline="-25000""#), "{sub}");
    assert!(
        run(Run {
            small_caps: true,
            ..Run::plain("a")
        })
        .contains(r#"cap="small""#)
    );
    assert!(
        run(Run {
            all_caps: true,
            ..Run::plain("a")
        })
        .contains(r#"cap="all""#)
    );
    assert!(
        run(Run {
            spacing: Some(1.5),
            ..Run::plain("a")
        })
        .contains(r#"spc="150""#)
    );
    assert!(
        run(Run {
            spacing: Some(-0.5),
            ..Run::plain("a")
        })
        .contains(r#"spc="-50""#)
    );
    let plain = run(Run::plain("a"));
    assert!(
        !plain.contains("baseline") && !plain.contains("cap=") && !plain.contains("spc="),
        "{plain}"
    );
}

#[test]
fn numbers_use_the_scheme_of_their_level_and_say_where_they_start_again() {
    let para = Paragraph {
        list: Some(ListKind::Number),
        level: Some(1),
        ..Paragraph::plain("x")
    };
    let number = Number {
        scheme: "alphaLcPeriod",
        start_at: Some(1),
    };
    let out = written(&para, "body", Some(number));
    assert!(
        out.contains(r#"<a:buFontTx/><a:buAutoNum type="alphaLcPeriod" startAt="1"/></a:pPr>"#),
        "{out}"
    );
    let plain = Number {
        scheme: "arabicPeriod",
        start_at: None,
    };
    assert!(written(&para, "body", Some(plain)).contains(r#"<a:buAutoNum type="arabicPeriod"/>"#));
}

#[test]
fn a_marker_that_needs_more_room_moves_the_text_and_not_the_marker() {
    let para = Paragraph {
        list: Some(ListKind::Number),
        level: Some(1),
        ..Paragraph::plain("x")
    };
    let number = Number {
        scheme: "alphaLcPeriod",
        start_at: None,
    };
    let out = with_item(
        &para,
        "body",
        Item {
            number: Some(number),
            geometry: Some(Geometry {
                margin: 60.0,
                indent: -36.0,
            }),
        },
    );
    // The marker starts 24 units in, as in the editor; the text is 12 units further on, at 60.
    assert!(
        out.contains(r#"<a:pPr marL="571500" indent="-342900" lvl="1" algn="l">"#),
        "{out}"
    );
}

#[test]
fn the_size_of_a_paragraph_is_its_largest_run_or_its_style() {
    let theme = slides_core::themes::light();
    let sized = |sizes: &[Option<f64>], text: &str| Paragraph {
        runs: sizes
            .iter()
            .map(|s| Run {
                size: *s,
                ..Run::plain(text)
            })
            .collect(),
        ..Paragraph::plain("")
    };
    assert_eq!(
        size_of(&theme, &sized(&[Some(10.0), Some(30.0), None], "x"), "body"),
        30.0
    );
    assert_eq!(size_of(&theme, &sized(&[None], "x"), "caption"), 14.0);
    assert_eq!(size_of(&theme, &sized(&[], ""), "body"), 22.0);
    // An empty run shows nothing, so it is the paragraph's mark: it sets the height of a paragraph with no words...
    assert_eq!(
        size_of(&theme, &sized(&[Some(90.0)], ""), "body"),
        90.0,
        "the mark of an empty paragraph"
    );
    assert_eq!(size_of(&theme, &sized(&[None], ""), "body"), 22.0);
    // ...and not that of one that has words.
    let mut words = sized(&[Some(10.0)], "x");
    words.runs.push(Run {
        size: Some(90.0),
        ..Run::plain("")
    });
    assert_eq!(size_of(&theme, &words, "body"), 10.0);
}

fn at_step(para: &Paragraph, step: u32) -> String {
    with_cx(|cx| {
        cx.step = Some(step);
        let mut x = Xml::fragment();
        write(&mut x, cx, para, "body", Item::plain(), 1.0);
        x.into_string()
    })
}

#[test]
fn a_plain_paragraph_at_a_deeper_level_moves_in_a_step_for_each_level() {
    let para = Paragraph {
        level: Some(2),
        ..Paragraph::plain("x")
    };
    let out = written(&para, "body", None);
    assert!(
        out.starts_with(r#"<a:p><a:pPr marL="457200" indent="0" lvl="2" algn="l">"#),
        "{out}"
    );
    assert!(out.contains("<a:buNone/>"), "{out}");
}

#[test]
fn the_marker_is_the_size_of_the_first_run_that_shows_something() {
    let theme = slides_core::themes::light();
    let runs = |parts: &[(&str, Option<f64>)]| Paragraph {
        runs: parts
            .iter()
            .map(|(text, size)| Run {
                size: *size,
                ..Run::plain(*text)
            })
            .collect(),
        ..Paragraph::plain("")
    };
    let size = |para: &Paragraph, base: &str| marker_size(&theme, para, base);
    let mixed = runs(&[("", Some(50.0)), ("a", Some(10.0)), ("b", Some(30.0))]);
    assert_eq!(size(&mixed, "body"), 10.0);
    assert_eq!(size(&runs(&[("a", None), ("b", Some(30.0))]), "body"), 22.0);
    assert_eq!(size(&runs(&[("", Some(50.0))]), "body"), 50.0);
    assert_eq!(size(&runs(&[]), "caption"), 14.0);
}

#[test]
fn a_paragraph_of_a_later_step_keeps_its_place_and_shows_nothing() {
    let item = |step| Paragraph {
        list: Some(ListKind::Bullet),
        step: Some(step),
        ..Paragraph::plain("later")
    };
    let later = at_step(&item(3), 1);
    assert_eq!(
        later.matches(r#"<a:alpha val="0"/>"#).count(),
        3,
        "the bullet, the words and the paragraph mark: {later}"
    );
    // In the colour of the page as well, for a program that ignores transparency.
    assert!(
        later.contains(
            r#"<a:buClr><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:buClr><a:buFont"#
        ),
        "{later}"
    );
    assert!(
        later.contains(r#"<a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:solidFill>"#),
        "{later}"
    );
    assert!(
        later.contains("<a:t>later</a:t>"),
        "the words keep their room"
    );
    for shown in [at_step(&item(3), 3), at_step(&item(1), 3)] {
        assert!(!shown.contains("alpha"), "{shown}");
    }
    assert!(!written(&item(9), "body", None).contains("alpha"));
}

#[test]
fn a_line_is_a_multiple_of_the_type_size_in_hundredths_of_a_point() {
    assert_eq!(line_height(1.0, 22.0), 2200);
    assert_eq!(line_height(1.15, 22.0), 2530);
    assert_eq!(line_height(0.0, 22.0), 2200, "no multiple is the usual one");
    assert_eq!(line_height(-2.0, 10.0), 1000);
    assert_eq!(line_height(f64::NAN, 10.0), 1000);
    assert_eq!(line_height(1.0, 0.001), 1, "never nothing");
    assert_eq!(
        line_height(100.0, 400.0),
        158_400,
        "PowerPoint's tallest line"
    );
}

#[test]
fn space_around_a_paragraph_is_held_to_what_powerpoint_reads() {
    let para = Paragraph {
        space_before: Some(1e9),
        space_after: Some(-5.0),
        ..Paragraph::plain("x")
    };
    let out = written(&para, "body", None);
    assert!(
        out.contains(
            r#"<a:spcBef><a:spcPts val="158400"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>"#
        ),
        "{out}"
    );
}

#[test]
fn a_paragraph_that_names_an_unknown_style_is_set_in_the_style_of_its_box() {
    let para = Paragraph {
        style: Some("no-such-style".into()),
        ..Paragraph::plain("x")
    };
    let out = written(&para, "caption", None);
    assert!(out.contains(r#"sz="1400""#), "{out}");
}

#[test]
fn a_plain_paragraph_has_no_indent_and_no_bullet() {
    let out = written(&Paragraph::plain("Text"), "caption", None);
    assert!(
        out.starts_with(r#"<a:p><a:pPr marL="0" indent="0" algn="l">"#),
        "{out}"
    );
    assert!(out.contains("<a:buNone/></a:pPr>"), "{out}");
    assert!(
        out.contains(r#"sz="1400""#) && out.contains(r#"<a:schemeClr val="tx2"/>"#),
        "{out}"
    );
    assert!(
        out.contains(r#"<a:lnSpc><a:spcPts val="1400"/></a:lnSpc>"#),
        "{out}"
    );
}

#[test]
fn a_paragraph_can_align_space_and_set_its_own_line_height() {
    let para = Paragraph {
        align: Some(Align::Center),
        space_before: Some(12.0),
        space_after: Some(3.5),
        line_spacing: Some(1.5),
        ..Paragraph::plain("x")
    };
    let out = written(&para, "body", None);
    assert!(out.contains(r#"algn="ctr""#), "{out}");
    assert!(
        out.contains(r#"<a:lnSpc><a:spcPts val="3300"/></a:lnSpc>"#),
        "{out}"
    );
    assert!(out.contains(r#"<a:spcBef><a:spcPts val="1200"/></a:spcBef><a:spcAft><a:spcPts val="350"/></a:spcAft>"#), "{out}");
}

#[test]
fn a_paragraph_can_name_a_style_of_its_own() {
    let para = Paragraph {
        style: Some("title".into()),
        ..Paragraph::plain("x")
    };
    let out = written(&para, "body", None);
    assert!(
        out.contains(r#"sz="3600" b="1""#) && out.contains("+mj-lt"),
        "{out}"
    );
}

#[test]
fn an_empty_paragraph_still_has_the_height_of_its_style() {
    let out = written(
        &Paragraph {
            runs: Vec::new(),
            ..Paragraph::plain("")
        },
        "body",
        None,
    );
    assert!(
        out.ends_with(&format!("<a:endParaRPr {RPR}</a:endParaRPr></a:p>")),
        "{out}"
    );
    assert!(!out.contains("<a:r>"), "{out}");
}

#[test]
fn an_empty_paragraph_is_as_tall_as_its_mark_and_its_marker_is_as_large() {
    let para = Paragraph {
        list: Some(ListKind::Bullet),
        runs: vec![Run {
            size: Some(12.0),
            ..Run::plain("")
        }],
        ..Paragraph::plain("")
    };
    let out = written(&para, "body", None);
    // A line of 12 pt at 1.15 is 13.8 points, not the 25.3 of the style's 22 pt.
    assert!(
        out.contains(r#"<a:lnSpc><a:spcPts val="1380"/></a:lnSpc>"#),
        "{out}"
    );
    assert!(
        out.contains(r#"<a:endParaRPr lang="en-US" sz="1200""#),
        "{out}"
    );
    // The marker hangs by the room a bullet of 12 pt needs, 24 units at the least.
    assert!(out.contains(r#"marL="228600" indent="-228600""#), "{out}");
    assert!(!out.contains("<a:r>"), "{out}");
}

#[test]
fn the_paragraph_mark_has_the_look_of_the_last_run() {
    let para = Paragraph {
        runs: vec![
            Run::plain("a"),
            Run {
                size: Some(10.0),
                ..Run::plain("b")
            },
        ],
        ..Paragraph::plain("")
    };
    let out = written(&para, "body", None);
    assert!(
        out.contains(r#"<a:endParaRPr lang="en-US" sz="1000""#),
        "{out}"
    );
}
