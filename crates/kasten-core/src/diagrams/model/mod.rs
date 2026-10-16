//! A diagram as the typed steps work on it: pages of cells with ids, labels,
//! styles, geometry and parents, read from the text and written back as
//! replacements of only the bytes a change touches (see `render`). Cells
//! nobody changed stay byte for byte as the editor wrote them. A diagram
//! saved compressed is refused with a hint to open and save it once, so
//! nothing here inflates or rewrites a page it cannot read.

mod cells;
mod edit;
mod render;
pub(crate) mod scan;
mod style;
mod text;

#[cfg(test)]
mod tests;

pub use cells::{Cell, Geo, Kind, Page, Values};
pub use style::Style;
pub use text::{esc_attr, fmt_num, label_html, plain_label, valid_id};

use crate::error::{Error, Result};
use cells::PageSrc;
use scan::Tree;

/// The most cells one diagram may hold after an edit.
pub const MAX_CELLS: usize = 2000;

/// What an agent is told of a page saved compressed.
pub const COMPRESSED: &str = "This diagram is saved compressed. Open it in the diagram editor and save it once (the editor writes it plain), then try again";

/// A rectangle in page coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn right(&self) -> f64 {
        self.x + self.w
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }

    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Whether the two overlap by more than `slack` in both directions.
    pub fn overlaps(&self, o: &Rect, slack: f64) -> bool {
        self.x + slack < o.right()
            && o.x + slack < self.right()
            && self.y + slack < o.bottom()
            && o.y + slack < self.bottom()
    }

    pub fn contains(&self, o: &Rect) -> bool {
        o.x >= self.x && o.y >= self.y && o.right() <= self.right() && o.bottom() <= self.bottom()
    }
}

/// A diagram read for editing.
#[derive(Debug, Clone)]
pub struct Doc {
    text: String,
    tree: Tree,
    pub pages: Vec<Page>,
}

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

impl Doc {
    /// Reads `text`, an `mxfile` or a bare `mxGraphModel`.
    pub fn parse(text: &str) -> Result<Doc> {
        let tree =
            scan::parse(text).map_err(|why| invalid(format!("Not a readable diagram: {why}")))?;
        let root = &tree.nodes[tree.root];
        let mut pages = Vec::new();
        match root.name.as_str() {
            "mxfile" => {
                for (n, &d) in root.children.iter().enumerate() {
                    let dn = &tree.nodes[d];
                    if dn.name != "diagram" {
                        continue;
                    }
                    let Some(m) = tree.child(d, "mxGraphModel") else {
                        return Err(invalid(if dn.has_text {
                            COMPRESSED.to_owned()
                        } else {
                            format!("Page {} of the diagram has no model", n + 1)
                        }));
                    };
                    let Some(r) = tree
                        .child(m, "root")
                        .filter(|&r| tree.nodes[r].close.is_some())
                    else {
                        return Err(invalid(format!(
                            "Page {} of the diagram has no cells",
                            n + 1
                        )));
                    };
                    let id = dn
                        .value("id")
                        .map_or_else(|| format!("page-{}", pages.len() + 1), str::to_owned);
                    let name = dn
                        .value("name")
                        .map_or_else(|| format!("Page-{}", pages.len() + 1), str::to_owned);
                    let src = PageSrc {
                        diagram: Some(d),
                        model: m,
                        root: r,
                    };
                    pages.push(
                        Page::read(text, &tree, src, &id, &name, &tree.nodes[m])
                            .map_err(invalid)?,
                    );
                }
            }
            "mxGraphModel" => {
                let Some(r) = tree
                    .child(tree.root, "root")
                    .filter(|&r| tree.nodes[r].close.is_some())
                else {
                    return Err(invalid("The diagram has no cells"));
                };
                let src = PageSrc {
                    diagram: None,
                    model: tree.root,
                    root: r,
                };
                pages
                    .push(Page::read(text, &tree, src, "page-1", "Page-1", root).map_err(invalid)?);
            }
            other => {
                return Err(invalid(format!(
                    "This is not a diagram: its root element is <{other}>"
                )));
            }
        }
        if pages.is_empty() {
            return Err(invalid("The diagram has no pages"));
        }
        Ok(Doc {
            text: text.to_owned(),
            tree,
            pages,
        })
    }

