use slides_core::Insets;

use super::*;
use crate::import::color::{ColorCx, ColorMap, Palette};
use crate::import::dom;
use crate::import::text::levels::FontNames;

const NS: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;

/// The layer that says what Light's body style says, as a master would.
const BODY_LAYER: &str = r#"<a:lstStyle><a:lvl1pPr><a:lnSpc><a:spcPts val="2530"/></a:lnSpc><a:spcAft><a:spcPts val="600"/></a:spcAft><a:buNone/><a:defRPr sz="2200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
<a:lvl2pPr><a:buChar char="x"/><a:defRPr sz="2000"/></a:lvl2pPr></a:lstStyle>"#;

#[derive(Default)]
struct Sink {
    warnings: Vec<String>,
}

impl TextSink for Sink {
    fn link(&mut self, click: &Node) -> Option<String> {
        click
            .attr("r:id")
            .map(|id| format!("https://example.com/{id}"))
    }
    fn warn(&mut self, message: &str) {
        self.warnings.push(message.to_owned());
    }
}

fn text_of(paragraphs: &str, layer: &str, body: BodyProps) -> (Text, Vec<String>) {
    let palette = Palette::default();
    let map = ColorMap::standard();
    let fonts = FontNames {
        heading: "Inter".into(),
        body: "Inter".into(),
    };
    let reader = Reader {
        colors: ColorCx {
            palette: &palette,
            map: &map,
            deck_map: &map,
        },
        fonts: &fonts,
    };
    let layer_xml = dom::parse(format!("<x {NS}>{layer}</x>").as_bytes())
        .unwrap_or_else(|e| panic!("{e}"))
        .root;
    let lst = layer_xml
        .child("a:lstStyle")
        .map(|l| levels::list_style(l, &reader, None));
    let chain = Chain::new().below(lst.unwrap_or_else(levels::Levels::empty));
    let styles = StyleBook::new();
    let env = TextEnv {
        reader,
        styles: &styles,
        base: "body",
        chain: &chain,
        body,
        default_valign: VAlign::Top,
    };
    let doc = dom::parse(
        format!("<p:txBody {NS}><a:bodyPr/><a:lstStyle/>{paragraphs}</p:txBody>").as_bytes(),
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let mut sink = Sink::default();
    let text = convert(&doc.root, &env, &mut sink);
    (text, sink.warnings)
}

fn read(paragraphs: &str) -> Text {
    text_of(paragraphs, BODY_LAYER, BodyProps::default()).0
}

#[test]
fn text_that_says_nothing_extra_is_plain_in_the_deck() {
    let t = read(r#"<a:p><a:r><a:rPr lang="en-US"/><a:t>Hello</a:t></a:r></a:p>"#);
    assert_eq!(t.paragraphs.len(), 1);
    assert_eq!(
        t.paragraphs[0],
        Paragraph::plain("Hello"),
        "{:?}",
        t.paragraphs[0]
    );
    assert_eq!((t.valign.clone(), t.insets.clone()), (None, None));
}

#[test]
fn what_differs_from_the_style_is_written_on_the_run() {
    let t = read(
        r#"<a:p><a:r><a:rPr sz="3000" b="1" i="1" u="sng" strike="sngStrike"><a:solidFill><a:srgbClr val="C0392B"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr><a:t>Loud</a:t></a:r></a:p>"#,
    );
    let run = &t.paragraphs[0].runs[0];
    assert_eq!(run.size, Some(30.0));
    assert!(run.bold && run.italic && run.underline && run.strike);
    assert_eq!(run.color.as_deref(), Some("#c0392b"));
    assert_eq!(run.font.as_deref(), Some("Georgia"));
    // What is the style's own is left out.
    let same = read(
        r#"<a:p><a:r><a:rPr sz="2200" b="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Inter"/></a:rPr><a:t>x</a:t></a:r></a:p>"#,
    );
    assert_eq!(same.paragraphs[0].runs[0], Run::plain("x"));
}

#[test]
fn neighbouring_runs_that_look_alike_are_one_and_a_line_break_is_a_newline() {
    let t = read(
        r#"<a:p><a:r><a:rPr b="1"/><a:t>Two </a:t></a:r><a:r><a:rPr b="1" dirty="0"/><a:t>words</a:t></a:r><a:br><a:rPr b="1"/></a:br><a:r><a:rPr b="1"/><a:t>next</a:t></a:r><a:r><a:t> plain</a:t></a:r></a:p>"#,
    );
    let runs = &t.paragraphs[0].runs;
    assert_eq!(runs.len(), 2, "{runs:?}");
    assert_eq!(runs[0].t, "Two words\nnext");
    assert!(runs[0].bold);
    assert_eq!(runs[1].t, " plain");
}

#[test]
fn bullets_numbers_and_levels_come_from_the_paragraph_or_the_layers() {
    let t = read(
        r#"<a:p><a:pPr lvl="1"/><a:r><a:t>inherits a bullet</a:t></a:r></a:p>
           <a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>numbered</a:t></a:r></a:p>
           <a:p><a:pPr lvl="1"><a:buNone/></a:pPr><a:r><a:t>none</a:t></a:r></a:p>"#,
    );
    let p = &t.paragraphs;
    assert_eq!(
        (p[0].list.clone(), p[0].level),
        (Some(ListKind::Bullet), Some(1))
    );
    assert_eq!(p[0].runs[0].size, Some(20.0), "level two is set smaller");
    assert_eq!(
        (p[1].list.clone(), p[1].level),
        (Some(ListKind::Number), None)
    );
    assert_eq!((p[2].list.clone(), p[2].level), (None, Some(1)));
}

#[test]
fn alignment_and_spacing_are_kept_when_they_differ_and_dropped_when_they_do_not() {
    let t = read(
        r#"<a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc><a:spcBef><a:spcPts val="1200"/></a:spcBef><a:spcAft><a:spcPts val="600"/></a:spcAft></a:pPr><a:r><a:t>x</a:t></a:r></a:p>
           <a:p><a:pPr algn="l"><a:lnSpc><a:spcPts val="2530"/></a:lnSpc></a:pPr><a:r><a:t>y</a:t></a:r></a:p>"#,
    );
    let (a, b) = (&t.paragraphs[0], &t.paragraphs[1]);
    assert_eq!(a.align, Some(Align::Center));
    assert_eq!(
        a.line_spacing,
        Some(1.8),
        "150% of PowerPoint's single line"
    );
    assert_eq!(a.space_before, Some(12.0));
    assert_eq!(a.space_after, None, "the style's own six points");
    assert_eq!(
        (b.align.clone(), b.line_spacing, b.space_before),
        (None, None, None)
    );
}

#[test]
fn spacing_as_a_share_is_a_share_of_the_type_size() {
    let t = read(
        r#"<a:p><a:pPr><a:spcBef><a:spcPct val="20000"/></a:spcBef></a:pPr><a:r><a:rPr sz="3000"/><a:t>x</a:t></a:r></a:p>"#,
    );
    assert_eq!(t.paragraphs[0].space_before, Some(6.0));
}

#[test]
fn a_slide_number_field_keeps_being_a_field_and_others_become_their_text() {
    let (t, warnings) = text_of(
        r#"<a:p><a:fld id="{1}" type="slidenum"><a:rPr/><a:t>7</a:t></a:fld><a:r><a:t> of </a:t></a:r><a:fld id="{2}" type="datetime1"><a:rPr/><a:t>1/2/03</a:t></a:fld></a:p>"#,
        BODY_LAYER,
        BodyProps::default(),
    );
    let runs = &t.paragraphs[0].runs;
    assert_eq!(runs[0].field.as_deref(), Some("slideNumber"));
    assert_eq!(runs[0].t, "7");
    assert_eq!(runs[1].t, " of 1/2/03");
    assert!(
        warnings.iter().any(|w| w.contains("datetime1")),
        "{warnings:?}"
    );
}

#[test]
fn a_programs_stand_in_for_the_slide_number_is_not_kept_as_its_sample() {
    let t = read(
        r#"<a:p><a:fld id="{1}" type="slidenum"><a:rPr/><a:t>&lt;number&gt;</a:t></a:fld></a:p>"#,
    );
    let run = &t.paragraphs[0].runs[0];
    assert_eq!(
        (run.t.as_str(), run.field.as_deref()),
        ("1", Some("slideNumber"))
    );
}

#[test]
fn a_link_is_kept_and_its_forced_look_is_not_written() {
    let t = read(
        r#"<a:p><a:r><a:rPr u="sng"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:hlinkClick r:id="rId4" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></a:rPr><a:t>docs</a:t></a:r></a:p>"#,
    );
    let run = &t.paragraphs[0].runs[0];
    assert_eq!(run.link.as_deref(), Some("https://example.com/rId4"));
    assert!(!run.underline && run.color.is_none(), "{run:?}");
}

#[test]
fn an_empty_paragraph_is_kept_with_the_height_its_mark_gives_it() {
    let t = read(r#"<a:p><a:endParaRPr sz="4000"/></a:p><a:p/>"#);
    assert_eq!(t.paragraphs.len(), 2);
    assert_eq!(t.paragraphs[0].runs.len(), 1);
    assert_eq!(t.paragraphs[0].runs[0].t, "");
    assert_eq!(t.paragraphs[0].runs[0].size, Some(40.0));
    assert_eq!(t.paragraphs[1], Paragraph::plain(""));
}

#[test]
fn the_exact_line_height_of_an_empty_paragraph_is_a_multiple_of_the_size_of_its_mark() {
    let t = read(
        r#"<a:p><a:pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc></a:pPr><a:endParaRPr sz="1200"/></a:p>"#,
    );
    let p = &t.paragraphs[0];
    assert_eq!(p.runs[0].size, Some(12.0));
    assert_eq!(p.line_spacing, Some(1.5));
}

#[test]
fn a_run_with_a_ground_in_a_monospace_face_is_code() {
    let t = read(
        r#"<a:p><a:r><a:rPr><a:highlight><a:srgbClr val="EBEBEB"/></a:highlight><a:latin typeface="Roboto Mono"/></a:rPr><a:t>x()</a:t></a:r><a:r><a:rPr><a:latin typeface="Consolas"/></a:rPr><a:t>y</a:t></a:r></a:p>"#,
    );
    let runs = &t.paragraphs[0].runs;
    assert!(runs[0].code && runs[0].font.is_none(), "{:?}", runs[0]);
    assert!(!runs[1].code && runs[1].font.as_deref() == Some("Consolas"));
}

#[test]
fn a_ground_in_an_ordinary_face_is_a_highlight_and_code_keeps_no_ground_it_already_has() {
    let t = read(
        r#"<a:p>
        <a:r><a:rPr><a:highlight><a:srgbClr val="FFEE00"/></a:highlight></a:rPr><a:t>pen</a:t></a:r>
        <a:r><a:rPr><a:highlight><a:schemeClr val="accent2"/></a:highlight></a:rPr><a:t>token</a:t></a:r>
        <a:r><a:rPr><a:highlight><a:srgbClr val="EBEBEB"/></a:highlight><a:latin typeface="Roboto Mono"/></a:rPr><a:t>code</a:t></a:r>
        <a:r><a:rPr><a:highlight><a:srgbClr val="FFEE00"/></a:highlight><a:latin typeface="Roboto Mono"/></a:rPr><a:t>marked</a:t></a:r>
        <a:r><a:rPr><a:highlight><a:srgbClr val="ECECEC"/></a:highlight><a:latin typeface="Roboto Mono"/></a:rPr><a:t>near</a:t></a:r>
        <a:r><a:rPr><a:latin typeface="Roboto Mono"/></a:rPr><a:t>mono</a:t></a:r>
        </a:p>"#,
    );
    let runs = &t.paragraphs[0].runs;
    let seen: Vec<(&str, Option<&str>, bool, Option<&str>)> = runs
        .iter()
        .map(|r| {
            (
                r.t.as_str(),
                r.highlight.as_deref(),
                r.code,
                r.font.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        seen,
        [
            ("pen", Some("#ffee00"), false, None),
            ("token", Some("accent2"), false, None),
            // The ground code is drawn on, to a step in a channel, is the run being code and no more.
            ("code", None, true, None),
            ("marked", Some("#ffee00"), true, None),
            ("near", None, true, None),
            // A mono face with no ground is the face, not code.
            ("mono", None, false, Some("Roboto Mono")),
        ]
    );
}

#[test]
fn a_box_shrunk_to_fit_keeps_the_sizes_it_was_written_in_and_says_it_shrinks() {
    let body = BodyProps {
        font_scale: Some(0.5),
        line_reduction: Some(0.1),
        fit: Some(slides_core::TextFit::Shrink),
        ..BodyProps::default()
    };
    let (t, _) = text_of(
        r#"<a:p><a:r><a:t>small</a:t></a:r></a:p>"#,
        BODY_LAYER,
        body,
    );
    // The scale is found again from the words and the box, so the words keep their own size.
    assert_eq!(t.paragraphs[0].runs[0].size, None);
    assert_eq!(t.fit, Some(slides_core::TextFit::Shrink));
}

#[test]
fn anchor_and_insets_are_kept_only_when_they_differ_from_the_boxs_own() {
    let body = BodyProps {
        anchor: Some(VAlign::Bottom),
        insets: [Some(0.0), None, Some(4.0), None],
        ..BodyProps::default()
    };
    let (t, _) = text_of(r#"<a:p><a:r><a:t>x</a:t></a:r></a:p>"#, BODY_LAYER, body);
    assert_eq!(t.valign, Some(VAlign::Bottom));
    assert_eq!(
        t.insets,
        Some(Insets {
            left: 0.0,
            top: 4.8,
            right: 4.0,
            bottom: 4.8,
            extra: slides_core::Extra::new(),
        })
    );
    let (t, _) = text_of(
        r#"<a:p><a:r><a:t>x</a:t></a:r></a:p>"#,
        BODY_LAYER,
        BodyProps {
            anchor: Some(VAlign::Top),
            ..BodyProps::default()
        },
    );
    assert_eq!(t.valign, None);
}

#[test]
fn raised_and_lowered_words_small_capitals_capitals_and_spacing_are_kept() {
    let (t, warnings) = text_of(
        concat!(
            r#"<a:p><a:r><a:rPr baseline="30000"/><a:t>2</a:t></a:r>"#,
            r#"<a:r><a:rPr baseline="-25000"/><a:t>i</a:t></a:r>"#,
            r#"<a:r><a:rPr cap="small" spc="150"/><a:t>sc</a:t></a:r>"#,
            r#"<a:r><a:rPr cap="all"/><a:t>up</a:t></a:r></a:p>"#
        ),
        BODY_LAYER,
        BodyProps::default(),
    );
    let runs = &t.paragraphs[0].runs;
    assert_eq!(runs.len(), 4, "{runs:?}");
    assert_eq!(runs[0].script, Some(slides_core::Script::Super));
    assert_eq!(runs[1].script, Some(slides_core::Script::Sub));
    assert!(runs[2].small_caps && runs[2].spacing == Some(1.5) && runs[2].script.is_none());
    assert!(runs[3].all_caps && !runs[3].small_caps);
    assert!(warnings.is_empty(), "{warnings:?}");
}

#[test]
fn what_a_box_does_with_words_that_do_not_fit_and_whether_it_wraps_are_kept() {
    let read_with =
        |body: BodyProps| text_of(r#"<a:p><a:r><a:t>x</a:t></a:r></a:p>"#, BODY_LAYER, body).0;
    let shrink = read_with(BodyProps {
        fit: Some(slides_core::TextFit::Shrink),
        ..BodyProps::default()
    });
    assert_eq!(shrink.fit, Some(slides_core::TextFit::Shrink));
    let resize = read_with(BodyProps {
        fit: Some(slides_core::TextFit::Resize),
        wrap: Some(false),
        ..BodyProps::default()
    });
    assert_eq!(
        (resize.fit, resize.wrap),
        (Some(slides_core::TextFit::Resize), Some(false))
    );
    // Overflowing and wrapping are what a box does when it says nothing.
    let plain = read_with(BodyProps {
        fit: Some(slides_core::TextFit::Off),
        wrap: Some(true),
        ..BodyProps::default()
    });
    assert_eq!((plain.fit, plain.wrap), (None, None));
}

#[test]
fn a_bullet_keeps_its_glyph_colour_and_size_and_a_number_its_scheme() {
    let (t, _) = text_of(
        concat!(
            r#"<a:p><a:pPr><a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="150000"/><a:buFont typeface="Arial"/><a:buChar char="➢"/></a:pPr><a:r><a:t>a</a:t></a:r></a:p>"#,
            r#"<a:p><a:pPr><a:buChar char="●"/></a:pPr><a:r><a:t>b</a:t></a:r></a:p>"#,
            r#"<a:p><a:pPr><a:buAutoNum type="romanUcPeriod"/></a:pPr><a:r><a:t>c</a:t></a:r></a:p>"#,
            r#"<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>d</a:t></a:r></a:p>"#
        ),
        BODY_LAYER,
        BodyProps::default(),
    );
    let [a, b, c, d] = &t.paragraphs[..] else {
        panic!("four paragraphs");
    };
    assert_eq!(a.list_style, Some(slides_core::ListStyle::Arrow));
    assert_eq!(a.bullet_color.as_deref(), Some("#ff0000"));
    assert_eq!(a.bullet_size, Some(1.5));
    // The first level's usual bullet and the usual numbers are the level's own: nothing is written.
    assert_eq!(
        (b.list_style.clone(), b.bullet_color.clone(), b.bullet_size),
        (None, None, None)
    );
    assert_eq!(c.list_style, Some(slides_core::ListStyle::UpperRoman));
    assert_eq!(d.list_style, None);
}

#[test]
fn a_run_of_numbers_begins_at_the_number_the_file_says_and_goes_on() {
    // PowerPoint puts the starting number on every item of the run; the deck says it once.
    let item = |start: Option<u32>, text: &str| {
        let at = start.map_or(String::new(), |n| format!(r#" startAt="{n}""#));
        format!(
            r#"<a:p><a:pPr><a:buAutoNum type="arabicPeriod"{at}/></a:pPr><a:r><a:t>{text}</a:t></a:r></a:p>"#
        )
    };
    let xml = [
        item(Some(3), "a"),
        item(Some(3), "b"),
        item(Some(3), "c"),
        r#"<a:p><a:r><a:t>break</a:t></a:r></a:p>"#.to_owned(),
        item(None, "d"),
        item(None, "e"),
    ]
    .concat();
    let (t, _) = text_of(&xml, BODY_LAYER, BodyProps::default());
    let starts: Vec<Option<u32>> = t.paragraphs.iter().map(|p| p.start).collect();
    assert_eq!(starts, [Some(3), None, None, None, None, None]);
    let numbers = slides_core::list::numbers(&t.paragraphs);
    assert_eq!(numbers, [Some(3), Some(4), Some(5), None, Some(1), Some(2)]);
}

#[test]
fn a_paragraph_whose_indents_are_not_the_editors_says_where_its_lines_start() {
    let (t, _) = text_of(
        concat!(
            // 36 units in and hanging 36: not what the editor sets for a bullet at this size.
            r#"<a:p><a:pPr marL="342900" indent="-342900"><a:buChar char="•"/></a:pPr><a:r><a:t>a</a:t></a:r></a:p>"#,
            // What the editor sets for a bullet at 22 pt: 30 units.
            r#"<a:p><a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr><a:r><a:t>b</a:t></a:r></a:p>"#,
            r#"<a:p><a:pPr marL="0" indent="0"/><a:r><a:t>c</a:t></a:r></a:p>"#,
            r#"<a:p><a:pPr marL="457200" indent="0"/><a:r><a:t>d</a:t></a:r></a:p>"#
        ),
        BODY_LAYER,
        BodyProps::default(),
    );
    let places: Vec<(Option<f64>, Option<f64>)> = t
        .paragraphs
        .iter()
        .map(|p| (p.margin_left, p.indent))
        .collect();
    assert_eq!(places[0], (Some(36.0), Some(-36.0)));
    assert_eq!(places[2], (None, None));
    assert_eq!(places[3], (Some(48.0), None));
    // A bullet that is at the usual place names nothing.
    assert_eq!(places[1], (None, None));
}

#[test]
fn text_with_no_paragraph_at_all_still_has_one() {
    let (t, _) = text_of("", BODY_LAYER, BodyProps::default());
    assert_eq!(t.paragraphs, vec![Paragraph::plain("")]);
}
