//! Text: the body of a text box, a shape, a table cell or a label, written
//! with the box's insets, anchor and every paragraph and run spelled out.

pub mod lists;
pub mod metrics;
mod para;
pub mod resolve;
mod run;

pub use para::write_level;

use slides_core::{Insets, Text, TextFit, VAlign};

use crate::cx::Cx;
use crate::units::{length, thousandths};
use crate::xml::Xml;
use metrics::DEFAULT_INSETS;

/// How the text of a box is set.
pub struct Look<'a> {
    /// The theme text style paragraphs start from.
    pub style: &'a str,
    /// Where the text sits in its box when the text does not say.
    pub valign: VAlign,
    /// Whether lines wrap at the box's edge.
    pub wrap: bool,
    /// How opaque the element the text belongs to is.
    pub opacity: f64,
    /// Whether the shape is mirrored top to bottom. PowerPoint turns the words
    /// upside down with it, the editor does not, so they are turned back.
    pub flipped: bool,
    /// The width and height of the room the words have, in slide units, when known: a box
    /// that shrinks its words to fit says by how much.
    pub area: Option<(f64, f64)>,
}

/// The space between a box and its text.
pub fn insets(text: &Text) -> &Insets {
    text.insets.as_ref().unwrap_or(&DEFAULT_INSETS)
}

/// `anchor` as PPTX names it.
pub fn anchor(valign: &VAlign) -> &'static str {
    match valign {
        VAlign::Top => "t",
        VAlign::Middle => "ctr",
        VAlign::Bottom => "b",
    }
}

fn paragraphs(x: &mut Xml, cx: &mut Cx, text: &Text, look: &Look) {
    if text.paragraphs.is_empty() {
        para::write(
            x,
            cx,
            &slides_core::Paragraph::plain(""),
            look.style,
            para::Item::plain(),
            look.opacity,
        );
        return;
    }
    let numbering = lists::numbering(&text.paragraphs);
    let theme = &cx.deck.theme;
    let sizes: Vec<f64> = text
        .paragraphs
        .iter()
        .map(|p| para::marker_size(theme, p, look.style))
        .collect();
    let places = slides_core::list::layout(&text.paragraphs, &sizes);
    for ((paragraph, number), geometry) in text.paragraphs.iter().zip(numbering).zip(places) {
        para::write(
            x,
            cx,
            paragraph,
            look.style,
            para::Item {
                number,
                geometry: Some(geometry),
            },
            look.opacity,
        );
    }
}

/// What a box does with words that do not fit it, as `a:bodyPr` says it: `a:noAutofit` lets
/// them run past the edge, `a:normAutofit` shrinks them (by the scale the words are
/// estimated to need), and `a:spAutoFit` makes the shape as tall as they are.
fn write_autofit(x: &mut Xml, cx: &Cx, text: &Text, look: &Look) {
    match text.fit {
        Some(TextFit::Shrink) => {
            let scale = look
                .area
                .map(|(w, h)| {
                    slides_core::text_fit::estimated_scale(&cx.deck.theme, look.style, text, w, h)
                })
                .unwrap_or(1.0);
            let open = x.open("a:normAutofit");
            if scale < 1.0 {
                open.int("fontScale", thousandths(scale));
            }
            x.close();
        }
        Some(TextFit::Resize) => {
            x.open("a:spAutoFit").close();
        }
        _ => {
            x.open("a:noAutofit").close();
        }
    }
}

/// The body of a shape: `tag` (`p:txBody`) holding the box's settings and the paragraphs.
/// What happens to words that do not fit is the text's own `fit`; by default they overflow, as
/// they do in the editor.
pub fn write_body(x: &mut Xml, cx: &mut Cx, tag: &str, text: &Text, look: &Look) {
    let space = insets(text);
    x.open(tag);
    x.open("a:bodyPr")
        .attr(
            "wrap",
            if look.wrap && text.wrap != Some(false) {
                "square"
            } else {
                "none"
            },
        )
        .int("lIns", length(space.left))
        .int("tIns", length(space.top))
        .int("rIns", length(space.right))
        .int("bIns", length(space.bottom))
        .attr("rtlCol", "0")
        .attr(
            "anchor",
            anchor(text.valign.as_ref().unwrap_or(&look.valign)),
        );
    if look.flipped {
        x.int("rot", 10_800_000);
    }
    write_autofit(x, cx, text, look);
    x.close();
    x.open("a:lstStyle").close();
    paragraphs(x, cx, text, look);
    x.close();
}

/// The body of a table cell, whose insets and anchor belong to the cell.
pub fn write_cell_body(x: &mut Xml, cx: &mut Cx, text: &Text, look: &Look) {
    x.open("a:txBody");
    x.open("a:bodyPr").close();
    x.open("a:lstStyle").close();
    paragraphs(x, cx, text, look);
    x.close();
}

#[cfg(test)]
mod tests {
    use slides_core::{Paragraph, Run};

    use super::*;
    use crate::testing::with_cx;

