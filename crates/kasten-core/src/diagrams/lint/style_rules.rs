//! The rules about how the diagram looks and reads: text size, contrast, a
//! title, a legend.

use super::{Severity, Sink};
use crate::diagrams::model::Kind;

/// A `#rgb` or `#rrggbb` colour as red, green and blue.
fn rgb(text: &str) -> Option<(f64, f64, f64)> {
    let hex = text.trim().strip_prefix('#')?;
    let part = |s: &str| u8::from_str_radix(s, 16).ok().map(f64::from);
    match hex.len() {
        6 => Some((part(&hex[0..2])?, part(&hex[2..4])?, part(&hex[4..6])?)),
        3 => {
            let d = |i: usize| part(&hex[i..=i]).map(|v| v * 17.0);
            Some((d(0)?, d(1)?, d(2)?))
        }
        _ => None,
    }
}

fn luminance((r, g, b): (f64, f64, f64)) -> f64 {
    let lin = |v: f64| {
        let v = v / 255.0;
        if v <= 0.03928 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/// The WCAG contrast ratio between two colours, 1 to 21.
pub fn contrast(a: (f64, f64, f64), b: (f64, f64, f64)) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// The font sizes (in pixels) a label asks for with `font-size: Npx`.
fn label_sizes(html: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(at) = rest.find("font-size:") {
        rest = &rest[at + 10..];
        let digits: String = rest
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if let Ok(v) = digits.parse::<f64>() {
            out.push(v);
        }
    }
    out
}

pub(super) fn run(s: &mut Sink) {
    let page = s.page;
    let mut tiny = Vec::new();
    let mut poor = Vec::new();
    for c in page
        .live()
        .filter(|c| matches!(c.kind, Kind::Vertex | Kind::Edge))
    {
        if c.text().trim().is_empty() {
            continue;
        }
        let size = c
            .style
            .number("fontSize")
            .into_iter()
            .chain(label_sizes(&c.label))
            .fold(f64::MAX, f64::min);
        if size < 10.0 {
            tiny.push((
                c.id.clone(),
                format!("The text of “{}” is {size} pixels high", c.id),
            ));
        }
        if let Some(fill) = c.style.get("fillColor").and_then(rgb) {
            let ink = c
                .style
                .get("fontColor")
                .and_then(rgb)
                .unwrap_or((0.0, 0.0, 0.0));
            let ratio = contrast(fill, ink);
            if ratio < 3.0 && c.is_vertex() {
                poor.push((
                    c.id.clone(),
                    format!(
                        "The text of “{}” is hard to read on its fill (contrast {ratio:.1} to 1)",
                        c.id
                    ),
                ));
            }
        }
    }
    s.many(
        "tiny-text",
        Severity::Warning,
        tiny,
        "Use text of 10 pixels or more; 12 is the editor's own",
    );
    s.many("contrast", Severity::Warning, poor, "Use a darker text colour on a light fill or a lighter one on a dark fill (aim for 4.5 to 1)");

    let nodes = page.vertices().filter(|c| !s.is_group(c)).count();
    if nodes >= 6 && !has_title(s) {
        s.add(
            "no-title",
            Severity::Info,
            None,
            "The diagram has no title".to_owned(),
            "Add a note at the top, in a large bold font, that says what the diagram shows",
        );
    }
    if nodes >= 4
        && needs_legend(s)
        && !page.vertices().any(|c| {
            let t = c.text().to_lowercase();
            t.contains("legend") || t.starts_with("key")
        })
    {
        s.add(
            "no-legend",
            Severity::Info,
            None,
            "The diagram uses several colours or line styles and has no legend".to_owned(),
            "Add a small note that says what each colour or dashed line means",
        );
    }
}

fn has_title(s: &Sink) -> bool {
    let page = s.page;
    let top = page
        .vertices()
        .filter_map(|c| page.abs(&c.id))
        .map(|r| r.y)
        .fold(f64::MAX, f64::min);
    page.vertices().any(|c| {
        let big = c.style.number("fontSize").unwrap_or(12.0) >= 16.0
            || c.style
                .number("fontStyle")
                .is_some_and(|f| (f as i64) & 1 == 1);
        let near_top = page.abs(&c.id).is_some_and(|r| r.y <= top + 80.0);
        c.style.bare() == Some("text") && big && near_top && !c.text().trim().is_empty()
    })
}

fn needs_legend(s: &Sink) -> bool {
    let page = s.page;
    let mut fills: Vec<&str> = page
        .vertices()
        .filter_map(|c| c.style.get("fillColor"))
        .filter(|f| *f != "none" && *f != "default")
        .collect();
    fills.sort_unstable();
    fills.dedup();
    let dashed = page.edges().any(|e| e.style.flag("dashed"));
    let solid = page.edges().any(|e| !e.style.flag("dashed"));
    fills.len() >= 3 || (dashed && solid && page.edges().count() >= 4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contrast_follows_the_standards_ratios() {
        assert!((contrast((0.0, 0.0, 0.0), (255.0, 255.0, 255.0)) - 21.0).abs() < 0.01);
        assert!(contrast(rgb("#ffffff").unwrap(), rgb("#fff").unwrap()) < 1.01);
        assert!(contrast(rgb("#dae8fc").unwrap(), (0.0, 0.0, 0.0)) > 10.0);
        assert!(contrast(rgb("#ffff00").unwrap(), rgb("#ffffff").unwrap()) < 1.5);
        assert!(rgb("none").is_none() && rgb("#12").is_none());
        assert_eq!(
            label_sizes("<font style=\"font-size: 9px\">a</font><span style='font-size:14px'>b"),
            vec![9.0, 14.0]
        );
    }
}
