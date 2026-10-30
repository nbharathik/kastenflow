//! A GFM table read as text: where each cell's bytes are, so a change can
//! touch the cells it must and leave every other byte alone. Rows are split
//! at unescaped pipes, as the editor splits them.

use super::lines::{Line, indent, is_blank};
use super::scan::starts_block;

/// A cell's bytes in its line, padding included.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Cell {
    pub start: usize,
    pub end: usize,
}

/// A table line cut into cells.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Row {
    pub cells: Vec<Cell>,
    /// Whether the line begins with a pipe.
    pub leading: bool,
    /// Whether the line ends with a pipe.
    pub trailing: bool,
}

/// Splits a table line at its unescaped pipes.
pub(crate) fn split_row(line: &str) -> Row {
    let mut pipes = Vec::new();
    let mut chars = line.char_indices();
    while let Some((at, c)) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            '|' => pipes.push(at),
            _ => {}
        }
    }
    let Some((&first, &last)) = pipes.first().zip(pipes.last()) else {
        return Row {
            cells: vec![Cell {
                start: 0,
                end: line.len(),
            }],
            leading: false,
            trailing: false,
        };
    };
    let mut cells = Vec::new();
    let mut start = 0;
    for &pipe in &pipes {
        cells.push(Cell { start, end: pipe });
        start = pipe + 1;
    }
    cells.push(Cell {
        start,
        end: line.len(),
    });
    let leading = line[..first].trim().is_empty();
    let trailing = line[last + 1..].trim().is_empty();
    if trailing {
        cells.pop();
    }
    if leading && !cells.is_empty() {
        cells.remove(0);
    }
    Row {
        cells,
        leading,
        trailing,
    }
}

/// A cell's text without the spaces around it.
pub(crate) fn cell_text<'a>(line: &'a str, cell: &Cell) -> &'a str {
    line[cell.start..cell.end].trim()
}

/// `:---:` and the like: the alignment a delimiter cell says (None: none).
pub(crate) fn align_of(text: &str) -> Option<Option<char>> {
    let body = text.trim_matches(':');
    if body.is_empty() || !body.chars().all(|c| c == '-') || text.matches(':').count() > 2 {
        return None;
    }
    let (left, right) = (text.starts_with(':'), text.ends_with(':'));
    // `:` alone at each end only; `-:-` is not a delimiter cell.
    if text.len() - body.len() != usize::from(left) + usize::from(right) {
        return None;
    }
    Some(match (left, right) {
        (true, true) => Some('c'),
        (true, false) => Some('l'),
        (false, true) => Some('r'),
        _ => None,
    })
}

/// Whether `line` is a delimiter row: every cell is dashes with optional colons.
pub(crate) fn is_delimiter_row(line: &str) -> bool {
    let row = split_row(line);
    !row.cells.is_empty()
        && line.contains('-')
        && row
            .cells
            .iter()
            .all(|c| align_of(cell_text(line, c)).is_some())
}

/// The last line of the table whose header is at line `i`, if one starts
/// there: a header, a delimiter row of as many cells, then rows up to a blank
/// line or the start of another block.
pub(crate) fn table_end(lines: &[Line], i: usize) -> Option<usize> {
    let header = lines.get(i)?.text;
    let delimiter = lines.get(i + 1)?.text;
    if indent(header) > 3 || indent(delimiter) > 3 || !is_delimiter_row(delimiter) {
        return None;
    }
    if !header.contains('|') && !delimiter.contains('|') {
        return None;
    }
    if split_row(header).cells.len() != split_row(delimiter).cells.len() {
        return None;
    }
    let mut last = i + 1;
    for (k, line) in lines.iter().enumerate().skip(i + 2) {
        // An indented line ends the table too: the editor's parser reads it as code.
        if is_blank(line.text) || starts_block(line.text) || indent(line.text) >= 4 {
            break;
        }
        last = k;
    }
    Some(last)
}

#[cfg(test)]
mod tests {
    use super::super::lines::split_lines;
    use super::*;

    fn texts(line: &str) -> Vec<&str> {
        split_row(line)
            .cells
            .iter()
            .map(|c| cell_text(line, c))
            .collect()
    }

    #[test]
    fn rows_split_at_unescaped_pipes() {
        assert_eq!(texts("| a | b |"), ["a", "b"]);
        assert_eq!(texts("a | b"), ["a", "b"]);
        assert_eq!(texts("| a \\| b | c"), ["a \\| b", "c"]);
        assert_eq!(texts("|"), Vec::<&str>::new());
        let row = split_row("| a | b");
        assert!(row.leading && !row.trailing);
        assert_eq!(split_row("plain").cells.len(), 1);
    }

    #[test]
    fn delimiter_rows_say_the_alignment() {
        assert_eq!(align_of(":---:"), Some(Some('c')));
        assert_eq!(align_of("--:"), Some(Some('r')));
        assert_eq!(align_of(":--"), Some(Some('l')));
        assert_eq!(align_of("---"), Some(None));
        assert_eq!(align_of("-:-"), None);
        assert_eq!(align_of("::"), None);
        assert!(is_delimiter_row("|:--|--:|:-:|"));
        assert!(!is_delimiter_row("| a | b |"));
    }

    #[test]
    fn a_table_needs_a_header_and_a_delimiter_row_of_the_same_width() {
        let body = "| a | b |\n|---|---|\n| 1 | 2 |\nmore\n\nafter\n";
        let lines = split_lines(body);
        assert_eq!(table_end(&lines, 0), Some(3));
        let narrow = split_lines("| a | b |\n|---|\n");
        assert_eq!(table_end(&narrow, 0), None);
        let setext = split_lines("Title\n-----\n");
        assert_eq!(table_end(&setext, 0), None);
    }
}
