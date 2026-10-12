//! Shapes, drawings and line styles. Each is a plain JSON
//! Canvas text node or edge, so other tools still show a shape's label
//! and every edge. What only Kasten draws is kept under `x-kasten`, keyed
//! by id as card sizes are: `shape` (id to outline), `draw` (id to points
//! and pen size), `line` (edge id to straight, curve or elbow) and `dash`
//! (edge ids).

use serde_json::{Map, Value, json};

use super::edit::{new_id, new_node, no_node};
use super::geometry::Rect;
use super::{Canvas, EXTRAS, field};
use crate::error::{Error, Result};
use crate::time::Instant;

pub(super) const SHAPE: &str = "shape";
pub(super) const DRAW: &str = "draw";
pub(super) const LINE: &str = "line";
pub(super) const DASH: &str = "dash";

/// The outlines Kasten draws, as draw.io names them for flowcharts.
const SHAPES: [&str; 9] = [
    "rect",
    "rounded",
    "ellipse",
    "diamond",
    "parallelogram",
    "cylinder",
    "hexagon",
    "document",
    "triangle",
];
const LINES: [&str; 3] = ["straight", "curve", "elbow"];
/// A stroke's most points: a long, slow line, well within a file's size.
const MAX_POINTS: usize = 5_000;
/// Points lie within the stroke's own box, which is never this far out.
const MAX_OFFSET: i64 = 1 << 24;

fn outline(value: &str) -> Result<&str> {
    let value = value.trim();
    if SHAPES.contains(&value) {
        Ok(value)
    } else {
        Err(Error::Invalid(format!(
            "KastenFlow draws {}, not “{value}”",
            SHAPES.join(", ")
        )))
    }
}

fn line_style(value: &str) -> Result<&str> {
    if LINES.contains(&value) {
        Ok(value)
    } else {
        Err(Error::Invalid(format!(
            "A line is straight, curve or elbow, not “{value}”"
        )))
    }
}

/// A pen's width: 1 to 32.
fn pen(size: i64) -> Result<i64> {
    if (1..=32).contains(&size) {
        Ok(size)
    } else {
        Err(Error::Invalid(format!("A pen is 1 to 32 wide, not {size}")))
    }
}

/// A stroke's points, `x,y` pairs apart by spaces, relative to its box.
fn points(value: &str) -> Result<String> {
    let bad = || Error::Invalid("A drawing's points are x,y pairs apart by spaces".to_owned());
    let pairs: Vec<&str> = value.split_whitespace().collect();
    if pairs.is_empty() {
        return Err(bad());
    }
    if pairs.len() > MAX_POINTS {
        return Err(Error::Invalid(format!(
            "A drawing has at most {MAX_POINTS} points, not {}",
            pairs.len()
        )));
    }
    for pair in &pairs {
        let (x, y) = pair.split_once(',').ok_or_else(bad)?;
        for n in [x, y] {
            let n: i64 = n.parse().map_err(|_| bad())?;
            if n.unsigned_abs() > MAX_OFFSET.unsigned_abs() {
                return Err(bad());
            }
        }
    }
    Ok(pairs.join(" "))
}

impl Canvas {
    /// The id to value map `key` under `x-kasten`, made when missing.
    fn extra_map(&mut self, key: &str) -> Result<&mut Map<String, Value>> {
        let map = self
            .extras_mut()?
            .entry(key)
            .or_insert_with(|| Value::Object(Map::new()));
        map.as_object_mut().ok_or_else(|| {
            Error::Invalid(format!("`{EXTRAS}.{key}` on this board is not an object"))
        })
    }

    fn text_node(&self, id: &str) -> Result<()> {
        let node = self.node(id).ok_or_else(|| no_node(id))?;
        if field(node, "type") == Some("text") {
            Ok(())
        } else {
            Err(Error::Invalid(
                "Only a text node takes a shape or a drawing".to_owned(),
            ))
        }
    }

    /// A new shape with its label; its outline goes to `x-kasten.shape`.
    pub(super) fn add_shape(
        &mut self,
        shape: &str,
        text: &str,
        rect: Rect,
        now: Instant,
    ) -> Result<String> {
        let shape = outline(shape)?;
        let id = new_id(&mut self.taken(), now);
        let node = new_node(&id, "text", Some(("text", text)), rect);
        self.list_mut("nodes").push(node);
        self.extra_map(SHAPE)?.insert(id.clone(), shape.into());
        Ok(id)
    }

