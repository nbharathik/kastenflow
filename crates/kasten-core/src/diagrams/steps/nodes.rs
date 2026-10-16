//! `add_node` and `move`.

use super::validate::{check_id, check_label, check_size, check_style_item};
use super::{Runner, Step, invalid};
use crate::diagrams::layout::place::{Side, beside, estimate_size, free_slot};
use crate::diagrams::model::{Cell, Geo, Kind, Rect, Style, label_html};
use crate::diagrams::{presets, shapes};
use crate::error::Result;

/// The words of a C4 label: the name (with `[technology]` at the end of the
/// first line) and the description on the lines after.
fn c4_parts(label: &str) -> (String, String, String) {
    let mut lines = label.lines();
    let first = lines.next().unwrap_or("").trim();
    let rest = lines.collect::<Vec<_>>().join(" ");
    match first.strip_suffix(']').and_then(|f| f.rsplit_once('[')) {
        Some((name, tech)) => (name.trim().to_owned(), tech.trim().to_owned(), rest),
        None => (first.to_owned(), String::new(), rest),
    }
}

/// Shapes whose size is part of how they look: icons, people, stores.
fn keeps_size(style: &Style) -> bool {
    style.get("aspect") == Some("fixed")
        || matches!(style.get("shape"), Some(s) if s.starts_with("mxgraph.") || matches!(s, "umlActor" | "cylinder3" | "umlLifeline"))
        || style.bare() == Some("image")
}

impl Runner {
    /// The base style of a node from a kind or a shape of the libraries:
    /// style, default size, and the C4 type when it is one.
    fn node_base(
        &self,
        kind: Option<&str>,
        shape: Option<&str>,
    ) -> Result<(Style, f64, f64, Option<&'static str>)> {
        if let Some(key) = shape {
            if kind.is_some() {
                return Err(invalid("Give a kind or a shape, not both"));
            }
            let Some(s) = shapes::lookup(key) else {
                let near: Vec<&str> = shapes::find(key, None, 3)
                    .iter()
                    .map(|s| s.key.as_str())
                    .collect();
                return Err(invalid(format!(
                    "No shape called “{key}”. Look one up with diagram_find_shapes{}",
                    if near.is_empty() {
                        String::new()
                    } else {
                        format!(" (close: {})", near.join(", "))
                    }
                )));
            };
            return Ok((Style::parse(&s.style), s.w, s.h, None));
        }
        let name = kind.unwrap_or(self.preset.default_node);
        let Some(k) = presets::node_kind(name) else {
            return Err(invalid(format!(
                "No node kind called “{name}”. The kinds of {} are {}; all of them: {}",
                self.preset.id,
                self.preset.nodes.join(", "),
                presets::node_kind_names().join(", ")
            )));
        };
        if let Some(key) = k.shape {
            let s = shapes::lookup(key).ok_or_else(|| {
                invalid(format!(
                    "The shape {key} of kind {name} is not in the index"
                ))
            })?;
            return Ok((Style::parse(&s.style), s.w, s.h, None));
        }
        Ok((Style::parse(k.style), k.w, k.h, k.c4))
    }