    /// The page named, or with the id, or the 1-based number; the first page
    /// for none.
    pub fn find_page(&self, key: Option<&str>) -> Result<usize> {
        let Some(key) = key.map(str::trim).filter(|k| !k.is_empty()) else {
            return Ok(0);
        };
        if let Some(i) = self.pages.iter().position(|p| p.id == key || p.name == key) {
            return Ok(i);
        }
        if let Ok(n) = key.parse::<usize>()
            && (1..=self.pages.len()).contains(&n)
        {
            return Ok(n - 1);
        }
        if let Some(i) = self
            .pages
            .iter()
            .position(|p| p.name.eq_ignore_ascii_case(key))
        {
            return Ok(i);
        }
        let names: Vec<&str> = self.pages.iter().map(|p| p.name.as_str()).collect();
        Err(invalid(format!(
            "No page called “{key}”; the pages are {}",
            names.join(", ")
        )))
    }

    /// Adds an empty page at the end; returns its index.
    pub fn add_page(&mut self, name: &str) -> Result<usize> {
        if self.tree.nodes[self.tree.root].name != "mxfile" {
            return Err(invalid(
                "A diagram saved as a bare model cannot take another page. Open it in the editor and save it once",
            ));
        }
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(invalid("A page needs a name of 1 to 80 characters"));
        }
        let mut n = self.pages.len() + 1;
        while self.pages.iter().any(|p| p.id == format!("page-{n}")) {
            n += 1;
        }
        self.pages.push(Page::blank(&format!("page-{n}"), name));
        Ok(self.pages.len() - 1)
    }

    /// How many cells all pages hold now.
    pub fn count(&self) -> usize {
        self.pages.iter().map(Page::count).sum()
    }
}

/// The text of each cell element of the diagram, with its id, in file order:
/// what a step that leaves a cell alone must leave byte for byte.
pub fn cell_blocks(text: &str) -> Result<Vec<(String, String)>> {
    let tree =
        scan::parse(text).map_err(|why| invalid(format!("Not a readable diagram: {why}")))?;
    let mut out = Vec::new();
    for node in &tree.nodes {
        if matches!(node.name.as_str(), "mxCell" | "object" | "UserObject")
            && let Some(parent) = node.parent
            && tree.nodes[parent].name == "root"
            && let Some(id) = node.value("id")
        {
            out.push((id.to_owned(), text[node.span()].to_owned()));
        }
    }
    Ok(out)
}

impl Page {
    /// The top-left corner of `parent`'s space in page coordinates: where a
    /// child's `x`, `y` count from.
    pub fn origin_of(&self, parent: Option<&str>) -> (f64, f64) {
        let (mut x, mut y) = (0.0, 0.0);
        let mut at = parent.map(str::to_owned);
        for _ in 0..64 {
            let Some(c) = at.as_deref().and_then(|id| self.get(id)) else {
                break;
            };
            if c.is_vertex()
                && let Some(g) = &c.geo
            {
                x += g.x;
                y += g.y;
            }
            at = c.parent.clone();
        }
        (x, y)
    }

    /// A vertex's rectangle in page coordinates.
    pub fn abs(&self, id: &str) -> Option<Rect> {
        let c = self.get(id)?;
        let g = c.geo.as_ref().filter(|_| c.is_vertex())?;
        let (ox, oy) = self.origin_of(c.parent.as_deref());
        Some(Rect {
            x: ox + g.x,
            y: oy + g.y,
            w: g.w,
            h: g.h,
        })
    }

    /// The ids from `id` up to the layer, `id` first.
    pub fn ancestors(&self, id: &str) -> Vec<String> {
        let mut out = vec![id.to_owned()];
        let mut at = self.get(id).and_then(|c| c.parent.clone());
        while let Some(p) = at {
            if out.len() > 64 || out.contains(&p) {
                break;
            }
            at = self.get(&p).and_then(|c| c.parent.clone());
            out.push(p);
        }
        out
    }

    /// The nearest container (or layer) that holds both `a` and `b`.
    pub fn common_parent(&self, a: &str, b: &str) -> String {
        let up_a = self.ancestors(a);
        let up_b = self.ancestors(b);
        up_a.iter()
            .skip(1)
            .find(|id| up_b.iter().skip(1).any(|o| o == *id))
            .cloned()
            .unwrap_or_else(|| self.default_parent())
    }

    /// Whether `id` is `of` or lies inside it.
    pub fn inside(&self, id: &str, of: &str) -> bool {
        self.ancestors(id).iter().any(|a| a == of)
    }

    /// The cells whose parent is `id`, vertices and edges.
    pub fn descendants(&self, id: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut todo = vec![id.to_owned()];
        while let Some(p) = todo.pop() {
            for c in self.children_of(&p) {
                if !out.contains(&c.id) {
                    out.push(c.id.clone());
                    todo.push(c.id.clone());
                }
            }
        }
        out
    }
}
