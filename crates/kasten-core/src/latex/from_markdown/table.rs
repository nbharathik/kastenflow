//! GFM tables as a `tabular` in a `center`: the header in bold, alignments
//! from the delimiter row, short rows padded.

use super::inline::Inline;

/// The most columns and rows written; the rest is left out with a note.
const MAX_COLUMNS: usize = 30;
const MAX_ROWS: usize = 500;

/// The cells of a table row; `\|` is a bar inside a cell.
fn cells_of(line: &str) -> Vec<String> {
    let line = line.trim();
    let line = line.strip_prefix('|').unwrap_or(line);
    let mut cells = Vec::new();
    let mut cell = String::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'|') => {
                chars.next();
                cell.push('|');
            }
            '|' => cells.push(std::mem::take(&mut cell).trim().to_owned()),
            c => cell.push(c),
        }
    }
    // Text after the last bar is a cell; nothing after it is not.
    if !cell.trim().is_empty() {
        cells.push(cell.trim().to_owned());
    }
    cells
}

/// `:--`, `:-:`, `--:` or `---`: the column's letter, if this is a delimiter cell.
fn align_of(cell: &str) -> Option<char> {
    let inner = cell.trim_start_matches(':').trim_end_matches(':');
    if inner.is_empty() || !inner.chars().all(|c| c == '-') {
        return None;
    }
    Some(match (cell.starts_with(':'), cell.ends_with(':')) {
        (true, true) => 'c',
        (false, true) => 'r',
        _ => 'l',
    })
}

/// The table in `source`, or none when its second line is not a delimiter row.
pub(super) fn convert(source: &str, inline: &mut Inline) -> Option<String> {
    let mut lines = source.lines().filter(|l| !l.trim().is_empty());
    let header = cells_of(lines.next()?);
    let delimiter: Vec<Option<char>> = cells_of(lines.next()?)
        .iter()
        .map(|c| align_of(c))
        .collect();
    if header.is_empty() || delimiter.is_empty() || delimiter.iter().any(Option::is_none) {
        return None;
    }
    let width = header.len().clamp(1, MAX_COLUMNS);
    if header.len() > MAX_COLUMNS {
        inline.note(format!(
            "% TODO: table has more than {MAX_COLUMNS} columns, the rest were left out"
        ));
    }
    let spec: String = (0..width)
        .map(|i| delimiter.get(i).copied().flatten().unwrap_or('l'))
        .collect();
    let mut out = vec![
        "\\begin{center}".to_owned(),
        format!("\\begin{{tabular}}{{{spec}}}"),
        "\\hline".to_owned(),
    ];
    let row = |inline: &mut Inline, cells: &[String], bold: bool| {
        let shown: Vec<String> = (0..width)
            .map(|i| {
                let text = inline.convert(cells.get(i).map_or("", String::as_str));
                if bold && !text.is_empty() {
                    return format!("\\textbf{{{text}}}");
                }
                // The row before ends in `\\`, which would read a leading `[` or `*` as its options.
                if i == 0 && text.starts_with(['[', '*']) {
                    format!("{{}}{text}")
                } else {
                    text
                }
            })
            .collect();
        format!("{} \\\\", shown.join(" & "))
    };
    out.push(row(inline, &header, true));
    out.push("\\hline".to_owned());
    for (n, line) in lines.enumerate() {
        if n == MAX_ROWS {
            inline.note(format!(
                "% TODO: table has more than {MAX_ROWS} rows, the rest were left out"
            ));
            break;
        }
        out.push(row(inline, &cells_of(line), false));
    }
    out.push("\\hline".to_owned());
    out.push("\\end{tabular}".to_owned());
    out.push("\\end{center}".to_owned());
    Some(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cells_split_on_bars_that_are_not_escaped() {
        assert_eq!(cells_of("| a | b \\| c |"), ["a", "b | c"]);
        assert_eq!(cells_of("a|b"), ["a", "b"]);
        assert_eq!(cells_of("| a | |"), ["a", ""]);
    }

    #[test]
    fn delimiter_cells() {
        assert_eq!(align_of(":--"), Some('l'));
        assert_eq!(align_of(":-:"), Some('c'));
        assert_eq!(align_of("--:"), Some('r'));
        assert_eq!(align_of("-"), Some('l'));
        assert_eq!(align_of("::"), None);
        assert_eq!(align_of("a-"), None);
    }

    #[test]
    fn not_a_table_without_a_delimiter_row() {
        let mut inline = Inline::default();
        assert!(convert("a | b\nc | d\n", &mut inline).is_none());
        assert!(convert("only one line", &mut inline).is_none());
    }

    #[test]
    fn very_wide_tables_are_cut() {
        let mut inline = Inline::default();
        let row = vec!["x"; 40].join("|");
        let delimiter = vec!["-"; 40].join("|");
        let tex = convert(&format!("{row}\n{delimiter}\n{row}\n"), &mut inline).unwrap();
        assert!(tex.contains(&format!("{{{}}}", "l".repeat(30))));
        assert_eq!(inline.notes.len(), 1);
    }
}
