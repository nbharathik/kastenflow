//! The look of a table as a whole and of its lines: a style from the gallery, the lines around a
//! block of cells, and the sizes of its columns and rows.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::size;
use super::{Cx, edit};
use crate::error::{Error, Result};
use crate::model::{
    CellBorders, CellRect, Place, Stroke, TableCell, TableStyle, is_table_style, table_style_ids,
};
use crate::ops::elements::{color_ok, unit};
use crate::ops::util::round2;
use crate::ops::{Op, Scope, op_types};

/// The narrowest a column is dragged, in slide units.
const NARROWEST: f64 = 12.0;

op_types! {
    /// Gives a table a style from the gallery, or changes what the style sets apart.
    pub struct SetTableStyle {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// The style: one of the gallery's ids, or `none` to take the style away.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub preset: Option<String>,
        /// Every other row after the header is shaded.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub banded_rows: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub first_column: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub last_row: Option<bool>,
        /// Whether the first row is a header.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub header_row: Option<bool>,
    }
}

impl Op for SetTableStyle {
    type Output = ();
    const NAME: &'static str = "set_table_style";
    const ABOUT: &'static str = "Give a table a style made from the theme's colours (preset: grid, accent, accent-light, dark, rules, minimal, soft, outline, accent2, accent3; `none` takes it away) and choose what it sets apart: `bandedRows`, `firstColumn`, `lastRow`, and whether the first row is a `headerRow`. A cell's own fill and its own borders win over the style. Choosing a style for a table that has none shades alternate rows.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if let Some(preset) = self.preset.as_deref()
            && preset != "none"
            && !is_table_style(preset)
        {
            return Err(Error::bad_input(
                Self::NAME,
                format!(
                    "`{preset}` is not a table style; the styles are: {}, or `none`",
                    table_style_ids().join(", ")
                ),
            ));
        }
        let Self {
            slide,
            id,
            preset,
            banded_rows,
            first_column,
            last_row,
            header_row,
        } = self;
        edit(cx, Self::NAME, &slide, &id, |table, _| {
            if let Some(on) = header_row {
                table.header_row = on;
            }
            if preset.as_deref() == Some("none") {
                table.table_style = None;
                return Ok(());
            }
            let wanted = preset.is_some()
                || banded_rows.is_some()
                || first_column.is_some()
                || last_row.is_some();
            if !wanted {
                return Ok(());
            }
            let mut style = table.table_style.take().unwrap_or_else(|| TableStyle {
                preset: "grid".to_owned(),
                banded_rows: true,
                first_column: false,
                last_row: false,
                extra: Default::default(),
            });
            if let Some(preset) = preset {
                style.preset = preset;
            }
            style.banded_rows = banded_rows.unwrap_or(style.banded_rows);
            style.first_column = first_column.unwrap_or(style.first_column);
            style.last_row = last_row.unwrap_or(style.last_row);
            table.table_style = Some(style);
            Ok(())
        })
    }
}

op_types! {
    /// Which lines of a block of cells a border is for.
    #[derive(Copy, Eq)]
    pub enum BorderSide {
        Top,
        Right,
        Bottom,
        Left,
        /// All four sides of every cell of the block.
        All,
        /// The four sides of the block as a whole.
        Outer,
        /// The lines between the cells of the block.
        Inner,
    }

    /// Draws, or takes away, the lines around a block of cells.
    pub struct SetCellBorders {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// One corner of the block, counted from 0.
        pub from: Place,
        /// The opposite corner.
        pub to: Place,
        /// Which lines.
        pub sides: Vec<BorderSide>,
        /// The line: a colour (theme token or `#rrggbb`) and a `width` in slide units; a width of 0 draws no line. Leave it out to give the lines back to the table's style.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub stroke: Option<Stroke>,
    }
}

#[derive(Clone, Copy)]
enum Edge {
    Top,
    Right,
    Bottom,
    Left,
}

