//! The properties of text as PowerPoint writes them, one list level at a time,
//! and how a level is read from `a:lvl1pPr`, `a:pPr` and `a:rPr`. A property a
//! level does not give is None, to be found further down the chain of
//! placeholder, layout, master and defaults (`chain.rs`).

use slides_core::{Align, ListStyle};

use crate::import::color::{ColorCx, Paint};
use crate::import::dom::Node;
use crate::text::lists::{style_of_glyph, style_of_scheme};

/// The names of the theme's two typefaces, so a run that names one is set in the role.
#[derive(Clone, Debug, Default)]
pub struct FontNames {
    pub heading: String,
    pub body: String,
}

/// What text needs to read its properties.
#[derive(Clone, Copy)]
pub struct Reader<'a> {
    pub colors: ColorCx<'a>,
    pub fonts: &'a FontNames,
}

/// Space above, below or between lines.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Spacing {
    /// A share of the line (1 is 100%).
    Percent(f64),
    Points(f64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bullet {
    None,
    Char,
    Number,
}

/// How a run looks, where it says.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RunProps {
    pub size: Option<f64>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strike: Option<bool>,
    pub color: Option<Paint>,
    /// `heading`, `body` or a family.
    pub font: Option<String>,
    pub highlight: Option<Paint>,
    /// Raised or lowered, in thousandths of a percent of the size.
    pub baseline: Option<i64>,
    /// `small`, `all` or `none`.
    pub cap: Option<String>,
    /// Extra space between letters, in points.
    pub spacing: Option<f64>,
}

impl RunProps {
    /// These, with what they leave open taken from `below`.
    pub fn over(&self, below: &RunProps) -> RunProps {
        RunProps {
            size: self.size.or(below.size),
            bold: self.bold.or(below.bold),
            italic: self.italic.or(below.italic),
            underline: self.underline.or(below.underline),
            strike: self.strike.or(below.strike),
            color: self.color.clone().or_else(|| below.color.clone()),
            font: self.font.clone().or_else(|| below.font.clone()),
            highlight: self.highlight.clone().or_else(|| below.highlight.clone()),
            baseline: self.baseline.or(below.baseline),
            cap: self.cap.clone().or_else(|| below.cap.clone()),
            spacing: self.spacing.or(below.spacing),
        }
    }
}

/// How a list marker looks and where it sits, where a paragraph says.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Marker {
    pub style: Option<ListStyle>,
    /// The number a numbered run begins at.
    pub start_at: Option<u32>,
    pub color: Option<Paint>,
    /// A share of the words' size.
    pub size: Option<f64>,
    /// Where the lines after the first start, and where the first starts from there, in slide units.
    pub margin: Option<f64>,
    pub indent: Option<f64>,
}

impl Marker {
    pub fn over(&self, below: &Marker) -> Marker {
        // A style that is not of the kind of list the paragraph ends up as is left to the level's own, by the caller.
        Marker {
            style: self.style.clone().or_else(|| below.style.clone()),
            start_at: self.start_at.or(below.start_at),
            color: self.color.clone().or_else(|| below.color.clone()),
            size: self.size.or(below.size),
            margin: self.margin.or(below.margin),
            indent: self.indent.or(below.indent),
        }
    }
}

/// How a paragraph is set, and how its runs look unless they say.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Level {
    pub align: Option<Align>,
    pub line: Option<Spacing>,
    pub before: Option<Spacing>,
    pub after: Option<Spacing>,
    pub bullet: Option<Bullet>,
    pub marker: Marker,
    pub run: RunProps,
}

impl Level {
    pub fn over(&self, below: &Level) -> Level {
        Level {
            align: self.align.clone().or_else(|| below.align.clone()),
            line: self.line.or(below.line),
            before: self.before.or(below.before),
            after: self.after.or(below.after),
            bullet: self.bullet.or(below.bullet),
            marker: self.marker.over(&below.marker),
            run: self.run.over(&below.run),
        }
    }
}

/// The nine levels of a list style.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Levels(pub Vec<Level>);

impl Levels {
    pub fn empty() -> Levels {
        Levels(vec![Level::default(); 9])
    }

    pub fn level(&self, at: usize) -> Level {
        self.0.get(at).cloned().unwrap_or_default()
    }
}

fn align(value: &str) -> Align {
    match value {
        "ctr" => Align::Center,
        "r" => Align::Right,
        "just" | "justLow" | "dist" | "thaiDist" => Align::Justify,
        _ => Align::Left,
    }
}

fn spacing(node: Option<&Node>) -> Option<Spacing> {
    let node = node?;
    if let Some(p) = node.child("a:spcPct").and_then(|n| n.int("val")) {
        return Some(Spacing::Percent((p as f64 / 100_000.0).clamp(0.0, 20.0)));
    }
    let pts = node.child("a:spcPts").and_then(|n| n.int("val"))?;
    Some(Spacing::Points((pts as f64 / 100.0).clamp(0.0, 1584.0)))
}