    pub(super) fn add_node(&mut self, step: &Step) -> Result<()> {
        let Step::AddNode {
            id,
            label,
            kind,
            shape,
            x,
            y,
            w,
            h,
            group,
            near,
            side,
            set,
        } = step
        else {
            return Err(invalid("not an add_node step"));
        };
        check_id(id)?;
        if self.page().taken(id) {
            return Err(invalid(format!(
                "The id “{id}” is already used on this page"
            )));
        }
        check_label(label)?;
        Self::check_xy(*x, *y)?;
        if x.is_some() != y.is_some() {
            return Err(invalid("Give both x and y, or neither"));
        }
        for (what, v) in [("w", *w), ("h", *h)] {
            if let Some(v) = v {
                check_size(what, v)?;
            }
        }
        let (mut style, dw, dh, c4) = self.node_base(kind.as_deref(), shape.as_deref())?;
        for (k, v) in set.iter().flatten() {
            check_style_item(k, v)?;
            style.set(k, v);
        }
        let fixed = keeps_size(&style);
        let shown = if c4.is_some() {
            c4_parts(label).0
        } else {
            label.clone()
        };
        let (ew, eh) = if fixed || c4.is_some() {
            (dw, dh)
        } else {
            estimate_size(&shown, dw, dh)
        };
        let (width, height) = (w.unwrap_or(ew), h.unwrap_or(eh));
        self.make_room(1)?;

        // Where it goes, in page coordinates.
        let page = self.page();
        let near_cell = match near {
            Some(n) => Some(
                page.get(n)
                    .filter(|c| c.is_vertex())
                    .ok_or_else(|| invalid(format!("No node called “{n}” to put it near")))?,
            ),
            None => None,
        };
        let parent = match (group, near_cell) {
            (Some(g), _) => match page.get(g) {
                Some(c) if c.is_vertex() => g.clone(),
                _ => return Err(invalid(format!("No group called “{g}”"))),
            },
            (None, Some(n)) => n.parent.clone().unwrap_or_else(|| page.default_parent()),
            (None, None) => page.default_parent(),
        };
        let siblings: Vec<Rect> = page
            .vertices()
            .filter(|c| c.parent.as_deref() == Some(parent.as_str()))
            .filter_map(|c| page.abs(&c.id))
            .collect();
        let origin = page.origin_of(Some(&parent));
        let horizontal = self.preset.direction == "LR";
        let mut notes = Vec::new();
        let (ax, ay) = match (x, y, near_cell) {
            (Some(x), Some(y), _) => (*x, *y),
            (_, _, Some(n)) => {
                let anchor = page
                    .abs(&n.id)
                    .ok_or_else(|| invalid("The node it goes near has no place"))?;
                let side = match side.as_deref() {
                    Some(s) => Side::parse(s).ok_or_else(|| {
                        invalid(format!(
                            "The side is right, left, above or below, not “{s}”"
                        ))
                    })?,
                    None if horizontal => Side::Right,
                    None => Side::Below,
                };
                let gap = if matches!(side, Side::Right | Side::Left) {
                    80.0
                } else {
                    60.0
                };
                beside(&siblings, anchor, side, width, height, gap)
            }
            _ => {
                let container = (parent != page.default_parent())
                    .then(|| page.abs(&parent))
                    .flatten();
                match container {
                    Some(c) => free_slot(
                        &siblings,
                        (c.x + 20.0, c.y + presets::HEADER + 20.0),
                        c.right() - width - 20.0,
                        width,
                        height,
                    ),
                    None => free_slot(
                        &siblings,
                        (40.0, 40.0),
                        page.width.unwrap_or(850.0) - width - 20.0,
                        width,
                        height,
                    ),
                }
            }
        };
        let mut cell = Cell::new(id, Kind::Vertex);
        cell.parent = Some(parent.clone());
        cell.geo = Some(Geo {
            x: ax - origin.0,
            y: ay - origin.1,
            w: width,
            h: height,
            ..Geo::default()
        });
        match c4 {
            Some(ty) => {
                let (name, tech, desc) = c4_parts(label);
                cell.wrapper = Some("object".to_owned());
                cell.label_in_wrapper = true;
                cell.attrs.push(("placeholders".to_owned(), "1".to_owned()));
                cell.attrs.push(("c4Name".to_owned(), name));
                cell.attrs.push(("c4Type".to_owned(), ty.to_owned()));
                if presets::c4_has_technology(ty) {
                    cell.attrs.push(("c4Technology".to_owned(), tech));
                }
                cell.attrs.push(("c4Description".to_owned(), desc));
                cell.label = presets::c4_label(ty).to_owned();
            }
            None => {
                cell.label = if style.flag("html") {
                    label_html(label)
                } else {
                    label.clone()
                };
            }
        }
        cell.style = style;
        let rect = Rect {
            x: ax,
            y: ay,
            w: width,
            h: height,
        };
        self.page_mut().add(cell);
        if parent != self.page().default_parent() && self.grow_to_fit(&parent, rect) {
            notes.push(format!("The group {parent} was made bigger to hold {id}"));
        }
        self.applied.nodes += 1;
        self.applied.ids.push(id.clone());
        self.applied.notes.extend(notes);
        Ok(())
    }

