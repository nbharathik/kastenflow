//! Tables: a native `a:tbl`. Cells are placed as the editor places them, the way
//! HTML does: left to right, skipping places a cell above covers. The file
//! spells every place out, so a cell that spans is followed by continuation
//! cells that say what covers them. The grid is drawn as thin lines of the
//! theme's second text colour, and the table fills its box.

use slides_core::{
    MOST_TABLE_COLUMNS, MOST_TABLE_PLACES, MOST_TABLE_ROWS, TableCell, TableEl, Text,
};

use super::Site;
use super::common::{Frame, name_of, write_c_nv_pr, write_xfrm};
use crate::cx::Cx;
use crate::style::combined;
use crate::text::{self, Look, insets};
use crate::units::length;
use crate::xml::Xml;

/// How the thin lines between cells are drawn: the theme's second text colour, faded.
const GRID_ALPHA: f64 = 0.3;
/// One unit thick, which is what the editor draws.
const GRID_WIDTH: i64 = 9525;

/// A cell and how far it spans, once laid out.
struct Laid<'a> {
    cell: &'a TableCell,
    col_span: usize,
    row_span: usize,
    header: bool,
}

struct Layout<'a> {
    columns: Vec<f64>,
    rows: Vec<f64>,
    cells: Vec<Laid<'a>>,
    /// What is at each place of the grid, row by row.
    grid: Vec<Vec<Spot>>,
    /// Cells whose span reached past the table and was cut back to it.
    cut: usize,
    /// Cells that had no place left in their row and were not written.
    lost: usize,
}

/// What is at one place of the grid.
#[derive(Clone, Copy)]
enum Spot {
    /// The cell (by its number in `cells`) that starts here.
    Starts(usize),
    /// Covered by a cell that starts at another place; which way it is covered.
    Covered { right_of: bool, below: bool },
    /// Nothing was placed here: a short row.
    Empty,
}

fn sum(values: &[f64]) -> f64 {
    values.iter().sum()
}

/// The sizes scaled to add up to `total`; equal shares when they have no size to go by.
fn scaled(sizes: &[f64], total: f64) -> Vec<f64> {
    let known = sum(sizes);
    if known > 0.0 {
        sizes.iter().map(|s| s * total / known).collect()
    } else {
        vec![total / sizes.len().max(1) as f64; sizes.len()]
    }
}

fn span(value: Option<u32>) -> usize {
    usize::try_from(value.unwrap_or(1).max(1)).unwrap_or(usize::MAX)
}

/// How many columns and rows of the table are written: all of them, unless the table is bigger
/// than a table may be. The grid is one place for each, and so is the file, so a table of
/// four billion columns (a span is a number a file can make as big as it likes) costs no more than
/// the largest table there may be.
fn extent(table: &TableEl) -> (usize, usize) {
    let columns = table.column_count().min(MOST_TABLE_COLUMNS);
    let rows = table
        .rows
        .len()
        .min(MOST_TABLE_ROWS)
        .min(MOST_TABLE_PLACES / columns.max(1));
    (columns, rows)
}

/// Lays the first `count` columns and `rows` rows of a table out in a box of `w` by `h`, as the
/// editor's table does.
fn layout(table: &TableEl, (count, rows): (usize, usize), w: f64, h: f64) -> Layout<'_> {
    let table_rows = &table.rows[..rows];
    let widths: Vec<f64> = (0..count)
        .map(|i| table.columns.get(i).copied().unwrap_or(0.0).max(0.0))
        .collect();
    let columns = scaled(&widths, w);

    let given: Vec<Option<f64>> = table_rows
        .iter()
        .map(|r| r.height.filter(|h| *h > 0.0))
        .collect();
    let unset = given.iter().filter(|g| g.is_none()).count();
    let left = h - given.iter().flatten().sum::<f64>();
    let share = if unset > 0 {
        (left / unset as f64).max(0.0)
    } else {
        0.0
    };
    let rows = scaled(
        &given.iter().map(|g| g.unwrap_or(share)).collect::<Vec<_>>(),
        h,
    );

    let mut grid = vec![vec![Spot::Empty; count]; table_rows.len()];
    let mut cells = Vec::new();
    let (mut cut, mut lost) = (0, 0);
    for (r, row) in table_rows.iter().enumerate() {
        let mut col = 0;
        for (n, cell) in row.cells.iter().enumerate() {
            while col < count && !matches!(grid[r][col], Spot::Empty) {
                col += 1;
            }
            if col >= count {
                lost += row.cells.len() - n;
                break;
            }
            let (wide, high) = (span(cell.col_span), span(cell.row_span));
            let col_span = wide.min(count - col);
            let row_span = high.min(table_rows.len() - r);
            if col_span < wide || row_span < high {
                cut += 1;
            }
            // A place a cell above already covers stays with it.
            for (down, covered) in grid.iter_mut().skip(r).take(row_span).enumerate() {
                for (across, spot) in covered[col..col + col_span].iter_mut().enumerate() {
                    if matches!(spot, Spot::Empty) {
                        *spot = if down == 0 && across == 0 {
                            Spot::Starts(cells.len())
                        } else {
                            Spot::Covered {
                                right_of: across > 0,
                                below: down > 0,
                            }
                        };
                    }
                }
            }
            cells.push(Laid {
                cell,
                col_span,
                row_span,
                header: table.header_row && r == 0,
            });
            col += col_span;
        }
    }
    Layout {
        columns,
        rows,
        cells,
        grid,
        cut,
        lost,
    }
}