    fn look(style: &str) -> Look<'_> {
        Look {
            style,
            valign: VAlign::Top,
            wrap: true,
            opacity: 1.0,
            flipped: false,
            area: None,
        }
    }

    fn body(text: &Text, look: &Look) -> String {
        with_cx(|cx| {
            let mut x = Xml::fragment();
            write_body(&mut x, cx, "p:txBody", text, look);
            x.into_string()
        })
    }

    #[test]
    fn a_body_has_the_default_insets_wraps_and_never_shrinks() {
        let out = body(&Text::plain("Hi"), &look("body"));
        assert!(
            out.starts_with(concat!(
                r#"<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="t">"#,
                r#"<a:noAutofit/></a:bodyPr><a:lstStyle/><a:p>"#
            )),
            "{out}"
        );
        assert!(out.ends_with("</a:p></p:txBody>"), "{out}");
    }

    #[test]
    fn the_texts_own_insets_and_alignment_win_over_the_boxs() {
        let text = Text {
            insets: Some(Insets {
                left: 0.0,
                top: 2.0,
                right: 4.0,
                bottom: 8.0,
                extra: slides_core::Extra::new(),
            }),
            valign: Some(VAlign::Bottom),
            ..Text::plain("x")
        };
        let out = body(
            &text,
            &Look {
                valign: VAlign::Middle,
                ..look("body")
            },
        );
        assert!(
            out.contains(r#"lIns="0" tIns="19050" rIns="38100" bIns="76200""#),
            "{out}"
        );
        assert!(out.contains(r#"anchor="b""#), "{out}");
        let plain = body(
            &Text::plain("x"),
            &Look {
                valign: VAlign::Middle,
                ..look("body")
            },
        );
        assert!(plain.contains(r#"anchor="ctr""#), "{plain}");
    }

    #[test]
    fn a_shape_mirrored_top_to_bottom_has_its_words_turned_back_upright() {
        let flipped = body(
            &Text::plain("x"),
            &Look {
                flipped: true,
                ..look("body")
            },
        );
        assert!(
            flipped.contains(r#"anchor="t" rot="10800000">"#),
            "{flipped}"
        );
        assert!(!body(&Text::plain("x"), &look("body")).contains("rot="));
    }

    #[test]
    fn text_with_no_paragraph_still_has_one() {
        let text = Text::from_paragraphs(Vec::new());
        assert_eq!(body(&text, &look("body")).matches("<a:p>").count(), 1);
    }

    #[test]
    fn a_numbered_list_is_numbered_by_its_levels() {
        let item = |level: u8| Paragraph {
            list: Some(slides_core::ListKind::Number),
            level: Some(level),
            ..Paragraph::plain("x")
        };
        let text = Text::from_paragraphs(vec![
            item(0),
            item(0),
            item(1),
            Paragraph::plain("break"),
            item(0),
        ]);
        let out = body(&text, &look("body"));
        assert_eq!(
            out.matches(r#"<a:buAutoNum type="arabicPeriod"/>"#).count(),
            2,
            "{out}"
        );
        assert_eq!(
            out.matches(r#"<a:buAutoNum type="arabicPeriod" startAt="1"/>"#)
                .count(),
            1,
            "{out}"
        );
        assert_eq!(
            out.matches(r#"<a:buAutoNum type="alphaLcPeriod"/>"#)
                .count(),
            1,
            "{out}"
        );
    }

    #[test]
    fn what_a_box_does_with_words_that_do_not_fit_is_in_its_body_properties() {
        let with_fit = |fit: Option<TextFit>, text: &str, area: Option<(f64, f64)>| {
            body(
                &Text {
                    fit,
                    ..Text::plain(text)
                },
                &Look {
                    area,
                    ..look("body")
                },
            )
        };
        assert!(with_fit(None, "x", None).contains("<a:noAutofit/>"));
        assert!(with_fit(Some(TextFit::Off), "x", None).contains("<a:noAutofit/>"));
        assert!(with_fit(Some(TextFit::Resize), "x", None).contains("<a:spAutoFit/>"));
        // Shrinking says nothing of the scale where the room is not known, or where the words fit.
        assert!(with_fit(Some(TextFit::Shrink), "x", None).contains("<a:normAutofit/>"));
        assert!(
            with_fit(Some(TextFit::Shrink), "x", Some((400.0, 200.0))).contains("<a:normAutofit/>")
        );
        // Many words in a small box are shrunk, to no less than half.
        let words = "lorem ipsum dolor sit amet ".repeat(30);
        let out = with_fit(Some(TextFit::Shrink), &words, Some((400.0, 120.0)));
        let scale: i64 = out
            .split(r#"<a:normAutofit fontScale=""#)
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .and_then(|n| n.parse().ok())
            .unwrap_or_else(|| panic!("a font scale: {out}"));
        assert!((50_000..100_000).contains(&scale), "{scale}");
    }

    #[test]
    fn a_box_that_does_not_wrap_says_so() {
        let text = Text {
            wrap: Some(false),
            ..Text::plain("x")
        };
        assert!(body(&text, &look("body")).contains(r#"<a:bodyPr wrap="none""#));
        let wraps = Text {
            wrap: Some(true),
            ..Text::plain("x")
        };
        assert!(body(&wraps, &look("body")).contains(r#"<a:bodyPr wrap="square""#));
    }

    #[test]
    fn a_cell_body_leaves_the_insets_to_the_cell() {
        let text = Text::from_paragraphs(vec![Paragraph {
            runs: vec![Run::plain("cell")],
            ..Paragraph::plain("")
        }]);
        let out = with_cx(|cx| {
            let mut x = Xml::fragment();
            write_cell_body(&mut x, cx, &text, &look("body"));
            x.into_string()
        });
        assert!(
            out.starts_with("<a:txBody><a:bodyPr/><a:lstStyle/><a:p>"),
            "{out}"
        );
    }
}
