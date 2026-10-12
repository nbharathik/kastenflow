//! Chart: bars, a line or a pie of a small table of numbers, drawn from rectangles, lines and words, so that it is
//! sharp at any size, follows the theme's colours, and goes to PowerPoint as shapes that can be edited one by one.
//!
//! A bar or line chart has a scale on the left (round numbers, with a line across at each, and the zero line stronger),
//! the names of the categories under it, the title over it and, for more than one series, a legend under that. A pie is
//! the first series as slices of a circle, with the legend at its side. The slices of a pie are many thin wedges (a
//! triangle for each few degrees), since the shapes a slide has include no arc; they are one colour to a slice.

use super::Ctx;
use super::build::{
    ParaExt, Parts, RunExt, StyleExt, filled, insets, outlined, para, run, text_of,
};
use super::geom::{pad, sane};
use super::measure::{Face, fit_pt, line_count, width};
use crate::model::{Align, ChartEl, ChartKind, Element, Text, TextFit, VAlign, is_color};
use crate::resolve::Rect;
use crate::units::points_to_units;

/// The colours series take in turn when they name none.
const PALETTE: [&str; 6] = [
    "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
];
/// The most categories and series that are drawn: more would only be a smudge.
const MOST_CATEGORIES: usize = 40;
const MOST_SERIES: usize = 12;
/// The degrees a thin wedge of a pie covers.
const WEDGE: f64 = 3.0;

/// The words a person who cannot see the chart is told.
pub fn alt_of(element: &ChartEl) -> String {
    let kind = match element.kind {
        ChartKind::Bar => "Bar chart",
        ChartKind::Line => "Line chart",
        ChartKind::Pie => "Pie chart",
    };
    match element
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        Some(title) => format!("{kind}: {title}"),
        None => kind.to_owned(),
    }
}

/// What is drawn: the categories, and for each series its name, its colour and a number for each category.
struct Data {
    categories: Vec<String>,
    series: Vec<(String, String, Vec<f64>)>,
}

