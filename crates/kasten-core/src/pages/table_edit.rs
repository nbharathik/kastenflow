//! Table steps: cells set, rows and columns added or taken out. Each is a
//! handful of byte edits inside the table's own lines, in the style of the
//! table (outer pipes or not, the padding of the cell it replaces); the
//! other cells, the alignment row and every other line stay as they are.

use super::blocks::{Block, Kind, Page};
use super::edits::Edit;
use super::lines::{Line, split_lines};
use super::steps::{BlockRef, PageStep};
use super::table::{Row, split_row};
use crate::error::{Error, Result};

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// The edits of the table steps; None for the steps others make.
pub(crate) fn tables(page: &Page, step: &PageStep) -> Option<Result<Vec<Edit>>> {
    Some(match step {
        PageStep::TableCells { block, cells } => cells_edit(page, block, cells),
        PageStep::TableRows {
            block,
            insert_at,
            rows,
            delete,
        } => rows_edit(page, block, *insert_at, rows, delete),
        PageStep::TableColumns {
            block,
            insert_at,
            header,
            align,
            cells,
            delete,
        } => columns_edit(
            page,
            block,
            *insert_at,
            (header, align.as_deref(), cells),
            delete,
        ),
        _ => return None,
    })
}

/// An edit inside the table's source: `start..end` of it replaced by `text`.
type Local = (usize, usize, String);

/// A table, with its lines.
struct Grid<'a> {
    block: &'a Block,
    source: &'a str,
    lines: Vec<Line<'a>>,
    eol: &'static str,
}

impl<'a> Grid<'a> {
    fn of(page: &'a Page, reference: &BlockRef) -> Result<Grid<'a>> {
        let block = page.find(reference)?;
        if block.kind != Kind::Table {
            return Err(invalid(format!("{} is not a table", block.id)));
        }
        let source = page.source(block);
        Ok(Grid {
            block,
            source,
            lines: split_lines(source),
            eol: page.eol,
        })
    }

    /// The line of row `row` (0 is the header; the delimiter row has no number).
    fn line(&self, row: usize) -> Result<&Line<'a>> {
        let at = if row == 0 { 0 } else { row + 1 };
        self.lines
            .get(at)
            .ok_or_else(|| invalid(format!("Table {} has no row {row}", self.block.id)))
    }

    /// Rows, the header included.
    fn rows(&self) -> usize {
        self.lines.len() - 1
    }

    fn columns(&self) -> usize {
        split_row(self.lines[0].text).cells.len()
    }

    /// The table with `edits` made, which must still be one table; the edits
    /// as the page's own.
    fn finish(self, mut edits: Vec<Local>) -> Result<Vec<Edit>> {
        edits.sort_by_key(|e| (e.0, e.1));
        let mut out = String::new();
        let mut at = 0;
        for (start, end, text) in &edits {
            if *start < at {
                return Err(invalid("Two changes to the table touch the same bytes"));
            }
            out.push_str(&self.source[at..*start]);
            out.push_str(text);
            at = *end;
        }
        out.push_str(&self.source[at..]);
        let page = Page::parse(&out);
        if !matches!(page.roots.as_slice(), [only] if page.blocks[*only].kind == Kind::Table) {
            return Err(invalid(format!(
                "The change would leave {} unreadable as a table, so nothing was written",
                self.block.id
            )));
        }
        let base = self.block.at.start;
        let block = (base, self.block.at.end);
        Ok(edits
            .into_iter()
            .map(|(s, e, t)| Edit::exact(base + s, base + e, t).inside(block))
            .collect())
    }
}

/// Cell text that stays in its cell: one line, bars escaped.
fn clean_cell(text: &str) -> String {
    let one = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("<br />");
    // A backslash escapes the next character, so a bar is escaped by an odd
    // number of them before it; the same pairs are read when the row is split.
    let mut out = String::with_capacity(one.len());
    let mut escaped = false;
    for c in one.chars() {
        if c == '|' && !escaped {
            out.push('\\');
        }
        escaped = c == '\\' && !escaped;
        out.push(c);
    }
    // A last backslash would escape the bar that ends the cell.
    if escaped {
        out.push('\\');
    }
    out.trim().to_owned()
}

