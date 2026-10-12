//! What a person does on a board, sent by the app as one batch: moving and
//! resizing, taking nodes off (their notes stay), new stickies, cards, links
//! and sections, text, colours, and connections with labels, arrowheads and
//! colours. A batch applies whole or not at all.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::checks::{cleared_or, colour, end, position, set_or_clear, side, size, web_address};
use super::edit::{new_id, new_node, no_node, section};
use super::geometry::{CARD, Rect};
use super::{Canvas, FileItem, Layout, field};
use crate::error::{Error, Result};
use crate::time::Instant;

/// One change to a board. Ids name nodes and edges on the board, including
/// ones made earlier in the same batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum BoardChange {
    /// Moves a node's top-left corner to x, y and, given a size, resizes it.
    Place {
        id: String,
        x: i64,
        y: i64,
        width: Option<i64>,
        height: Option<i64>,
    },
    /// Takes nodes off the board with their edges. The notes they show
    /// stay in the vault. Ids already gone are skipped.
    Remove { ids: Vec<String> },
    /// A sticky's text, a section's label or a link's address.
    Text { id: String, text: String },
    /// Colours nodes or edges: `1` to `6`, the JSON Canvas presets, or
    /// `#rrggbb`. None goes back to the default.
    Color {
        ids: Vec<String>,
        color: Option<String>,
    },
    /// A new sticky, its top-left corner at x, y.
    Sticky { text: String, x: i64, y: i64 },
    /// A card for a vault file: a note, an image or other file, or, for a
    /// `.canvas`, a nested board. Given a size, a new card takes it, such as
    /// a picture's shape. A file already on the board keeps the card it has,
    /// where it is.
    Card {
        path: String,
        x: i64,
        y: i64,
        width: Option<i64>,
        height: Option<i64>,
    },
    /// A card for a web address.
    Link { url: String, x: i64, y: i64 },
    /// An empty section, behind everything.
    Section {
        label: String,
        x: i64,
        y: i64,
        width: i64,
        height: i64,
    },
    /// A section around nodes.
    Wrap { ids: Vec<String>, label: String },
    /// Connects two nodes, joining the sides given or, without them, the
    /// sides that face each other. Nodes already joined keep their edge.
    Connect {
        from: String,
        to: String,
        label: Option<String>,
        from_side: Option<String>,
        to_side: Option<String>,
    },
    /// Restyles an edge: each field given replaces the old value, and an
    /// empty one removes it. Ends are `none` or `arrow`; sides are `top`,
    /// `right`, `bottom` or `left`, and without one the view picks the side
    /// facing the other node.
    Edge {
        id: String,
        label: Option<String>,
        color: Option<String>,
        from_end: Option<String>,
        to_end: Option<String>,
        from_side: Option<String>,
        to_side: Option<String>,
    },
    /// Removes edges. Ids already gone are skipped.
    Unlink { ids: Vec<String> },
    /// How a card shows: `title` only or `expanded` to its full note. None
    /// goes back to its title and first lines.
    CardSize { id: String, size: Option<String> },
    /// Folds a section or opens it again.
    Collapse { id: String, collapsed: bool },
    /// Puts back nodes and edges taken off, as they were, ids and all: undo.
    /// A node or edge may carry what `x-kasten` said about it under its own
    /// `x-kasten` key, which goes back where it belongs.
    Restore {
        nodes: Vec<Value>,
        edges: Vec<Value>,
    },
    /// A new shape with its label: `rect`, `rounded`, `ellipse`,
    /// `diamond`, `parallelogram`, `cylinder`, `hexagon`, `document` or
    /// `triangle`.
    Shape {
        shape: String,
        text: String,
        x: i64,
        y: i64,
        width: i64,
        height: i64,
    },
    /// Gives a text node another outline; an empty one makes it a sticky.
    Reshape { id: String, shape: String },
    /// A drawn stroke in the box at x, y: `points` as `x,y` pairs apart by
    /// spaces, relative to that corner, a pen 1 to 32 wide, and a colour.
    Draw {
        points: String,
        x: i64,
        y: i64,
        width: i64,
        height: i64,
        size: i64,
        color: Option<String>,
    },
    /// How an edge is drawn: `straight`, `curve` or `elbow` (empty goes
    /// back to the default), and dashed or not.
    Line {
        id: String,
        line: Option<String>,
        dash: Option<bool>,
    },
    /// What the board remembers about the page it was made from (an object
    /// naming the page, kept under `x-kasten.source`); None forgets it.
    Source { source: Option<Value> },
}

