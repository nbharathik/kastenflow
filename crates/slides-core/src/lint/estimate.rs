//! How much room words take, worked out from the words alone.
//!
//! Only something that draws text can say how big it comes out, and a browser
//! does (see [`Measures`]). A host without one, such as the `slides` command
//! or an agent, gets an estimate from the widths of typical letters in a
//! typeface like Inter, which is close for ordinary text and a little
//! generous for capitals. Lint allows extra slack for estimates and says so.

use std::collections::BTreeMap;

use crate::citations::Refs;
use crate::model::{Deck, Element, Paragraph, Run, Slide, Text, Theme};

use super::model::{Measure, Measures};
use super::scene::{Leaf, Scene, expanded_with, is_blank};
use super::texts::{breaks_anywhere, is_mono, parts, size_of, style_of};

/// The space between a box's edge and its text when the text names none: across (left and right together), and down (top and bottom).
const DEFAULT_ACROSS: f64 = 19.2;
const DEFAULT_DOWN: f64 = 9.6;

/// A size in points as slide units.
fn to_units(points: f64) -> f64 {
    points * 4.0 / 3.0
}

/// The width of one character, as a fraction of the type size.
fn glyph(c: char, mono: bool) -> f64 {
    if mono {
        return 0.6;
    }
    match c {
        ' ' => 0.28,
        'i' | 'l' | 'j' | '.' | ',' | ':' | ';' | '\'' | '|' | '!' | '`' => 0.27,
        'f' | 't' | 'r' | 'I' | '(' | ')' | '[' | ']' | '/' | '-' => 0.36,
        'm' | 'M' | 'W' | '@' | '%' => 0.84,
        'w' => 0.76,
        '0'..='9' => 0.6,
        'A'..='Z' => 0.67,
        c if c.is_ascii_lowercase() => 0.55,
        c if c.is_alphabetic() && !c.is_ascii() => 0.58,
        // Wide characters (CJK, emoji) take a full em.
        c if (c as u32) >= 0x2e80 => 1.0,
        _ => 0.55,
    }
}

/// How wide a word is at a type size (in units), bold a little wider.
fn word_width(word: &str, size: f64, bold: bool, mono: bool) -> f64 {
    let em: f64 = word.chars().map(|c| glyph(c, mono)).sum();
    em * size * if bold { 1.06 } else { 1.0 }
}

/// The room text needs: `width` is the widest word plus the insets (what it
/// needs so that no word is broken); `height` is the height it takes when
/// wrapped to the box, insets included; `natural` is the width of its widest
/// line if nothing were wrapped, insets included.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
    pub natural: f64,
}

/// One paragraph laid out.
struct Laid {
    lines: usize,
    widest_word: f64,
    line_height: f64,
    /// The widest line with nothing wrapped.
    natural: f64,
}

