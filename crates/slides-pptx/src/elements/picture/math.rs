//! A formula whose picture the host could not make. PowerPoint cannot typeset
//! LaTeX, so the exporter would normally be handed a picture of each formula under
//! the name the deck gives it (`math/<hash>.png`). When that picture is missing,
//! the formula is written as text in its box instead of a grey stand-in: the
//! LaTeX source, in italics, in the theme's text colour, centred. It is not
//! typeset, but it can be read and it can be edited.

use slides_core::{Align, Base, Extra, Paragraph, Run, Text, TextEl, VAlign};

use super::super::shape::write_text;
use super::Site;
use crate::cx::Cx;
use crate::text::metrics::DEFAULT_INSETS;
use crate::xml::Xml;

/// The largest size the source is set at, in points.
const MOST: f64 = 32.0;
/// The smallest, past which the source wraps instead of shrinking.
const LEAST: f64 = 10.0;
/// How wide a character of proportional italic text is on average, in em.
const AVERAGE_EM: f64 = 0.55;

/// Whether a picture path is a formula's: the deck names those `math/...`.
pub fn is_formula(path: &str) -> bool {
    path.trim().starts_with("math/")
}

/// The whole points of type at which the source fits its box on one line, or the least.
fn size_for(latex: &str, w: f64, h: f64) -> f64 {
    let room_w = (w - DEFAULT_INSETS.left - DEFAULT_INSETS.right).max(1.0);
    let room_h = (h - DEFAULT_INSETS.top - DEFAULT_INSETS.bottom).max(1.0);
    let chars = latex.chars().count().max(1) as f64;
    let mut size = MOST;
    while size > LEAST {
        let em = size * 4.0 / 3.0;
        if chars * AVERAGE_EM * em <= room_w && em * 1.2 <= room_h {
            break;
        }
        size -= 1.0;
    }
    size
}

/// The formula's source as a text box where its picture would have been.
pub fn write_source(x: &mut Xml, cx: &mut Cx, base: &Base, site: &Site, latex: &str) {
    let size = size_for(latex, site.frame.rect.w, site.frame.rect.h);
    let words = Run {
        italic: true,
        size: Some(size),
        color: Some("text1".to_owned()),
        ..Run::plain(latex)
    };
    let paragraph = Paragraph {
        align: Some(Align::Center),
        ..Paragraph::plain("")
    };
    let text = Text {
        paragraphs: vec![Paragraph {
            runs: vec![words],
            ..paragraph
        }],
        valign: Some(VAlign::Middle),
        ..Text::plain("")
    };
    let element = TextEl {
        // A picture has no fill of its own to carry over; the text sits on the slide.
        base: Base {
            style: None,
            ..base.clone()
        },
        text,
        columns: None,
        column_gap: None,
        extra: Extra::new(),
    };
    write_text(x, cx, &element, site);
}

#[cfg(test)]
mod tests;
