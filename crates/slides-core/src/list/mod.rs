//! What a list shows in front of its items, which number each numbered item has,
//! and how far in a paragraph sits.
//!
//! The editor draws lists with the same rules (`packages/slides-react/src/text/lists.ts`)
//! and the PowerPoint export spells them out, so a line breaks in the same place
//! everywhere. `fixtures/text/lists.json` holds cases that both sides are tested against.
//!
//! - A bullet item shows a glyph, a numbered item a count. Each level has a style of its
//!   own (● ○ ■ and `1.` `a.` `i.`, round again after three) unless the paragraph names one.
//! - An item's number counts the run of numbered items at its own level that share its
//!   style. Items nested deeper in between do not interrupt it; a plain paragraph, a bullet
//!   at the same level, an item at a shallower level or another style begins it again, and
//!   so does an item that names a `start`, which counts from there.
//! - A list item's marker hangs in the space before its text. The room it needs is the
//!   widest marker of its level at its size, so every item of a level sets its words alike,
//!   and each level sits under the words of the one above.

use crate::model::{ListKind, ListStyle, Paragraph};

/// The deepest list level: PowerPoint and Google Slides offer nine.
pub const MAX_LEVEL: usize = 8;

/// The room a marker has in front of its words, in slide units, unless it needs more.
pub const LIST_INDENT: f64 = 24.0;

/// Each level of a paragraph that is not a list item moves this far further in.
pub const LIST_STEP: f64 = 24.0;

/// The air between a marker and its words, as a share of the marker's size.
pub const AIR: f64 = 0.35;

/// The most that any list grows: a marker as big as a heading is not given more room than this.
pub const MOST_HANGING: f64 = 240.0;

/// Hangs grow in steps of this many units, so they stay near the usual ones.
const HANG_STEP: f64 = 6.0;

impl ListStyle {
    /// Whether a bullet list or a numbered one shows this style.
    pub fn kind(&self) -> ListKind {
        match self {
            ListStyle::Disc
            | ListStyle::Circle
            | ListStyle::Square
            | ListStyle::Arrow
            | ListStyle::Check
            | ListStyle::Dash => ListKind::Bullet,
            _ => ListKind::Number,
        }
    }
}

/// The level of a paragraph, from 0 to the deepest there is.
pub fn level(paragraph: &Paragraph) -> usize {
    usize::from(paragraph.level.unwrap_or(0)).min(MAX_LEVEL)
}

/// The style a list of `kind` has at `level` when nothing says otherwise.
pub fn default_style(kind: &ListKind, level: usize) -> ListStyle {
    match (kind, level % 3) {
        (ListKind::Bullet, 0) => ListStyle::Disc,
        (ListKind::Bullet, 1) => ListStyle::Circle,
        (ListKind::Bullet, _) => ListStyle::Square,
        (ListKind::Number, 0) => ListStyle::Decimal,
        (ListKind::Number, 1) => ListStyle::LowerAlpha,
        (ListKind::Number, _) => ListStyle::LowerRoman,
    }
}

/// The style a list item shows, or none for a paragraph that is not one. A style of the
/// other kind of list than the paragraph's is not used.
pub fn style_of(paragraph: &Paragraph) -> Option<ListStyle> {
    let kind = paragraph.list.as_ref()?;
    match &paragraph.list_style {
        Some(style) if style.kind() == *kind => Some(style.clone()),
        _ => Some(default_style(kind, level(paragraph))),
    }
}

/// The glyph a bullet style shows; none for a numbered style.
pub fn glyph(style: &ListStyle) -> Option<&'static str> {
    Some(match style {
        ListStyle::Disc => "●",
        ListStyle::Circle => "○",
        ListStyle::Square => "■",
        ListStyle::Arrow => "➢",
        ListStyle::Check => "✓",
        ListStyle::Dash => "–",
        _ => return None,
    })
}

/// `1` is `a`, `26` is `z`, `27` is `aa`, as a spreadsheet counts its columns.
fn letters(n: u32) -> String {
    let mut rest = n;
    let mut out = Vec::new();
    while rest > 0 {
        rest -= 1;
        out.push(char::from(b'a' + (rest % 26) as u8));
        rest /= 26;
    }
    out.iter().rev().collect()
}

