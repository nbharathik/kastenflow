//! A body as lines with their byte offsets, and the small tests every
//! scanner rule shares (blank, indent, line ends).

/// One line of a body: `start..end` is the line without its line end.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Line<'a> {
    pub start: usize,
    pub end: usize,
    pub text: &'a str,
}

/// The lines of `body`. A line end is `\n` or `\r\n`; a last line may have none,
/// and a body that ends in a line end has no empty last line.
pub(crate) fn split_lines(body: &str) -> Vec<Line<'_>> {
    let bytes = body.as_bytes();
    let mut out = Vec::new();
    let mut start = 0;
    while start < body.len() {
        let (end, next) = match body[start..].find('\n') {
            Some(at) => {
                let nl = start + at;
                let end = if nl > start && bytes[nl - 1] == b'\r' {
                    nl - 1
                } else {
                    nl
                };
                (end, nl + 1)
            }
            None => (body.len(), body.len()),
        };
        out.push(Line {
            start,
            end,
            text: &body[start..end],
        });
        start = next;
    }
    out
}

/// The line end the body uses: CRLF if it holds one anywhere, else LF.
pub(crate) fn eol_of(body: &str) -> &'static str {
    if body.contains("\r\n") { "\r\n" } else { "\n" }
}

/// `text` with every line end as `eol`, and no line end at its ends.
pub(crate) fn with_eol(text: &str, eol: &str) -> String {
    let trimmed = text.trim_matches(['\n', '\r']);
    let mut out = String::with_capacity(trimmed.len());
    let mut chars = trimmed.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push_str(eol);
            }
            '\n' => out.push_str(eol),
            other => out.push(other),
        }
    }
    out
}

/// A line with nothing but spaces and tabs (and the `\r` of a line end). A
/// vertical tab or a form feed makes text, as the editor's parser reads it.
pub(crate) fn is_blank(text: &str) -> bool {
    text.chars().all(|c| matches!(c, ' ' | '\t' | '\r'))
}

/// The width of a line's leading white space in columns (a tab goes to the
/// next multiple of 4).
pub(crate) fn indent(text: &str) -> usize {
    let mut cols = 0;
    for c in text.chars() {
        match c {
            ' ' => cols += 1,
            '\t' => cols = (cols / 4 + 1) * 4,
            _ => break,
        }
    }
    cols
}

/// `text` without up to `cols` columns of leading white space.
pub(crate) fn strip_cols(text: &str, cols: usize) -> &str {
    let mut width = 0;
    for (at, c) in text.char_indices() {
        if width >= cols {
            return &text[at..];
        }
        match c {
            ' ' => width += 1,
            '\t' => width = (width / 4 + 1) * 4,
            _ => return &text[at..],
        }
    }
    ""
}

/// `text` without its leading spaces and tabs.
pub(crate) fn trim_indent(text: &str) -> &str {
    text.trim_start_matches([' ', '\t'])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_keep_their_offsets_and_line_ends() {
        let body = "a\r\nb\n\nc";
        let lines = split_lines(body);
        let spans: Vec<(usize, usize)> = lines.iter().map(|l| (l.start, l.end)).collect();
        assert_eq!(spans, [(0, 1), (3, 4), (5, 5), (6, 7)]);
        assert_eq!(split_lines("a\n").len(), 1);
        assert!(split_lines("").is_empty());
    }

    #[test]
    fn markdown_is_given_the_pages_line_ends() {
        assert_eq!(with_eol("\na\nb\r\nc\n\n", "\r\n"), "a\r\nb\r\nc");
        assert_eq!(with_eol("a\r\nb", "\n"), "a\nb");
        assert_eq!(eol_of("a\r\nb\n"), "\r\n");
    }

    #[test]
    fn only_spaces_and_tabs_make_a_line_blank() {
        assert!(is_blank("") && is_blank(" \t \r"));
        assert!(!is_blank("\x0c") && !is_blank("\x0b") && !is_blank("\u{a0}"));
    }

    #[test]
    fn indent_counts_columns() {
        assert_eq!(indent("   x"), 3);
        assert_eq!(indent("\tx"), 4);
        assert_eq!(indent(" \tx"), 4);
        assert_eq!(strip_cols("    x", 2), "  x");
        assert_eq!(strip_cols("\tx", 4), "x");
    }
}
