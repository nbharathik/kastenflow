//! The cells of one page as the steps work on them: what each says now, and
//! where in the file it came from, so a change can be written back as the
//! smallest replacement of bytes.

use std::collections::HashMap;

use super::scan::{Node, Tree};
use super::style::Style;
use super::text::{plain_label, valid_id};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Cell `0`.
    Root,
    /// A layer: a child of the root that is neither a vertex nor an edge.
    Layer,
    Vertex,
    Edge,
    Other,
}

/// A cell's geometry. A child's `x`/`y` are relative to its parent vertex;
/// an edge's `relative` geometry carries its waypoints in the parent's space.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Geo {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub relative: bool,
    pub points: Vec<(f64, f64)>,
}

/// What a cell says, kept as it was read to find what a step changed.
#[derive(Debug, Clone, PartialEq)]
pub struct Values {
    pub label: String,
    pub style: Style,
    pub geo: Option<Geo>,
    pub parent: Option<String>,
    pub source: Option<String>,
    pub target: Option<String>,
    /// The attributes of an `object` wrapper other than `id` and `label`.
    pub attrs: Vec<(String, String)>,
}

/// Where a cell is in the file it was read from.
#[derive(Debug, Clone)]
pub struct Origin {
    pub node: usize,
    pub wrapper: Option<usize>,
    pub geometry: Option<usize>,
    pub values: Values,
}

#[derive(Debug, Clone)]
pub struct Cell {
    pub id: String,
    pub kind: Kind,
    pub label: String,
    pub style: Style,
    pub geo: Option<Geo>,
    pub parent: Option<String>,
    pub source: Option<String>,
    pub target: Option<String>,
    pub attrs: Vec<(String, String)>,
    /// `object` or `UserObject` when the cell is wrapped.
    pub wrapper: Option<String>,
    /// The label is the wrapper's `label`, not the cell's `value`.
    pub label_in_wrapper: bool,
    /// Raw `sourcePoint`/`targetPoint`/`offset` points, kept when a geometry is written again.
    pub extra_points: Vec<String>,
    pub origin: Option<Origin>,
    pub gone: bool,
}

impl Cell {
    pub fn new(id: &str, kind: Kind) -> Cell {
        Cell {
            id: id.to_owned(),
            kind,
            label: String::new(),
            style: Style::default(),
            geo: None,
            parent: None,
            source: None,
            target: None,
            attrs: Vec::new(),
            wrapper: None,
            label_in_wrapper: false,
            extra_points: Vec::new(),
            origin: None,
            gone: false,
        }
    }

    pub fn values(&self) -> Values {
        Values {
            label: self.label.clone(),
            style: self.style.clone(),
            geo: self.geo.clone(),
            parent: self.parent.clone(),
            source: self.source.clone(),
            target: self.target.clone(),
            attrs: self.attrs.clone(),
        }
    }

    pub fn is_vertex(&self) -> bool {
        self.kind == Kind::Vertex
    }

    pub fn is_edge(&self) -> bool {
        self.kind == Kind::Edge
    }

    /// The attribute of an `object` wrapper.
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    /// The words the cell shows: its label with `%name%` placeholders filled
    /// from the wrapper's attributes when the cell says `placeholders=1`, and,
    /// for a label that is HTML (`html=1`), without its markup. A label that
    /// is not HTML is the words as they are, `<` and all.
    pub fn text(&self) -> String {
        let mut label = self.label.clone();
        if self.attr("placeholders") == Some("1") {
            for (k, v) in &self.attrs {
                label = label.replace(&format!("%{k}%"), v);
            }
        }
        if self.html() {
            plain_label(&label)
        } else {
            label
        }
    }

    /// Whether the label is HTML (the cell's style says `html=1`).
    pub fn html(&self) -> bool {
        self.style.flag("html")
    }
}

#[derive(Debug, Clone)]
pub struct PageSrc {
    pub diagram: Option<usize>,
    pub model: usize,
    pub root: usize,
}

#[derive(Debug, Clone)]
pub struct Page {
    pub id: String,
    pub name: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub cells: Vec<Cell>,
    pub src: Option<PageSrc>,
    pub orig_name: String,
    pub orig_size: (Option<f64>, Option<f64>),
    index: HashMap<String, usize>,
}

fn number(node: &Node, name: &str) -> Option<f64> {
    node.value(name).and_then(|v| v.trim().parse().ok())
}

impl Page {
    pub fn blank(id: &str, name: &str) -> Page {
        let mut page = Page {
            id: id.to_owned(),
            name: name.to_owned(),
            width: Some(850.0),
            height: Some(1100.0),
            cells: Vec::new(),
            src: None,
            orig_name: String::new(),
            orig_size: (None, None),
            index: HashMap::new(),
        };
        page.add(Cell::new("0", Kind::Root));
        let mut layer = Cell::new("1", Kind::Layer);
        layer.parent = Some("0".to_owned());
        page.add(layer);
        page
    }

