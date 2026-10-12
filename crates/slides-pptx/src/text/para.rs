//! Paragraphs: alignment, spacing, indent and bullet, then the runs. A list
//! item's marker hangs in the room its indent leaves, as the editor draws it.

use slides_core::list::{self, Geometry};
use slides_core::{Align, ListKind, ListStyle, Paragraph, Run, Theme};

use super::lists::{self, Number};
use super::metrics::DEFAULT_LINE_SPACING;
use super::{resolve, run};
use crate::color::Color;
use crate::cx::Cx;
use crate::units::{emu, hundredths, thousandths};
use crate::xml::Xml;

fn align(a: &Align) -> &'static str {
    match a {
        Align::Left => "l",
        Align::Center => "ctr",
        Align::Right => "r",
        Align::Justify => "just",
    }
}

/// The most space PowerPoint reads before, after or between lines: 1584 points.
const MOST_SPACE: i64 = 158_400;

fn spacing(x: &mut Xml, tag: &str, points: f64) {
    x.open(tag);
    x.open("a:spcPts")
        .int("val", hundredths(points).clamp(0, MOST_SPACE))
        .close();
    x.close();
}

/// What a list item needs besides its paragraph: its number, and where its lines start.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Item {
    pub number: Option<Number>,
    /// Where the paragraph sets its lines; worked out for the paragraph alone when absent.
    pub geometry: Option<Geometry>,
}

impl Item {
    /// An item with nothing said about it: the paragraph is set as if it stood alone.
    pub fn plain() -> Item {
        Item {
            number: None,
            geometry: None,
        }
    }
}

/// The settings of a paragraph, or of one list level of a style.
pub struct Setting {
    pub align: Align,
    /// The line height as a multiple of the type size.
    pub line_spacing: f64,
    /// The type size the multiple is of, in points.
    pub size: f64,
    pub space_before: f64,
    pub space_after: f64,
    pub list: Option<ListKind>,
    /// The bullet or numbering style, when the paragraph is a list item.
    pub style: Option<ListStyle>,
    pub level: usize,
    pub number: Option<Number>,
    /// Where the paragraph's lines start.
    pub geometry: Geometry,
    /// The colour of the marker when the paragraph names one.
    pub marker_color: Option<Color>,
    /// The size of the marker as a share of the words', when the paragraph names one.
    pub marker_size: Option<f64>,
    /// Set for a paragraph of a step that has not come yet, which keeps its place and shows
    /// nothing: the colour its bullet is drawn in, which is the page's, and no opacity.
    pub hidden: Option<Color>,
}

impl Setting {
    /// The settings a style gives a list of `list` at `level`: each level of the first sits under the words of the one above.
    pub fn of_style(style: &resolve::Style, list: Option<ListKind>, level: usize) -> Setting {
        let listed = list.is_some();
        let style_of_list = list.as_ref().map(|kind| list::default_style(kind, level));
        let number = matches!(list, Some(ListKind::Number)).then(|| Number {
            scheme: lists::scheme(&list::default_style(&ListKind::Number, level)),
            start_at: None,
        });
        let margin = if listed {
            list::LIST_INDENT * (level + 1) as f64
        } else {
            list::LIST_STEP * level as f64
        };
        Setting {
            align: style.align.clone(),
            line_spacing: style.line_spacing,
            size: style.size,
            space_before: style.space_before,
            space_after: style.space_after,
            list,
            style: style_of_list,
            level,
            number,
            geometry: Geometry {
                margin,
                indent: if listed { -list::LIST_INDENT } else { 0.0 },
            },
            marker_color: None,
            marker_size: None,
            hidden: None,
        }
    }
}

/// The height of a line, in hundredths of a point. The editor sets a line at a
/// multiple of the type size, so that is what is written, as an exact height.
/// A percentage would not do: PowerPoint's 100% is the face's own line height,
/// about a fifth more than the type size for most faces, and it changes with the
/// face PowerPoint puts in when the deck's is missing, while an exact height does not.
fn line_height(multiple: f64, size: f64) -> i64 {
    let multiple = if multiple > 0.0 {
        multiple
    } else {
        DEFAULT_LINE_SPACING
    };
    hundredths(multiple * size).clamp(1, MOST_SPACE)
}

/// Opens `tag` (`a:pPr`, or the `a:lvl1pPr` of a style) with the settings
/// spelled out: indent, alignment, spacing and bullet. The caller adds what
/// comes after, and closes it. `with_level` says whether the tag also names
/// its level, which a paragraph does and a style's level does not.
pub fn open_settings(x: &mut Xml, tag: &str, s: &Setting, with_level: bool) {
    x.open(tag);
    x.int("marL", emu(s.geometry.margin))
        .int("indent", emu(s.geometry.indent));
    if with_level && s.level > 0 {
        x.int("lvl", s.level as i64);
    }
    x.attr("algn", align(&s.align));
    x.open("a:lnSpc");
    x.open("a:spcPts")
        .int("val", line_height(s.line_spacing, s.size))
        .close();
    x.close();
    spacing(x, "a:spcBef", s.space_before);
    spacing(x, "a:spcAft", s.space_after);
    if s.list.is_some() {
        // A step that has not come yet draws its marker in the colour of the page; otherwise the paragraph's own, if it names one.
        if let Some(ink) = s.hidden.as_ref() {
            x.open("a:buClr");
            ink.write(x, Some(0.0));
            x.close();
        } else if let Some(ink) = &s.marker_color {
            x.open("a:buClr");
            ink.write(x, None);
            x.close();
        }
        if let Some(share) = s.marker_size {
            x.open("a:buSzPct")
                .int("val", thousandths(share).clamp(25_000, 400_000))
                .close();
        }
    }
    match (&s.list, s.number, s.style.as_ref().and_then(lists::bullet)) {
        (Some(ListKind::Bullet), _, Some((glyph, face))) => {
            x.leaf("a:buFont", &[("typeface", face)]);
            x.leaf("a:buChar", &[("char", glyph)]);
        }
        (Some(ListKind::Number), Some(n), _) => {
            x.open("a:buFontTx").close();
            x.open("a:buAutoNum").attr("type", n.scheme);
            if let Some(start) = n.start_at {
                x.int("startAt", i64::from(start));
            }
            x.close();
        }
        _ => {
            x.open("a:buNone").close();
        }
    }
}

