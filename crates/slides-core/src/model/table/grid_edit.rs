//! Changing the grid of a table: adding and taking away rows and columns, and joining cells into
//! one or splitting them. Each works on a [`Matrix`] and keeps it a table that follows the rules:
//! every cell inside the grid, no two covering the same place.

use super::grid::{CellRect, Matrix, Place, Placed};
use crate::model::{Extra, Paragraph, TableRow};

/// Which way a change runs: across the rows or across the columns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Along {
    Rows,
    Columns,
}

impl Along {
    /// "row" or "column", in the plural when `many`.
    pub fn name(self, many: bool) -> &'static str {
        match (self, many) {
            (Along::Rows, false) => "row",
            (Along::Rows, true) => "rows",
            (Along::Columns, false) => "column",
            (Along::Columns, true) => "columns",
        }
    }
}

impl Placed {
    fn start(&self, along: Along) -> usize {
        match along {
            Along::Rows => self.at.row,
            Along::Columns => self.at.col,
        }
    }

    fn span(&self, along: Along) -> usize {
        match along {
            Along::Rows => self.down,
            Along::Columns => self.across,
        }
    }

    fn put(&mut self, along: Along, start: usize, span: usize) {
        match along {
            Along::Rows => {
                self.at.row = start;
                self.down = span;
            }
            Along::Columns => {
                self.at.col = start;
                self.across = span;
            }
        }
    }
}

/// "1 column", "2 columns".
fn count_of(n: usize, along: Along) -> String {
    format!("{n} {}", along.name(n != 1))
}

impl Matrix {
    /// How many rows or columns there are.
    pub fn lines(&self, along: Along) -> usize {
        match along {
            Along::Rows => self.rows.len(),
            Along::Columns => self.columns,
        }
    }

    /// Adds `count` rows or columns in front of the one at `at` (after the last when `at` is the
    /// number there are). A cell that stretches across the line grows by `count`; a cell that
    /// stops at the line or starts at it moves, and the new places get empty cells. The new rows
    /// have no height; whoever adds them gives them one.
    pub fn insert_lines(&mut self, along: Along, at: usize, count: usize) {
        let at = at.min(self.lines(along));
        for placed in &mut self.cells {
            let (start, span) = (placed.start(along), placed.span(along));
            if start >= at {
                placed.put(along, start + count, span);
            } else if start + span > at {
                placed.put(along, start, span + count);
            }
        }
        match along {
            Along::Rows => {
                let new = (0..count).map(|_| TableRow {
                    height: None,
                    cells: Vec::new(),
                    extra: Extra::new(),
                });
                self.rows.splice(at..at, new);
            }
            Along::Columns => self.columns += count,
        }
        let (rows, columns) = (self.rows.len(), self.columns);
        if count == 0 || rows == 0 || columns == 0 {
            return;
        }
        let owners = self.owners();
        let new = match along {
            Along::Rows => {
                CellRect::new(Place::new(at, 0), Place::new(at + count - 1, columns - 1))
            }
            Along::Columns => {
                CellRect::new(Place::new(0, at), Place::new(rows - 1, at + count - 1))
            }
        };
        for place in new.places() {
            if owners.at(place).is_none() {
                self.cells.push(Placed::empty(place));
            }
        }
    }

    /// Takes away `count` rows or columns from `from`. A cell wholly inside them goes; a cell that
    /// reaches into them gets shorter; one that starts inside them and reaches past starts at the
    /// first place that stays, with its words. Refused when they are not all there, and when
    /// they are every one the table has.
    pub fn delete_lines(&mut self, along: Along, from: usize, count: usize) -> Result<(), String> {
        let total = self.lines(along);
        let end = from.saturating_add(count);
        if count == 0 {
            return Err(format!("Give at least 1 {} to delete.", along.name(false)));
        }
        if end > total {
            return Err(format!(
                "The table has {}, so {} from {} to {} are not all there.",
                count_of(total, along),
                along.name(true),
                from,
                end - 1
            ));
        }
        if count >= total {
            return Err(format!(
                "That would delete every {} the table has. A table keeps at least one; delete the table instead.",
                along.name(false)
            ));
        }
        let mut kept = Vec::with_capacity(self.cells.len());
        for mut placed in std::mem::take(&mut self.cells) {
            let (start, span) = (placed.start(along), placed.span(along));
            let stop = start + span;
            if stop <= from {
                kept.push(placed);
            } else if start >= end {
                placed.put(along, start - count, span);
                kept.push(placed);
            } else {
                let overlap = stop.min(end) - start.max(from);
                let left = span - overlap;
                if left > 0 {
                    // The origin moves to the first place that stays when its own line went.
                    placed.put(along, start.min(from), left);
                    kept.push(placed);
                }
            }
        }
        self.cells = kept;
        match along {
            Along::Rows => {
                self.rows.drain(from..end);
            }
            Along::Columns => self.columns -= count,
        }
        Ok(())
    }

