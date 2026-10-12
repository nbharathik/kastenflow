//! The elements a page's blocks become on a slide. Words (headings, paragraphs, lists, quotes) are one text box that
//! is made to fit its place; pictures, tables, code and formulas are elements of their own, stacked beside the words
//! on a wide place and under them on a tall one. Nothing is measured: the words shrink to fit, and what is stacked
//! is scaled down together until it fits.

use std::collections::BTreeMap;

use super::Block;
use crate::model::{
    Base, CodeEl, Element, Extra, ImageEl, ListKind, ListStyle, MathEl, Paragraph, TableCell,
    TableEl, TableRow, Text, TextFit, VAlign,
};
use crate::resolve::Rect;

/// The size in pixels of a picture, by where the host keeps it: `(width, height)`. A picture that is not here is taken for 16 by 9.
pub type Sizes = BTreeMap<String, (f64, f64)>;

/// The gap between what is stacked, in slide units.
const GAP: f64 = 12.0;
/// How much of a wide place the words take when something is beside them, and how far in from their left the rest starts.
const WORDS_SHARE: f64 = 0.54;
const REST_FROM: f64 = 0.58;
/// How tall a row of a table, a line of code and a line of a formula are drawn at.
const ROW: f64 = 40.0;
const LINE: f64 = 22.0;
const FORMULA: f64 = 80.0;

/// Two decimals: a deck that is written and read again must come back the same, and a number of many digits does not.
fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// A box in the file's own precision.
fn placed(r: Rect) -> Base {
    Base::new("").place(r2(r.x), r2(r.y), r2(r.w), r2(r.h))
}

fn is_media(block: &Block) -> bool {
    matches!(
        block,
        Block::Image { .. } | Block::Table { .. } | Block::Code { .. } | Block::Math { .. }
    )
}

/// The words of the blocks as paragraphs: the shallowest headings in the style of a subtitle, deeper ones as bold words,
/// list items with their level, to-dos with a ring or a tick for a bullet, and quotes in the style of a quote. A rule says nothing.
pub fn text_paragraphs(blocks: &[Block]) -> Vec<Paragraph> {
    let shallowest = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Heading { level, .. } => Some(*level),
            _ => None,
        })
        .min();
    let mut out = Vec::new();
    for block in blocks {
        match block {
            Block::Heading { level, runs } => {
                let mut paragraph = Paragraph {
                    runs: runs.clone(),
                    ..Paragraph::plain("")
                };
                if Some(*level) == shallowest {
                    paragraph.style = Some("subtitle".to_owned());
                } else {
                    // A deeper heading is bold words in the body's own style, so that a body slot does not give it a bullet.
                    paragraph.style = Some("body".to_owned());
                    paragraph.runs.iter_mut().for_each(|r| r.bold = true);
                }
                out.push(paragraph);
            }
            Block::Paragraph { runs } => out.push(Paragraph {
                runs: runs.clone(),
                ..Paragraph::plain("")
            }),
            Block::Item {
                level,
                ordered,
                checked,
                runs,
            } => {
                let mut paragraph = Paragraph {
                    runs: runs.clone(),
                    list: Some(if *ordered {
                        ListKind::Number
                    } else {
                        ListKind::Bullet
                    }),
                    level: (*level > 0).then_some(*level),
                    ..Paragraph::plain("")
                };
                if let (Some(ticked), false) = (checked, *ordered) {
                    paragraph.list_style = Some(if *ticked {
                        ListStyle::Check
                    } else {
                        ListStyle::Circle
                    });
                }
                out.push(paragraph);
            }
            Block::Quote { runs, .. } => out.push(Paragraph {
                runs: runs.clone(),
                style: Some("quote".to_owned()),
                ..Paragraph::plain("")
            }),
            Block::Rule
            | Block::Code { .. }
            | Block::Math { .. }
            | Block::Image { .. }
            | Block::Table { .. } => {}
        }
    }
    out
}

fn text_element(paragraphs: Vec<Paragraph>, r: Rect) -> Element {
    let text = Text {
        valign: Some(VAlign::Top),
        fit: Some(TextFit::Shrink),
        ..Text::from_paragraphs(paragraphs)
    };
    Element::text_el(placed(r), text)
}

/// What a block would like for itself in a column `width` wide: its size.
fn wanted(block: &Block, width: f64, sizes: &Sizes) -> (f64, f64) {
    match block {
        Block::Image { src, .. } => {
            let (w, h) = sizes
                .get(src)
                .copied()
                .filter(|(w, h)| *w > 0.0 && *h > 0.0)
                .unwrap_or((16.0, 9.0));
            (width, width * h / w)
        }
        Block::Table { rows, .. } => (width, rows.len().max(1) as f64 * ROW),
        Block::Code { code, .. } => (width, code.lines().count().max(1) as f64 * LINE + 28.0),
        Block::Math { latex, .. } => (
            width,
            FORMULA + (latex.lines().count().max(1) - 1) as f64 * 30.0,
        ),
        _ => (width, 0.0),
    }
}