    /// Gives a text node another outline, or none: a sticky again.
    pub(super) fn reshape(&mut self, id: &str, shape: &str) -> Result<()> {
        self.text_node(id)?;
        if shape.trim().is_empty() {
            self.extra_map(SHAPE)?.shift_remove(id);
            return Ok(());
        }
        let shape = outline(shape)?;
        self.extra_map(SHAPE)?.insert(id.to_owned(), shape.into());
        Ok(())
    }

    /// A drawn stroke: an empty text node, its points and pen under
    /// `x-kasten.draw`, its colour the node's own.
    pub(super) fn add_drawing(
        &mut self,
        stroke: &str,
        size: i64,
        color: Option<&str>,
        rect: Rect,
        now: Instant,
    ) -> Result<String> {
        let stroke = points(stroke)?;
        let size = pen(size)?;
        let id = new_id(&mut self.taken(), now);
        let mut node = new_node(&id, "text", Some(("text", "")), rect);
        if let (Some(color), Value::Object(item)) = (color, &mut node) {
            item.insert("color".to_owned(), color.into());
        }
        self.list_mut("nodes").push(node);
        self.extra_map(DRAW)?
            .insert(id.clone(), json!({"points": stroke, "size": size}));
        Ok(id)
    }

    /// How an edge is drawn: `line` set, or cleared when empty; `dash`
    /// on or off.
    pub(super) fn style_line(
        &mut self,
        id: &str,
        line: Option<&str>,
        dash: Option<bool>,
    ) -> Result<()> {
        if !self.edges().iter().any(|e| field(e, "id") == Some(id)) {
            return Err(Error::Invalid(format!("No edge {id} on this board")));
        }
        match line.map(str::trim) {
            Some("") => {
                self.extra_map(LINE)?.shift_remove(id);
            }
            Some(line) => {
                let line = line_style(line)?;
                self.extra_map(LINE)?.insert(id.to_owned(), line.into());
            }
            None => {}
        }
        if let Some(dash) = dash {
            let dashed = self
                .extras_mut()?
                .entry(DASH)
                .or_insert_with(|| Value::Array(Vec::new()));
            let Value::Array(ids) = dashed else {
                return Err(Error::Invalid(format!(
                    "`{EXTRAS}.{DASH}` on this board is not a list"
                )));
            };
            ids.retain(|v| v.as_str() != Some(id));
            if dash {
                ids.push(id.into());
            }
        }
        Ok(())
    }

    /// Puts back what `x-kasten` said about a node or edge, given with it
    /// to `restore` under its own `x-kasten` key.
    pub(super) fn restore_extras(&mut self, id: &str, extras: &Value) -> Result<()> {
        if let Some(shape) = extras.get(SHAPE).and_then(Value::as_str) {
            self.reshape(id, shape)?;
        }
        if let Some(drawn) = extras.get(DRAW) {
            self.text_node(id)?;
            let stroke = points(drawn.get("points").and_then(Value::as_str).unwrap_or(""))?;
            let size = pen(drawn.get("size").and_then(Value::as_i64).unwrap_or(0))?;
            self.extra_map(DRAW)?
                .insert(id.to_owned(), json!({"points": stroke, "size": size}));
        }
        let line = extras.get(LINE).and_then(Value::as_str);
        let dash = extras.get(DASH).and_then(Value::as_bool);
        if line.is_some() || dash.is_some() {
            self.style_line(id, line, dash)?;
        }
        Ok(())
    }

    fn extra(&self, key: &str, id: &str) -> Option<&Value> {
        self.doc.get(EXTRAS)?.get(key)?.get(id)
    }

    /// A shape's outline, if the node has one.
    pub(super) fn shape_of(&self, id: &str) -> Option<&str> {
        self.extra(SHAPE, id)?.as_str()
    }

    /// A drawing's points and pen, if the node is one.
    pub(super) fn drawing_of(&self, id: &str) -> Option<(String, i64)> {
        let drawn = self.extra(DRAW, id)?;
        let stroke = drawn.get("points")?.as_str()?.to_owned();
        Some((stroke, drawn.get("size")?.as_i64()?))
    }

    /// An edge's line, if set.
    pub(super) fn line_of(&self, id: &str) -> Option<&str> {
        self.extra(LINE, id)?.as_str()
    }

    /// Whether an edge is dashed.
    pub(super) fn dashed(&self, id: &str) -> bool {
        self.doc
            .get(EXTRAS)
            .and_then(|extras| extras.get(DASH))
            .and_then(Value::as_array)
            .is_some_and(|ids| ids.iter().any(|v| v.as_str() == Some(id)))
    }
}
