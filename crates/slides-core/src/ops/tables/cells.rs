//! The words and the fill of a block of cells.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::size::{self, over_limit};
use super::{Cx, edit};
use crate::error::{Error, Result};
use crate::model::{Along, CellRect, Fill, Place, Placed, TableCell, TableEl, Text};
use crate::ops::elements::{color_ok, unit};
use crate::ops::layout::slot_text;
use crate::ops::text::keeping_box;
use crate::ops::{Op, Scope, op_types};

fn yes() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

op_types! {
    /// The words for one cell: `text` (paragraphs of runs) or `markdown`. A value with neither is skipped, and the cell stays as it is.
    pub struct CellValue {
        /// The words as paragraphs of runs, as the editor writes them. Give this or `markdown`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub text: Option<Text>,
        /// The words as Markdown (`**bold**`, `*italic*`, `` `code` ``, `[text](url)`, one paragraph per line). The cell keeps its alignment and insets.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub markdown: Option<String>,
    }

    /// Puts words in a block of cells of a table.
    pub struct SetCells {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// The row and column of the first value, counted from 0.
        pub at: Place,
        /// The values, a list of rows, each a list of cells.
        pub cells: Vec<Vec<CellValue>>,
        /// Add rows at the bottom and columns at the right when the values reach past the table (on by default). Off, values past the table are refused.
        #[serde(default = "yes", skip_serializing_if = "is_true")]
        pub grow: bool,
    }

    /// How big a table is.
    pub struct TableSize {
        pub rows: usize,
        pub columns: usize,
    }
}

/// Whether the value has any words to put in a cell.
fn says_something(value: &CellValue) -> bool {
    value.text.as_ref().is_some_and(|t| !t.says_nothing())
        || value
            .markdown
            .as_ref()
            .is_some_and(|m| !m.trim().is_empty())
}

fn put(cell: &mut TableCell, value: &CellValue) {
    match (&value.text, &value.markdown) {
        (Some(text), _) => cell.text = text.clone(),
        (None, Some(markdown)) => {
            cell.text = keeping_box(slot_text(None, Some(markdown)), Some(&cell.text));
        }
        (None, None) => {}
    }
}

/// Puts the values in the table, which has room for them.
fn write_values(table: &mut TableEl, at: Place, values: &[Vec<CellValue>]) -> Result<()> {
    let mut matrix = table.to_matrix().map_err(Error::refused)?;
    let width = values.iter().map(Vec::len).max().unwrap_or(0);
    let block = CellRect::new(
        at,
        Place::new(at.row + values.len() - 1, at.col + width - 1),
    );
    let owners = matrix.owners();
    let mut writes = Vec::new();
    let mut fresh = Vec::new();
    for (down, line) in values.iter().enumerate() {
        for (across, value) in line.iter().enumerate() {
            let place = Place::new(at.row + down, at.col + across);
            match owners.at(place) {
                Some(i) if matrix.cells[i].at == place => writes.push((i, value)),
                Some(i) => {
                    let merged = &matrix.cells[i];
                    if !block.holds(merged.rect()) {
                        return Err(Error::refused(matrix.cut_message(block, i)));
                    }
                    if says_something(value) {
                        return Err(Error::refused(format!(
                            "The cell at row {}, column {} is covered by the merged cell at row {}, column {} ({} by {}). Put its words at the merged cell's own place, leave this value empty, or unmerge the cell first.",
                            place.row,
                            place.col,
                            merged.at.row,
                            merged.at.col,
                            plural(merged.across, "column"),
                            plural(merged.down, "row"),
                        )));
                    }
                }
                None if says_something(value) => fresh.push((place, value)),
                None => {}
            }
        }
    }
    for (i, value) in writes {
        put(&mut matrix.cells[i].cell, value);
    }
    for (place, value) in fresh {
        let mut placed = Placed::empty(place);
        put(&mut placed.cell, value);
        matrix.cells.push(placed);
    }
    table.from_matrix(matrix);
    Ok(())
}

