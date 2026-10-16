//! Words in the draft picture: broken into lines that fit, and set as
//! `<text>` elements (never `foreignObject`, which a rasteriser such as the
//! one that makes a slide's picture cannot draw).

use super::style::{Align, Look, VAlign, n};
use crate::diagrams::model::Rect;

/// Lines of words are never more than this many, nor longer than this.
const MAX_LINES: usize = 60;
const MAX_LINE: usize = 300;

/// What a character of the font takes, as a share of its size.
const CHAR: f64 = 0.56;
const LINE: f64 = 1.2;

/// `text` as the inside of an element: markup characters escaped, control
/// characters gone.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if c.is_control() && c != ' ' => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

/// How wide `line` is set, estimated.
pub fn width_of(line: &str, size: f64, bold: bool) -> f64 {
    line.chars().count() as f64 * size * CHAR * if bold { 1.07 } else { 1.0 }
}

/// The lines of `text`: its own, and broken at spaces to fit `max` wide when `wrap`.
pub fn lines(text: &str, look: &Look, max: f64) -> Vec<String> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let raw = raw.trim_end();
        if !look.wrap || max <= 0.0 || width_of(raw, look.font_size, look.bold) <= max {
            out.push(raw.chars().take(MAX_LINE).collect::<String>());
            continue;
        }
        let mut current = String::new();
        for word in raw.split_whitespace() {
            let tried = if current.is_empty() {
                word.to_owned()
            } else {
                format!("{current} {word}")
            };
            if !current.is_empty() && width_of(&tried, look.font_size, look.bold) > max {
                out.push(std::mem::take(&mut current));
                current = word.to_owned();
            } else {
                current = tried;
            }
        }
        if !current.is_empty() {
            out.push(current.chars().take(MAX_LINE).collect());
        }
    }
    out.truncate(MAX_LINES);
    out
}

/// The text attributes of a look.
fn attrs(look: &Look, anchor: &str) -> String {
    let mut out = format!(
        " font-family=\"Helvetica, Arial, sans-serif\" font-size=\"{}\" fill=\"{}\" text-anchor=\"{anchor}\"",
        n(look.font_size),
        look.font_color
    );
    if look.bold {
        out.push_str(" font-weight=\"bold\"");
    }
    if look.italic {
        out.push_str(" font-style=\"italic\"");
    }
    if look.underline {
        out.push_str(" text-decoration=\"underline\"");
    }
    out
}

/// Sets `text` inside `area` as `look` says: aligned, and wrapped when asked.
pub fn put(out: &mut String, text: &str, look: &Look, area: Rect) {
    if text.trim().is_empty() {
        return;
    }
    let pad = look.spacing;
    let set = lines(text, look, area.w - 2.0 * pad);
    let line_h = look.font_size * LINE;
    let total = set.len() as f64 * line_h;
    let (x, anchor) = match look.align {
        Align::Left => (area.x + pad, "start"),
        Align::Center => (area.x + area.w / 2.0, "middle"),
        Align::Right => (area.right() - pad, "end"),
    };
    let top = match look.valign {
        VAlign::Top => area.y + pad,
        VAlign::Middle => area.y + (area.h - total) / 2.0,
        VAlign::Bottom => area.bottom() - pad - total,
    };
    for (i, line) in set.iter().enumerate() {
        if line.is_empty() {
            continue;
        }
        let y = top + i as f64 * line_h + look.font_size * 0.9;
        out.push_str(&format!(
            "<text x=\"{}\" y=\"{}\"{}>{}</text>\n",
            n(x),
            n(y),
            attrs(look, anchor),
            escape(line)
        ));
    }
}

/// Sets `text` centred on a point with a white ground behind it, as the
/// words on an edge are.
pub fn put_on_ground(out: &mut String, text: &str, look: &Look, at: (f64, f64)) {
    let set = lines(text, look, 0.0);
    if set.iter().all(String::is_empty) {
        return;
    }
    let line_h = look.font_size * LINE;
    let wide = set
        .iter()
        .map(|l| width_of(l, look.font_size, look.bold))
        .fold(0.0, f64::max);
    let (w, h) = (wide + 6.0, set.len() as f64 * line_h + 2.0);
    out.push_str(&format!(
        "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"2\" fill=\"#ffffff\" stroke=\"none\"/>\n",
        n(at.0 - w / 2.0),
        n(at.1 - h / 2.0),
        n(w),
        n(h)
    ));
    let mut centred = look.clone();
    centred.align = Align::Center;
    centred.valign = VAlign::Middle;
    centred.wrap = false;
    put(
        out,
        text,
        &centred,
        Rect {
            x: at.0 - w / 2.0,
            y: at.1 - h / 2.0,
            w,
            h,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagrams::model::Style;

    fn look(style: &str) -> Look {
        Look::of(&Style::parse(style), false, false)
    }

    #[test]
    fn words_are_escaped_and_control_characters_are_gone() {
        assert_eq!(
            escape("a < b & \"c\" > d\u{7}e\u{0}"),
            "a &lt; b &amp; &quot;c&quot; &gt; d e "
        );
    }

    #[test]
    fn long_lines_break_at_spaces_to_fit_and_only_when_asked() {
        let wrap = look("whiteSpace=wrap");
        let set = lines("the quick brown fox jumps over the lazy dog", &wrap, 100.0);
        assert!(
            set.len() >= 3 && set.iter().all(|l| width_of(l, 12.0, false) <= 100.0),
            "{set:?}"
        );
        assert_eq!(set.join(" "), "the quick brown fox jumps over the lazy dog");
        assert_eq!(lines("the quick brown fox jumps", &look(""), 50.0).len(), 1);
        assert_eq!(lines("one\ntwo", &wrap, 500.0), ["one", "two"]);
        assert_eq!(lines(&"x".repeat(1000), &look(""), 0.0)[0].len(), 300);
        assert_eq!(lines(&"w\n".repeat(200), &look(""), 0.0).len(), 60);
    }

    #[test]
    fn words_are_set_where_the_look_puts_them() {
        let mut svg = String::new();
        put(
            &mut svg,
            "Web app",
            &look(""),
            Rect {
                x: 40.0,
                y: 80.0,
                w: 120.0,
                h: 60.0,
            },
        );
        assert!(
            svg.contains("x=\"100\"")
                && svg.contains("text-anchor=\"middle\"")
                && svg.contains(">Web app</text>"),
            "{svg}"
        );
        assert!(svg.contains("y=\"113.6\""), "{svg}");
        let mut left = String::new();
        put(
            &mut left,
            "A\nB",
            &look("align=left;verticalAlign=top;fontStyle=1"),
            Rect {
                x: 0.0,
                y: 0.0,
                w: 100.0,
                h: 100.0,
            },
        );
        assert!(
            left.contains("x=\"2\"")
                && left.contains("text-anchor=\"start\"")
                && left.contains("font-weight=\"bold\"")
                && left.matches("<text").count() == 2,
            "{left}"
        );
        let mut none = String::new();
        put(&mut none, "  ", &look(""), Rect::default());
        assert!(none.is_empty());
    }

    #[test]
    fn the_words_on_an_edge_have_a_white_ground() {
        let mut svg = String::new();
        put_on_ground(
            &mut svg,
            "HTTPS",
            &Look::of(&Style::parse(""), true, false),
            (200.0, 100.0),
        );
        assert!(
            svg.starts_with("<rect")
                && svg.contains("fill=\"#ffffff\"")
                && svg.contains(">HTTPS</text>"),
            "{svg}"
        );
        assert!(!svg.contains("foreignObject"));
    }
}