fn paragraph(theme: &Theme, base: &str, p: &Paragraph, available: f64, scale: f64) -> Laid {
    let style = style_of(theme, base, p);
    let spacing = p
        .line_spacing
        .or(style.and_then(|s| s.line_spacing))
        .unwrap_or(1.0);
    let shown: Vec<&Run> = p.runs.iter().filter(|r| !r.t.trim().is_empty()).collect();
    // The line's own measure is the type size of its style, or when every run names a
    // size, the smallest of those; a bigger run makes its line taller. A paragraph with
    // no words is measured by its mark, the one empty run it holds.
    let strut = if !shown.is_empty() && shown.iter().all(|r| r.size.is_some_and(|s| s > 0.0)) {
        shown
            .iter()
            .map(|r| to_units(size_of(theme, base, p, r)) * scale)
            .fold(f64::INFINITY, f64::min)
    } else if let (true, Some(mark)) = (shown.is_empty(), p.runs.first()) {
        to_units(size_of(theme, base, p, mark)) * scale
    } else {
        to_units(style.map_or(18.0, |s| s.size)) * scale
    };
    let tallest = shown
        .iter()
        .map(|r| to_units(size_of(theme, base, p, r)) * scale)
        .fold(strut, f64::max);
    // Each word with the space before it; a line break is a word of no width that ends the line.
    let mut words: Vec<(f64, Option<f64>)> = Vec::new();
    let mut widest: f64 = 0.0;
    let (mut natural, mut line): (f64, f64) = (0.0, 0.0);
    for run in &p.runs {
        let size = to_units(size_of(theme, base, p, run)) * scale;
        let bold = run.bold || style.is_some_and(|s| s.bold);
        let mono = is_mono(style, run);
        for (n, piece) in run.t.split('\n').enumerate() {
            if n > 0 {
                words.push((0.0, None));
                natural = natural.max(line);
                line = 0.0;
            }
            for (k, word) in piece.split(' ').enumerate() {
                let w = word_width(word, size, bold, mono);
                // A word that may be broken anywhere (an address, code) is broken to fit and is no hindrance to the width.
                if !breaks_anywhere(word, mono) {
                    widest = widest.max(w);
                }
                let gap = if k == 0 {
                    0.0
                } else {
                    word_width(" ", size, bold, mono)
                };
                words.push((gap, Some(w)));
                line += gap + w;
            }
        }
    }
    // Greedy wrap: a word that does not fit goes to the next line; a word wider than
    // the line is broken as often as it needs.
    let mut lines = 1;
    let mut used = 0.0;
    for (gap, word) in words {
        let Some(w) = word else {
            lines += 1;
            used = 0.0;
            continue;
        };
        if used > 0.0 && used + gap + w > available {
            lines += 1;
            used = 0.0;
        }
        let here = if used > 0.0 { gap + w } else { w };
        if here > available && available > 1.0 {
            let breaks = (here / available).ceil() as usize - 1;
            lines += breaks;
            used = here - available * breaks as f64;
        } else {
            used += here;
        }
    }
    Laid {
        lines,
        widest_word: widest,
        line_height: tallest * spacing,
        natural: natural.max(line),
    }
}

/// The size of a paragraph's list marker in points, the first words' size times the marker's own scale.
fn marker_points(theme: &Theme, base: &str, p: &Paragraph) -> f64 {
    let first = p
        .runs
        .iter()
        .find(|r| !r.t.is_empty())
        .or_else(|| p.runs.first());
    let size = first.map_or_else(
        || style_of(theme, base, p).map_or(18.0, |s| s.size),
        |run| size_of(theme, base, p, run),
    );
    size * p
        .bullet_size
        .filter(|s| s.is_finite() && *s > 0.0)
        .unwrap_or(1.0)
}

/// The room `text` needs in a box `box_w` wide, set in the theme text style `base`.
pub fn text_size(theme: &Theme, base: &str, text: &Text, box_w: f64) -> Size {
    text_size_scaled(theme, base, text, box_w, 1.0)
}

/// The room `text` needs when its type, spacing and indents are all `scale` times what they are
/// written as and the box's insets keep their size: what "shrink text on overflow" does.
pub fn text_size_scaled(theme: &Theme, base: &str, text: &Text, box_w: f64, scale: f64) -> Size {
    let (across, mut height) = text
        .insets
        .as_ref()
        .map_or((DEFAULT_ACROSS, DEFAULT_DOWN), |i| {
            (i.left + i.right, i.top + i.bottom)
        });
    let mut width: f64 = 0.0;
    let mut natural: f64 = 0.0;
    let points: Vec<f64> = text
        .paragraphs
        .iter()
        .map(|p| marker_points(theme, base, p))
        .collect();
    let geometry = crate::list::layout(&text.paragraphs, &points);
    for (p, place) in text.paragraphs.iter().zip(&geometry) {
        let indent = place.margin * scale;
        let available = (box_w - across - indent).max(1.0);
        let laid = paragraph(theme, base, p, available, scale);
        let style = style_of(theme, base, p);
        let before = p
            .space_before
            .or(style.and_then(|s| s.space_before))
            .unwrap_or(0.0);
        let after = p
            .space_after
            .or(style.and_then(|s| s.space_after))
            .unwrap_or(0.0);
        height += laid.lines as f64 * laid.line_height + to_units(before + after) * scale;
        width = width.max(laid.widest_word + indent);
        natural = natural.max(laid.natural + indent);
    }
    Size {
        width: width + across,
        height,
        natural: natural + across,
    }
}