/// The type size of a paragraph, in points: its largest run's; its mark's (the size of
/// its one empty run) when it has no words, or its style's when it has not even that.
/// A line is as tall as the largest type on it.
pub fn size_of(theme: &Theme, para: &Paragraph, base: &str) -> f64 {
    let style = resolve::style_for(theme, para.style.as_deref(), base);
    let shown = para
        .runs
        .iter()
        .filter(|r| !r.t.is_empty() || r.field.is_some());
    shown
        .map(|r| run::run_size(r, &style))
        .reduce(f64::max)
        // A paragraph with no words is as tall as its mark, the one empty run it holds.
        .or_else(|| para.runs.first().map(|r| run::run_size(r, &style)))
        .unwrap_or(style.size)
}

/// The type size of the marker of a list item, in points: the first run's that
/// shows something, which is how the editor draws it and PowerPoint sets a bullet, and the
/// marker's own scale of it when the paragraph names one.
pub fn marker_size(theme: &Theme, para: &Paragraph, base: &str) -> f64 {
    let style = resolve::style_for(theme, para.style.as_deref(), base);
    let first = para
        .runs
        .iter()
        .find(|r| !r.t.is_empty())
        .or_else(|| para.runs.first());
    let size = first.map_or(style.size, |r| run::run_size(r, &style));
    size * marker_share(para).unwrap_or(1.0)
}

/// The share of the words' size a paragraph's marker is set at, when it says.
fn marker_share(para: &Paragraph) -> Option<f64> {
    para.bullet_size.filter(|s| s.is_finite() && *s > 0.0)
}

/// Writes one paragraph. `base` is the text style of the box; the paragraph may
/// name another. `item` says how a list item is numbered and where it sits.
pub fn write(x: &mut Xml, cx: &mut Cx, para: &Paragraph, base: &str, item: Item, opacity: f64) {
    let style = resolve::style_for(&cx.deck.theme, para.style.as_deref(), base);
    // A paragraph of a step that has not come keeps its place and shows nothing.
    let later = matches!((cx.step, para.step), (Some(shown), Some(at)) if at > shown);
    let opacity = if later { 0.0 } else { opacity };
    let hidden = later.then(|| {
        cx.shown(&cx.backdrop)
            .or_else(|| cx.ground())
            .and_then(|behind| Color::parse(&behind))
            .unwrap_or_else(|| Color::Rgb("000000".to_owned()))
    });
    let geometry = item.geometry.unwrap_or_else(|| {
        let size = marker_size(&cx.deck.theme, para, base);
        list::layout(std::slice::from_ref(para), &[size])
            .first()
            .copied()
            .unwrap_or(Geometry {
                margin: 0.0,
                indent: 0.0,
            })
    });
    let list_style = list::style_of(para);
    // A numbered paragraph that was not told where it is in its list is numbered by itself.
    let number = item.number.or_else(|| {
        let style = list_style
            .as_ref()
            .filter(|_| para.list == Some(ListKind::Number))?;
        Some(Number {
            scheme: lists::scheme(style),
            start_at: None,
        })
    });
    let setting = Setting {
        align: para.align.clone().unwrap_or_else(|| style.align.clone()),
        line_spacing: para.line_spacing.unwrap_or(style.line_spacing),
        size: size_of(&cx.deck.theme, para, base),
        space_before: para.space_before.unwrap_or(style.space_before),
        space_after: para.space_after.unwrap_or(style.space_after),
        list: para.list.clone(),
        style: list_style,
        level: lists::level(para),
        number,
        geometry,
        marker_color: para.bullet_color.as_deref().and_then(Color::parse),
        marker_size: marker_share(para),
        hidden,
    };
    x.open("a:p");
    open_settings(x, "a:pPr", &setting, true);
    x.close();

    let mut last = None;
    for r in &para.runs {
        last = Some(run::write(x, cx, r, &style, opacity));
    }
    let mark = last.unwrap_or_else(|| run::props(cx, &style, &Run::plain(""), opacity));
    mark.write(x, "a:endParaRPr", None);
    x.close();
}

/// One level of a style: `a:lvl1pPr` and the like, with the default look of text at that level.
pub fn write_level(
    x: &mut Xml,
    cx: &mut Cx,
    tag: &str,
    style: &resolve::Style,
    list: Option<ListKind>,
    level: usize,
) {
    open_settings(x, tag, &Setting::of_style(style, list, level), false);
    run::props(cx, style, &Run::plain(""), 1.0).write(x, "a:defRPr", None);
    x.close();
}

#[cfg(test)]
mod tests;
