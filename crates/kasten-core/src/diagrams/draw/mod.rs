//! The draft picture: a diagram drawn by the program when the diagram editor
//! has not drawn it (an agent wrote it through MCP, or the app was closed).
//! Boxes, arrows and words are drawn where they are, the basic shapes as the
//! editor draws them, the icons of its libraries as labelled boxes (said in
//! `warnings`). The words are `<text>`, never `foreignObject`, so a
//! rasteriser can draw it; the diagram itself is kept in `content`, so the
//! file is still a valid `.drawio.svg`; and every colour and number is read
//! and checked, never copied from the style. The editor draws the exact
//! picture the next time the diagram is open and replaces this one.

mod edges;
mod shapes;
mod style;
mod text;

#[cfg(test)]
mod tests;

use std::collections::BTreeSet;

use super::format::DRAFT_MARK;
use super::model::{Cell, Doc, Kind, Page, Rect, esc_attr};
use shapes::Kind as Shape;
use style::{Look, n};

/// A picture drawn by the program, and what it could not draw exactly.
#[derive(Debug, Clone, PartialEq)]
pub struct Draft {
    /// The SVG, followed by the comment that marks it a draft.
    pub svg: String,
    pub warnings: Vec<String>,
}

/// The most cells drawn.
const MAX_CELLS: usize = 2000;
/// Room kept around the drawing.
const MARGIN: f64 = 10.0;
/// The biggest picture, in either direction.
const MAX_SIDE: f64 = 20_000.0;

struct Painter<'a> {
    page: &'a Page,
    out: String,
    min: (f64, f64),
    max: (f64, f64),
    /// The icons of the libraries drawn as boxes.
    icons: BTreeSet<String>,
    unknown: BTreeSet<String>,
    rotated: bool,
    drawn: usize,
}

impl Painter<'_> {
    fn grow(&mut self, r: &Rect) {
        self.min = (self.min.0.min(r.x), self.min.1.min(r.y));
        self.max = (self.max.0.max(r.right()), self.max.1.max(r.bottom()));
    }

    fn children(&mut self, parent: &str) {
        let kids: Vec<&Cell> = self.page.children_of(parent).collect();
        for c in kids {
            if self.drawn >= MAX_CELLS {
                return;
            }
            match c.kind {
                Kind::Vertex => {
                    self.drawn += 1;
                    self.vertex(c);
                    self.children(&c.id);
                }
                Kind::Edge => {
                    self.drawn += 1;
                    let points = edges::draw(&mut self.out, self.page, c);
                    for p in &points {
                        self.grow(&Rect {
                            x: p.0,
                            y: p.1,
                            w: 0.0,
                            h: 0.0,
                        });
                    }
                }
                Kind::Layer => self.children(&c.id),
                _ => {}
            }
        }
    }

    fn vertex(&mut self, c: &Cell) {
        let Some(r) = self
            .page
            .abs(&c.id)
            .filter(|r| r.w > 0.0 && r.h > 0.0 && r.w < MAX_SIDE && r.h < MAX_SIDE)
        else {
            return;
        };
        let kind = shapes::kind_of(&c.style);
        if let Some(word) = c
            .style
            .get("shape")
            .filter(|w| !w.starts_with("mxgraph.") && !shapes::KNOWN.contains(w))
        {
            self.unknown.insert(word.to_owned());
        }
        if let Shape::Icon(name) = &kind {
            self.icons.insert(name.clone());
        }
        if c.style.number("rotation").is_some_and(|v| v != 0.0) {
            self.rotated = true;
        }
        let look = Look::of(&c.style, false, kind == Shape::Text);
        shapes::draw(&mut self.out, &kind, &look, &c.style, r);
        self.grow(&r);
        let words = c.text();
        let (area, set, turned) = shapes::label_area(&kind, &look, &c.style, r, &words);
        if !words.trim().is_empty() {
            self.grow(&area);
        }
        if turned {
            // A title strip down the side: the words turned a quarter.
            let (cx, cy) = area.center();
            let flat = Rect {
                x: cx - area.h / 2.0,
                y: cy - area.w / 2.0,
                w: area.h,
                h: area.w,
            };
            self.out.push_str(&format!(
                "<g transform=\"rotate(-90 {} {})\">\n",
                n(cx),
                n(cy)
            ));
            text::put(&mut self.out, &words, &set, flat);
            self.out.push_str("</g>\n");
        } else {
            text::put(&mut self.out, &words, &set, area);
        }
    }
}

/// What the drawing could not do exactly, in a sentence each.
fn warnings(p: &Painter) -> Vec<String> {
    let mut out = Vec::new();
    if !p.icons.is_empty() {
        let names: Vec<&str> = p.icons.iter().map(String::as_str).take(8).collect();
        out.push(format!(
            "{} icon{} of the editor's libraries ({}{}) are drawn as labelled boxes; the diagram editor draws them exactly",
            p.icons.len(),
            if p.icons.len() == 1 { "" } else { "s" },
            names.join(", "),
            if p.icons.len() > 8 { ", …" } else { "" }
        ));
    }
    if !p.unknown.is_empty() {
        out.push(format!(
            "Shapes this picture does not know are drawn as boxes: {}",
            p.unknown.iter().cloned().collect::<Vec<_>>().join(", ")
        ));
    }
    if p.rotated {
        out.push("Rotated shapes are drawn upright".to_owned());
    }
    if p.drawn >= MAX_CELLS {
        out.push(format!("Only the first {MAX_CELLS} cells are drawn"));
    }
    out
}

/// Draws a page of the diagram `xml` (the first when none is named).
pub fn draft(xml: &str, page: Option<&str>) -> Result<Draft, String> {
    let doc = Doc::parse(xml).map_err(|e| e.to_string())?;
    let at = doc.find_page(page).map_err(|e| e.to_string())?;
    let mut painter = Painter {
        page: &doc.pages[at],
        out: String::new(),
        min: (f64::MAX, f64::MAX),
        max: (f64::MIN, f64::MIN),
        icons: BTreeSet::new(),
        unknown: BTreeSet::new(),
        rotated: false,
        drawn: 0,
    };
    painter.children("0");
    if painter.min.0 > painter.max.0 {
        return Err("the page has nothing to draw yet (no box with a size)".to_owned());
    }
    let warnings = warnings(&painter);
    let (min, max) = (painter.min, painter.max);
    let (x, y) = (min.0 - MARGIN, min.1 - MARGIN);
    let (w, h) = (
        (max.0 - min.0 + 2.0 * MARGIN).clamp(20.0, MAX_SIDE),
        (max.1 - min.1 + 2.0 * MARGIN).clamp(20.0, MAX_SIDE),
    );
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"{w}px\" height=\"{h}px\" viewBox=\"{x} {y} {w} {h}\" style=\"background: #ffffff; color-scheme: light;\" content=\"{content}\">\n<rect x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" fill=\"#ffffff\"/>\n{body}</svg>\n{DRAFT_MARK}",
        w = n(w),
        h = n(h),
        x = n(x),
        y = n(y),
        content = esc_attr(xml),
        body = painter.out
    );
    Ok(Draft { svg, warnings })
}