    /// Reads the cells under `<root>` (node `root`) of `tree`.
    pub(super) fn read(
        text: &str,
        tree: &Tree,
        src: PageSrc,
        id: &str,
        name: &str,
        model: &Node,
    ) -> Result<Page, String> {
        let mut page = Page {
            id: id.to_owned(),
            name: name.to_owned(),
            width: number(model, "pageWidth"),
            height: number(model, "pageHeight"),
            cells: Vec::new(),
            orig_name: name.to_owned(),
            orig_size: (number(model, "pageWidth"), number(model, "pageHeight")),
            src: Some(src.clone()),
            index: HashMap::new(),
        };
        for &child in &tree.nodes[src.root].children {
            let node = &tree.nodes[child];
            let (wrapper, cell_node) = match node.name.as_str() {
                "mxCell" => (None, child),
                "object" | "UserObject" => match tree.child(child, "mxCell") {
                    Some(c) => (Some(child), c),
                    None => continue,
                },
                _ => continue,
            };
            let cn = &tree.nodes[cell_node];
            let holder = &tree.nodes[wrapper.unwrap_or(cell_node)];
            let Some(id) = holder.value("id") else {
                return Err("a cell has no id".to_owned());
            };
            let parent = cn.value("parent").map(str::to_owned);
            let kind = if cn.value("vertex") == Some("1") {
                Kind::Vertex
            } else if cn.value("edge") == Some("1") {
                Kind::Edge
            } else if parent.is_none() && id == "0" {
                Kind::Root
            } else if parent.as_deref() == Some("0") {
                Kind::Layer
            } else {
                Kind::Other
            };
            let mut cell = Cell::new(id, kind);
            cell.parent = parent;
            cell.style = Style::parse(cn.value("style").unwrap_or(""));
            cell.source = cn.value("source").map(str::to_owned);
            cell.target = cn.value("target").map(str::to_owned);
            if let Some(w) = wrapper {
                let wn = &tree.nodes[w];
                cell.wrapper = Some(wn.name.clone());
                cell.label_in_wrapper = wn.attr("label").is_some() || cn.attr("value").is_none();
                cell.attrs = wn
                    .attrs
                    .iter()
                    .filter(|a| a.name != "id" && a.name != "label")
                    .map(|a| (a.name.clone(), a.value.clone()))
                    .collect();
                cell.label = wn.value("label").unwrap_or("").to_owned();
            } else {
                cell.label = cn.value("value").unwrap_or("").to_owned();
            }
            let mut geometry_node = None;
            if let Some(g) = tree.child(cell_node, "mxGeometry") {
                geometry_node = Some(g);
                let gn = &tree.nodes[g];
                let mut geo = Geo {
                    x: number(gn, "x").unwrap_or(0.0),
                    y: number(gn, "y").unwrap_or(0.0),
                    w: number(gn, "width").unwrap_or(0.0),
                    h: number(gn, "height").unwrap_or(0.0),
                    relative: gn.value("relative") == Some("1"),
                    points: Vec::new(),
                };
                for &part in &gn.children {
                    let pn = &tree.nodes[part];
                    if pn.name == "Array" && pn.value("as") == Some("points") {
                        for &p in &pn.children {
                            let point = &tree.nodes[p];
                            geo.points.push((
                                number(point, "x").unwrap_or(0.0),
                                number(point, "y").unwrap_or(0.0),
                            ));
                        }
                    } else if pn.name == "mxPoint" {
                        cell.extra_points.push(text[pn.span()].trim().to_owned());
                    }
                }
                cell.geo = Some(geo);
            }
            cell.origin = Some(Origin {
                node: cell_node,
                wrapper,
                geometry: geometry_node,
                values: cell.values(),
            });
            page.add(cell);
        }
        Ok(page)
    }

    /// Adds a cell at the end.
    pub fn add(&mut self, cell: Cell) {
        self.index.insert(cell.id.clone(), self.cells.len());
        self.cells.push(cell);
    }

    pub fn get(&self, id: &str) -> Option<&Cell> {
        self.index
            .get(id)
            .map(|&i| &self.cells[i])
            .filter(|c| !c.gone)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Cell> {
        match self.index.get(id) {
            Some(&i) if !self.cells[i].gone => Some(&mut self.cells[i]),
            _ => None,
        }
    }

    /// The cells that are still there, in the file's order.
    pub fn live(&self) -> impl Iterator<Item = &Cell> {
        self.cells.iter().filter(|c| !c.gone)
    }

    pub fn vertices(&self) -> impl Iterator<Item = &Cell> {
        self.live().filter(|c| c.is_vertex())
    }

    pub fn edges(&self) -> impl Iterator<Item = &Cell> {
        self.live().filter(|c| c.is_edge())
    }

    /// How many cells a person sees (vertices and edges).
    pub fn count(&self) -> usize {
        self.live().filter(|c| c.is_vertex() || c.is_edge()).count()
    }

    pub fn children_of<'a>(&'a self, parent: &'a str) -> impl Iterator<Item = &'a Cell> {
        self.live()
            .filter(move |c| c.parent.as_deref() == Some(parent))
    }

    /// The layer new cells go into: the first layer, normally `1`.
    pub fn default_parent(&self) -> String {
        self.live()
            .find(|c| c.kind == Kind::Layer)
            .map_or_else(|| "1".to_owned(), |c| c.id.clone())
    }

    /// A free id starting with `base` (numbered when `base` is taken or not
    /// a good id).
    pub fn free_id(&self, base: &str) -> String {
        let clean: String = base
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '_' | '-') {
                    c
                } else {
                    '-'
                }
            })
            .take(48)
            .collect();
        let clean = if clean.is_empty() {
            "cell".to_owned()
        } else {
            clean
        };
        if !self.index.contains_key(&clean) && valid_id(&clean) {
            return clean;
        }
        (2..)
            .map(|n| format!("{clean}-{n}"))
            .find(|id| !self.index.contains_key(id))
            .unwrap_or(clean)
    }

    /// Whether `id` is taken, by a cell now or one that was taken out (an id
    /// is not reused in the same edit).
    pub fn taken(&self, id: &str) -> bool {
        self.index.contains_key(id)
    }
}
