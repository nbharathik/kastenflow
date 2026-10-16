//! `group`, `ungroup` and `delete`, and the care the edges that touch the
//! cells need: an edge belongs to the nearest group that holds both its ends.

use std::collections::BTreeSet;

use super::validate::{check_id, check_label, check_size};
use super::{Runner, Step, invalid};
use crate::diagrams::layout::place::GRID;
use crate::diagrams::model::{Cell, Geo, Kind, Rect, label_html};
use crate::diagrams::presets::{self, HEADER};
use crate::error::Result;

fn down(v: f64) -> f64 {
    (v / GRID).floor() * GRID
}

fn up(v: f64) -> f64 {
    (v / GRID).ceil() * GRID
}

impl Runner {
    /// Takes the waypoints off every edge that touches one of `touched`: they
    /// were drawn for places the cells have left.
    pub(super) fn drop_waypoints(&mut self, touched: &[String]) {
        for cell in self.page_mut().cells.iter_mut() {
            if cell.is_edge()
                && !cell.gone
                && [&cell.source, &cell.target]
                    .iter()
                    .any(|e| e.as_ref().is_some_and(|e| touched.contains(e)))
                && let Some(g) = cell.geo.as_mut()
            {
                g.points.clear();
            }
        }
    }

    /// Gives each edge that touches one of `touched` the parent it should
    /// have, keeping its waypoints where they are on the page.
    pub(super) fn fix_edge_parents(&mut self, touched: &[String]) {
        let page = self.page();
        // The edge, its new parent, and the corners of the old and the new parent's space.
        type Fix = (String, String, (f64, f64), (f64, f64));
        let mut fixes: Vec<Fix> = Vec::new();
        for c in page.edges() {
            let (Some(s), Some(t)) = (&c.source, &c.target) else {
                continue;
            };
            if !(touched.contains(s) || touched.contains(t)) {
                continue;
            }
            let want = page.common_parent(s, t);
            if c.parent.as_deref() != Some(want.as_str()) {
                let old = page.origin_of(c.parent.as_deref());
                let new = page.origin_of(Some(&want));
                fixes.push((c.id.clone(), want, old, new));
            }
        }
        for (id, want, old, new) in fixes {
            if let Some(c) = self.page_mut().get_mut(&id) {
                c.parent = Some(want);
                if let Some(g) = c.geo.as_mut() {
                    for p in &mut g.points {
                        p.0 += old.0 - new.0;
                        p.1 += old.1 - new.1;
                    }
                }
            }
        }
    }

    pub(super) fn group(&mut self, step: &Step) -> Result<()> {
        let Step::Group {
            id,
            label,
            members,
            kind,
            padding,
        } = step
        else {
            return Err(invalid("not a group step"));
        };
        check_id(id)?;
        if self.page().taken(id) {
            return Err(invalid(format!(
                "The id “{id}” is already used on this page"
            )));
        }
        check_label(label)?;
        if members.is_empty() || members.len() > 200 {
            return Err(invalid("A group needs between 1 and 200 members"));
        }
        let padding = padding.unwrap_or(20.0);
        if !(0.0..=200.0).contains(&padding) {
            return Err(invalid("The padding is between 0 and 200"));
        }
        let name = kind
            .as_deref()
            .or_else(|| self.preset.groups.first().copied())
            .unwrap_or("container");
        let Some(gk) = presets::group_kind(name) else {
            return Err(invalid(format!(
                "No group kind called “{name}”. The kinds are {}",
                presets::group_kind_names().join(", ")
            )));
        };
        let page = self.page();
        let mut rects: Vec<Rect> = Vec::new();
        let mut parent: Option<String> = None;
        for (i, m) in members.iter().enumerate() {
            if members[..i].contains(m) {
                return Err(invalid(format!("“{m}” is named twice in members")));
            }
            let Some(cell) = page.get(m).filter(|c| c.is_vertex()) else {
                return Err(invalid(format!("No node called “{m}” to group")));
            };
            match &parent {
                None => parent = cell.parent.clone(),
                Some(p) if cell.parent.as_ref() == Some(p) => {}
                Some(_) => {
                    return Err(invalid(format!(
                        "“{m}” is not in the same group as the first member. Move the members into one group first"
                    )));
                }
            }
            rects.extend(page.abs(m));
        }
        let parent = parent.unwrap_or_else(|| page.default_parent());
        let left_header = gk.style.contains("horizontal=0");
        let x0 = rects.iter().map(|r| r.x).fold(f64::MAX, f64::min);
        let y0 = rects.iter().map(|r| r.y).fold(f64::MAX, f64::min);
        let x1 = rects.iter().map(Rect::right).fold(f64::MIN, f64::max);
        let y1 = rects.iter().map(Rect::bottom).fold(f64::MIN, f64::max);
        let (head_x, head_y) = if left_header {
            (HEADER, 0.0)
        } else {
            (0.0, HEADER)
        };
        // The group's edges on the grid, outside the members.
        let (ax, ay) = (down(x0 - padding - head_x), down(y0 - padding - head_y));
        let abs = Rect {
            x: ax,
            y: ay,
            w: up(x1 + padding) - ax,
            h: up(y1 + padding) - ay,
        };
        check_size("The group's width", abs.w)?;
        check_size("The group's height", abs.h)?;
        let origin = page.origin_of(Some(&parent));
        self.make_room(1)?;
        let mut cell = Cell::new(id, Kind::Vertex);
        cell.parent = Some(parent);
        cell.style = crate::diagrams::model::Style::parse(gk.style);
        cell.label = if cell.style.flag("html") {
            label_html(label)
        } else {
            label.clone()
        };
        cell.geo = Some(Geo {
            x: abs.x - origin.0,
            y: abs.y - origin.1,
            w: abs.w,
            h: abs.h,
            ..Geo::default()
        });
        let mut touched: Vec<String> = Vec::new();
        for m in members {
            touched.extend(self.page().descendants(m));
            touched.push(m.clone());
        }
        let page = self.page_mut();
        page.add(cell);
        for m in members {
            let Some(r) = page.abs(m) else { continue };
            if let Some(c) = page.get_mut(m) {
                c.parent = Some(id.clone());
                if let Some(g) = c.geo.as_mut() {
                    g.x = r.x - abs.x;
                    g.y = r.y - abs.y;
                }
            }
        }
        self.fix_edge_parents(&touched);
        self.applied.groups += 1;
        self.applied.ids.push(id.clone());
        Ok(())
    }

