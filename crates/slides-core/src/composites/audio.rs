//! Audio: a speaker on a rounded chip, with the name of the piece under it.
//!
//! The sound plays in a show; everywhere else (the editor, a picture, PowerPoint) this chip is what
//! shows. A file on the web links to itself from every part, so the slide opens it in PowerPoint; a
//! file in the host's store is not an address, so it gets no link.

use super::Ctx;
use super::build::{ParaExt, Parts, RunExt, StyleExt, filled, insets, para, run, text_of};
use super::geom::{middle, pad, sane};
use super::measure::MONO_EM;
use super::media::{RADIUS, READABLE, addressed, middle as cut, web_address};
use crate::model::{AudioEl, Element, VAlign};
use crate::resolve::Rect;
use crate::units::points_to_units;

/// The words a person who cannot see the chip is told, when it has no title.
pub const ALT: &str = "Audio";

/// The address the parts link to, if the source is a web address.
pub fn link_of(element: &AudioEl) -> Option<&str> {
    web_address(&element.src)
}

/// The name of the file a source points at: the last part of its path, without a query.
pub fn name_of(src: &str) -> String {
    let path = src.trim().split(['?', '#']).next().unwrap_or("");
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_owned()
}

/// What the chip says under the speaker: its label, else the name of the file.
pub fn title_of(element: &AudioEl) -> String {
    match element
        .label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        Some(label) => label.to_owned(),
        None => name_of(&element.src),
    }
}

/// The words for a person who cannot see the chip.
pub fn alt_of(element: &AudioEl) -> String {
    let title = title_of(element);
    if title.is_empty() {
        ALT.to_owned()
    } else {
        format!("{ALT}: {title}")
    }
}

pub fn expand(cx: &Ctx, element: &AudioEl) -> Vec<Element> {
    let rect = sane(cx.rect);
    let mut parts = Parts::new(cx.id, rect);
    parts.shape(
        "roundRect",
        rect,
        filled("bg2")
            .radius(RADIUS)
            .stroke("text2", 1.5)
            .stroke_alpha(0.4),
        None,
    );

    let title = title_of(element);
    let room = pad(rect, 12.0, 10.0);
    let line = points_to_units(READABLE * 4.0 / 3.0);
    let with_title = !title.is_empty() && rect.w >= 110.0 && room.h >= line * 3.0;
    let area = Rect {
        h: if with_title { room.h - line } else { room.h },
        ..room
    };
    let u = (area.w.min(area.h) * 0.62).max(0.0);
    let (cx_, cy) = middle(area);
    let left = cx_ - u / 2.0;
    let top = cy - u / 2.0;

    // The speaker's box, then its cone pointing left, then two bars of sound.
    parts.shape(
        "rect",
        Rect {
            x: left,
            y: top + u * 0.34,
            w: u * 0.22,
            h: u * 0.32,
        },
        filled("text1"),
        None,
    );
    let (cone_w, cone_h) = (u * 0.5, u * 0.3);
    let (cone_cx, cone_cy) = (left + u * 0.22 + cone_h / 2.0, top + u * 0.5);
    let cone = parts.shape(
        "triangle",
        Rect {
            x: cone_cx - cone_w / 2.0,
            y: cone_cy - cone_h / 2.0,
            w: cone_w,
            h: cone_h,
        },
        filled("text1"),
        None,
    );
    cone.base_mut().rotation = Some(270.0);
    for (i, height) in [0.22, 0.46].into_iter().enumerate() {
        let h = u * height;
        parts.shape(
            "roundRect",
            Rect {
                x: left + u * (0.66 + 0.17 * i as f64),
                y: top + u * 0.5 - h / 2.0,
                w: u * 0.08,
                h,
            },
            filled("accent1").radius(u * 0.04),
            None,
        );
    }

    if with_title {
        let cols = (room.w / (MONO_EM * points_to_units(READABLE) * 1.01)).floor() as usize;
        let name = cut(&title, cols.max(3));
        let label = para(vec![run(&name, READABLE).color("text2")]).style("body");
        parts.text(
            Rect {
                x: room.x,
                y: room.y + room.h - line,
                w: room.w,
                h: line,
            },
            text_of(
                vec![label.align(crate::model::Align::Center)],
                VAlign::Bottom,
                insets(0.0, 0.0, 0.0, 0.0),
            ),
        );
    } else {
        parts.skip();
    }
    addressed(parts.finish(), link_of(element), &alt_of(element))
}

#[cfg(test)]
mod tests;