fn plural(n: usize, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

impl Op for SetCells {
    type Output = TableSize;
    const NAME: &'static str = "set_cells";
    const ABOUT: &'static str = "Put words in a block of cells of a table. `cells` is a list of rows, each a list of {text} or {markdown} values, and `at` is the row and column of the first, counted from 0. Markdown keeps the cell's alignment and insets; a value with neither is skipped. When the values reach past the table, rows and columns are added at the bottom and right (`grow`, on by default) as big as the last ones, and the table's box grows with them while it stays on the slide. A value on a place that a merged cell covers is refused unless it is empty, and so is a block that takes in only part of a merged cell. Returns the table's rows and columns.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<TableSize> {
        if self
            .cells
            .iter()
            .flatten()
            .any(|v| v.text.is_some() && v.markdown.is_some())
        {
            return Err(Error::bad_input(
                Self::NAME,
                "give a cell `text` or `markdown`, not both",
            ));
        }
        let height = self.cells.len();
        let width = self.cells.iter().map(Vec::len).max().unwrap_or(0);
        let Self {
            slide,
            id,
            at,
            cells,
            grow,
        } = self;
        edit(cx, Self::NAME, &slide, &id, |table, frame| {
            if height > 0 && width > 0 {
                let rows_end = at.row.saturating_add(height);
                let columns_end = at.col.saturating_add(width);
                let (rows, columns) = (table.rows.len(), table.column_count());
                if rows_end > rows || columns_end > columns {
                    if !grow {
                        return Err(Error::refused(format!(
                            "The values reach row {} and column {}, but the table has {} and {} (counted from 0). Leave `grow` on to add rows and columns, or give fewer values.",
                            rows_end - 1,
                            columns_end - 1,
                            plural(rows, "row"),
                            plural(columns, "column"),
                        )));
                    }
                    if let Some(message) = over_limit(rows.max(rows_end), columns.max(columns_end))
                    {
                        return Err(Error::refused(message));
                    }
                    if rows_end > rows {
                        size::insert(table, frame, Along::Rows, rows, rows_end - rows)
                            .map_err(Error::refused)?;
                    }
                    if columns_end > columns {
                        size::insert(table, frame, Along::Columns, columns, columns_end - columns)
                            .map_err(Error::refused)?;
                    }
                }
                write_values(table, at, &cells)?;
            }
            Ok(TableSize {
                rows: table.rows.len(),
                columns: table.column_count(),
            })
        })
    }
}

op_types! {
    /// Empties a block of cells.
    pub struct ClearCells {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// One corner of the block, counted from 0.
        pub from: Place,
        /// The opposite corner.
        pub to: Place,
    }
}

impl Op for ClearCells {
    type Output = ();
    const NAME: &'static str = "clear_cells";
    const ABOUT: &'static str = "Empty the cells of a table from `from` to `to` (opposite corners, counted from 0): their words go, their alignment, insets and fill stay. A block that takes in only part of a merged cell is refused.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let block = CellRect::new(self.from, self.to).normal();
        edit(cx, Self::NAME, &self.slide, &self.id, |table, _| {
            let mut matrix = table.to_matrix().map_err(Error::refused)?;
            matrix.check_block(block).map_err(Error::refused)?;
            for placed in matrix.cells.iter_mut().filter(|p| block.contains(p.at)) {
                placed.cell.text = keeping_box(Text::plain(""), Some(&placed.cell.text));
            }
            table.from_matrix(matrix);
            Ok(())
        })
    }
}

op_types! {
    /// Fills a block of cells with a colour, or takes the fill away.
    pub struct SetCellFill {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// One corner of the block, counted from 0.
        pub from: Place,
        /// The opposite corner.
        pub to: Place,
        /// The colour: a theme token or `#rrggbb`, and an `alpha` from 0 (clear) to 1. Leave it out to take the fill away.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub fill: Option<Fill>,
    }
}

impl Op for SetCellFill {
    type Output = ();
    const NAME: &'static str = "set_cell_fill";
    const ABOUT: &'static str = "Fill the cells of a table from `from` to `to` (opposite corners, counted from 0) with a colour: a theme token (accent1, bg2 ...) or #rrggbb, with an optional alpha from 0 to 1. Leave out `fill` to take the fill away. A block that takes in only part of a merged cell is refused.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if let Some(fill) = &self.fill {
            color_ok(&fill.color)
                .and_then(|()| unit(fill.alpha, "fill alpha"))
                .map_err(|message| Error::bad_input(Self::NAME, message))?;
        }
        let block = CellRect::new(self.from, self.to).normal();
        let fill = self.fill;
        edit(cx, Self::NAME, &self.slide, &self.id, |table, _| {
            let mut matrix = table.to_matrix().map_err(Error::refused)?;
            matrix.check_block(block).map_err(Error::refused)?;
            for placed in matrix.cells.iter_mut().filter(|p| block.contains(p.at)) {
                placed.cell.fill = fill.clone();
            }
            table.from_matrix(matrix);
            Ok(())
        })
    }
}