fn cells_edit(
    page: &Page,
    block: &BlockRef,
    cells: &[(usize, usize, String)],
) -> Result<Vec<Edit>> {
    let grid = Grid::of(page, block)?;
    let mut edits = Vec::new();
    // Each line is cut once, however many of its cells are set.
    let mut cut: std::collections::HashMap<usize, Row> = std::collections::HashMap::new();
    for (row, col, text) in cells {
        let line = grid.line(*row)?;
        let parsed = cut.entry(*row).or_insert_with(|| split_row(line.text));
        let cell = parsed.cells.get(*col).ok_or_else(|| {
            invalid(format!(
                "Row {row} of {} has {} cells, so there is no column {col}",
                grid.block.id,
                parsed.cells.len()
            ))
        })?;
        let raw = &line.text[cell.start..cell.end];
        let text = clean_cell(text);
        let core = raw.trim();
        if core == text {
            continue;
        }
        // With no bar at the row's side, an empty first cell would make the next
        // cell the first: that row gets a bar.
        if text.is_empty() && *col == 0 && !parsed.leading && parsed.cells.len() > 1 {
            let first = line.start + indent_len(line.text);
            edits.push((first, first, "| ".to_owned()));
        }
        if core.is_empty() {
            edits.push((
                line.start + cell.start,
                line.start + cell.end,
                format!(" {text} "),
            ));
        } else {
            let lead = raw.len() - raw.trim_start().len();
            let from = line.start + cell.start + lead;
            edits.push((from, from + core.len(), text));
        }
    }
    grid.finish(edits)
}

/// A line of `cells` in the style of the header.
fn build_line(cells: &[String], like: &Row, lead: &str) -> String {
    let body = cells.join(" | ");
    let bare = cells.len() == 1 && !like.leading && !like.trailing;
    // Without bars at the sides an empty first or last cell cannot be told
    // from no cell, so such a row gets the bar.
    let many = cells.len() > 1;
    let first_empty = many && cells.first().is_some_and(String::is_empty);
    let last_empty = many && cells.last().is_some_and(String::is_empty);
    format!(
        "{lead}{}{body}{}",
        if like.leading || bare || first_empty {
            "| "
        } else {
            ""
        },
        if like.trailing || bare || last_empty {
            " |"
        } else {
            ""
        }
    )
}

fn rows_edit(
    page: &Page,
    block: &BlockRef,
    insert_at: Option<usize>,
    rows: &[Vec<String>],
    delete: &[usize],
) -> Result<Vec<Edit>> {
    let grid = Grid::of(page, block)?;
    if insert_at.is_none() && delete.is_empty() {
        return Err(invalid("table_rows needs insert_at with rows, or delete"));
    }
    let mut edits = Vec::new();
    let mut gone: Vec<usize> = Vec::new();
    for &row in delete {
        if row == 0 {
            return Err(invalid("The header row cannot be deleted"));
        }
        grid.line(row)?;
        gone.push(row + 1);
    }
    gone.sort_unstable();
    gone.dedup();
    let last = grid.lines.len() - 1;
    let mut i = 0;
    while i < gone.len() {
        let mut j = i;
        while j + 1 < gone.len() && gone[j + 1] == gone[j] + 1 {
            j += 1;
        }
        let (a, b) = (gone[i], gone[j]);
        edits.push(if b < last {
            (grid.lines[a].start, grid.lines[b + 1].start, String::new())
        } else {
            (grid.lines[a - 1].end, grid.lines[b].end, String::new())
        });
        i = j + 1;
    }
    if let Some(at) = insert_at {
        if at == 0 || at > grid.rows() {
            return Err(invalid(format!(
                "insert_at must be from 1 (the first row under the header) to {}",
                grid.rows()
            )));
        }
        if rows.is_empty() {
            return Err(invalid("Give the rows to insert"));
        }
        let columns = grid.columns();
        let header = split_row(grid.lines[0].text);
        let lead =
            &grid.lines[0].text[..grid.lines[0].text.len() - grid.lines[0].text.trim_start().len()];
        let mut lines = Vec::new();
        for row in rows {
            if row.len() > columns {
                return Err(invalid(format!(
                    "A row has {} cells but the table has {columns} columns",
                    row.len()
                )));
            }
            let mut cells: Vec<String> = row.iter().map(|c| clean_cell(c)).collect();
            cells.resize(columns, String::new());
            lines.push(build_line(&cells, &header, lead));
        }
        let eol = grid.eol;
        edits.push(if at + 1 < grid.lines.len() {
            let spot = grid.lines[at + 1].start;
            (spot, spot, format!("{}{eol}", lines.join(eol)))
        } else {
            let spot = grid.lines[last].end;
            (spot, spot, format!("{eol}{}", lines.join(eol)))
        });
    }
    grid.finish(edits)
}