fn set_edge(cell: &mut TableCell, edge: Edge, stroke: &Option<Stroke>) {
    let mut borders = cell.borders.take().unwrap_or_default();
    let slot = match edge {
        Edge::Top => &mut borders.top,
        Edge::Right => &mut borders.right,
        Edge::Bottom => &mut borders.bottom,
        Edge::Left => &mut borders.left,
    };
    *slot = stroke.clone();
    cell.borders = (!CellBorders::is_empty(&borders)).then_some(borders);
}

/// The sides of a cell that cover `rect` which the sides asked for reach, in a block.
fn edges_of(rect: CellRect, block: CellRect, sides: &[BorderSide]) -> Vec<Edge> {
    let has = |s| sides.contains(&s);
    let (all, outer, inner) = (
        has(BorderSide::All),
        has(BorderSide::Outer),
        has(BorderSide::Inner),
    );
    let (top, left) = (
        rect.from.row == block.from.row,
        rect.from.col == block.from.col,
    );
    let (bottom, right) = (rect.to.row == block.to.row, rect.to.col == block.to.col);
    let mut out = Vec::new();
    if all || ((has(BorderSide::Top) || outer) && top) || (inner && !top) {
        out.push(Edge::Top);
    }
    if all || ((has(BorderSide::Bottom) || outer) && bottom) || (inner && !bottom) {
        out.push(Edge::Bottom);
    }
    if all || ((has(BorderSide::Left) || outer) && left) || (inner && !left) {
        out.push(Edge::Left);
    }
    if all || ((has(BorderSide::Right) || outer) && right) || (inner && !right) {
        out.push(Edge::Right);
    }
    out
}

impl Op for SetCellBorders {
    type Output = ();
    const NAME: &'static str = "set_cell_borders";
    const ABOUT: &'static str = "Draw the lines around the cells of a table from `from` to `to` (opposite corners, counted from 0). `sides` is any of top, right, bottom, left (the block's own sides), outer (all four sides of the block), inner (the lines between its cells) and all (every side of every cell); `stroke` is {color, width} (width 0 for no line). Leave `stroke` out to give those lines back to the table's style. A line shared by two cells is set on both. A block that takes in only part of a merged cell is refused.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if self.sides.is_empty() {
            return Err(Error::bad_input(Self::NAME, "name at least one side"));
        }
        if let Some(s) = &self.stroke {
            color_ok(&s.color)
                .and_then(|()| unit(s.alpha, "line alpha"))
                .map_err(|m| Error::bad_input(Self::NAME, m))?;
            if s.width
                .is_some_and(|w| !w.is_finite() || !(0.0..=64.0).contains(&w))
            {
                return Err(Error::bad_input(
                    Self::NAME,
                    "a line's width is between 0 and 64",
                ));
            }
        }
        let block = CellRect::new(self.from, self.to).normal();
        let Self {
            slide,
            id,
            sides,
            stroke,
            ..
        } = self;
        edit(cx, Self::NAME, &slide, &id, |table, _| {
            let mut matrix = table.to_matrix().map_err(Error::refused)?;
            matrix.check_block(block).map_err(Error::refused)?;
            let owners = matrix.owners();
            // (cell, edge): the cells in the block and the neighbours that share each line.
            let mut writes: Vec<(usize, Edge)> = Vec::new();
            for (i, placed) in matrix.cells.iter().enumerate() {
                if !block.contains(placed.at) {
                    continue;
                }
                let rect = placed.rect();
                for edge in edges_of(rect, block, &sides) {
                    writes.push((i, edge));
                    let (neighbours, opposite): (Vec<Place>, Edge) = match edge {
                        Edge::Top if rect.from.row > 0 => (
                            (rect.from.col..=rect.to.col)
                                .map(|c| Place::new(rect.from.row - 1, c))
                                .collect(),
                            Edge::Bottom,
                        ),
                        Edge::Bottom => (
                            (rect.from.col..=rect.to.col)
                                .map(|c| Place::new(rect.to.row + 1, c))
                                .collect(),
                            Edge::Top,
                        ),
                        Edge::Left if rect.from.col > 0 => (
                            (rect.from.row..=rect.to.row)
                                .map(|r| Place::new(r, rect.from.col - 1))
                                .collect(),
                            Edge::Right,
                        ),
                        Edge::Right => (
                            (rect.from.row..=rect.to.row)
                                .map(|r| Place::new(r, rect.to.col + 1))
                                .collect(),
                            Edge::Left,
                        ),
                        _ => continue,
                    };
                    for place in neighbours {
                        if let Some(n) = owners.at(place)
                            && n != i
                        {
                            writes.push((n, opposite));
                        }
                    }
                }
            }
            for (i, edge) in writes {
                set_edge(&mut matrix.cells[i].cell, edge, &stroke);
            }
            table.from_matrix(matrix);
            Ok(())
        })
    }
}

