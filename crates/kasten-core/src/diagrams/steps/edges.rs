//! `add_edge`.

use super::validate::{check_coord, check_id, check_label, check_style_item};
use super::{Runner, Step, invalid};
use crate::diagrams::model::{Cell, Geo, Kind, Style, label_html};
use crate::diagrams::presets;
use crate::error::Result;

impl Runner {
    pub(super) fn add_edge(&mut self, step: &Step) -> Result<()> {
        let Step::AddEdge {
            from,
            to,
            label,
            kind,
            id,
            waypoints,
            set,
        } = step
        else {
            return Err(invalid("not an add_edge step"));
        };
        for (what, end) in [("from", from), ("to", to)] {
            if !self.page().get(end).is_some_and(Cell::is_vertex) {
                return Err(invalid(format!(
                    "No node called “{end}” to connect ({what}). Add it first, or check the id with diagram_describe"
                )));
            }
        }
        let name = kind.as_deref().unwrap_or(self.preset.default_edge);
        let Some(ek) = presets::edge_kind(name) else {
            return Err(invalid(format!(
                "No edge kind called “{name}”. The kinds of {} are {}; all of them: {}",
                self.preset.id,
                self.preset.edges.join(", "),
                presets::edge_kind_names().join(", ")
            )));
        };
        let id = match id {
            Some(id) => {
                check_id(id)?;
                if self.page().taken(id) {
                    return Err(invalid(format!(
                        "The id “{id}” is already used on this page"
                    )));
                }
                id.clone()
            }
            None => self.page().free_id(&format!("e-{from}-{to}")),
        };
        let text = label.as_deref().unwrap_or("");
        check_label(text)?;
        let mut style = Style::parse(ek.style);
        for (k, v) in set.iter().flatten() {
            check_style_item(k, v)?;
            style.set(k, v);
        }
        let parent = self.page().common_parent(from, to);
        let origin = self.page().origin_of(Some(&parent));
        let mut points = Vec::new();
        for p in waypoints.iter().flatten() {
            check_coord("A waypoint's x", p.x)?;
            check_coord("A waypoint's y", p.y)?;
            points.push((p.x - origin.0, p.y - origin.1));
        }
        self.make_room(1)?;
        let mut cell = Cell::new(&id, Kind::Edge);
        cell.parent = Some(parent);
        cell.source = Some(from.clone());
        cell.target = Some(to.clone());
        cell.label = if style.flag("html") {
            label_html(text)
        } else {
            text.to_owned()
        };
        cell.style = style;
        cell.geo = Some(Geo {
            relative: true,
            points,
            ..Geo::default()
        });
        self.page_mut().add(cell);
        self.applied.edges += 1;
        self.applied.ids.push(id);
        Ok(())
    }
}
