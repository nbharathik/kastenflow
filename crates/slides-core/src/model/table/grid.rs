//! A table as a grid of places that can be edited. A table is stored the way HTML has one: each row
//! lists its cells, and a cell goes at the first place from the left that no cell above covers. That
//! is cheap to store and awkward to change, so every edit goes through a [`Matrix`]: the cells with
//! the place each one starts at and how far it spans, changed as a whole and written back with
//! [`TableEl::from_matrix`]. Reading a table and writing it back unchanged gives the same table.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Grid, span_of};
use crate::model::{Extra, TableCell, TableEl, TableRow, Text};

model! {
    /// A place in a table: its row and its column, both counted from 0.
    #[derive(Copy, Eq, Hash, PartialOrd, Ord)]
    #[serde(rename_all = "camelCase")]
    pub struct Place {
        /// The row, from 0 at the top.
        pub row: usize,
        /// The column, from 0 at the left.
        pub col: usize,
    }

    /// A block of places, both corners included. The corners may be given in either order.
    #[derive(Copy, Eq, Hash)]
    #[serde(rename_all = "camelCase")]
    pub struct CellRect {
        /// One corner, such as the top left.
        pub from: Place,
        /// The opposite corner.
        pub to: Place,
    }
}

impl Place {
    pub fn new(row: usize, col: usize) -> Place {
        Place { row, col }
    }
}

impl CellRect {
    pub fn new(from: Place, to: Place) -> CellRect {
        CellRect { from, to }
    }

    /// The block that is the one place.
    pub fn at(place: Place) -> CellRect {
        CellRect {
            from: place,
            to: place,
        }
    }

    /// The same block with `from` at the top left and `to` at the bottom right.
    pub fn normal(self) -> CellRect {
        CellRect {
            from: Place::new(
                self.from.row.min(self.to.row),
                self.from.col.min(self.to.col),
            ),
            to: Place::new(
                self.from.row.max(self.to.row),
                self.from.col.max(self.to.col),
            ),
        }
    }

    /// How many rows it takes in.
    pub fn height(self) -> usize {
        let n = self.normal();
        (n.to.row - n.from.row).saturating_add(1)
    }

    /// How many columns it takes in.
    pub fn width(self) -> usize {
        let n = self.normal();
        (n.to.col - n.from.col).saturating_add(1)
    }

    pub fn contains(self, place: Place) -> bool {
        let n = self.normal();
        (n.from.row..=n.to.row).contains(&place.row) && (n.from.col..=n.to.col).contains(&place.col)
    }

    /// Whether the two blocks have a place in common.
    pub fn meets(self, other: CellRect) -> bool {
        let (a, b) = (self.normal(), other.normal());
        a.from.row <= b.to.row
            && b.from.row <= a.to.row
            && a.from.col <= b.to.col
            && b.from.col <= a.to.col
    }

    /// Whether `other` lies wholly inside this block.
    pub fn holds(self, other: CellRect) -> bool {
        let (a, b) = (self.normal(), other.normal());
        a.from.row <= b.from.row
            && b.to.row <= a.to.row
            && a.from.col <= b.from.col
            && b.to.col <= a.to.col
    }

    /// Every place of the block, row by row. The caller has checked that the block is inside a table.
    pub fn places(self) -> impl Iterator<Item = Place> {
        let n = self.normal();
        (n.from.row..=n.to.row)
            .flat_map(move |row| (n.from.col..=n.to.col).map(move |col| Place::new(row, col)))
    }
}

/// A cell and where it stands: the place it starts at (its top left) and how many columns and rows
/// it covers from there.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub at: Place,
    pub across: usize,
    pub down: usize,
    pub cell: TableCell,
}

/// A cell with no words, no fill and no span.
pub fn empty_cell() -> TableCell {
    TableCell {
        text: Text::plain(""),
        fill: None,
        col_span: None,
        row_span: None,
        extra: Extra::new(),
    }
}

impl Placed {
    /// An empty cell of one place.
    pub fn empty(at: Place) -> Placed {
        Placed {
            at,
            across: 1,
            down: 1,
            cell: empty_cell(),
        }
    }

    /// The block the cell covers.
    pub fn rect(&self) -> CellRect {
        CellRect {
            from: self.at,
            to: Place::new(self.at.row + self.down - 1, self.at.col + self.across - 1),
        }
    }

    /// Whether the cell covers more than its own place.
    pub fn is_merged(&self) -> bool {
        self.across > 1 || self.down > 1
    }
}

/// Writes a span the way the file does: a span of 1 is left out, and a span that is already what
/// it should be is not touched.
fn put_span(field: &mut Option<u32>, span: usize) {
    if span_of(*field) != span {
        *field = (span > 1).then(|| u32::try_from(span).unwrap_or(u32::MAX));
    }
}

/// Which cell covers each place of a table, as an index into [`Matrix::cells`].
#[derive(Clone, Debug)]
pub struct Owners {
    lines: Vec<Vec<Option<usize>>>,
}