/// Lower-case Roman numerals up to 3999; beyond that the plain number.
fn roman(n: u32) -> String {
    const NUMERALS: [(u32, &str); 13] = [
        (1000, "m"),
        (900, "cm"),
        (500, "d"),
        (400, "cd"),
        (100, "c"),
        (90, "xc"),
        (50, "l"),
        (40, "xl"),
        (10, "x"),
        (9, "ix"),
        (5, "v"),
        (4, "iv"),
        (1, "i"),
    ];
    if n == 0 || n >= 4000 {
        return n.to_string();
    }
    let mut rest = n;
    let mut out = String::new();
    for (value, glyph) in NUMERALS {
        while rest >= value {
            out.push_str(glyph);
            rest -= value;
        }
    }
    out
}

/// What an item shows in front of it: the glyph of a bullet style, or `3.`, `c)`, `IV.` for
/// the `n`th of a numbered one.
pub fn marker(style: &ListStyle, n: u32) -> String {
    if let Some(glyph) = glyph(style) {
        return glyph.to_owned();
    }
    let n = n.max(1);
    match style {
        ListStyle::DecimalParen => format!("{n})"),
        ListStyle::LowerAlpha => format!("{}.", letters(n)),
        ListStyle::UpperAlpha => format!("{}.", letters(n).to_uppercase()),
        ListStyle::LowerRoman => format!("{}.", roman(n)),
        ListStyle::UpperRoman => format!("{}.", roman(n).to_uppercase()),
        _ => format!("{n}."),
    }
}

/// A numbered item's count, and whether it begins a run of its own, one that a program that
/// counts by what it is told (PowerPoint) must be told about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Counted {
    pub n: u32,
    /// The item does not go on from an item before it: it starts a list, begins again at a
    /// number it names, or follows something that ended the one before.
    pub begins: bool,
}

/// The count of each numbered paragraph, and none for the rest.
pub fn counted(paragraphs: &[Paragraph]) -> Vec<Option<Counted>> {
    // For each level, the count so far and the style it is counted in.
    let mut counters: Vec<(u32, Option<ListStyle>)> = Vec::new();
    paragraphs
        .iter()
        .map(|p| {
            let Some(kind) = &p.list else {
                counters.clear();
                return None;
            };
            let at = level(p);
            counters.truncate(at + 1);
            counters.resize(at + 1, (0, None));
            match kind {
                ListKind::Bullet => {
                    counters[at] = (0, None);
                    None
                }
                ListKind::Number => {
                    let style = style_of(p);
                    let (count, before) = &counters[at];
                    let (n, begins) = match p.start {
                        Some(start) => (start.max(1), true),
                        None if *before == style => (count + 1, false),
                        None => (1, true),
                    };
                    counters[at] = (n, style);
                    Some(Counted { n, begins })
                }
            }
        })
        .collect()
}

/// The number each numbered paragraph shows, and none for the rest.
pub fn numbers(paragraphs: &[Paragraph]) -> Vec<Option<u32>> {
    counted(paragraphs)
        .into_iter()
        .map(|c| c.map(|c| c.n))
        .collect()
}

/// Makes the numbers come out as `wanted` says, by telling an item that would not show the number
/// asked of it where to begin. An item that is told changes what comes after it, so the count is
/// looked at again after each. A paragraph is left alone where `wanted` has nothing for it.
pub fn reconcile(paragraphs: &mut [Paragraph], wanted: &[Option<u32>]) {
    for _ in 0..paragraphs.len() {
        let ours = numbers(paragraphs);
        let Some(at) = (0..paragraphs.len()).find(|&i| {
            wanted
                .get(i)
                .copied()
                .flatten()
                .is_some_and(|w| ours[i] != Some(w.max(1)))
        }) else {
            break;
        };
        paragraphs[at].start = wanted[at].map(|w| w.max(1));
    }
}

/// The marker text of each paragraph: a glyph, or a number as its style writes it. None for a
/// paragraph that is not a list item.
pub fn markers(paragraphs: &[Paragraph]) -> Vec<Option<String>> {
    numbers(paragraphs)
        .into_iter()
        .zip(paragraphs)
        .map(|(n, p)| Some(marker(&style_of(p)?, n.unwrap_or(1))))
        .collect()
}

/// How wide a marker is in ems, judged generously: a wide face such as Inter or Verdana is assumed.
pub fn width_in_ems(marker: &str) -> f64 {
    marker
        .chars()
        .map(|c| match c {
            '.' | ',' => 0.3,
            '(' | ')' => 0.36,
            '●' | '○' | '■' => 0.62,
            '➢' => 0.92,
            '✓' => 0.8,
            '–' => 0.6,
            '0'..='9' => 0.62,
            'i' | 'j' | 'l' => 0.28,
            'I' => 0.3,
            'm' | 'w' => 0.85,
            'M' | 'W' => 0.95,
            'A'..='Z' => 0.72,
            _ => 0.56,
        })
        .sum()
}

