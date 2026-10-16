//! Running one step: the dispatch, and the steps about pages and layout.

use super::validate::{check_coord, check_label, check_page_size, check_size};
use super::{MAX_NEW_CELLS, Runner, Step, invalid};
use crate::diagrams::layout::{self, Options};
use crate::diagrams::model::{Page, valid_id};
use crate::error::Result;

impl Runner {
    pub(super) fn page(&self) -> &Page {
        &self.doc.pages[self.page]
    }

    pub(super) fn page_mut(&mut self) -> &mut Page {
        &mut self.doc.pages[self.page]
    }

    /// Counts a cell about to be made against the call's limit.
    pub(super) fn make_room(&mut self, n: usize) -> Result<()> {
        self.new_cells += n;
        if self.new_cells > MAX_NEW_CELLS {
            return Err(invalid(format!(
                "One call may add at most {MAX_NEW_CELLS} cells; send the rest in another call"
            )));
        }
        Ok(())
    }

    pub(super) fn step(&mut self, step: &Step) -> Result<()> {
        match step {
            Step::AddNode { .. } => self.add_node(step),
            Step::AddEdge { .. } => self.add_edge(step),
            Step::Update { .. } => self.update(step),
            Step::Move { .. } => self.move_node(step),
            Step::Resize { id, w, h } => self.resize(id, *w, *h),
            Step::Restyle { .. } => self.restyle(step),
            Step::Group { .. } => self.group(step),
            Step::Ungroup { id } => self.ungroup(id),
            Step::Delete { ids } => self.delete(ids),
            Step::SetPage {
                page,
                name,
                width,
                height,
            } => self.set_page(page, name.as_deref(), *width, *height),
            Step::AddPage { name } => {
                self.page = self.doc.add_page(name)?;
                self.applied.pages += 1;
                Ok(())
            }
            Step::Layout {
                scope,
                direction,
                spacing,
            } => self.layout(scope.as_deref(), direction.as_deref(), spacing.as_deref()),
        }
    }

    fn set_page(
        &mut self,
        page: &str,
        name: Option<&str>,
        w: Option<f64>,
        h: Option<f64>,
    ) -> Result<()> {
        self.page = self.doc.find_page(Some(page))?;
        if let Some(name) = name {
            let name = name.trim();
            if name.is_empty() || name.chars().count() > 80 {
                return Err(invalid("A page needs a name of 1 to 80 characters"));
            }
            check_label(name)?;
            self.page_mut().name = name.to_owned();
        }
        for (what, v, is_w) in [("width", w, true), ("height", h, false)] {
            if let Some(v) = v {
                check_page_size(&format!("The page {what}"), v)?;
                if is_w {
                    self.page_mut().width = Some(v);
                } else {
                    self.page_mut().height = Some(v);
                }
            }
        }
        self.applied.pages += 1;
        Ok(())
    }

    fn resize(&mut self, id: &str, w: Option<f64>, h: Option<f64>) -> Result<()> {
        for (what, v) in [("The width", w), ("The height", h)] {
            if let Some(v) = v {
                check_size(what, v)?;
            }
        }
        let cell = self.page_mut().get_mut(id);
        let Some(cell) = cell.filter(|c| c.is_vertex()) else {
            return Err(invalid(format!("No node called “{id}” to resize")));
        };
        let geo = cell.geo.get_or_insert_with(Default::default);
        if let Some(w) = w {
            geo.w = w;
        }
        if let Some(h) = h {
            geo.h = h;
        }
        self.applied.updated += 1;
        Ok(())
    }

    fn layout(
        &mut self,
        scope: Option<&str>,
        direction: Option<&str>,
        spacing: Option<&str>,
    ) -> Result<()> {
        let scope = scope
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != "all");
        if let Some(id) = scope {
            if !valid_id(id) {
                return Err(invalid(format!(
                    "“{id}” is not a group's id; the scope is all or a group's id"
                )));
            }
            match self.page().get(id) {
                Some(c) if c.is_vertex() => {}
                _ => return Err(invalid(format!("No group called “{id}” to lay out"))),
            }
        }
        let direction = match direction.map(str::trim).filter(|d| !d.is_empty()) {
            None => self.preset.direction,
            Some(d) if d.eq_ignore_ascii_case("LR") => "LR",
            Some(d) if d.eq_ignore_ascii_case("TB") => "TB",
            Some(d) => return Err(invalid(format!("The direction is LR or TB, not “{d}”"))),
        };
        let gap = match spacing.map(str::trim).filter(|s| !s.is_empty()) {
            None | Some("normal") => 1.0,
            Some("compact") => 0.7,
            Some("wide") => 1.5,
            Some(other) => {
                return Err(invalid(format!(
                    "The spacing is compact, normal or wide, not “{other}”"
                )));
            }
        };
        let options = Options {
            scope: scope.map(str::to_owned),
            horizontal: direction == "LR",
            spacing: gap,
        };
        let report = layout::run(self.page_mut(), &options)?;
        self.applied.layouts += 1;
        self.applied.moved += report.moved;
        self.applied.notes.extend(report.notes);
        Ok(())
    }

    /// Checks a pair of coordinates the step was given.
    pub(super) fn check_xy(x: Option<f64>, y: Option<f64>) -> Result<()> {
        if let Some(x) = x {
            check_coord("x", x)?;
        }
        if let Some(y) = y {
            check_coord("y", y)?;
        }
        Ok(())
    }
}
