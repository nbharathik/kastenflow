//! Charts whose series are piled on each other or filled down to zero: stacked columns and areas.

use super::{
    Align, ChartEl, Data, Parts, Rect, StyleExt, VAlign, axes, centred, filled, outlined, unit,
    words,
};
use crate::composites::build::faded;

/// The share of an area's colour that shows through when areas overlap.
const SEE_THROUGH: f64 = 0.55;

/// Columns with the series piled up in each: numbers above zero from the zero line up, numbers below it from the
/// zero line down.
pub(super) fn stacked_columns(parts: &mut Parts, room: Rect, element: &ChartEl, data: &Data) {
    let found = axes(parts, room, data);
    let inner = found.group * 0.62;
    let value_pt = 12.0;
    let tall = unit(value_pt) * 1.4;
    for i in 0..data.categories.len() {
        let left = found.plot.x + found.group * i as f64 + (found.group - inner) / 2.0;
        let (mut up, mut down) = (0.0f64, 0.0f64);
        for (_, color, values) in &data.series {
            let v = values[i];
            if v == 0.0 {
                continue;
            }
            let (from, to) = if v > 0.0 {
                let from = up;
                up += v;
                (from, up)
            } else {
                let from = down;
                down += v;
                (from, down)
            };
            let top = found.y(from.max(to));
            let h = (found.y(from.min(to)) - top).max(1.0);
            parts.shape(
                "rect",
                Rect {
                    x: left,
                    y: top,
                    w: inner,
                    h,
                },
                filled(color).stroke("bg1", 1.0),
                None,
            );
            if element.labels && h >= tall {
                words(
                    parts,
                    Rect {
                        x: left,
                        y: top + (h - tall) / 2.0,
                        w: inner,
                        h: tall,
                    },
                    &data.num(v),
                    value_pt,
                    Align::Center,
                    VAlign::Middle,
                    "bg1",
                    true,
                );
            }
        }
    }
}

/// The area under the straight line from `a` to `b` (points on the page) down to `base`: a rectangle under the
/// lower end, and a right triangle over it that follows the slope.
fn fill_between(
    parts: &mut Parts,
    a: (f64, f64),
    b: (f64, f64),
    base: f64,
    color: &str,
    alpha: Option<f64>,
) {
    let ((x1, y1), (x2, y2)) = (a, b);
    let w = x2 - x1;
    if w <= 0.0 {
        return;
    }
    let style = || match alpha {
        Some(alpha) => faded(color, alpha),
        None => filled(color),
    };
    let (high, low) = (y1.min(y2), y1.max(y2));
    if base - low > 0.01 {
        parts.shape(
            "rect",
            Rect {
                x: x1,
                y: low,
                w,
                h: base - low,
            },
            style(),
            None,
        );
    }
    if low - high > 0.01 {
        let slope = parts.shape(
            "rtTriangle",
            Rect {
                x: x1,
                y: high,
                w,
                h: low - high,
            },
            style(),
            None,
        );
        // The right angle is at the bottom left, under a line that falls to the right; the other way for one that climbs.
        if y2 < y1 {
            slope.base_mut().flip_h = true;
        }
    }
}

/// Areas filled down to zero, one for each series: overlapping and see-through, or piled up when stacked, each
/// one's top edge drawn as a line.
pub(super) fn areas(parts: &mut Parts, room: Rect, element: &ChartEl, data: &Data) {
    let found = axes(parts, room, data);
    let base = found.y(0.0);
    let columns = data.categories.len();
    // The height each series reaches in each category: its own numbers, or the pile up to it.
    let mut running = vec![0.0f64; columns];
    let mut tops: Vec<Vec<f64>> = Vec::new();
    for (_, _, values) in &data.series {
        if data.stacked {
            for (total, v) in running.iter_mut().zip(values) {
                *total += *v;
            }
            tops.push(running.clone());
        } else {
            tops.push(values.clone());
        }
    }
    let alpha = (!data.stacked).then_some(SEE_THROUGH);
    let value_pt = 12.0;
    // The highest is drawn first, so that what is below it shows in front of it.
    for (s, (_, color, values)) in data.series.iter().enumerate().rev() {
        let at = |i: usize| (found.x(i), found.y(tops[s][i]));
        for i in 0..columns.saturating_sub(1) {
            fill_between(parts, at(i), at(i + 1), base, color, alpha);
        }
        for i in 0..columns.saturating_sub(1) {
            let ((x1, y1), (x2, y2)) = (at(i), at(i + 1));
            let edge = parts.line(
                Rect {
                    x: x1,
                    y: y1.min(y2),
                    w: x2 - x1,
                    h: (y2 - y1).abs(),
                },
                outlined(color, 2.5),
            );
            if y2 < y1 {
                edge.base_mut().flip_v = true;
            }
        }
        if element.labels {
            for (i, v) in values.iter().enumerate() {
                let (x, y) = at(i);
                words(
                    parts,
                    centred(x, y - unit(value_pt) * 1.9, 48.0, unit(value_pt) * 1.4),
                    &data.num(*v),
                    value_pt,
                    Align::Center,
                    VAlign::Middle,
                    "text1",
                    false,
                );
            }
        }
    }
}