/// The sizes in EMU: each rounded, the last one taking what rounding left over
/// so the parts add up to the whole. None is nothing: a column or row of no size
/// keeps a hair, which PowerPoint reads where it may not read a zero.
fn emus(sizes: &[f64], total: f64) -> Vec<i64> {
    let mut out: Vec<i64> = sizes.iter().map(|s| length(*s).max(1)).collect();
    let have: i64 = out.iter().sum();
    if let Some(last) = out.last_mut() {
        *last = (*last + length(total) - have).max(1);
    }
    out
}

fn bold(text: &Text) -> Text {
    let mut out = text.clone();
    for run in out.paragraphs.iter_mut().flat_map(|p| p.runs.iter_mut()) {
        run.bold = true;
    }
    out
}

fn write_borders(x: &mut Xml, cx: &mut Cx, opacity: f64) {
    for tag in ["a:lnL", "a:lnR", "a:lnT", "a:lnB"] {
        x.open(tag).int("w", GRID_WIDTH);
        cx.color("text2")
            .solid_fill(x, combined(Some(GRID_ALPHA), opacity));
        x.close();
    }
}

fn write_cell(x: &mut Xml, cx: &mut Cx, cell: Option<&Laid>, covered: (bool, bool), opacity: f64) {
    let empty = Text::plain("");
    let (text, shown) = match cell {
        Some(c) if c.header => (bold(&c.cell.text), true),
        Some(c) => (c.cell.text.clone(), true),
        None => (empty, false),
    };
    x.open("a:tc");
    if let Some(c) = cell {
        if c.col_span > 1 {
            x.int("gridSpan", c.col_span as i64);
        }
        if c.row_span > 1 {
            x.int("rowSpan", c.row_span as i64);
        }
    }
    x.flag("hMerge", covered.0).flag("vMerge", covered.1);
    let look = Look {
        style: "body",
        valign: slides_core::VAlign::Top,
        wrap: true,
        opacity,
        flipped: false,
        area: None,
    };
    text::write_cell_body(x, cx, &text, &look);
    let space = insets(&text);
    x.open("a:tcPr")
        .int("marL", length(space.left))
        .int("marR", length(space.right))
        .int("marT", length(space.top))
        .int("marB", length(space.bottom))
        .attr(
            "anchor",
            text::anchor(text.valign.as_ref().unwrap_or(&slides_core::VAlign::Top)),
        );
    write_borders(x, cx, opacity);
    if let Some(fill) = cell.and_then(|c| c.cell.fill.as_ref()).filter(|_| shown) {
        let color = cx.color(&fill.color);
        color.solid_fill(x, combined(fill.alpha, opacity));
    }
    x.close();
    x.close();
}

pub fn write(x: &mut Xml, cx: &mut Cx, el: &TableEl, site: &Site) {
    let Site {
        id, frame, opacity, ..
    } = site;
    let written = extent(el);
    let (columns, rows) = (el.column_count(), el.rows.len());
    if written != (columns, rows) && written.0 > 0 {
        cx.warn(format!(
            "a table of {columns} columns and {rows} rows is bigger than an export writes (at most {MOST_TABLE_COLUMNS} columns, {MOST_TABLE_ROWS} rows and {MOST_TABLE_PLACES} places), so it was cut to {} columns and {} rows",
            written.0, written.1
        ));
    }
    let laid = layout(el, written, frame.rect.w, frame.rect.h);
    if laid.columns.is_empty() || laid.rows.is_empty() {
        cx.warn("a table with no rows or no columns was left out");
        return;
    }
    if laid.cut > 0 || laid.lost > 0 {
        let mut said = Vec::new();
        if laid.cut > 0 {
            said.push(format!(
                "{} span further than the table goes, so they were cut back to it",
                laid.cut
            ));
        }
        if laid.lost > 0 {
            said.push(format!(
                "{} have no place left in their row, so they were left out",
                laid.lost
            ));
        }
        cx.warn(format!(
            "a table has cells that do not fit it: {}",
            said.join(", and ")
        ));
    }
    let columns = emus(&laid.columns, frame.rect.w);
    let rows = emus(&laid.rows, frame.rect.h);
    let frame = Frame {
        rect: slides_core::resolve::Rect {
            x: frame.rect.x,
            y: frame.rect.y,
            w: columns.iter().sum::<i64>() as f64 / 9525.0,
            h: rows.iter().sum::<i64>() as f64 / 9525.0,
        },
        rotation: 0.0,
        flip_h: false,
        flip_v: false,
    };

    x.open("p:graphicFrame");
    x.open("p:nvGraphicFramePr");
    write_c_nv_pr(x, cx, *id, &name_of(&el.base, "Table", *id), &el.base);
    x.open("p:cNvGraphicFramePr");
    x.open("a:graphicFrameLocks").attr("noGrp", "1").close();
    x.close();
    x.open("p:nvPr").close();
    x.close();
    write_xfrm(x, "p:xfrm", &frame);
    x.open("a:graphic");
    x.open("a:graphicData").attr(
        "uri",
        "http://schemas.openxmlformats.org/drawingml/2006/table",
    );
    x.open("a:tbl");
    x.open("a:tblPr").flag("firstRow", el.header_row).close();
    x.open("a:tblGrid");
    for width in &columns {
        x.open("a:gridCol").int("w", *width).close();
    }
    x.close();
    for (r, height) in rows.iter().enumerate() {
        x.open("a:tr").int("h", *height);
        for c in 0..columns.len() {
            match laid.grid[r][c] {
                Spot::Starts(n) => {
                    write_cell(x, cx, Some(&laid.cells[n]), (false, false), *opacity)
                }
                Spot::Covered { right_of, below } => {
                    write_cell(x, cx, None, (right_of, below), *opacity)
                }
                Spot::Empty => write_cell(x, cx, None, (false, false), *opacity),
            }
        }
        x.close();
    }
    x.close();
    x.close();
    x.close();
    x.close();
}

#[cfg(test)]
mod tests;
