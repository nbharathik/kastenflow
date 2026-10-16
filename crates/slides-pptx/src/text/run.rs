//! Runs: a stretch of text with one look. Every property is written out, from
//! the paragraph's style and the run's own settings, so nothing depends on what
//! a layout would have inherited.

use slides_core::{Run, Script, Theme};

use super::metrics::{CODE_GROUND, SCRIPT_LOWER, SCRIPT_RAISE};
use super::resolve::Style;
use crate::color::Color;
use crate::cx::{Cx, Link};
use crate::fonts::{self, Face};
use crate::units::{hundredths, thousandths};
use crate::xml::Xml;

/// The language text is marked with, which decides spelling and hyphenation in PowerPoint.
const LANG: &str = "en-US";

/// The look of a run, ready to write.
#[derive(Clone, Debug, PartialEq)]
pub struct Props {
    pub size: f64,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub color: Color,
    /// How see-through the words are; None when they are solid.
    pub alpha: Option<f64>,
    /// How see-through the ground behind the words is (the same for all of the element's fading).
    pub wash: Option<f64>,
    /// The ground behind the words, which inline code has.
    pub highlight: Option<Color>,
    pub face: Face,
    /// Raised or lowered; PowerPoint sets such words smaller by itself.
    pub script: Option<Script>,
    pub small_caps: bool,
    pub all_caps: bool,
    /// Extra space between letters, in points.
    pub spacing: f64,
}

/// The size of a run in points: its own when that is a size, else its paragraph's.
pub fn run_size(run: &Run, style: &Style) -> f64 {
    run.size
        .filter(|size| size.is_finite() && *size > 0.0)
        .unwrap_or(style.size)
}

/// The ground behind inline code. The editor lays the text colour over the page
/// at a fraction; a file cannot put a see-through ground behind words, so this
/// is the colour that fraction makes over the theme's page.
fn code_ground(theme: &Theme) -> Option<Color> {
    Color::blend(&theme.colors.text1, &theme.colors.bg1, CODE_GROUND)
}

/// The colour and the transparency of words drawn at `opacity`. Words a step dims (`cx.dim`)
/// are mixed toward the colour behind the element that dims them (the page's, unless a shape
/// holds them) and not made see-through: a file has no opacity for an element, and some
/// programs, Google Slides among them, show words at full strength whatever their
/// transparency. Words that are not there yet take the colour behind them as well as no
/// opacity, so they cannot show in such a program. Any other fading, and words over a picture
/// or with no colour to be mixed with, are transparency.
fn faded(cx: &Cx, color: Color, source: &str, opacity: f64) -> (Color, Option<f64>) {
    let see_through = |amount: f64| (amount < 1.0).then_some(amount);
    let dim = cx.dim.clamp(0.0, 1.0);
    let amount = if opacity <= 0.0 { 0.0 } else { dim };
    let behind = if opacity <= 0.0 {
        &cx.backdrop
    } else {
        &cx.under
    };
    if amount < 1.0
        && let Some(ground) = cx.shown(behind)
        && let Some(top) = cx.deck.theme.resolve_color(source)
        && let Some(mixed) = Color::blend(&top, &ground, amount)
    {
        // What the element's own fading adds to the step's dimming stays transparency.
        let rest = if opacity <= 0.0 {
            0.0
        } else if dim > 0.0 {
            (opacity / dim).clamp(0.0, 1.0)
        } else {
            1.0
        };
        return (mixed, see_through(rest));
    }
    (color, see_through(opacity))
}

/// The look a run has: its paragraph's style, changed by what the run says.
/// Code is set in the code face and math in italics, as the editor draws them.
pub fn props(cx: &mut Cx, style: &Style, run: &Run, opacity: f64) -> Props {
    let own = run.font.as_deref().map(str::trim).filter(|f| !f.is_empty());
    let font = match (own, run.code) {
        (Some(font), _) => font,
        (None, true) => "code",
        (None, false) => style.font.as_str(),
    };
    let (color, source) = match run.color.as_deref() {
        None => (cx.color(&style.color), style.color.clone()),
        Some(value) => match Color::parse(value) {
            Some(color) => (color, value.to_owned()),
            None => {
                cx.warn(format!(
                    "`{value}` is not a colour; the text is drawn in the colour of its style"
                ));
                (cx.color(&style.color), style.color.clone())
            }
        },
    };
    let (color, alpha) = faded(cx, color, &source, opacity);
    // The run's own highlight, else the ground inline code has.
    let highlight = match run
        .highlight
        .as_deref()
        .map(str::trim)
        .filter(|h| !h.is_empty())
    {
        Some(value) => {
            let ground = Color::parse(value);
            if ground.is_none() {
                cx.warn(format!(
                    "`{value}` is not a colour; the highlight is left out"
                ));
            }
            ground
        }
        None if run.code => code_ground(&cx.deck.theme),
        None => None,
    };
    Props {
        size: run_size(run, style),
        bold: style.bold || run.bold,
        italic: style.italic || run.italic || run.math,
        underline: run.underline,
        strike: run.strike,
        color,
        alpha,
        wash: (opacity < 1.0).then_some(opacity),
        highlight,
        face: fonts::face(&cx.deck.theme, font),
        script: run.script.clone(),
        small_caps: run.small_caps,
        all_caps: run.all_caps,
        spacing: run.spacing.filter(|s| s.is_finite()).unwrap_or(0.0),
    }
}