    /// The cell, if any, that the block takes in only a part of. A cell of one place cannot be cut.
    pub fn cut_by(&self, rect: CellRect) -> Option<usize> {
        let rect = rect.normal();
        (0..self.cells.len())
            .filter(|&i| {
                let placed = &self.cells[i];
                placed.is_merged() && placed.rect().meets(rect) && !rect.holds(placed.rect())
            })
            .min_by_key(|&i| self.cells[i].at)
    }

    /// Why a block that cuts the merged cell `i` is refused, said as what to do.
    pub fn cut_message(&self, rect: CellRect, i: usize) -> String {
        let rect = rect.normal();
        let cell = &self.cells[i];
        format!(
            "The cells from row {}, column {} to row {}, column {} cut through the merged cell at row {}, column {} ({} by {}). Unmerge it, or take in all of it.",
            rect.from.row,
            rect.from.col,
            rect.to.row,
            rect.to.col,
            cell.at.row,
            cell.at.col,
            count_of(cell.across, Along::Columns),
            count_of(cell.down, Along::Rows),
        )
    }

    /// Why a block that reaches past the table is refused, or none when it is inside.
    pub fn reach_message(&self, rect: CellRect) -> Option<String> {
        let rect = rect.normal();
        (rect.to.row >= self.rows.len() || rect.to.col >= self.columns).then(|| {
            format!(
                "The cells from row {}, column {} to row {}, column {} reach past the table, which has {} and {} (counted from 0).",
                rect.from.row,
                rect.from.col,
                rect.to.row,
                rect.to.col,
                count_of(self.rows.len(), Along::Rows),
                count_of(self.columns, Along::Columns),
            )
        })
    }

    /// The block, checked to lie inside the table and not to cut a merged cell.
    pub fn check_block(&self, rect: CellRect) -> Result<(), String> {
        if let Some(message) = self.reach_message(rect) {
            return Err(message);
        }
        match self.cut_by(rect) {
            Some(i) => Err(self.cut_message(rect, i)),
            None => Ok(()),
        }
    }

    /// Joins the cells of the block into one that starts at its top left. The words of the cells
    /// that have any become paragraphs of the one, in reading order; the one keeps the settings
    /// and the fill of the first cell.
    pub fn merge(&mut self, rect: CellRect) -> Result<(), String> {
        let rect = rect.normal();
        self.check_block(rect)?;
        let mut inside: Vec<usize> = (0..self.cells.len())
            .filter(|&i| rect.contains(self.cells[i].at))
            .collect();
        inside.sort_by_key(|&i| self.cells[i].at);
        let whole = inside.len() == 1 && self.cells[inside[0]].rect() == rect;
        if rect.from == rect.to || whole {
            return Err(format!(
                "The cells from row {}, column {} to row {}, column {} are one cell already. Take in two or more to merge them.",
                rect.from.row, rect.from.col, rect.to.row, rect.to.col
            ));
        }
        let mut paragraphs: Vec<Paragraph> = Vec::new();
        for &i in &inside {
            let text = &self.cells[i].cell.text;
            if !text.says_nothing() {
                paragraphs.extend(text.paragraphs.iter().cloned());
            }
        }
        let first = inside.first().copied();
        let mut merged = first.map_or_else(|| Placed::empty(rect.from), |i| self.cells[i].clone());
        if !paragraphs.is_empty() {
            merged.cell.text.paragraphs = paragraphs;
        }
        merged.at = rect.from;
        merged.across = rect.width();
        merged.down = rect.height();
        let gone: std::collections::HashSet<usize> = inside.into_iter().collect();
        self.cells = std::mem::take(&mut self.cells)
            .into_iter()
            .enumerate()
            .filter(|(i, _)| !gone.contains(i))
            .map(|(_, placed)| placed)
            .collect();
        self.cells.push(merged);
        Ok(())
    }

    /// Splits the merged cell that covers the place into cells of one place. The words and the
    /// fill stay with the one at the top left; the others are empty.
    pub fn unmerge(&mut self, at: Place) -> Result<(), String> {
        let Some(i) = self.owner_at(at) else {
            return Err(format!(
                "There is no cell at row {}, column {}: the table has {} and {} (counted from 0).",
                at.row,
                at.col,
                count_of(self.rows.len(), Along::Rows),
                count_of(self.columns, Along::Columns),
            ));
        };
        if !self.cells[i].is_merged() {
            return Err(format!(
                "The cell at row {}, column {} is not merged.",
                at.row, at.col
            ));
        }
        let rect = self.cells[i].rect();
        self.cells[i].across = 1;
        self.cells[i].down = 1;
        let origin = self.cells[i].at;
        for place in rect.places().filter(|place| *place != origin) {
            self.cells.push(Placed::empty(place));
        }
        Ok(())
    }
}