impl Owners {
    /// The cell that covers the place, or none when no cell does or the place is outside the table.
    pub fn at(&self, place: Place) -> Option<usize> {
        *self.lines.get(place.row)?.get(place.col)?
    }
}

/// A table taken apart: how many columns it has, its rows without their cells, and every cell with
/// the place it starts at. Change it, then write it back with [`TableEl::from_matrix`]. The widths
/// in the table's `columns` are not in it; whoever changes the number of columns changes those.
#[derive(Clone, Debug, PartialEq)]
pub struct Matrix {
    pub columns: usize,
    /// Each row's height and any fields the model does not list; its `cells` are empty.
    pub rows: Vec<TableRow>,
    /// The cells, in reading order when the matrix was made (rows from the top, then left to right).
    pub cells: Vec<Placed>,
}

impl Matrix {
    /// Which cell covers each place.
    pub fn owners(&self) -> Owners {
        let mut lines = vec![vec![None; self.columns]; self.rows.len()];
        for (i, placed) in self.cells.iter().enumerate() {
            for line in lines.iter_mut().skip(placed.at.row).take(placed.down) {
                for slot in line.iter_mut().skip(placed.at.col).take(placed.across) {
                    *slot = Some(i);
                }
            }
        }
        Owners { lines }
    }

    /// The cell that covers the place, found by looking at each cell. To look up many places, ask
    /// [`owners`](Self::owners) once.
    pub fn owner_at(&self, place: Place) -> Option<usize> {
        self.cells
            .iter()
            .position(|placed| placed.rect().contains(place))
    }

    /// The places where a cell starts, in reading order.
    pub fn anchors(&self) -> Vec<Place> {
        let mut at: Vec<Place> = self.cells.iter().map(|placed| placed.at).collect();
        at.sort_unstable();
        at
    }
}

impl TableEl {
    /// The table as a grid, or what is wrong with it when it breaks the rules of the format (see
    /// [`problem`](Self::problem)) or has two cells reaching over one place, because places cannot
    /// be told for a table like that. The rules let such a table be drawn, the cell above winning;
    /// they do not let it be edited.
    pub fn to_matrix(&self) -> Result<Matrix, String> {
        if let Some(problem) = self.problem() {
            return Err(problem);
        }
        let columns = self.column_count();
        let mut grid = Grid::new(columns, self.rows.len());
        let mut rows = Vec::with_capacity(self.rows.len());
        let mut cells = Vec::new();
        for (r, row) in self.rows.iter().enumerate() {
            rows.push(TableRow {
                height: row.height,
                cells: Vec::new(),
                extra: row.extra.clone(),
            });
            let mut col = 0;
            for cell in &row.cells {
                col = grid.free(r, col);
                let (across, down) = (span_of(cell.col_span), span_of(cell.row_span));
                // A cell that reaches over a place another covers has no clear place in the grid.
                let overlap = (r..r + down)
                    .flat_map(|line| (col..col + across).map(move |place| (line, place)))
                    .find(|(line, place)| grid.covered(*line, *place));
                if let Some((line, place)) = overlap {
                    return Err(format!(
                        "The cell at row {r}, column {col} reaches over row {line}, column {place}, which another cell covers, so the cells of this table cannot be told apart. Give the cells spans that do not overlap (patch_elements) first."
                    ));
                }
                grid.cover(r, col, across, down);
                cells.push(Placed {
                    at: Place::new(r, col),
                    across,
                    down,
                    cell: cell.clone(),
                });
                col += across;
            }
        }
        Ok(Matrix {
            columns,
            rows,
            cells,
        })
    }

    /// Puts the rows of a grid in the table: each row lists its cells from the left. A place that
    /// no cell covers and that has a cell to its right gets an empty cell, because a row cannot
    /// leave a gap. The cells that are left at the end of a row stay as they were.
    pub fn from_matrix(&mut self, matrix: Matrix) {
        let Matrix {
            columns,
            mut rows,
            mut cells,
        } = matrix;
        cells.sort_by_key(|placed| placed.at);
        let mut taken = Grid::new(columns, rows.len());
        for placed in &cells {
            if placed.at.row < rows.len() && placed.at.col < columns {
                let across = placed.across.min(columns - placed.at.col);
                let down = placed.down.min(rows.len() - placed.at.row);
                taken.cover(placed.at.row, placed.at.col, across, down);
            }
        }
        for row in &mut rows {
            row.cells.clear();
        }
        let mut next = vec![0usize; rows.len()];
        for mut placed in cells {
            let Some(row) = rows.get_mut(placed.at.row) else {
                continue;
            };
            let r = placed.at.row;
            while next[r] < placed.at.col {
                if !taken.covered(r, next[r]) {
                    row.cells.push(empty_cell());
                }
                next[r] += 1;
            }
            put_span(&mut placed.cell.col_span, placed.across);
            put_span(&mut placed.cell.row_span, placed.down);
            row.cells.push(placed.cell);
            next[r] = placed.at.col + placed.across;
        }
        self.rows = rows;
    }
}