/// The widest marker of a style among the first `count` numbers. The last is not always it:
/// "viii." is wider than "ix." and "m." than "n.", so a list that ends there still needs the room.
fn widest_marker(style: &ListStyle, count: u32) -> String {
    // Beyond this every style only grows with the number, so the last is the widest of the rest.
    const SCAN: u32 = 4000;
    (1..=count.min(SCAN))
        .chain([count])
        .map(|n| marker(style, n))
        .max_by(|a, b| width_in_ems(a).total_cmp(&width_in_ems(b)))
        .unwrap_or_default()
}

/// The room, in slide units, that a marker set at `points` needs in front of its text: its width and a little air.
fn room_for(marker: &str, points: f64) -> f64 {
    (width_in_ems(marker) + AIR) * crate::units::points_to_units(points)
}

/// Whether the paragraph says for itself where its text starts, so its list's room does not count.
fn is_placed(p: &Paragraph) -> bool {
    p.indent.is_some() || p.margin_left.is_some()
}

/// How far the marker hangs before the text at each level: what the widest marker there
/// needs, in steps of 6 units, and at least `LIST_INDENT`. `points` is the size of each
/// paragraph's marker.
pub fn hangs_by_level(paragraphs: &[Paragraph], points: &[f64]) -> [f64; MAX_LEVEL + 1] {
    let counts = numbers(paragraphs);
    // The largest count of each style at a level: the widest number is not always the last.
    let mut most: Vec<(usize, ListStyle, u32)> = Vec::new();
    for (p, count) in paragraphs.iter().zip(&counts) {
        let (Some(n), Some(style)) = (count, style_of(p)) else {
            continue;
        };
        let at = level(p);
        match most.iter_mut().find(|(l, s, _)| *l == at && *s == style) {
            Some((_, _, top)) => *top = (*top).max(*n),
            None => most.push((at, style, *n)),
        }
    }
    let widest: Vec<(usize, ListStyle, String)> = most
        .into_iter()
        .map(|(at, style, top)| {
            let text = widest_marker(&style, top);
            (at, style, text)
        })
        .collect();
    let mut need = [0.0_f64; MAX_LEVEL + 1];
    for (p, size) in paragraphs.iter().zip(points) {
        let Some(style) = style_of(p) else { continue };
        if is_placed(p) {
            continue;
        }
        let at = level(p);
        let text = match glyph(&style) {
            Some(glyph) => glyph.to_owned(),
            None => widest
                .iter()
                .find(|(l, s, _)| *l == at && *s == style)
                .map(|(_, _, text)| text.clone())
                .unwrap_or_else(|| marker(&style, 1)),
        };
        need[at] = need[at].max(room_for(&text, *size));
    }
    need.map(|room| {
        if room <= LIST_INDENT {
            LIST_INDENT
        } else {
            ((room / HANG_STEP).ceil() * HANG_STEP).min(MOST_HANGING)
        }
    })
}

/// Where a paragraph's lines start, in slide units from the box's inset.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Geometry {
    /// Where the lines after the first start (for a list item, where its words start).
    pub margin: f64,
    /// Where the first line starts, from `margin`; negative for a marker that hangs out to the left.
    pub indent: f64,
}

impl Geometry {
    /// Where the first line starts, from the box's inset.
    pub fn first(&self) -> f64 {
        self.margin + self.indent
    }
}

/// Where each paragraph sets its lines. A list item hangs its marker in the room its level
/// needs and sits under the words of the level above; a paragraph that is not one moves in
/// `LIST_STEP` for each level. A paragraph's own `margin_left` and `indent` win, and neither
/// puts a line outside the box.
pub fn layout(paragraphs: &[Paragraph], points: &[f64]) -> Vec<Geometry> {
    let hangs = hangs_by_level(paragraphs, points);
    paragraphs
        .iter()
        .map(|p| {
            let at = level(p);
            let listed = p.list.is_some();
            let margin = p.margin_left.unwrap_or(if listed {
                hangs[..=at].iter().sum()
            } else {
                LIST_STEP * at as f64
            });
            let margin = if margin.is_finite() {
                margin.max(0.0)
            } else {
                0.0
            };
            let indent = p.indent.unwrap_or(if listed { -hangs[at] } else { 0.0 });
            let indent = if indent.is_finite() {
                indent.max(-margin)
            } else {
                0.0
            };
            // `+ 0.0` turns a negative zero into a zero, which is how a file writes it.
            Geometry {
                margin: margin + 0.0,
                indent: indent + 0.0,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests;
