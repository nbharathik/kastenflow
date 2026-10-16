//! Rescaling a deck from one slide size to another: where things stand, how big they are,
//! and the type, lines and corners that go with them.
//!
//! The rule, in one place so a deck, a theme and a new deck all follow it:
//!
//! - Boxes stretch with the slide: what stood at a fraction of the width stands at the same
//!   fraction, and the same goes for the height. The margins of a theme therefore change a little
//!   with the slide, which keeps every slot, every master shape and every element that was put
//!   where a slot was exactly together.
//! - Type, line widths, corner radii, shadows and the room inside a box follow the width, because
//!   text is set along the width. A slide that keeps its width (16:9 to 4:3 at 960 units) keeps
//!   its type sizes to the hundredth; one that changes it has its sizes rounded to the half point.
//! - A picture, an element that is turned, and a circle keep their shape: they are fitted inside
//!   the stretched box, centred in it, instead of being stretched with it.
//!
//! Positions are rounded to a hundredth of a unit, so a size and back gives the same numbers when
//! the deck's own numbers have at most two decimals, and the new size is at least as large as the
//! old (a smaller one and back can differ by a hundredth). Shapes that keep their proportions come
//! back smaller than they were whenever the box did not grow in the same ratio on both sides.

mod element;

use std::collections::BTreeMap;

use crate::model::{Deck, Layout, Size, Slide, TextStyle, Theme};
use crate::ops::geometry::reroute;

pub use element::scale_elements;

/// The page sizes offered by name, in slide units: the name, the width and the height.
pub const PAGE_SIZES: [(&str, f64, f64); 4] = [
    ("16:9", 960.0, 540.0),
    ("16:10", 960.0, 600.0),
    ("4:3", 960.0, 720.0),
    ("1:1", 720.0, 720.0),
];

/// The smallest a slide is, each way: an inch.
pub const SMALLEST: f64 = 96.0;
/// The largest a slide is, each way: 56 inches, which is as much as PowerPoint allows.
pub const LARGEST: f64 = 5376.0;

/// A page size, rounded to a hundredth of a unit, or why it is not one.
pub fn checked(w: f64, h: f64) -> Result<(f64, f64), String> {
    let (w, h) = (round2(w), round2(h));
    for (side, value) in [("width", w), ("height", h)] {
        if !(SMALLEST..=LARGEST).contains(&value) {
            return Err(format!(
                "the slide's {side} is {value}; a slide is between {SMALLEST} and {LARGEST} units (1 and 56 inches) each way"
            ));
        }
    }
    Ok((w, h))
}

/// How far each side of the slide grows: new width over old, new height over old.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fit {
    pub sx: f64,
    pub sy: f64,
}

impl Fit {
    pub fn between(from: &Size, to: &Size) -> Fit {
        Fit {
            sx: to.w / from.w.max(1.0),
            sy: to.h / from.h.max(1.0),
        }
    }

    /// Whether nothing would move.
    pub fn is_identity(&self) -> bool {
        self.sx == 1.0 && self.sy == 1.0
    }

    /// How much type, line widths, corners and shadows grow.
    pub fn text(&self) -> f64 {
        self.sx
    }

    /// The scale of a thing that keeps its shape: as much as fits both ways.
    pub(crate) fn uniform(&self) -> f64 {
        self.sx.min(self.sy)
    }
}

/// Two decimals: enough for a position, and short in the file.
pub(crate) fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// The half point a type size is rounded to.
pub(crate) fn round_half(v: f64) -> f64 {
    (v * 2.0).round() / 2.0
}

/// `size` scaled by `by`: the same when the scale is 1, so a size that is not on the half-point
/// grid is only touched when the slide's width changes.
pub(crate) fn scaled_size(size: f64, by: f64) -> f64 {
    if by == 1.0 {
        size
    } else {
        round_half(size * by)
    }
}

fn scaled_length(length: f64, by: f64) -> f64 {
    if by == 1.0 {
        length
    } else {
        round2(length * by)
    }
}

fn scale_style(style: &mut TextStyle, by: f64) {
    style.size = scaled_size(style.size, by);
    style.space_before = style.space_before.map(|v| scaled_size(v, by));
    style.space_after = style.space_after.map(|v| scaled_size(v, by));
}

/// Fits one layout to the slide size: the boxes of its slots and of the decoration it draws. This is
/// what a layout brought from a deck of another size needs; its text styles are fitted with
/// [`scale_text_styles`].
pub fn scale_layout(layout: &mut Layout, fit: &Fit) {
    if fit.is_identity() {
        return;
    }
    for slot in &mut layout.placeholders {
        slot.x = round2(slot.x * fit.sx);
        slot.y = round2(slot.y * fit.sy);
        slot.w = round2(slot.w * fit.sx);
        slot.h = round2(slot.h * fit.sy);
    }
    scale_elements(&mut layout.elements, fit);
}

/// Fits text styles to the slide size: type follows the width.
pub fn scale_text_styles(styles: &mut BTreeMap<String, TextStyle>, fit: &Fit) {
    if fit.is_identity() {
        return;
    }
    for style in styles.values_mut() {
        scale_style(style, fit.text());
    }
}

/// Fits a theme to the slide size: the boxes of its slots, of the decoration of its layouts and of
/// its master shapes, and the sizes of its text styles.
pub fn scale_theme(theme: &mut Theme, fit: &Fit) {
    if fit.is_identity() {
        return;
    }
    for layout in &mut theme.layouts {
        scale_layout(layout, fit);
    }
    scale_text_styles(&mut theme.text_styles, fit);
    theme.highlight.width = scaled_length(theme.highlight.width, fit.text());
    scale_elements(&mut theme.master, fit);
}

/// Fits a slide to the slide size: its elements, and the connectors between them.
pub fn scale_slide(slide: &mut Slide, theme: &Theme, fit: &Fit) {
    if fit.is_identity() {
        return;
    }
    scale_elements(&mut slide.elements, fit);
    reroute(theme, slide);
}

/// Changes the size of the deck to `w` by `h` units and fits everything in it: the theme and
/// every slide.
pub fn scale_deck(deck: &mut Deck, w: f64, h: f64) {
    let to = Size {
        w,
        h,
        extra: deck.size.extra.clone(),
    };
    let fit = Fit::between(&deck.size, &to);
    scale_theme(&mut deck.theme, &fit);
    let Deck { theme, slides, .. } = deck;
    for slide in slides {
        scale_slide(slide, theme, &fit);
    }
    deck.size = to;
}
