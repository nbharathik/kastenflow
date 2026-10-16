//! The sizes of a table's rows and columns, and the box that holds them. A table is drawn to fill
//! its box: widths and heights are shares that are scaled to it, so adding a row or a column
//! gives it the size of the one beside it, grows the box by that much (as far as the slide
//! allows), and writes every size out, so what is on the slide stays where it was drawn.

use crate::model::{Along, MOST_TABLE_COLUMNS, MOST_TABLE_PLACES, MOST_TABLE_ROWS, TableEl};
use crate::ops::util::round2;

/// The table's box and the room the slide leaves it.
pub(super) struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub slide_w: f64,
    pub slide_h: f64,
}

impl Frame {
    fn len(&self, along: Along) -> f64 {
        match along {
            Along::Rows => self.h,
            Along::Columns => self.w,
        }
    }

    fn set_len(&mut self, along: Along, value: f64) {
        match along {
            Along::Rows => self.h = value,
            Along::Columns => self.w = value,
        }
    }

    /// How long the box may be along this way before it leaves the slide.
    fn room(&self, along: Along) -> f64 {
        match along {
            Along::Rows => self.slide_h - self.y,
            Along::Columns => self.slide_w - self.x,
        }
    }
}

/// The sizes scaled to add up to `total`; equal shares when they have no size to go by.
fn scaled(sizes: &[f64], total: f64) -> Vec<f64> {
    let known: f64 = sizes.iter().sum();
    if known > 0.0 {
        sizes.iter().map(|s| s * total / known).collect()
    } else {
        vec![total / sizes.len().max(1) as f64; sizes.len()]
    }
}

/// The widths of the columns and the heights of the rows as the table is drawn in a box of `w` by
/// `h`: a row with no height of its own shares what the others leave.
fn laid(table: &TableEl, columns: usize, w: f64, h: f64) -> (Vec<f64>, Vec<f64>) {
    let widths: Vec<f64> = (0..columns)
        .map(|i| table.columns.get(i).copied().unwrap_or(0.0).max(0.0))
        .collect();
    let given: Vec<Option<f64>> = table
        .rows
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
    let heights: Vec<f64> = given.iter().map(|g| g.unwrap_or(share)).collect();
    (scaled(&widths, w), scaled(&heights, h))
}

/// Why a table of this size is too big, or none when it is within the limits.
pub(super) fn over_limit(rows: usize, columns: usize) -> Option<String> {
    if columns > MOST_TABLE_COLUMNS {
        Some(format!(
            "A table has at most {MOST_TABLE_COLUMNS} columns and this would make {columns}. Split it into more than one table, or take out columns."
        ))
    } else if rows > MOST_TABLE_ROWS {
        Some(format!(
            "A table has at most {MOST_TABLE_ROWS} rows and this would make {rows}. Split it across slides, or take out rows."
        ))
    } else if columns.saturating_mul(rows) > MOST_TABLE_PLACES {
        Some(format!(
            "A table has at most {MOST_TABLE_PLACES} places (columns times rows) and this would make {columns} columns and {rows} rows. Split it, or take out rows or columns."
        ))
    } else {
        None
    }
}

/// Writes the sizes into the table and its box. The table has the rows and columns the sizes are for.
fn write(table: &mut TableEl, frame: &Frame, widths: &[f64], heights: &[f64]) {
    table.columns = widths.iter().map(|w| round2(*w)).collect();
    for (row, height) in table.rows.iter_mut().zip(heights) {
        row.height = Some(round2(*height));
    }
    table.base.w = Some(round2(frame.w));
    table.base.h = Some(round2(frame.h));
}

/// Adds `count` rows or columns in front of the one at `at`. Each is as big as the one before it
/// (the first, when there is none), the box grows by that much without leaving the slide, and
/// the sizes are scaled to fit what the box has become.
pub(super) fn insert(
    table: &mut TableEl,
    frame: &mut Frame,
    along: Along,
    at: usize,
    count: usize,
) -> Result<(), String> {
    let mut matrix = table.to_matrix()?;
    let (columns, rows) = (matrix.columns, matrix.rows.len());
    let total = matrix.lines(along);
    if at > total {
        return Err(format!(
            "The table has {total} {}, so {} can be added at 0 to {total}, not {at}.",
            along.name(total != 1),
            along.name(true)
        ));
    }
    let (new_rows, new_columns) = match along {
        Along::Rows => (rows.saturating_add(count), columns),
        Along::Columns => (rows, columns.saturating_add(count)),
    };
    if let Some(message) = over_limit(new_rows, new_columns) {
        return Err(message);
    }
    let (mut widths, mut heights) = laid(table, columns, frame.w, frame.h);
    let length = frame.len(along);
    let grown = {
        let sizes = match along {
            Along::Rows => &mut heights,
            Along::Columns => &mut widths,
        };
        // A table with none of this kind has nothing to copy: the new ones share the box.
        let each = sizes
            .get(at.saturating_sub(1))
            .or(sizes.first())
            .copied()
            .unwrap_or(length / count as f64);
        let added = if sizes.is_empty() {
            0.0
        } else {
            each * count as f64
        };
        sizes.splice(at..at, std::iter::repeat_n(each, count));
        let grown = (length + added).min(length.max(frame.room(along)));
        let sum: f64 = sizes.iter().sum();
        if sum > 0.0 {
            for size in sizes.iter_mut() {
                *size = *size * grown / sum;
            }
        }
        grown
    };
    frame.set_len(along, grown);
    matrix.insert_lines(along, at, count);
    table.from_matrix(matrix);
    write(table, frame, &widths, &heights);
    Ok(())
}

/// Takes `count` rows or columns away from `from`. The box gets shorter by what they took; the
/// others keep the size they are drawn at.
pub(super) fn remove(
    table: &mut TableEl,
    frame: &mut Frame,
    along: Along,
    from: usize,
    count: usize,
) -> Result<(), String> {
    let mut matrix = table.to_matrix()?;
    let columns = matrix.columns;
    matrix.delete_lines(along, from, count)?;
    let (mut widths, mut heights) = laid(table, columns, frame.w, frame.h);
    let sizes = match along {
        Along::Rows => &mut heights,
        Along::Columns => &mut widths,
    };
    let taken: f64 = sizes.drain(from..from + count).sum();
    frame.set_len(along, (frame.len(along) - taken).max(0.0));
    table.from_matrix(matrix);
    write(table, frame, &widths, &heights);
    Ok(())
}
