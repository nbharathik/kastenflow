//! How big a table may be and where its cells may reach. A table is a grid the way HTML has one:
//! cells go left to right, skipping the places a cell above covers, and a cell may span columns and
//! rows. Everything that lays a table out (the editor, the export, the browser) works from these
//! rules and also holds itself to the limits, so a table that breaks them is refused when it is made
//! and never costs more memory than the limits allow.

use super::TableEl;

/// The most columns a table has.
pub const MOST_TABLE_COLUMNS: usize = 1000;
/// The most rows a table has.
pub const MOST_TABLE_ROWS: usize = 10_000;
/// The most places a table has, columns times rows: the size of the grid an export writes out.
pub const MOST_TABLE_PLACES: usize = 50_000;

/// The places of a table, and which of them a cell already covers.
struct Grid {
    columns: usize,
    taken: Vec<Vec<bool>>,
}

impl Grid {
    fn new(columns: usize, rows: usize) -> Grid {
        Grid {
            columns,
            taken: vec![vec![false; columns]; rows],
        }
    }

    /// The first place at or after `col` in row `r` that no cell covers.
    fn free(&self, r: usize, mut col: usize) -> usize {
        while col < self.columns && self.taken[r][col] {
            col += 1;
        }
        col
    }

    fn cover(&mut self, r: usize, col: usize, across: usize, down: usize) {
        for line in self.taken.iter_mut().skip(r).take(down) {
            line[col..col + across].fill(true);
        }
    }

    /// Whether a cell covers the place; a place outside the grid is not covered.
    fn covered(&self, r: usize, col: usize) -> bool {
        self.taken
            .get(r)
            .and_then(|line| line.get(col))
            .copied()
            .unwrap_or(false)
    }
}

fn span_of(value: Option<u32>) -> usize {
    usize::try_from(value.unwrap_or(1)).unwrap_or(usize::MAX)
}

/// Whether the size of a table is within the limits.
fn within_limits(columns: usize, rows: usize) -> bool {
    columns <= MOST_TABLE_COLUMNS
        && rows <= MOST_TABLE_ROWS
        && columns.saturating_mul(rows) <= MOST_TABLE_PLACES
}

/// Cuts a span back to `room` places, and a span of nothing to one. Returns what it is now.
fn clamp(field: &mut Option<u32>, room: usize) -> usize {
    let old = span_of(*field);
    let now = old.clamp(1, room.max(1));
    if now != old {
        *field = (now > 1).then(|| u32::try_from(now).unwrap_or(u32::MAX));
    }
    now
}

impl TableEl {
    /// The number of columns: the widths listed or, failing those, the widest row. A row of spans
    /// too wide to count is counted as the most there is, so the answer is never a wrong small number.
    pub fn column_count(&self) -> usize {
        if !self.columns.is_empty() {
            return self.columns.len();
        }
        let widest = self
            .rows
            .iter()
            .map(|row| {
                row.cells
                    .iter()
                    .map(|cell| u64::try_from(span_of(cell.col_span).max(1)).unwrap_or(u64::MAX))
                    .fold(0, u64::saturating_add)
            })
            .max()
            .unwrap_or(0);
        usize::try_from(widest).unwrap_or(usize::MAX)
    }

    /// What is wrong with the table's size or with where its cells reach, said as what to change;
    /// None when it follows the rules.
    pub fn problem(&self) -> Option<String> {
        let (columns, rows) = (self.column_count(), self.rows.len());
        if columns > MOST_TABLE_COLUMNS {
            return Some(format!(
                "A table has at most {MOST_TABLE_COLUMNS} columns and this one has {columns}. Split it into more than one table, or take out columns."
            ));
        }
        if rows > MOST_TABLE_ROWS {
            return Some(format!(
                "A table has at most {MOST_TABLE_ROWS} rows and this one has {rows}. Split it across slides, or take out rows."
            ));
        }
        if !within_limits(columns, rows) {
            return Some(format!(
                "A table has at most {MOST_TABLE_PLACES} places (columns times rows) and this one has {columns} columns and {rows} rows, which is {}. Split it, or take out rows or columns.",
                columns * rows
            ));
        }
        let mut grid = Grid::new(columns, rows);
        for (r, row) in self.rows.iter().enumerate() {
            let mut col = 0;
            for (n, cell) in row.cells.iter().enumerate() {
                col = grid.free(r, col);
                let at = format!("Row {}, cell {}", r + 1, n + 1);
                if col >= columns {
                    return Some(format!(
                        "{at} has no place left: the table has {columns} columns and the cells before it fill row {}. Take the cell out, or add a column.",
                        r + 1
                    ));
                }
                for (name, value, room, one, many) in [
                    ("colSpan", cell.col_span, columns - col, "column", "columns"),
                    ("rowSpan", cell.row_span, rows - r, "row", "rows"),
                ] {
                    if value == Some(0) {
                        return Some(format!(
                            "{at}: {name} is 0. A cell covers at least one place; give 1 or leave {name} out."
                        ));
                    }
                    if span_of(value) > room {
                        let left = if room == 1 {
                            format!("1 {one} is")
                        } else {
                            format!("{room} {many} are")
                        };
                        return Some(format!(
                            "{at}: {name} is {}, but only {left} left from there to the end of the table. Give {name} {room} or less, or add {many}.",
                            span_of(value)
                        ));
                    }
                }
                let (across, down) = (span_of(cell.col_span), span_of(cell.row_span));
                grid.cover(r, col, across, down);
                col += across;
            }
        }
        None
    }

    /// Cuts the table back to the rules of where cells reach: a span of 0 becomes 1, a span that
    /// reaches past the last column or row stops there, and a cell with no place left in its row is
    /// taken out. True when anything changed. A table beyond the size limits is left as it is:
    /// that is not something to trim, and `problem` still says so.
    pub fn fit(&mut self) -> bool {
        let (columns, rows) = (self.column_count(), self.rows.len());
        if !within_limits(columns, rows) {
            return false;
        }
        let mut changed = false;
        let derived = self.columns.is_empty();
        let mut grid = Grid::new(columns, rows);
        for (r, row) in self.rows.iter_mut().enumerate() {
            let mut col = 0;
            let mut kept = Vec::with_capacity(row.cells.len());
            for mut cell in std::mem::take(&mut row.cells) {
                col = grid.free(r, col);
                if col >= columns {
                    changed = true;
                    continue;
                }
                let before = (cell.col_span, cell.row_span);
                let across = clamp(&mut cell.col_span, columns - col);
                let down = clamp(&mut cell.row_span, rows - r);
                changed |= before != (cell.col_span, cell.row_span);
                grid.cover(r, col, across, down);
                col += across;
                kept.push(cell);
            }
            row.cells = kept;
        }
        // Without widths the columns are counted from the spans, and cutting them could change the
        // count. Equal widths are what a table without widths is drawn with, so the count is fixed.
        if changed && derived {
            self.columns = vec![1.0; columns];
        }
        changed
    }
}

mod grid;
mod grid_edit;

pub use grid::{CellRect, Matrix, Owners, Place, Placed, empty_cell};
pub use grid_edit::Along;

#[cfg(test)]
mod grid_props;
#[cfg(test)]
mod grid_tests;
#[cfg(test)]
mod tests;