/// A delimiter cell for an alignment word.
fn delimiter(align: Option<&str>) -> Result<&'static str> {
    Ok(match align.map(str::trim) {
        None | Some("" | "none") => "---",
        Some("left") => ":--",
        Some("center") => ":-:",
        Some("right") => "--:",
        Some(other) => {
            return Err(invalid(format!(
                "“{other}” is not an alignment: use left, center, right or none"
            )));
        }
    })
}

fn columns_edit(
    page: &Page,
    block: &BlockRef,
    insert_at: Option<usize>,
    (header, align, cells): (&str, Option<&str>, &[String]),
    delete: &[usize],
) -> Result<Vec<Edit>> {
    let grid = Grid::of(page, block)?;
    if insert_at.is_none() && delete.is_empty() {
        return Err(invalid("table_columns needs insert_at, or delete"));
    }
    let columns = grid.columns();
    let mut gone = delete.to_vec();
    gone.sort_unstable();
    gone.dedup();
    if let Some(&bad) = gone.iter().find(|&&c| c >= columns) {
        return Err(invalid(format!(
            "{} has {columns} columns, so there is no column {bad}",
            grid.block.id
        )));
    }
    if gone.len() >= columns {
        return Err(invalid("A table keeps at least one column"));
    }
    let delimiter = delimiter(align)?;
    if let Some(at) = insert_at
        && at > columns
    {
        return Err(invalid(format!("insert_at must be from 0 to {columns}")));
    }
    let mut edits = Vec::new();
    for (n, line) in grid.lines.iter().enumerate() {
        let row = split_row(line.text);
        let text = match n {
            0 => clean_cell(header),
            1 => delimiter.to_owned(),
            _ => cells.get(n - 2).map(|c| clean_cell(c)).unwrap_or_default(),
        };
        if let Some(at) = insert_at {
            let spot = insertion(line, &row, at, &text)?;
            edits.push(spot);
        }
        for &col in &gone {
            if let Some(cut) = removal(line, &row, col)? {
                edits.push(cut);
            }
        }
    }
    grid.finish(edits)
}

/// The edit that puts a cell with `text` at column `at` of a line.
fn insertion(line: &Line, row: &Row, at: usize, text: &str) -> Result<Local> {
    let count = row.cells.len();
    if at > count {
        return Err(invalid(format!(
            "A row has {count} cells, fewer than column {at}"
        )));
    }
    if at == count {
        let end = line.text.trim_end().len();
        let spot = line.start + end;
        // An empty cell at the end of a row with no bar there needs one, or it is no cell.
        return Ok(if row.trailing {
            (spot, spot, format!(" {text} |"))
        } else if text.is_empty() {
            (spot, spot, " |  |".to_owned())
        } else {
            (spot, spot, format!(" | {text}"))
        });
    }
    let cell = row.cells[at];
    if row.leading || at > 0 {
        let spot = line.start + cell.start;
        return Ok((spot, spot, format!(" {text} |")));
    }
    let first = line.start + indent_len(line.text);
    // An empty first cell in a row with no bar there needs one, or the next cell becomes the first.
    if text.is_empty() {
        return Ok((first, first, "| | ".to_owned()));
    }
    Ok((first, first, format!("{text} | ")))
}

fn indent_len(text: &str) -> usize {
    text.len() - text.trim_start_matches([' ', '\t']).len()
}

/// The edit that takes column `col` out of a line, if the line has it.
fn removal(line: &Line, row: &Row, col: usize) -> Result<Option<Local>> {
    let count = row.cells.len();
    if col >= count {
        return Ok(None);
    }
    let cell = row.cells[col];
    if row.leading || col > 0 {
        return Ok(Some((
            line.start + cell.start - 1,
            line.start + cell.end,
            String::new(),
        )));
    }
    if count < 2 {
        return Err(invalid("A row with one cell cannot lose it"));
    }
    let next = row.cells[1];
    let from = line.start + indent_len(line.text).max(cell.start);
    let to = line.start + next.start + indent_len(&line.text[next.start..]);
    Ok(Some((from, to, String::new())))
}