fn finite(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

/// The first `n` characters of `text`: a name is a few words, and what is drawn of a longer one is cut.
fn clip(text: &str, n: usize) -> String {
    text.chars().take(n).collect()
}

fn data_of(element: &ChartEl) -> Data {
    let widest = element
        .series
        .iter()
        .map(|s| s.values.len())
        .max()
        .unwrap_or(0);
    let count = element.categories.len().max(widest).min(MOST_CATEGORIES);
    let categories = (0..count)
        .map(|i| {
            element
                .categories
                .get(i)
                .map_or_else(|| (i + 1).to_string(), |c| clip(c, 120))
        })
        .collect();
    let series = element
        .series
        .iter()
        .take(MOST_SERIES)
        .enumerate()
        .map(|(i, s)| {
            let color = s
                .color
                .as_deref()
                .filter(|c| is_color(c))
                .map_or_else(|| PALETTE[i % PALETTE.len()].to_owned(), str::to_owned);
            let values = (0..count)
                .map(|c| finite(s.values.get(c).copied().unwrap_or(0.0)))
                .collect();
            (clip(&s.name, 120), color, values)
        })
        .collect();
    Data { categories, series }
}

/// A number as a person writes it on an axis: no more digits than it has, thousands set apart, and millions as `M`.
fn number(v: f64) -> String {
    let a = v.abs();
    let (scaled, suffix) = if a >= 1.0e9 {
        (v / 1.0e9, "B")
    } else if a >= 1.0e6 {
        (v / 1.0e6, "M")
    } else {
        (v, "")
    };
    let text = if scaled.fract().abs() < 0.005 {
        format!("{scaled:.0}")
    } else if (scaled * 10.0).fract().abs() < 0.05 {
        format!("{scaled:.1}")
    } else {
        format!("{scaled:.2}")
    };
    let (sign, digits) = text
        .strip_prefix('-')
        .map_or(("", text.as_str()), |d| ("-", d));
    let (whole, rest) = digits
        .split_once('.')
        .map_or((digits, String::new()), |(w, r)| (w, format!(".{r}")));
    let mut grouped = String::new();
    for (i, c) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    let out = format!("{sign}{grouped}{rest}{suffix}");
    if out == "-0" { "0".to_owned() } else { out }
}

/// A round number at or above `x` (or the nearest one, with `round`): 1, 2, 5 or 10 times a power of ten.
fn nice(x: f64, round: bool) -> f64 {
    let exponent = x.log10().floor();
    let fraction = x / 10f64.powf(exponent);
    let nice = if round {
        match fraction {
            f if f < 1.5 => 1.0,
            f if f < 3.0 => 2.0,
            f if f < 7.0 => 5.0,
            _ => 10.0,
        }
    } else {
        match fraction {
            f if f <= 1.0 => 1.0,
            f if f <= 2.0 => 2.0,
            f if f <= 5.0 => 5.0,
            _ => 10.0,
        }
    };
    nice * 10f64.powf(exponent)
}

/// The scale of an axis: its least and greatest numbers, which include zero and the data, and the step between the lines.
fn scale(least: f64, greatest: f64, lines: usize) -> (f64, f64, f64) {
    let (lo, hi) = (least.min(0.0), greatest.max(0.0));
    let (lo, hi) = if hi - lo <= f64::EPSILON {
        (lo, lo + 1.0)
    } else {
        (lo, hi)
    };
    let step = nice(nice(hi - lo, false) / (lines.max(2) - 1) as f64, true);
    ((lo / step).floor() * step, (hi / step).ceil() * step, step)
}

fn unit(pt: f64) -> f64 {
    points_to_units(pt)
}

/// Words in a box, set at `pt`, shrunk by the renderer if they do not fit.
#[allow(clippy::too_many_arguments)]
fn words(
    parts: &mut Parts,
    r: Rect,
    text: &str,
    pt: f64,
    align: Align,
    valign: VAlign,
    color: &str,
    bold: bool,
) {
    let mut run = run(text, pt).color(color);
    if bold {
        run = run.bold();
    }
    let paragraph = para(vec![run])
        .style("body")
        .spacing(1.0)
        .after(0.0)
        .align(align);
    parts.text(
        r,
        Text {
            fit: Some(TextFit::Shrink),
            ..text_of(vec![paragraph], valign, insets(0.0, 0.0, 0.0, 0.0))
        },
    );
}

/// `text` cut to what fits `room` units at `pt`, with an ellipsis where it was cut.
fn cut(text: &str, room: f64, pt: f64) -> String {
    if width(text, pt, Face::Sans, false) <= room {
        return text.to_owned();
    }
    let mut out = String::new();
    for c in text.chars() {
        let next = format!("{out}{c}\u{2026}");
        if width(&next, pt, Face::Sans, false) > room {
            break;
        }
        out.push(c);
    }
    format!("{out}\u{2026}")
}

/// A box with a line of words in it, centred on `x`.
fn centred(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect {
        x: x - w / 2.0,
        y,
        w,
        h,
    }
}

/// The room a chart is drawn in once its title and its legend have theirs.
struct Frame {
    plot: Rect,
    legend: Option<Rect>,
}

const LEGEND_PT: f64 = 13.0;

fn frame(parts: &mut Parts, rect: Rect, element: &ChartEl, legend_rows: bool) -> Frame {
    let inner = pad(
        rect,
        (rect.w * 0.02).clamp(4.0, 12.0),
        (rect.h * 0.03).clamp(4.0, 12.0),
    );
    let mut top = inner.y;
    let mut bottom = inner.y + inner.h;
    if let Some(title) = element
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| clip(t, 200))
    {
        let pt = fit_pt(22.0, 12.0, |pt| {
            width(&title, pt, Face::Sans, true) <= inner.w && unit(pt * 1.4) <= inner.h * 0.2
        });
        let h = unit(pt * 1.4);
        words(
            parts,
            Rect {
                x: inner.x,
                y: top,
                w: inner.w,
                h,
            },
            &title,
            pt,
            Align::Center,
            VAlign::Middle,
            "text1",
            true,
        );
        top += h + 4.0;
    } else {
        parts.skip();
    }
    let legend = legend_rows.then(|| {
        let h = unit(LEGEND_PT * 1.7);
        bottom -= h;
        Rect {
            x: inner.x,
            y: bottom + 2.0,
            w: inner.w,
            h: h - 2.0,
        }
    });
    Frame {
        plot: Rect {
            x: inner.x,
            y: top,
            w: inner.w,
            h: (bottom - top).max(0.0),
        },
        legend,
    }
}