/// How far PowerPoint is told a raised word is moved, in thousandths of a percent of its size.
fn baseline(script: &Script) -> i64 {
    match script {
        Script::Super => thousandths(SCRIPT_RAISE),
        Script::Sub => -thousandths(SCRIPT_LOWER),
    }
}

impl Props {
    /// `a:rPr`, `a:endParaRPr` or `a:defRPr`, as `tag` says. Attributes first,
    /// then the children in the order the schema fixes: fill, typeface, link.
    pub fn write(&self, x: &mut Xml, tag: &str, link: Option<&Link>) {
        let size = hundredths(self.size).clamp(100, 400_000);
        x.open(tag)
            .attr("lang", LANG)
            .int("sz", size)
            .attr("b", if self.bold { "1" } else { "0" })
            .attr("i", if self.italic { "1" } else { "0" });
        if self.underline {
            x.attr("u", "sng");
        }
        if self.strike {
            x.attr("strike", "sngStrike");
        }
        if self.all_caps || self.small_caps {
            x.attr("cap", if self.small_caps { "small" } else { "all" });
        }
        if self.spacing != 0.0 {
            x.int("spc", hundredths(self.spacing).clamp(-40_000, 200_000));
        }
        if let Some(script) = &self.script {
            x.int("baseline", baseline(script));
        }
        x.attr("dirty", "0");
        self.color.solid_fill(x, self.alpha);
        if let Some(ground) = &self.highlight {
            x.open("a:highlight");
            ground.write(x, self.wash);
            x.close();
        }
        self.face.write(x);
        match link {
            Some(Link::Web(id)) => {
                x.open("a:hlinkClick").attr("r:id", id).close();
            }
            Some(Link::Slide(id)) => {
                x.open("a:hlinkClick")
                    .attr("r:id", id)
                    .attr("action", "ppaction://hlinksldjump")
                    .close();
            }
            None => {}
        }
        x.close();
    }
}

/// The lines of a run's text: it is cut wherever a program would say "new line" inside a paragraph.
fn breaks(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((at, c)) = chars.next() {
        let mut end = at + c.len_utf8();
        match c {
            '\r' => {
                if chars.next_if(|(_, next)| *next == '\n').is_some() {
                    end += 1;
                }
            }
            '\n' | '\u{b}' | '\u{2028}' => {}
            _ => continue,
        }
        parts.push(&text[start..at]);
        start = end;
    }
    parts.push(&text[start..]);
    parts
}

/// Writes one run: `a:r` for its text, `a:br` where it breaks a line, `a:fld`
/// for a field. Returns the look of its words, for the paragraph mark.
pub fn write(x: &mut Xml, cx: &mut Cx, run: &Run, style: &Style, opacity: f64) -> Props {
    let mark = props(cx, style, run, opacity);
    if run.math {
        cx.warn("inline math is written as its LaTeX source");
    }
    let link = run.link.as_deref().and_then(|address| cx.link(address));
    // A link is the theme's link colour and underlined, whatever else the run says.
    // PowerPoint does that by itself; the others are told.
    let look = if link.is_some() {
        Props {
            color: Color::Scheme("accent1"),
            underline: true,
            ..mark.clone()
        }
    } else {
        mark.clone()
    };
    if run.field.as_deref() == Some("slideNumber") {
        let shown = if cx.master {
            run.t.clone()
        } else {
            cx.number.to_string()
        };
        x.open("a:fld")
            .attr("id", &cx.field_id())
            .attr("type", "slidenum");
        mark.write(x, "a:rPr", None);
        x.text_element("a:t", &shown);
        x.close();
        return mark;
    }
    // The step label is the words of the page being written; without steps it keeps its own.
    let shown = match run.field.as_deref() {
        Some("stepLabel") => cx.step_label().unwrap_or_else(|| run.t.clone()),
        _ => run.t.clone(),
    };
    for (n, part) in breaks(&shown).into_iter().enumerate() {
        if n > 0 {
            x.open("a:br");
            look.write(x, "a:rPr", None);
            x.close();
        }
        if part.is_empty() {
            continue;
        }
        x.open("a:r");
        look.write(x, "a:rPr", link.as_ref());
        x.text_element("a:t", part);
        x.close();
    }
    mark
}

#[cfg(test)]
mod tests;