fn element_of(block: &Block, r: Rect) -> Option<Element> {
    let base = placed(r);
    Some(match block {
        Block::Image { src, alt } => Element::Image(ImageEl {
            base: Base {
                alt: (!alt.trim().is_empty()).then(|| alt.trim().to_owned()),
                ..base
            },
            src: src.clone(),
            crop: None,
            mask: None,
            extra: Extra::new(),
        }),
        Block::Table { header, rows } => {
            let columns = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
            let height = r2(r.h / rows.len().max(1) as f64);
            Element::Table(TableEl {
                base,
                columns: vec![r2(r.w / columns as f64); columns],
                rows: rows
                    .iter()
                    .map(|row| TableRow {
                        height: Some(height),
                        cells: (0..columns)
                            .map(|c| TableCell {
                                text: Text::from_paragraphs(vec![Paragraph {
                                    runs: row.get(c).cloned().unwrap_or_default(),
                                    ..Paragraph::plain("")
                                }]),
                                fill: None,
                                col_span: None,
                                row_span: None,
                                extra: Extra::new(),
                            })
                            .collect(),
                        extra: Extra::new(),
                    })
                    .collect(),
                header_row: *header,
                extra: Extra::new(),
            })
        }
        Block::Code { language, code } => Element::Code(CodeEl {
            base,
            language: if language.is_empty() {
                "text".to_owned()
            } else {
                language.clone()
            },
            code: code.clone(),
            theme: None,
            line_numbers: false,
            first_line: None,
            focus: Vec::new(),
            font_size: None,
            extra: Extra::new(),
        }),
        Block::Math { latex } => Element::Math(MathEl {
            base,
            latex: latex.clone(),
            inline: false,
            color: None,
            font_size: None,
            extra: Extra::new(),
        }),
        _ => return None,
    })
}

/// The pictures, tables, code and formulas among the blocks as elements stacked in `area`, each as wide as the area (a picture
/// keeps its shape and is centred), all scaled down together when they are too tall for it. Ids are left empty.
pub fn media_elements(blocks: &[Block], area: Rect, sizes: &Sizes) -> Vec<Element> {
    let media: Vec<&Block> = blocks.iter().filter(|b| is_media(b)).collect();
    if media.is_empty() || area.w <= 0.0 || area.h <= 0.0 {
        return Vec::new();
    }
    let wants: Vec<(f64, f64)> = media.iter().map(|b| wanted(b, area.w, sizes)).collect();
    let gaps = GAP * (media.len() - 1) as f64;
    let total: f64 = wants.iter().map(|(_, h)| h).sum();
    let scale = if total > 0.0 {
        ((area.h - gaps) / total).clamp(0.05, 1.0)
    } else {
        1.0
    };
    let mut y = area.y;
    let mut out = Vec::new();
    for (block, (w, h)) in media.iter().zip(wants) {
        let h = h * scale;
        // A picture keeps its shape as it is made smaller; the rest are as wide as the area.
        let w = if matches!(block, Block::Image { .. }) {
            w * scale
        } else {
            w
        };
        let x = area.x + (area.w - w) / 2.0;
        if let Some(element) = element_of(block, Rect { x, y, w, h }) {
            out.push(element);
        }
        y += h + GAP;
    }
    out
}

/// The elements for blocks in `area`: their words in one box that shrinks to fit, beside the pictures, tables, code and
/// formulas on a wide place and above them on a tall one. Ids are left empty for the operation that adds them.
pub fn contents(blocks: &[Block], area: Rect, sizes: &Sizes) -> Vec<Element> {
    let words = text_paragraphs(blocks);
    let has_media = blocks.iter().any(is_media);
    match (words.is_empty(), has_media) {
        (true, false) => Vec::new(),
        (false, false) => vec![text_element(words, area)],
        (true, true) => media_elements(blocks, area, sizes),
        (false, true) => {
            let (text_area, rest) = split(area);
            let mut out = vec![text_element(words, text_area)];
            out.extend(media_elements(blocks, rest, sizes));
            out
        }
    }
}

/// An area divided for words and for what goes with them: beside each other on a wide one, one above the other on a tall one.
pub fn split(area: Rect) -> (Rect, Rect) {
    if area.w >= area.h * 1.3 {
        (
            Rect {
                w: area.w * WORDS_SHARE,
                ..area
            },
            Rect {
                x: area.x + area.w * REST_FROM,
                w: area.w * (1.0 - REST_FROM),
                ..area
            },
        )
    } else {
        let words_h = area.h * 0.5;
        (
            Rect { h: words_h, ..area },
            Rect {
                y: area.y + words_h + GAP,
                h: area.h - words_h - GAP,
                ..area
            },
        )
    }
}

/// Whether any block is a picture, a table, code or a formula: something that is not words.
pub fn has_media(blocks: &[Block]) -> bool {
    blocks.iter().any(is_media)
}