/// A typeface as the deck names it: a role when it is one of the theme's.
fn font(reader: &Reader, typeface: &str) -> Option<String> {
    let name = typeface.trim();
    match name {
        "" | "+mn-ea" | "+mj-ea" | "+mn-cs" | "+mj-cs" => None,
        "+mj-lt" => Some("heading".to_owned()),
        "+mn-lt" => Some("body".to_owned()),
        // With one typeface for both, naming it says nothing the role does not.
        _ if name.eq_ignore_ascii_case(&reader.fonts.heading)
            && name.eq_ignore_ascii_case(&reader.fonts.body) =>
        {
            None
        }
        _ if name.eq_ignore_ascii_case(&reader.fonts.heading) => Some("heading".to_owned()),
        _ if name.eq_ignore_ascii_case(&reader.fonts.body) => Some("body".to_owned()),
        _ => Some(name.to_owned()),
    }
}

/// Reads an `a:rPr`, `a:defRPr` or `a:endParaRPr`.
pub fn run_props(node: &Node, reader: &Reader, placeholder: Option<&Paint>) -> RunProps {
    let color = node
        .child("a:solidFill")
        .and_then(|fill| reader.colors.first(fill, placeholder))
        .or_else(|| {
            node.child("a:gradFill")
                .and_then(|g| reader.colors.gradient_average(g, placeholder))
        });
    RunProps {
        size: node.int("sz").map(crate::import::units::points),
        bold: node.flag("b"),
        italic: node.flag("i"),
        underline: node.attr("u").map(|u| u != "none"),
        strike: node.attr("strike").map(|s| s != "noStrike"),
        color,
        font: node
            .child("a:latin")
            .and_then(|l| l.attr("typeface"))
            .and_then(|t| font(reader, t)),
        highlight: node
            .child("a:highlight")
            .and_then(|h| reader.colors.first(h, placeholder)),
        baseline: node.int("baseline"),
        cap: node.attr("cap").map(str::to_owned),
        spacing: node
            .int("spc")
            .map(|hundredths| (hundredths as f64 / 100.0).clamp(-400.0, 4000.0)),
    }
}

/// What the marker of a paragraph says: its glyph or numbering scheme, colour, size and where it sits.
fn marker(node: &Node, reader: &Reader, placeholder: Option<&Paint>) -> Marker {
    let style = node.elements().find_map(|n| match n.name.as_str() {
        "a:buChar" => n.attr("char").and_then(style_of_glyph),
        "a:buAutoNum" => n.attr("type").and_then(style_of_scheme),
        _ => None,
    });
    let numbered = node.child("a:buAutoNum");
    let size = node
        .child("a:buSzPct")
        .and_then(|n| n.int("val"))
        .map(|v| (v as f64 / 100_000.0).clamp(0.25, 4.0));
    Marker {
        style,
        start_at: numbered
            .and_then(|n| n.int("startAt"))
            .map(|v| v.clamp(1, 32_767) as u32),
        color: node
            .child("a:buClr")
            .and_then(|c| reader.colors.first(c, placeholder)),
        size,
        margin: node.int("marL").map(crate::import::units::length),
        indent: node.int("indent").map(crate::import::units::position),
    }
}

/// Reads an `a:pPr` or one of the `a:lvlNpPr` of a list style.
pub fn level(node: &Node, reader: &Reader, placeholder: Option<&Paint>) -> Level {
    let bullet = node.elements().find_map(|n| match n.name.as_str() {
        "a:buNone" => Some(Bullet::None),
        "a:buChar" | "a:buBlip" => Some(Bullet::Char),
        "a:buAutoNum" => Some(Bullet::Number),
        _ => None,
    });
    Level {
        align: node.attr("algn").map(align),
        line: spacing(node.child("a:lnSpc")),
        before: spacing(node.child("a:spcBef")),
        after: spacing(node.child("a:spcAft")),
        bullet,
        marker: marker(node, reader, placeholder),
        run: node
            .child("a:defRPr")
            .map(|d| run_props(d, reader, placeholder))
            .unwrap_or_default(),
    }
}

/// Reads a list style: an `a:lstStyle`, or the title, body and other styles of a master.
pub fn list_style(node: &Node, reader: &Reader, placeholder: Option<&Paint>) -> Levels {
    let default = node
        .child("a:defPPr")
        .map(|d| level(d, reader, placeholder))
        .unwrap_or_default();
    Levels(
        (1..=9)
            .map(|n| {
                node.child(&format!("a:lvl{n}pPr"))
                    .map_or_else(Level::default, |l| level(l, reader, placeholder))
                    .over(&default)
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests;