/// How much of a preset shape's box its text is set in: the box's width and
/// height times `across` and `down`, less `pad` on both. An ellipse keeps its
/// words in the rectangle that fits inside it, a diamond in its middle quarter.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Room {
    pub across: f64,
    pub down: f64,
    pub pad: f64,
}

/// A rounded corner of this radius takes this fraction of it off the text's rectangle, at each side.
const ROUND_INSET: f64 = 0.292_89;

/// The room a preset shape leaves for text, for a box of `w` by `h` with corner `radius` (if it names one).
pub fn room(preset: &str, w: f64, h: f64, radius: Option<f64>) -> Room {
    let whole = Room {
        across: 1.0,
        down: 1.0,
        pad: 0.0,
    };
    match preset {
        "roundRect" | "flowChartAlternateProcess" => {
            let side = w.min(h).max(0.0);
            let corner = radius.unwrap_or(side / 6.0).clamp(0.0, side / 2.0);
            Room {
                pad: 2.0 * corner * ROUND_INSET,
                ..whole
            }
        }
        "ellipse" | "flowChartConnector" => Room {
            across: std::f64::consts::FRAC_1_SQRT_2,
            down: std::f64::consts::FRAC_1_SQRT_2,
            pad: 0.0,
        },
        "diamond" | "flowChartDecision" => Room {
            across: 0.5,
            down: 0.5,
            pad: 0.0,
        },
        "triangle" => Room {
            across: 0.5,
            down: 0.5,
            pad: 0.0,
        },
        "rtTriangle" => Room {
            across: 0.5,
            down: 1.0 / 3.0,
            pad: 0.0,
        },
        _ => whole,
    }
}

/// The width and height of the part of an element's box that its text goes in.
pub(super) fn area_of(el: &Element, w: f64, h: f64) -> (f64, f64) {
    match el {
        Element::Shape(s) => {
            let r = room(
                &s.shape,
                w,
                h,
                s.base.style.as_ref().and_then(|st| st.radius),
            );
            (
                (w * r.across - r.pad).max(1.0),
                (h * r.down - r.pad).max(1.0),
            )
        }
        _ => (w, h),
    }
}

/// The text a leaf carries, as one measure: the widest and the tallest of its pieces.
fn measure_of(scene: &Scene, leaf: &Leaf) -> Option<Measure> {
    let rect = leaf.rect?;
    let (area_w, area_h) = area_of(leaf.el, rect.w, rect.h);
    let mut all: Option<Measure> = None;
    for part in parts(scene, leaf) {
        if is_blank(part.text) {
            continue;
        }
        let size = text_size(&scene.deck.theme, &part.base, part.text, area_w);
        all = Some(match all {
            Some(m) => Measure {
                text_width: m.text_width.max(size.width),
                text_height: m.text_height.max(size.height),
                ..m
            },
            None => Measure {
                text_width: size.width,
                text_height: size.height,
                area_width: Some(area_w),
                area_height: Some(area_h),
            },
        });
    }
    all
}

/// Estimated measures of every text of a slide, by element id.
pub fn slide_measures(deck: &Deck, slide: &Slide) -> BTreeMap<String, Measure> {
    slide_measures_with(deck, slide, None)
}

/// The same for a deck whose citations are drawn from a bibliography: the works are measured as they are
/// drawn, not as their keys.
pub fn slide_measures_with(
    deck: &Deck,
    slide: &Slide,
    refs: Option<&Refs>,
) -> BTreeMap<String, Measure> {
    let expanded = expanded_with(deck, slide, refs);
    let scene = Scene::new(deck, slide, &expanded);
    scene
        .leaves
        .iter()
        .filter_map(|leaf| measure_of(&scene, leaf).map(|m| (leaf.el.id().to_owned(), m)))
        .collect()
}