    pub(super) fn ungroup(&mut self, id: &str) -> Result<()> {
        let page = self.page();
        let Some(group) = page.get(id).filter(|c| c.is_vertex()) else {
            return Err(invalid(format!("No group called “{id}”")));
        };
        let kids: Vec<String> = page.children_of(id).map(|c| c.id.clone()).collect();
        let holds = group.style.flag("container")
            || matches!(group.style.bare(), Some("swimlane" | "group"));
        if kids.is_empty() && !holds {
            return Err(invalid(format!(
                "“{id}” is not a group, so there is nothing to ungroup. Delete it to take it away"
            )));
        }
        let (gx, gy) = group.geo.as_ref().map_or((0.0, 0.0), |g| (g.x, g.y));
        let outer = group
            .parent
            .clone()
            .unwrap_or_else(|| page.default_parent());
        let linked: Vec<String> = page
            .edges()
            .filter(|e| e.source.as_deref() == Some(id) || e.target.as_deref() == Some(id))
            .map(|e| e.id.clone())
            .collect();
        let page = self.page_mut();
        for kid in &kids {
            if let Some(c) = page.get_mut(kid) {
                c.parent = Some(outer.clone());
                if let Some(g) = c.geo.as_mut() {
                    if c.kind == Kind::Edge {
                        for p in &mut g.points {
                            p.0 += gx;
                            p.1 += gy;
                        }
                    } else {
                        g.x += gx;
                        g.y += gy;
                    }
                }
            }
        }
        for e in &linked {
            if let Some(c) = page.get_mut(e) {
                c.gone = true;
            }
        }
        if let Some(c) = page.get_mut(id) {
            c.gone = true;
        }
        self.applied.deleted += 1 + linked.len();
        self.applied.moved += kids.len();
        if !linked.is_empty() {
            self.applied.notes.push(format!(
                "{} arrows to the group {id} went with it",
                linked.len()
            ));
        }
        Ok(())
    }

    pub(super) fn delete(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Err(invalid("Name the cells to delete in ids"));
        }
        let page = self.page();
        let mut gone: BTreeSet<String> = BTreeSet::new();
        for id in ids {
            if !page
                .get(id)
                .is_some_and(|c| matches!(c.kind, Kind::Vertex | Kind::Edge))
            {
                return Err(invalid(format!("No node or edge called “{id}” to delete")));
            }
            gone.insert(id.clone());
            gone.extend(page.descendants(id));
        }
        let linked: Vec<String> = page
            .edges()
            .filter(|e| {
                let touches = |end: &Option<String>| end.as_ref().is_some_and(|x| gone.contains(x));
                touches(&e.source) || touches(&e.target)
            })
            .map(|e| e.id.clone())
            .collect();
        gone.extend(linked);
        let page = self.page_mut();
        for id in &gone {
            if let Some(c) = page.get_mut(id) {
                c.gone = true;
            }
        }
        self.applied.deleted += gone.len();
        Ok(())
    }
}
