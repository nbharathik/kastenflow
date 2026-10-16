//! The rules of the format that the operations check an element against before they keep it: colours
//! are theme tokens or `#rrggbb`, sizes and fractions are in range, a table follows its rules.
//! (`Engine::check` looks at ids and layouts; it does not look at these.)

use crate::model::{Element, Paragraph, Style, Text, is_color};

pub(super) fn color_ok(c: &str) -> Result<(), String> {
    if is_color(c) {
        Ok(())
    } else {
        Err(format!(
            "`{c}` is not a theme colour (text1, bg2, accent3, ...) or a #rrggbb value"
        ))
    }
}

pub(super) fn unit(v: Option<f64>, what: &str) -> Result<(), String> {
    match v {
        Some(v) if !(0.0..=1.0).contains(&v) => Err(format!("{what} is between 0 and 1, not {v}")),
        _ => Ok(()),
    }
}

fn check_style(s: &Style) -> Result<(), String> {
    if let Some(f) = &s.fill {
        color_ok(&f.color)?;
        unit(f.alpha, "fill alpha")?;
    }
    if let Some(l) = &s.stroke {
        color_ok(&l.color)?;
        unit(l.alpha, "stroke alpha")?;
        if l.width.is_some_and(|w| w < 0.0) {
            return Err("a stroke width cannot be negative".to_owned());
        }
    }
    if let Some(sh) = &s.shadow {
        color_ok(&sh.color)?;
    }
    unit(s.opacity, "opacity")
}

/// The farthest a paragraph may be moved in from its box's edge, in slide units.
const MOST_INDENT: f64 = 5000.0;

/// Whether a paragraph and its runs follow the format's rules.
pub(super) fn check_paragraph(p: &Paragraph) -> Result<(), String> {
    for r in &p.runs {
        if let Some(c) = &r.color {
            color_ok(c)?;
        }
        if let Some(c) = &r.highlight {
            color_ok(c)?;
        }
        if r.size.is_some_and(|s| s <= 0.0) {
            return Err("a run's size is above 0 points".to_owned());
        }
        if r.spacing
            .is_some_and(|s| !s.is_finite() || s.abs() > 1000.0)
        {
            return Err(
                "the space between letters is a number of points, between -1000 and 1000"
                    .to_owned(),
            );
        }
    }
    if let Some(c) = &p.bullet_color {
        color_ok(c)?;
    }
    if p.bullet_size
        .is_some_and(|s| !s.is_finite() || !(0.25..=4.0).contains(&s))
    {
        return Err(
            "a marker's size is a multiple of the words' size, from 0.25 to 4 (25% to 400%)"
                .to_owned(),
        );
    }
    if p.start.is_some_and(|n| n > 99_999) {
        return Err("a numbered item cannot start at a number above 99999".to_owned());
    }
    for (name, v) in [("marginLeft", p.margin_left), ("indent", p.indent)] {
        if v.is_some_and(|v| !v.is_finite() || v.abs() > MOST_INDENT) {
            return Err(format!(
                "`{name}` is a number of slide units, within {MOST_INDENT} of the edge"
            ));
        }
    }
    if p.margin_left.is_some_and(|v| v < 0.0) {
        return Err("`marginLeft` cannot be negative".to_owned());
    }
    Ok(())
}

fn check_text(t: &Text) -> Result<(), String> {
    t.paragraphs.iter().try_for_each(check_paragraph)
}

/// Whether an element, and what it holds, follows the format's rules.
pub fn validate(e: &Element) -> Result<(), String> {
    let b = e.base();
    for (name, v) in [("w", b.w), ("h", b.h)] {
        if v.is_some_and(|v| v < 0.0) {
            return Err(format!("`{name}` cannot be negative"));
        }
    }
    if let Some(s) = &b.style {
        check_style(s)?;
    }
    if let Some(t) = e.text() {
        check_text(t)?;
    }
    match e {
        Element::Shape(s) if s.shape.is_empty() => {
            return Err(
                "a shape needs a `shape` name such as rect, roundRect or ellipse".to_owned(),
            );
        }
        Element::Table(t) => {
            if let Some(problem) = t.problem() {
                return Err(problem);
            }
            for c in t.rows.iter().flat_map(|r| &r.cells) {
                check_text(&c.text)?;
                if let Some(fill) = &c.fill {
                    color_ok(&fill.color)?;
                    unit(fill.alpha, "fill alpha")?;
                }
            }
        }
        _ => {}
    }
    e.children().iter().try_for_each(validate)
}