/// Estimated measures for the whole deck, marked as estimates so lint allows for them.
pub fn measures(deck: &Deck) -> Measures {
    measures_with(deck, None)
}

/// The same for a deck whose citations are drawn from a bibliography.
pub fn measures_with(deck: &Deck, refs: Option<&Refs>) -> Measures {
    Measures {
        slides: deck
            .slides
            .iter()
            .map(|s| (s.id.clone(), slide_measures_with(deck, s, refs)))
            .collect(),
        estimated: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theme() -> Theme {
        crate::themes::light()
    }

    #[test]
    fn a_short_line_fits_on_one_line_and_a_long_one_wraps() {
        let t = theme();
        let one = text_size(&t, "body", &Text::plain("Hello"), 400.0);
        let two = text_size(
            &t,
            "body",
            &Text::plain("Hello world this is a longer line of words that wraps"),
            200.0,
        );
        // 22 pt is 29.3 units; one line of 1.15 and 6 pt after, plus the insets.
        assert!(
            (one.height - (29.33 * 1.15 + 8.0 + 9.6)).abs() < 1.0,
            "{one:?}"
        );
        assert!(two.height > one.height * 2.0, "{two:?} {one:?}");
        assert!(two.width < 200.0);
    }

    #[test]
    fn a_word_wider_than_the_box_needs_the_box_to_be_wider() {
        let t = theme();
        let size = text_size(
            &t,
            "body",
            &Text::plain("Supercalifragilisticexpialidocious"),
            100.0,
        );
        assert!(size.width > 250.0, "{size:?}");
    }

    #[test]
    fn a_bigger_type_size_takes_more_room_and_a_list_takes_its_indent() {
        let t = theme();
        let mut big = Text::plain("The quick brown fox jumps over the lazy dog");
        big.paragraphs[0].runs[0] = Run {
            size: Some(40.0),
            ..Run::plain("The quick brown fox jumps over the lazy dog")
        };
        let small = text_size(
            &t,
            "body",
            &Text::plain("The quick brown fox jumps over the lazy dog"),
            300.0,
        );
        let large = text_size(&t, "body", &big, 300.0);
        assert!(large.height > small.height * 1.5);
        let mut list = Text::plain("The quick brown fox jumps over the lazy dog");
        list.paragraphs[0].list = Some(crate::model::ListKind::Bullet);
        assert!(text_size(&t, "body", &list, 300.0).height >= small.height);
    }

    #[test]
    fn an_empty_paragraph_is_as_tall_as_its_mark_says() {
        let t = theme();
        let empty = |size: Option<f64>| {
            Text::from_paragraphs(vec![Paragraph {
                runs: vec![Run {
                    size,
                    ..Run::plain("")
                }],
                ..Paragraph::plain("")
            }])
        };
        let plain = text_size(&t, "body", &empty(None), 400.0);
        let small = text_size(&t, "body", &empty(Some(11.0)), 400.0);
        let large = text_size(&t, "body", &empty(Some(44.0)), 400.0);
        assert!(small.height < plain.height, "{small:?} {plain:?}");
        assert!(large.height > plain.height, "{large:?} {plain:?}");
        // The same as the words that would be typed there.
        let typed = Text::from_paragraphs(vec![Paragraph {
            runs: vec![Run {
                size: Some(11.0),
                ..Run::plain("x")
            }],
            ..Paragraph::plain("")
        }]);
        assert!((text_size(&t, "body", &typed, 400.0).height - small.height).abs() < 0.5);
    }

    #[test]
    fn estimates_are_marked_and_cover_every_text_of_the_deck() {
        let deck = crate::ops::Engine::create("Talk", "Light", 1)
            .unwrap()
            .deck()
            .clone();
        let m = measures(&deck);
        assert!(m.estimated);
        let slide = &deck.slides[0];
        assert!(m.of(&slide.id, slide.elements[0].id()).is_some());
    }
}
