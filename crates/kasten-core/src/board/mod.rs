//! Whiteboards: JSON Canvas 1.0 files (<https://jsoncanvas.org>). A board is
//! kept as parsed JSON, so every key Kasten does not know, at any level,
//! survives a read and a write in its original order. Kasten's own extras, such
//! as the board's title, live under a top-level `x-kasten` object that other
//! tools ignore.
//!
//! Boards live in `projects/<project>/boards/`, or in `library/` when they
//! belong to no project. Reading accepts any formatting; writing always
//! uses one diff-friendly house style (see `Canvas::to_text`).

mod change;
mod checks;
mod drawing;
mod edit;
mod extras;
mod files;
mod geometry;
mod source;
mod style;
#[cfg(test)]
mod tests;
mod view;

use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::error::{Error, Result};

pub use change::BoardChange;
pub use edit::{Added, FileItem, Layout};
pub use files::{
    board_text, boards_referencing, create_board, plan_board, read_board, relink_boards,
    write_board,
};
pub(crate) use style::document_with as json_document;
pub use view::{BoardView, Drawing, EdgeView, NodeView, file_title, view};

/// The top-level key for Kasten-only extras.
pub const EXTRAS: &str = "x-kasten";

/// A parsed board. Nodes and edges are the JSON objects as read; nodes are
/// in z-order, lowest first, so a section comes before the cards in it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Canvas {
    /// The whole document; `nodes` and `edges` are always arrays of objects.
    doc: Map<String, Value>,
}

fn invalid(why: &str) -> Error {
    Error::Invalid(format!("Not valid JSON Canvas: {why}"))
}

/// A text field of a node or edge.
fn field<'a>(item: &'a Value, key: &str) -> Option<&'a str> {
    item.get(key).and_then(Value::as_str)
}

impl Canvas {
    /// An empty board titled `title`.
    pub fn new(title: &str) -> Canvas {
        let mut extras = Map::new();
        extras.insert("title".to_owned(), title.into());
        let mut doc = Map::new();
        doc.insert("nodes".to_owned(), Value::Array(Vec::new()));
        doc.insert("edges".to_owned(), Value::Array(Vec::new()));
        doc.insert(EXTRAS.to_owned(), Value::Object(extras));
        Canvas { doc }
    }

    /// Reads a board in any valid JSON Canvas formatting.
    pub fn parse(text: &str) -> Result<Canvas> {
        let value = serde_json::from_str(text).map_err(|err| invalid(&err.to_string()))?;
        Canvas::from_value(value)
    }

    /// A board from parsed JSON, such as one the app sends. It needs a
    /// `nodes` array, except for `{}`, which Obsidian writes for a new
    /// canvas. A missing `edges` array is added, empty, after `nodes`.
    pub fn from_value(value: Value) -> Result<Canvas> {
        let Value::Object(mut doc) = value else {
            return Err(invalid("the top level is not an object"));
        };
        if doc.is_empty() {
            doc.insert("nodes".to_owned(), Value::Array(Vec::new()));
        }
        if !doc.contains_key("edges")
            && let Some(at) = doc.keys().position(|key| key == "nodes")
        {
            doc.shift_insert(at + 1, "edges".to_owned(), Value::Array(Vec::new()));
        }
        for key in ["nodes", "edges"] {
            let Some(Value::Array(items)) = doc.get(key) else {
                return Err(invalid(&format!("no `{key}` array")));
            };
            if let Some(i) = items.iter().position(|item| !item.is_object()) {
                return Err(invalid(&format!("{key} item {} is not an object", i + 1)));
            }
        }
        Ok(Canvas { doc })
    }

    /// The board in house style: two-space indent, one node or edge per
    /// line, every other top-level key on one line, and a final newline.
    pub fn to_text(&self) -> String {
        style::document(&self.doc)
    }

    /// The whole board as JSON.
    pub fn to_value(&self) -> Value {
        Value::Object(self.doc.clone())
    }

    /// The title kept in `x-kasten.title`, if any.
    pub fn title(&self) -> Option<&str> {
        self.doc
            .get(EXTRAS)
            .and_then(|extras| field(extras, "title"))
            .map(str::trim)
            .filter(|title| !title.is_empty())
    }

    /// Every node, lowest in z-order first.
    pub fn nodes(&self) -> &[Value] {
        self.list("nodes")
    }

    /// Every edge.
    pub fn edges(&self) -> &[Value] {
        self.list("edges")
    }

    /// The node with this id.
    pub fn node(&self, id: &str) -> Option<&Value> {
        self.nodes()
            .iter()
            .find(|node| field(node, "id") == Some(id))
    }

    /// Every node's id, lowest in z-order first.
    pub fn node_ids(&self) -> Vec<String> {
        self.nodes()
            .iter()
            .filter_map(|node| field(node, "id"))
            .map(str::to_owned)
            .collect()
    }

    /// Points file nodes at files that moved: each `(old, new)` pair of
    /// vault paths makes nodes showing `old` show `new`, all pairs at once.
    /// Returns how many nodes changed.
    pub fn relink(&mut self, moves: &[(String, String)]) -> usize {
        let moves: HashMap<&str, &str> = moves
            .iter()
            .map(|(old, new)| (old.as_str(), new.as_str()))
            .collect();
        let mut changed = 0;
        for node in self.list_mut("nodes") {
            if field(node, "type") != Some("file") {
                continue;
            }
            let Some(old) = field(node, "file") else {
                continue;
            };
            let Some(&new) = moves.get(old) else {
                continue;
            };
            if new != old {
                node["file"] = new.into();
                changed += 1;
            }
        }
        changed
    }

    fn list(&self, key: &str) -> &[Value] {
        self.doc
            .get(key)
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    fn list_mut(&mut self, key: &str) -> &mut Vec<Value> {
        match self
            .doc
            .entry(key)
            .or_insert_with(|| Value::Array(Vec::new()))
        {
            Value::Array(items) => items,
            _ => unreachable!("`from_value` keeps `{key}` an array"),
        }
    }
}

/// Boards arrive from the app as JSON and are checked like parsed text.
impl<'de> Deserialize<'de> for Canvas {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Canvas::from_value(Value::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}