    /// Makes the group `id` (and the groups around it) big enough to hold
    /// `rect`, in page coordinates; whether anything grew.
    pub(super) fn grow_to_fit(&mut self, id: &str, rect: Rect) -> bool {
        let mut grew = false;
        let mut at = Some(id.to_owned());
        let mut need = rect;
        for _ in 0..8 {
            let Some(g) = at.take() else { break };
            let Some(abs) = self.page().abs(&g) else {
                break;
            };
            // Groups only grow to the right and downwards.
            let right = abs.right().max(need.right() + 20.0);
            let bottom = abs.bottom().max(need.bottom() + 20.0);
            if right == abs.right() && bottom == abs.bottom() {
                break;
            }
            if let Some(geo) = self.page_mut().get_mut(&g).and_then(|c| c.geo.as_mut()) {
                geo.w = right - abs.x;
                geo.h = bottom - abs.y;
                grew = true;
            }
            need = Rect {
                x: abs.x,
                y: abs.y,
                w: right - abs.x,
                h: bottom - abs.y,
            };
            at = self
                .page()
                .get(&g)
                .and_then(|c| c.parent.clone())
                .filter(|p| self.page().get(p).is_some_and(|c| c.is_vertex()));
        }
        grew
    }

    pub(super) fn move_node(&mut self, step: &Step) -> Result<()> {
        let Step::Move {
            id,
            x,
            y,
            dx,
            dy,
            group,
        } = step
        else {
            return Err(invalid("not a move step"));
        };
        Self::check_xy(*x, *y)?;
        Self::check_xy(*dx, *dy)?;
        let page = self.page();
        let Some(cell) = page.get(id).filter(|c| c.is_vertex()) else {
            return Err(invalid(format!("No node called “{id}” to move")));
        };
        let abs = page
            .abs(id)
            .ok_or_else(|| invalid(format!("“{id}” has no place to move from")))?;
        let new_parent = match group.as_deref().map(str::trim) {
            None | Some("") => cell.parent.clone().unwrap_or_else(|| page.default_parent()),
            Some("page" | "none") => page.default_parent(),
            Some(g) => match page.get(g) {
                Some(c) if c.is_vertex() && !page.inside(g, id) => g.to_owned(),
                Some(c) if c.is_vertex() => {
                    return Err(invalid(format!("“{id}” cannot be moved into itself")));
                }
                _ => return Err(invalid(format!("No group called “{g}”"))),
            },
        };
        let (nx, ny) = (
            x.unwrap_or(abs.x + dx.unwrap_or(0.0)),
            y.unwrap_or(abs.y + dy.unwrap_or(0.0)),
        );
        let reparent = cell.parent.as_deref() != Some(new_parent.as_str());
        let origin = page.origin_of(Some(&new_parent));
        let mut touched = page.descendants(id);
        touched.push(id.clone());
        let page = self.page_mut();
        if let Some(cell) = page.get_mut(id) {
            cell.parent = Some(new_parent.clone());
            if let Some(g) = cell.geo.as_mut() {
                g.x = nx - origin.0;
                g.y = ny - origin.1;
            }
        }
        self.drop_waypoints(&touched);
        if reparent {
            self.fix_edge_parents(&touched);
            let rect = Rect {
                x: nx,
                y: ny,
                w: abs.w,
                h: abs.h,
            };
            if new_parent != self.page().default_parent() {
                self.grow_to_fit(&new_parent, rect);
            }
        }
        self.applied.moved += 1;
        Ok(())
    }
}
