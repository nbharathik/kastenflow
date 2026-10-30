//! Lists: where an item starts and where the list ends. A list runs over its
//! items' lines (indented under the marker, or lazily continued), the blank
//! lines between items, and nested lists.

use super::lines::{Line, indent, is_blank, strip_cols, trim_indent};
use super::scan::starts_block;
use super::scan_rules::{atx_level, fence_closes, fence_open, is_thematic};

/// A list item's marker line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Marker {
    /// The bullet (`-`, `+`, `*`), or the delimiter (`.` or `)`) of a number.
    pub mark: char,
    pub ordered: bool,
    pub number: u64,
    /// The column the item's text starts at; its lines are indented to it.
    pub content_col: usize,
    /// Nothing follows the marker.
    pub empty: bool,
    /// Where the item's text starts in the line, in bytes.
    pub content_at: usize,
}

/// The marker a line starts with, if it starts a list item. The caller
/// checks the indent (a marker indented four columns is not one).
pub(crate) fn list_marker(text: &str) -> Option<Marker> {
    let ind = indent(text);
    let t = trim_indent(text);
    let lead = text.len() - t.len();
    let first = t.chars().next()?;
    let (ordered, number, mark, width) = if matches!(first, '-' | '+' | '*') {
        (false, 0, first, 1)
    } else {
        let digits = t.chars().take_while(char::is_ascii_digit).count();
        if !(1..=9).contains(&digits) {
            return None;
        }
        let mark = t[digits..]
            .chars()
            .next()
            .filter(|c| matches!(c, '.' | ')'))?;
        (true, t[..digits].parse().ok()?, mark, digits + 1)
    };
    let after = &t[width..];
    let mut cols = 0;
    let mut spaces = 0;
    for c in after.chars() {
        match c {
            ' ' => cols += 1,
            '\t' => cols = (((ind + width + cols) / 4 + 1) * 4) - (ind + width),
            _ => break,
        }
        spaces += 1;
    }
    let rest = &after[spaces..];
    if !rest.is_empty() && cols == 0 {
        return None;
    }
    let empty = is_blank(rest);
    let content_col = if empty || cols >= 5 {
        ind + width + 1
    } else {
        ind + width + cols
    };
    Some(Marker {
        mark,
        ordered,
        number,
        content_col,
        empty,
        content_at: lead + width + if empty { after.len() } else { spaces },
    })
}

/// Whether a line starts a list that can interrupt a paragraph: a non-empty
/// item, and a number only if it is 1.
pub(crate) fn list_interrupts(text: &str) -> bool {
    indent(text) <= 3
        && list_marker(text).is_some_and(|m| !m.empty && (!m.ordered || m.number == 1))
}

fn same_list(a: &Marker, b: &Marker) -> bool {
    a.ordered == b.ordered && a.mark == b.mark
}

/// Whether the item that starts with `marker` on `text` is a task (`[ ]`, `[x]`).
pub(crate) fn is_task(text: &str, marker: &Marker) -> bool {
    let rest = text.get(marker.content_at..).unwrap_or("");
    let mut chars = rest.chars();
    chars.next() == Some('[')
        && matches!(chars.next(), Some(' ' | 'x' | 'X'))
        && chars.next() == Some(']')
        && matches!(chars.next(), None | Some(' ' | '\t'))
}

/// A fence the item's own text opens on its first line.
fn fence_in_first_line(text: &str, marker: &Marker) -> Option<(char, usize)> {
    fence_open(text.get(marker.content_at..).unwrap_or(""))
}

fn step_fence(open: Option<(char, usize)>, inner: &str) -> Option<(char, usize)> {
    match open {
        Some(fence) => (!fence_closes(inner, fence)).then_some(fence),
        None => fence_open(inner),
    }
}

