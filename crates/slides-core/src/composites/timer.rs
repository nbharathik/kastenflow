//! Timer: a countdown on a rounded panel, the time in big digits and, if it has one, a few words over them.
//!
//! Wherever a slide is only drawn (the editor, a thumbnail, a PDF, PowerPoint) it shows the time it starts at. A
//! presentation counts it down: it draws the timer again each second with `seconds` set to what is left, so the digits look
//! exactly as they do here.

use super::Ctx;
use super::build::{ParaExt, Parts, RunExt, StyleExt, filled, insets, para, run, text_of};
use super::geom::{pad, sane};
use super::measure::{Face, fit_pt, width};
use crate::model::{Align, Element, TextFit, TimerEl, VAlign};
use crate::resolve::Rect;
use crate::units::points_to_units;

/// The longest a timer counts: a day.
pub const MOST_SECONDS: u32 = 24 * 3600 - 1;

/// A time as a clock shows it: `05:00`, or `1:05:00` from an hour on.
pub fn clock(seconds: u32) -> String {
    let s = seconds.min(MOST_SECONDS);
    let (h, m, s) = (s / 3600, (s / 60) % 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

/// The words a person who cannot see the timer is told.
pub fn alt_of(element: &TimerEl) -> String {
    match element
        .label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        Some(label) => format!("Timer, {}: {label}", spoken(element.seconds)),
        None => format!("Timer, {}", spoken(element.seconds)),
    }
}

/// A length of time in words: `5 minutes`, `1 hour 30 minutes`, `45 seconds`.
fn spoken(seconds: u32) -> String {
    let s = seconds.min(MOST_SECONDS);
    let (h, m, s) = (s / 3600, (s / 60) % 60, s % 60);
    let part = |n: u32, what: &str| {
        (n > 0).then(|| format!("{n} {what}{}", if n == 1 { "" } else { "s" }))
    };
    let parts: Vec<String> = [part(h, "hour"), part(m, "minute"), part(s, "second")]
        .into_iter()
        .flatten()
        .collect();
    if parts.is_empty() {
        "0 seconds".to_owned()
    } else {
        parts.join(" ")
    }
}

pub fn expand(cx: &Ctx, element: &TimerEl) -> Vec<Element> {
    let rect = sane(cx.rect);
    let mut parts = Parts::new(cx.id, rect);
    parts.shape(
        "roundRect",
        rect,
        filled("bg2")
            .radius(12.0)
            .stroke("text2", 1.5)
            .stroke_alpha(0.4),
        None,
    );
    let inner = pad(
        rect,
        (rect.w * 0.06).clamp(6.0, 28.0),
        (rect.h * 0.08).clamp(4.0, 20.0),
    );
    let time = clock(element.seconds);
    let label = element
        .label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty());
    let label_h = if label.is_some() {
        (inner.h * 0.26).min(points_to_units(40.0))
    } else {
        0.0
    };
    let digits_h = (inner.h - label_h).max(0.0);
    let flat = insets(0.0, 0.0, 0.0, 0.0);
    let size = fit_pt(200.0, 12.0, |pt| {
        width(&time, pt, Face::Mono, true) <= inner.w && points_to_units(pt * 1.2) <= digits_h
    });
    let digits = para(vec![run(&time, size).font("code").bold().color("text1")])
        .style("code")
        .spacing(1.0)
        .after(0.0)
        .align(Align::Center);
    parts.text(
        Rect {
            x: inner.x,
            y: inner.y + label_h,
            w: inner.w,
            h: digits_h,
        },
        crate::model::Text {
            fit: Some(TextFit::Shrink),
            ..text_of(vec![digits], VAlign::Middle, flat.clone())
        },
    );
    match label {
        Some(words) => {
            let pt = fit_pt(28.0, 10.0, |pt| {
                width(words, pt, Face::Sans, false) <= inner.w
                    && points_to_units(pt * 1.3) <= label_h
            });
            let paragraph = para(vec![run(words, pt).color("text2")])
                .style("body")
                .spacing(1.0)
                .after(0.0)
                .align(Align::Center);
            parts.text(
                Rect {
                    x: inner.x,
                    y: inner.y,
                    w: inner.w,
                    h: label_h,
                },
                crate::model::Text {
                    fit: Some(TextFit::Shrink),
                    ..text_of(vec![paragraph], VAlign::Middle, flat)
                },
            );
        }
        None => parts.skip(),
    }
    parts.finish()
}

#[cfg(test)]
mod tests;
