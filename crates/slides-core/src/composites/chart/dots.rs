//! A scatter chart: points on two number axes. A point's height is the series' number; its place along the
//! horizontal axis is the series' `x` (its place in the list when it has none).

use super::{
    Align, ChartEl, Data, Face, Parts, Rect, StyleExt, VAlign, centred, filled, nice, number,
    outlined, unit, width, words,
};

/// The most lines across an axis.
const MOST_TICKS: usize = 12;

/// The scale of an axis that need not reach zero: its least and greatest number, and the step between the lines.
fn nice_scale(least: f64, greatest: f64) -> (f64, f64, f64) {
    let (lo, hi) = if greatest - least <= f64::EPSILON {
        (least - 1.0, greatest + 1.0)
    } else {
        (least, greatest)
    };
    let step = nice((hi - lo) / 4.0, true);
    ((lo / step).floor() * step, (hi / step).ceil() * step, step)
}

fn ticks(lo: f64, hi: f64, step: f64) -> Vec<f64> {
    (0..)
        .map(|i| lo + step * f64::from(i))
        .take_while(|t| *t <= hi + step * 0.001)
        .take(MOST_TICKS)
        .collect()
}

pub(super) fn scatter(parts: &mut Parts, room: Rect, element: &ChartEl, data: &Data) {
    let points: Vec<Vec<(f64, f64)>> = data
        .series
        .iter()
        .enumerate()
        .map(|(s, (_, _, values))| {
            values
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let x = data.xs.get(s).and_then(|x| x.get(i)).copied();
                    (x.unwrap_or(i as f64), *v)
                })
                .collect()
        })
        .collect();
    let (mut x_lo, mut x_hi, mut y_lo, mut y_hi) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for (x, y) in points.iter().flatten() {
        x_lo = x_lo.min(*x);
        x_hi = x_hi.max(*x);
        y_lo = y_lo.min(*y);
        y_hi = y_hi.max(*y);
    }
    if x_lo > x_hi || y_lo > y_hi {
        return;
    }
    let (x_lo, x_hi, x_step) = nice_scale(x_lo, x_hi);
    let (y_lo, y_hi, y_step) = nice_scale(y_lo, y_hi);
    let (x_ticks, y_ticks) = (ticks(x_lo, x_hi, x_step), ticks(y_lo, y_hi, y_step));
    let tick_pt = (room.h / 16.0).clamp(10.0, 14.0);
    let y_labels: Vec<String> = y_ticks.iter().map(|t| data.num(*t)).collect();
    let x_labels: Vec<String> = x_ticks.iter().map(|t| number(*t)).collect();
    let label_w = y_labels
        .iter()
        .map(|l| width(l, tick_pt, Face::Sans, false))
        .fold(0.0, f64::max)
        + 8.0;
    let foot = unit(tick_pt) * 1.4 + 4.0;
    let plot = Rect {
        x: room.x + label_w,
        y: room.y + unit(tick_pt) * 0.5,
        w: (room.w - label_w).max(1.0),
        h: (room.h - foot - unit(tick_pt) * 0.5).max(1.0),
    };
    let px = |x: f64| plot.x + plot.w * (x - x_lo) / (x_hi - x_lo);
    let py = |y: f64| plot.y + plot.h * (y_hi - y) / (y_hi - y_lo);
    for (t, label) in y_ticks.iter().zip(&y_labels) {
        let y = py(*t);
        parts.line(
            Rect {
                x: plot.x,
                y,
                w: plot.w,
                h: 0.0,
            },
            outlined("text2", 1.0).stroke_alpha(0.25),
        );
        words(
            parts,
            Rect {
                x: room.x,
                y: y - unit(tick_pt) * 0.7,
                w: label_w - 6.0,
                h: unit(tick_pt) * 1.4,
            },
            label,
            tick_pt,
            Align::Right,
            VAlign::Middle,
            "text2",
            false,
        );
    }
    for (t, label) in x_ticks.iter().zip(&x_labels) {
        let x = px(*t);
        parts.line(
            Rect {
                x,
                y: plot.y,
                w: 0.0,
                h: plot.h,
            },
            outlined("text2", 1.0).stroke_alpha(0.15),
        );
        words(
            parts,
            centred(x, plot.y + plot.h + 4.0, 56.0, unit(tick_pt) * 1.4),
            label,
            tick_pt,
            Align::Center,
            VAlign::Top,
            "text2",
            false,
        );
    }
    let value_pt = 12.0;
    for ((_, color, _), series) in data.series.iter().zip(&points) {
        for (x, y) in series {
            let (cx, cy) = (px(*x), py(*y));
            parts.shape(
                "ellipse",
                Rect {
                    x: cx - 5.0,
                    y: cy - 5.0,
                    w: 10.0,
                    h: 10.0,
                },
                filled(color).stroke("bg1", 1.5),
                None,
            );
            if element.labels {
                words(
                    parts,
                    centred(cx, cy - unit(value_pt) * 1.9, 48.0, unit(value_pt) * 1.4),
                    &data.num(*y),
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