/// A row of swatches with names, centred in `room`.
fn legend_row(parts: &mut Parts, room: Rect, entries: &[(String, String)]) {
    if entries.is_empty() || room.w <= 0.0 {
        return;
    }
    let swatch = unit(LEGEND_PT) * 0.8;
    let gap = unit(LEGEND_PT) * 1.2;
    let each = (room.w / entries.len() as f64 - swatch - gap * 0.5 - gap).max(20.0);
    let names: Vec<String> = entries
        .iter()
        .map(|(name, _)| cut(name, each, LEGEND_PT))
        .collect();
    let widths: Vec<f64> = names
        .iter()
        .map(|n| width(n, LEGEND_PT, Face::Sans, false) + 2.0)
        .collect();
    let total: f64 = widths.iter().map(|w| swatch + gap * 0.5 + w).sum::<f64>()
        + gap * (entries.len() - 1) as f64;
    let mut x = room.x + (room.w - total).max(0.0) / 2.0;
    for ((name, (_, color)), w) in names.iter().zip(entries).zip(widths) {
        parts.shape(
            "roundRect",
            Rect {
                x,
                y: room.y + (room.h - swatch) / 2.0,
                w: swatch,
                h: swatch,
            },
            filled(color).radius(2.0),
            None,
        );
        x += swatch + gap * 0.5;
        words(
            parts,
            Rect {
                x,
                y: room.y,
                w: w + 2.0,
                h: room.h,
            },
            name,
            LEGEND_PT,
            Align::Left,
            VAlign::Middle,
            "text1",
            false,
        );
        x += w + gap;
    }
}

/// The axes of a bar or a line chart, and the room that is left for the marks: the scale (with its lines) on the left and the
/// categories under them. Gives the plot's box, the scale, and the width of a category.
struct Axes {
    plot: Rect,
    least: f64,
    greatest: f64,
    group: f64,
}

impl Axes {
    fn y(&self, v: f64) -> f64 {
        self.plot.y + self.plot.h * (self.greatest - v) / (self.greatest - self.least)
    }

    fn x(&self, category: usize) -> f64 {
        self.plot.x + self.group * (category as f64 + 0.5)
    }
}