op_types! {
    /// Which lines of a table are made even.
    #[derive(Copy, Eq)]
    pub enum TableLines {
        Rows,
        Columns,
    }

    /// Makes the rows, or the columns, of a table the same size.
    pub struct DistributeTable {
        pub slide: String,
        /// The table's id.
        pub id: String,
        pub lines: TableLines,
    }
}

impl Op for DistributeTable {
    type Output = ();
    const NAME: &'static str = "distribute_table";
    const ABOUT: &'static str = "Make all the rows of a table the same height, or all its columns the same width, keeping the table's box where it is.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let lines = self.lines;
        edit(cx, Self::NAME, &self.slide, &self.id, |table, frame| {
            match lines {
                TableLines::Columns => {
                    let n = table.column_count().max(1);
                    table.columns = vec![round2(frame.w / n as f64); n];
                }
                TableLines::Rows => {
                    let n = table.rows.len().max(1);
                    for row in &mut table.rows {
                        row.height = Some(round2(frame.h / n as f64));
                    }
                }
            }
            Ok(())
        })
    }
}

op_types! {
    /// Moves the edge after a column, as dragging it does.
    pub struct ResizeColumn {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// The column, counted from 0.
        pub index: usize,
        /// Its new width in slide units; the column after it gives or takes the difference, and the last column widens the table instead.
        pub width: f64,
    }
}

impl Op for ResizeColumn {
    type Output = ();
    const NAME: &'static str = "resize_table_column";
    const ABOUT: &'static str = "Set the width of one column of a table, as dragging the line after it does: the next column gets narrower or wider by the same amount so the table keeps its width, and the last column changes the table's width instead (as far as the slide allows). A column is never narrower than 12 slide units.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if !self.width.is_finite() {
            return Err(Error::bad_input(Self::NAME, "`width` is a number"));
        }
        let (index, want) = (self.index, self.width.max(NARROWEST));
        edit(cx, Self::NAME, &self.slide, &self.id, |table, frame| {
            let mut widths = size::column_widths(table, frame);
            let n = widths.len();
            if index >= n {
                return Err(Error::bad_input(
                    Self::NAME,
                    format!(
                        "the table has {n} columns, counted from 0; there is no column {index}"
                    ),
                ));
            }
            if index + 1 < n {
                let pair = widths[index] + widths[index + 1];
                let now = want.min((pair - NARROWEST).max(NARROWEST));
                widths[index] = now;
                widths[index + 1] = (pair - now).max(NARROWEST);
            } else {
                let rest: f64 = widths[..index].iter().sum();
                let room = (frame.slide_w - frame.x - rest).max(NARROWEST);
                widths[index] = want.min(room);
                frame.w = rest + widths[index];
                table.base.w = Some(round2(frame.w));
            }
            table.columns = widths.iter().map(|w| round2(*w)).collect();
            Ok(())
        })
    }
}