/// Whether a line is not paragraph text (an empty item, a heading, a rule, a
/// fence), so the next line cannot continue it lazily.
fn ends_paragraph(prev: &str) -> bool {
    // Indented four columns or more, outside any item's own text, a line is
    // paragraph text, whatever it looks like.
    if indent(prev) >= 4 {
        return false;
    }
    let mut t = trim_indent(prev);
    while let Some(marker) = list_marker(t) {
        t = t.get(marker.content_at..).unwrap_or("");
    }
    is_blank(t) || atx_level(t).is_some() || is_thematic(t) || fence_open(t).is_some()
}

/// The last line of the list whose first item starts at line `i`.
pub(crate) fn list_end(lines: &[Line], i: usize, first: &Marker) -> usize {
    let mut content_col = first.content_col;
    let mut fence = fence_in_first_line(lines[i].text, first);
    let mut last = i;
    let mut k = i + 1;
    while k < lines.len() {
        let text = lines[k].text;
        if is_blank(text) {
            k += 1;
            continue;
        }
        let ind = indent(text);
        if ind >= content_col {
            fence = step_fence(fence, strip_cols(text, content_col));
            last = k;
            k += 1;
            continue;
        }
        // Less indented than the item: it ends the item, and its fence if it
        // had one open; it may still be the next item of the list.
        let fenced = fence.take().is_some();
        if ind <= 3
            && !is_thematic(text)
            && let Some(m) = list_marker(text)
        {
            if !same_list(first, &m) {
                break;
            }
            content_col = m.content_col;
            fence = fence_in_first_line(text, &m);
            last = k;
            k += 1;
            continue;
        }
        let after_blank = is_blank(lines[k - 1].text);
        if is_thematic(text)
            || fenced
            || after_blank
            || ends_paragraph(lines[k - 1].text)
            || starts_block(text)
        {
            break;
        }
        // Text that continues the paragraph of the item above it.
        last = k;
        k += 1;
    }
    last
}

#[cfg(test)]
mod tests {
    use super::super::lines::split_lines;
    use super::*;

    fn end(body: &str) -> usize {
        let lines = split_lines(body);
        let marker = list_marker(lines[0].text).unwrap();
        list_end(&lines, 0, &marker)
    }

    #[test]
    fn markers_say_where_the_text_starts() {
        let m = list_marker("- a").unwrap();
        assert_eq!((m.content_col, m.empty, m.ordered), (2, false, false));
        let m = list_marker("  12) b").unwrap();
        assert_eq!((m.content_col, m.number, m.mark), (6, 12, ')'));
        assert!(list_marker("-a").is_none());
        assert!(list_marker("1.a").is_none());
        assert!(list_marker("-").unwrap().empty);
        // Five or more spaces make the text indented code: the item starts one column in.
        assert_eq!(list_marker("-      code").unwrap().content_col, 2);
        assert!(list_interrupts("- a"));
        assert!(list_interrupts("1. a"));
        assert!(!list_interrupts("2. a"));
        assert!(!list_interrupts("-"));
        assert!(is_task("- [x] done", &list_marker("- [x] done").unwrap()));
        assert!(!is_task("- [x]done", &list_marker("- [x]done").unwrap()));
    }

    #[test]
    fn a_list_runs_over_its_items_blank_lines_and_nested_lists() {
        assert_eq!(end("- a\n- b\n\n- c\n\nafter"), 3);
        assert_eq!(end("- a\n  - b\n    - c\n- d\nafter\n"), 4);
        assert_eq!(end("1. a\n   text\n2. b\n"), 2);
        assert_eq!(end("- a\n\n  more of a\n\nafter"), 2);
    }

    #[test]
    fn a_list_ends_at_another_kind_of_list_a_rule_a_gap_or_a_block() {
        assert_eq!(end("- a\n* b\n"), 0);
        assert_eq!(end("- a\n---\n"), 0);
        assert_eq!(end("- a\n\nafter\n"), 0);
        assert_eq!(end("- a\n# Head\n"), 0);
        // Text right under an item continues it.
        assert_eq!(end("- a\nlazy\n- b\n"), 2);
        // A fence open in an item ends with the item.
        assert_eq!(end("- ```\n  x\nout\n"), 1);
    }
}