fn axes(parts: &mut Parts, room: Rect, data: &Data) -> Axes {
    let all = data.series.iter().flat_map(|(_, _, v)| v.iter().copied());
    let (least, greatest) = all.fold((0.0f64, 0.0f64), |(lo, hi), v| (lo.min(v), hi.max(v)));
    let (least, greatest, step) = scale(least, greatest, 5);
    let ticks: Vec<f64> = (0..)
        .map(|i| least + step * f64::from(i))
        .take_while(|t| *t <= greatest + step * 0.001)
        .take(12)
        .collect();
    let tick_pt = (room.h / 16.0).clamp(10.0, 14.0);
    let labels: Vec<String> = ticks.iter().map(|t| number(*t)).collect();
    let label_w = labels
        .iter()
        .map(|l| width(l, tick_pt, Face::Sans, false))
        .fold(0.0, f64::max)
        + 8.0;
    let columns = data.categories.len().max(1) as f64;
    let x0 = room.x + label_w;
    let w = (room.w - label_w).max(1.0);
    let group = w / columns;
    // The names of the categories: the largest size at which none needs more than two lines.
    let name_pt = fit_pt(14.0, 9.0, |pt| {
        data.categories
            .iter()
            .all(|c| line_count(c, group - 4.0, pt, Face::Sans, false) <= 2)
    });
    let lines = data
        .categories
        .iter()
        .map(|c| line_count(c, group - 4.0, name_pt, Face::Sans, false).clamp(1, 2))
        .max()
        .unwrap_or(1);
    let names_h = unit(name_pt * 1.25) * lines as f64 + 4.0;
    let plot = Rect {
        x: x0,
        y: room.y + unit(tick_pt) * 0.5,
        w,
        h: (room.h - names_h - unit(tick_pt) * 0.5).max(1.0),
    };
    let found = Axes {
        plot,
        least,
        greatest,
        group,
    };
    for (tick, label) in ticks.iter().zip(&labels) {
        let y = found.y(*tick);
        let zero = tick.abs() < step * 0.001;
        parts.line(
            Rect {
                x: plot.x,
                y,
                w: plot.w,
                h: 0.0,
            },
            outlined("text2", if zero { 1.5 } else { 1.0 }).stroke_alpha(if zero {
                0.8
            } else {
                0.25
            }),
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
    for (i, name) in data.categories.iter().enumerate() {
        words(
            parts,
            Rect {
                x: plot.x + group * i as f64 + 2.0,
                y: plot.y + plot.h + 4.0,
                w: group - 4.0,
                h: names_h - 4.0,
            },
            name,
            name_pt,
            Align::Center,
            VAlign::Top,
            "text1",
            false,
        );
    }
    found
}

fn bars(parts: &mut Parts, room: Rect, element: &ChartEl, data: &Data) {
    let found = axes(parts, room, data);
    let m = data.series.len().max(1) as f64;
    let inner = found.group * 0.78;
    let each = inner / m;
    let zero = found.y(0.0);
    let value_pt = (each * 0.45).clamp(10.0, 13.0);
    for (i, _) in data.categories.iter().enumerate() {
        let left = found.plot.x + found.group * i as f64 + (found.group - inner) / 2.0;
        for (j, (_, color, values)) in data.series.iter().enumerate() {
            let v = values[i];
            let top = found.y(v);
            let (y, h) = if v >= 0.0 {
                (top, (zero - top).max(1.0))
            } else {
                (zero, (top - zero).max(1.0))
            };
            let gap = if m > 1.0 { 1.0 } else { 0.0 };
            let x = left + each * j as f64 + gap;
            parts.shape(
                "rect",
                Rect {
                    x,
                    y,
                    w: (each - 2.0 * gap).max(1.0),
                    h,
                },
                filled(color),
                None,
            );
            if element.labels {
                let at = if v >= 0.0 {
                    y - unit(value_pt) * 1.5
                } else {
                    y + h + 1.0
                };
                words(
                    parts,
                    centred(
                        x + each / 2.0,
                        at,
                        (each + 24.0).max(36.0),
                        unit(value_pt) * 1.4,
                    ),
                    &number(v),
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

fn lines(parts: &mut Parts, room: Rect, element: &ChartEl, data: &Data) {
    let found = axes(parts, room, data);
    let value_pt = 12.0;
    for (_, color, values) in &data.series {
        let points: Vec<(f64, f64)> = values
            .iter()
            .enumerate()
            .map(|(i, v)| (found.x(i), found.y(*v)))
            .collect();
        for pair in points.windows(2) {
            let ((x1, y1), (x2, y2)) = (pair[0], pair[1]);
            let line = parts.line(
                Rect {
                    x: x1,
                    y: y1.min(y2),
                    w: x2 - x1,
                    h: (y2 - y1).abs(),
                },
                outlined(color, 3.0),
            );
            if y2 < y1 {
                line.base_mut().flip_v = true;
            }
        }
        for ((x, y), v) in points.iter().zip(values) {
            parts.shape(
                "ellipse",
                Rect {
                    x: x - 5.0,
                    y: y - 5.0,
                    w: 10.0,
                    h: 10.0,
                },
                filled(color).stroke("bg1", 1.5),
                None,
            );
            if element.labels {
                words(
                    parts,
                    centred(*x, y - unit(value_pt) * 1.9, 48.0, unit(value_pt) * 1.4),
                    &number(*v),
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

/// The wedges of one slice of a pie: thin isosceles triangles with their points at the middle, turned to face along the slice.
fn slice(parts: &mut Parts, (cx, cy): (f64, f64), radius: f64, from: f64, sweep: f64, color: &str) {
    let count = ((sweep / WEDGE).ceil() as usize).max(1);
    let each = sweep / count as f64;
    for n in 0..count {
        let middle = from + each * (n as f64 + 0.5);
        let rad = middle.to_radians();
        let (dx, dy) = (rad.sin(), -rad.cos());
        let height = radius * (each.to_radians() / 2.0).cos();
        let base = 2.0 * radius * (each.to_radians() / 2.0).sin() * 1.06;
        let (x, y) = (cx + dx * height / 2.0, cy + dy * height / 2.0);
        let wedge = parts.shape(
            "triangle",
            Rect {
                x: x - base / 2.0,
                y: y - height / 2.0,
                w: base,
                h: height + 0.5,
            },
            filled(color),
            None,
        );
        // A triangle points up; this one points at the middle of the pie, which is the other way from the slice.
        wedge.base_mut().rotation = Some((middle + 180.0).rem_euclid(360.0));
    }
}

fn pie(parts: &mut Parts, room: Rect, element: &ChartEl, data: &Data, legend: bool) {
    let values: Vec<f64> = data
        .series
        .first()
        .map_or_else(Vec::new, |(_, _, v)| v.iter().map(|x| x.max(0.0)).collect());
    let total: f64 = values.iter().sum();
    let entries: Vec<(String, String)> = data
        .categories
        .iter()
        .enumerate()
        .map(|(i, name)| (name.clone(), PALETTE[i % PALETTE.len()].to_owned()))
        .collect();
    // What each slice's share is called in the legend, after its name.
    let shares: Vec<String> = (0..entries.len())
        .map(|n| match values.get(n).copied() {
            Some(v) if total > 0.0 => format!("  {}%", number((100.0 * v / total).round())),
            _ => String::new(),
        })
        .collect();
    let swatch = unit(LEGEND_PT) * 0.8;
    // The legend is a column at the right, as wide as its longest line asks, but not more than two fifths of the room.
    let legend_w = if legend {
        let widest = entries
            .iter()
            .zip(&shares)
            .map(|((n, _), s)| width(&format!("{n}{s}"), LEGEND_PT, Face::Sans, false))
            .fold(0.0, f64::max);
        (widest + swatch + unit(LEGEND_PT) * 2.2).min(room.w * 0.42)
    } else {
        0.0
    };
    let disc = Rect {
        x: room.x,
        y: room.y,
        w: (room.w - legend_w).max(1.0),
        h: room.h,
    };
    let radius = (disc.w.min(disc.h) / 2.0 * 0.96).max(1.0);
    let middle = (disc.x + disc.w / 2.0, disc.y + disc.h / 2.0);
    if total <= 0.0 {
        parts.shape(
            "ellipse",
            Rect {
                x: middle.0 - radius,
                y: middle.1 - radius,
                w: radius * 2.0,
                h: radius * 2.0,
            },
            outlined("text2", 2.0).stroke_alpha(0.5),
            None,
        );
        words(
            parts,
            Rect {
                x: middle.0 - radius,
                y: middle.1 - 12.0,
                w: radius * 2.0,
                h: 24.0,
            },
            "No data",
            14.0,
            Align::Center,
            VAlign::Middle,
            "text2",
            false,
        );
    } else {
        let mut from = 0.0;
        for (i, v) in values.iter().enumerate() {
            if *v <= 0.0 {
                continue;
            }
            let sweep = 360.0 * v / total;
            slice(
                parts,
                middle,
                radius,
                from,
                sweep,
                PALETTE[i % PALETTE.len()],
            );
            if element.labels {
                let mid = (from + sweep / 2.0).to_radians();
                let at = (
                    middle.0 + mid.sin() * radius * 0.62,
                    middle.1 - mid.cos() * radius * 0.62,
                );
                words(
                    parts,
                    centred(at.0, at.1 - unit(13.0) * 0.7, 56.0, unit(13.0) * 1.4),
                    &format!("{}%", number((100.0 * v / total * 10.0).round() / 10.0)),
                    13.0,
                    Align::Center,
                    VAlign::Middle,
                    "bg1",
                    true,
                );
            }
            from += sweep;
        }
    }
    if legend {
        let row = unit(LEGEND_PT * 1.7);
        let shown = ((room.h / row).floor() as usize).max(1).min(entries.len());
        let top = room.y + (room.h - row * shown as f64) / 2.0;
        let x = room.x + room.w - legend_w + unit(LEGEND_PT) * 0.6;
        for (n, (name, color)) in entries.iter().take(shown).enumerate() {
            let y = top + row * n as f64;
            parts.shape(
                "roundRect",
                Rect {
                    x,
                    y: y + (row - swatch) / 2.0,
                    w: swatch,
                    h: swatch,
                },
                filled(color).radius(2.0),
                None,
            );
            let room_for_name = legend_w
                - swatch
                - unit(LEGEND_PT) * 1.4
                - width(&shares[n], LEGEND_PT, Face::Sans, false);
            let name = cut(name, room_for_name.max(12.0), LEGEND_PT);
            words(
                parts,
                Rect {
                    x: x + swatch + unit(LEGEND_PT) * 0.5,
                    y,
                    w: legend_w - swatch - unit(LEGEND_PT) * 1.4,
                    h: row,
                },
                &format!("{name}{}", shares[n]),
                LEGEND_PT,
                Align::Left,
                VAlign::Middle,
                "text1",
                false,
            );
        }
    }
}

pub fn expand(cx: &Ctx, element: &ChartEl) -> Vec<Element> {
    let rect = sane(cx.rect);
    let mut parts = Parts::new(cx.id, rect);
    let data = data_of(element);
    let nothing = data.series.is_empty() || data.categories.is_empty();
    let legend = element
        .legend
        .unwrap_or(data.series.len() > 1 || element.kind == ChartKind::Pie);
    if nothing {
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
        let pt = fit_pt(20.0, 10.0, |pt| {
            width("Add the numbers of the chart", pt, Face::Sans, false) <= rect.w * 0.9
        });
        words(
            &mut parts,
            pad(rect, 8.0, 8.0),
            "Add the numbers of the chart",
            pt,
            Align::Center,
            VAlign::Middle,
            "text2",
            false,
        );
        return parts.finish();
    }
    // A pie keeps its legend at its side; the others under the plot.
    let Frame { plot, legend: row } = frame(
        &mut parts,
        rect,
        element,
        legend && element.kind != ChartKind::Pie,
    );
    match element.kind {
        ChartKind::Bar => bars(&mut parts, plot, element, &data),
        ChartKind::Line => lines(&mut parts, plot, element, &data),
        ChartKind::Pie => pie(&mut parts, plot, element, &data, legend),
    }
    if let Some(row) = row {
        let entries: Vec<(String, String)> = data
            .series
            .iter()
            .map(|(name, color, _)| (name.clone(), color.clone()))
            .collect();
        legend_row(&mut parts, row, &entries);
    }
    parts.finish()
}

#[cfg(test)]
mod tests;
