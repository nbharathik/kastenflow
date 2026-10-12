//! QR code: the code of some text or an address, drawn as squares on a white tile with the quiet margin the standard asks for,
//! so that it is sharp at any size and any phone reads it, whatever the theme. A row of dark modules is one rectangle, so a
//! code is a few hundred shapes that PowerPoint opens and edits like any others.

mod code;

use super::Ctx;
use super::build::{ParaExt, Parts, RunExt, StyleExt, filled, insets, para, run, text_of};
use super::geom::{pad, sane};
use super::measure::{Face, fit_pt, line_count, width};
use crate::model::{Align, Element, QrEl, Text, TextFit, VAlign};
use crate::resolve::Rect;
use crate::units::points_to_units;

/// The light margin round a code, in modules.
const QUIET: usize = 4;
/// What a code is drawn in: black on white, whatever the theme, as readers expect.
const DARK: &str = "#000000";
const LIGHT: &str = "#ffffff";

use code::MOST_BYTES;

/// The words a person who cannot see the code is told.
pub fn alt_of(element: &QrEl) -> String {
    let data = element.data.trim();
    let mut shown: String = data.chars().take(60).collect();
    if data.chars().count() > 60 {
        shown.push('\u{2026}');
    }
    if shown.is_empty() {
        "QR code".to_owned()
    } else {
        format!("QR code: {shown}")
    }
}

fn note(parts: &mut Parts, rect: Rect, words: &str) {
    parts.shape(
        "roundRect",
        rect,
        filled("bg2")
            .radius(12.0)
            .stroke("text2", 1.5)
            .stroke_alpha(0.6)
            .dashed(),
        None,
    );
    let inner = pad(
        rect,
        (rect.w * 0.06).clamp(6.0, 24.0),
        (rect.h * 0.08).clamp(4.0, 20.0),
    );
    let pt = fit_pt(20.0, 10.0, |pt| {
        line_count(words, inner.w, pt, Face::Sans, false) as f64 * points_to_units(pt * 1.3)
            <= inner.h
    });
    let paragraph = para(vec![run(words, pt).color("text2")])
        .style("body")
        .spacing(1.2)
        .after(0.0)
        .align(Align::Center);
    parts.text(
        inner,
        Text {
            fit: Some(TextFit::Shrink),
            ..text_of(vec![paragraph], VAlign::Middle, insets(0.0, 0.0, 0.0, 0.0))
        },
    );
}

pub fn expand(cx: &Ctx, element: &QrEl) -> Vec<Element> {
    let rect = sane(cx.rect);
    let mut parts = Parts::new(cx.id, rect);
    let caption = element
        .caption
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty());
    let caption_h = if caption.is_some() {
        (rect.h * 0.16).min(points_to_units(30.0))
    } else {
        0.0
    };
    let side = rect.w.min(rect.h - caption_h);
    let Some(found) = (side > 1.0)
        .then(|| code::encode(element.data.trim()))
        .flatten()
    else {
        let words = if element.data.trim().is_empty() {
            "Type the address or the words the code holds"
        } else if element.data.trim().len() > MOST_BYTES {
            "That is too long for a QR code: use a shorter address"
        } else {
            "This cannot be made into a QR code"
        };
        note(&mut parts, rect, words);
        return parts.finish();
    };
    let across = found.size + 2 * QUIET;
    let module = side / across as f64;
    let (ox, oy) = (rect.x + (rect.w - side) / 2.0, rect.y);
    parts.shape(
        "rect",
        Rect {
            x: ox,
            y: oy,
            w: side,
            h: side,
        },
        filled(LIGHT),
        None,
    );
    for (y, row) in found.modules.iter().enumerate() {
        let mut x = 0;
        while x < row.len() {
            if !row[x] {
                x += 1;
                continue;
            }
            let start = x;
            while x < row.len() && row[x] {
                x += 1;
            }
            parts.shape(
                "rect",
                Rect {
                    x: ox + (QUIET + start) as f64 * module,
                    y: oy + (QUIET + y) as f64 * module,
                    w: (x - start) as f64 * module,
                    h: module,
                },
                filled(DARK),
                None,
            );
        }
    }
    if let Some(words) = caption {
        let pt = fit_pt(24.0, 10.0, |pt| {
            width(words, pt, Face::Sans, false) <= rect.w && points_to_units(pt * 1.3) <= caption_h
        });
        let paragraph = para(vec![run(words, pt).color("text1")])
            .style("body")
            .spacing(1.0)
            .after(0.0)
            .align(Align::Center);
        parts.text(
            Rect {
                x: rect.x,
                y: oy + side,
                w: rect.w,
                h: caption_h,
            },
            Text {
                fit: Some(TextFit::Shrink),
                ..text_of(vec![paragraph], VAlign::Middle, insets(0.0, 0.0, 0.0, 0.0))
            },
        );
    }
    parts.finish()
}

#[cfg(test)]
mod tests;