impl Canvas {
    /// Applies `changes` in order, all of them or, when one is refused,
    /// none. Returns the id of what each change that makes something made
    /// or reused, in order.
    pub fn apply(&mut self, changes: &[BoardChange], now: Instant) -> Result<Vec<String>> {
        let mut next = self.clone();
        let mut made = Vec::new();
        for change in changes {
            if let Some(id) = next.change(change, now)? {
                made.push(id);
            }
        }
        *self = next;
        Ok(made)
    }

    fn change(&mut self, change: &BoardChange, now: Instant) -> Result<Option<String>> {
        match change {
            BoardChange::Place {
                id,
                x,
                y,
                width,
                height,
            } => {
                let (x, y) = position(*x, *y)?;
                let size = match (width, height) {
                    (None, None) => None,
                    (w, h) => {
                        let old = self.node(id).and_then(Rect::of).unwrap_or_default();
                        Some(size(w.unwrap_or(old.width), h.unwrap_or(old.height))?)
                    }
                };
                let node = self.node_mut(id).ok_or_else(|| no_node(id))?;
                node.insert("x".to_owned(), x.into());
                node.insert("y".to_owned(), y.into());
                if let Some((width, height)) = size {
                    node.insert("width".to_owned(), width.into());
                    node.insert("height".to_owned(), height.into());
                }
            }
            BoardChange::Remove { ids } => {
                let mut gone: HashSet<String> = ids.iter().cloned().collect();
                let hit =
                    |item: &Value, key: &str| field(item, key).is_some_and(|id| gone.contains(id));
                // Edges go with their nodes, and so does their styling.
                let edges: Vec<String> = self
                    .edges()
                    .iter()
                    .filter(|edge| hit(edge, "fromNode") || hit(edge, "toNode"))
                    .filter_map(|edge| field(edge, "id").map(str::to_owned))
                    .collect();
                self.list_mut("nodes").retain(|node| !hit(node, "id"));
                self.list_mut("edges")
                    .retain(|edge| !hit(edge, "fromNode") && !hit(edge, "toNode"));
                gone.extend(edges);
                self.forget(&gone.iter().map(String::as_str).collect());
            }
            BoardChange::Text { id, text } => {
                let node = self.node_mut(id).ok_or_else(|| no_node(id))?;
                let kind = node.get("type").and_then(Value::as_str).map(str::to_owned);
                match kind.as_deref() {
                    Some("text") => {
                        node.insert("text".to_owned(), text.as_str().into());
                    }
                    Some("group") => set_or_clear(node, "label", text.trim()),
                    Some("link") => {
                        node.insert("url".to_owned(), web_address(text)?.into());
                    }
                    Some("file") => {
                        return Err(Error::Invalid(
                            "A card shows its note; edit the note instead".to_owned(),
                        ));
                    }
                    _ => return Err(Error::Invalid(format!("Node {id} has no text to edit"))),
                }
            }
            BoardChange::Color { ids, color } => {
                let color = color.as_deref().map(colour).transpose()?;
                for id in ids {
                    let item = if self.node(id).is_some() {
                        self.node_mut(id)
                    } else {
                        self.edge_mut(id)
                    };
                    let item = item.ok_or_else(|| no_node(id))?;
                    set_or_clear(item, "color", color.unwrap_or_default());
                }
            }
            BoardChange::Sticky { text, x, y } => {
                let corner = position(*x, *y)?;
                return Ok(Some(self.add_text(text, Some(corner), now)));
            }
            BoardChange::Card {
                path,
                x,
                y,
                width,
                height,
            } => {
                let item = FileItem {
                    path: path.trim().to_owned(),
                    tags: Vec::new(),
                };
                let corner = position(*x, *y)?;
                let shape = match (width, height) {
                    (Some(w), Some(h)) => Some(size(*w, *h)?),
                    _ => None,
                };
                let added = self.add_files(&[item], Layout::Positions(vec![corner]), now)?;
                let id = added.nodes.into_iter().next();
                if let (Some(id), Some((w, h))) = (&id, shape)
                    && added.created.contains(id)
                {
                    let node = self.node_mut(id).ok_or_else(|| no_node(id))?;
                    node.insert("width".into(), w.into());
                    node.insert("height".into(), h.into());
                }
                return Ok(id);
            }
            BoardChange::Link { url, x, y } => {
                let url = web_address(url)?;
                let corner = position(*x, *y)?;
                let id = new_id(&mut self.taken(), now);
                let node = new_node(&id, "link", Some(("url", url)), Rect::at(corner, CARD));
                self.list_mut("nodes").push(node);
                return Ok(Some(id));
            }
            BoardChange::Section {
                label,
                x,
                y,
                width,
                height,
            } => {
                let corner = position(*x, *y)?;
                let size = size(*width, *height)?;
                let id = new_id(&mut self.taken(), now);
                let node = section(&id, label.trim(), Rect::at(corner, size));
                self.list_mut("nodes").insert(0, node);
                return Ok(Some(id));
            }
            BoardChange::Wrap { ids, label } => return self.group(ids, label, now).map(Some),
            BoardChange::Connect {
                from,
                to,
                label,
                from_side,
                to_side,
            } => {
                let sides = (
                    from_side.as_deref().map(side).transpose()?,
                    to_side.as_deref().map(side).transpose()?,
                );
                let id = self.connect_sides(from, to, label.as_deref(), sides, now)?;
                return Ok(Some(id));
            }
            BoardChange::Edge {
                id,
                label,
                color,
                from_end,
                to_end,
                from_side,
                to_side,
            } => {
                let color = cleared_or(color, colour)?;
                let from_end = cleared_or(from_end, end)?;
                let to_end = cleared_or(to_end, end)?;
                let from_side = cleared_or(from_side, side)?;
                let to_side = cleared_or(to_side, side)?;
                let edge = self
                    .edge_mut(id)
                    .ok_or_else(|| Error::Invalid(format!("No edge {id} on this board")))?;
                if let Some(label) = label {
                    set_or_clear(edge, "label", label.trim());
                }
                for (key, value) in [
                    ("color", color),
                    ("fromEnd", from_end),
                    ("toEnd", to_end),
                    ("fromSide", from_side),
                    ("toSide", to_side),
                ] {
                    if let Some(value) = value {
                        set_or_clear(edge, key, value);
                    }
                }
            }
            BoardChange::CardSize { id, size } => self.set_card_size(id, size.as_deref())?,
            BoardChange::Collapse { id, collapsed } => self.set_collapsed(id, *collapsed)?,
            BoardChange::Restore { nodes, edges } => self.restore(nodes, edges)?,
            BoardChange::Unlink { ids } => {
                self.list_mut("edges").retain(|edge| {
                    field(edge, "id").is_none_or(|id| !ids.iter().any(|gone| gone == id))
                });
                self.forget(&ids.iter().map(String::as_str).collect());
            }
            BoardChange::Shape {
                shape,
                text,
                x,
                y,
                width,
                height,
            } => {
                let rect = Rect::at(position(*x, *y)?, size(*width, *height)?);
                return self.add_shape(shape, text, rect, now).map(Some);
            }
            BoardChange::Reshape { id, shape } => self.reshape(id, shape)?,
            BoardChange::Draw {
                points,
                x,
                y,
                width,
                height,
                size: pen,
                color,
            } => {
                let rect = Rect::at(position(*x, *y)?, size(*width, *height)?);
                let color = color.as_deref().map(colour).transpose()?;
                return self.add_drawing(points, *pen, color, rect, now).map(Some);
            }
            BoardChange::Line { id, line, dash } => {
                self.style_line(id, line.as_deref(), *dash)?;
            }
            BoardChange::Source { source } => self.set_source(source.as_ref())?,
        }
        Ok(None)
    }

    fn node_mut(&mut self, id: &str) -> Option<&mut Map<String, Value>> {
        self.item_mut("nodes", id)
    }

    fn edge_mut(&mut self, id: &str) -> Option<&mut Map<String, Value>> {
        self.item_mut("edges", id)
    }

    fn item_mut(&mut self, list: &str, id: &str) -> Option<&mut Map<String, Value>> {
        self.list_mut(list)
            .iter_mut()
            .find(|item| field(item, "id") == Some(id))
            .and_then(Value::as_object_mut)
    }
}
