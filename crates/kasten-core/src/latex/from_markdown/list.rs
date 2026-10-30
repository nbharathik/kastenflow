//! Lists: bullets and numbers nested as the page nests them, as
//! `itemize` and `enumerate`. A task becomes an item labelled `[ ]` or `[x]`.

use super::inline::Inline;

/// The deepest list LaTeX can hold (itemize and enumerate allow four levels).
const MAX_DEPTH: usize = 3;

struct Item {
    depth: usize,
    ordered: bool,
    task: Option<bool>,
    lines: Vec<String>,
}

/// The marker a line starts with: its indent, whether it numbers, and the text after it.
fn marker(line: &str) -> Option<(usize, bool, &str)> {
    let mut indent = 0;
    let mut rest = line;
    while let Some(c) = rest.chars().next() {
        match c {
            ' ' => indent += 1,
            '\t' => indent += 4 - indent % 4,
            _ => break,
        }
        rest = &rest[1..];
    }
    let first = rest.chars().next()?;
    let (ordered, after) = if matches!(first, '-' | '*' | '+') {
        (false, &rest[1..])
    } else {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits > 9 || !matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) {
            return None;
        }
        (true, &rest[digits + 1..])
    };
    if !after.is_empty() && !after.starts_with([' ', '\t']) {
        return None;
    }
    Some((indent, ordered, after.trim_start()))
}

fn task_of(text: &str) -> (Option<bool>, &str) {
    for (mark, done) in [("[ ]", false), ("[x]", true), ("[X]", true)] {
        if let Some(rest) = text.strip_prefix(mark)
            && (rest.is_empty() || rest.starts_with(' '))
        {
            return (Some(done), rest.trim_start());
        }
    }
    (None, text)
}

fn items_of(source: &str, inline: &mut Inline) -> Vec<Item> {
    let mut items: Vec<Item> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut flattened = false;
    for line in source.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Some((indent, ordered, text)) = marker(line) else {
            let trimmed = line.trim();
            if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
                inline.note("% TODO: code inside a list item is shown as text");
            }
            match items.last_mut() {
                Some(item) => item.lines.push(trimmed.to_owned()),
                None => items.push(Item {
                    depth: 0,
                    ordered: false,
                    task: None,
                    lines: vec![trimmed.to_owned()],
                }),
            }
            continue;
        };
        while stack.last().is_some_and(|&top| top >= indent) {
            stack.pop();
        }
        let depth = stack.len();
        stack.push(indent);
        if depth > MAX_DEPTH {
            flattened = true;
        }
        let (task, text) = task_of(text);
        items.push(Item {
            depth: depth.min(MAX_DEPTH),
            ordered,
            task,
            lines: vec![text.to_owned()],
        });
    }
    if flattened {
        inline.note("% TODO: list nested deeper than four levels was flattened");
    }
    items
}

fn pad(depth: usize) -> String {
    "  ".repeat(depth)
}

fn env(ordered: bool) -> &'static str {
    if ordered { "enumerate" } else { "itemize" }
}

/// The list in `source` as LaTeX.
pub(super) fn convert(source: &str, inline: &mut Inline) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut open: Vec<bool> = Vec::new();
    for item in items_of(source, inline) {
        let d = item.depth;
        while open.len() > d + 1 {
            let kind = open.pop().unwrap_or(false);
            out.push(format!("{}\\end{{{}}}", pad(open.len()), env(kind)));
        }
        if open.len() == d + 1 && open[d] != item.ordered {
            open.pop();
            out.push(format!("{}\\end{{{}}}", pad(d), env(!item.ordered)));
        }
        while open.len() < d + 1 {
            out.push(format!(
                "{}\\begin{{{}}}",
                pad(open.len()),
                env(item.ordered)
            ));
            open.push(item.ordered);
        }
        let label = match item.task {
            Some(true) => "[{[x]}]",
            Some(false) => "[{[ ]}]",
            None => "",
        };
        let text = inline.convert(&item.lines.join("\n"));
        let mut lines = text.split('\n');
        let first = lines.next().unwrap_or("");
        let head = format!("{}\\item{label}", pad(d + 1));
        // `\item [` would start the item's own label.
        let guard = if first.starts_with('[') { "{}" } else { "" };
        out.push(if first.is_empty() {
            head
        } else {
            format!("{head} {guard}{first}")
        });
        for more in lines {
            out.push(format!("{}  {more}", pad(d + 1)));
        }
    }
    while let Some(kind) = open.pop() {
        out.push(format!("{}\\end{{{}}}", pad(open.len()), env(kind)));
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers() {
        assert_eq!(marker("- a"), Some((0, false, "a")));
        assert_eq!(marker("  * b"), Some((2, false, "b")));
        assert_eq!(marker("12. c"), Some((0, true, "c")));
        assert_eq!(marker("3) d"), Some((0, true, "d")));
        assert_eq!(marker("-"), Some((0, false, "")));
        assert_eq!(marker("-x"), None);
        assert_eq!(marker("1234567890. x"), None);
        assert_eq!(marker("text"), None);
        assert_eq!(marker("\t- t"), Some((4, false, "t")));
    }

    #[test]
    fn an_item_that_starts_with_a_bracket_is_not_read_as_its_label() {
        let mut inline = Inline::default();
        assert_eq!(
            convert("- [x\n", &mut inline),
            "\\begin{itemize}\n  \\item {}[x\n\\end{itemize}"
        );
    }

    #[test]
    fn deep_lists_are_flattened_not_broken() {
        let mut inline = Inline::default();
        let source: String = (0..8)
            .map(|d| format!("{}- l{d}\n", "  ".repeat(d)))
            .collect();
        let tex = convert(&source, &mut inline);
        assert_eq!(tex.matches("\\begin{itemize}").count(), 4);
        assert_eq!(tex.matches("\\end{itemize}").count(), 4);
        assert_eq!(inline.notes.len(), 1);
    }

    #[test]
    fn a_change_of_kind_closes_and_opens_a_list() {
        let mut inline = Inline::default();
        let tex = convert("- a\n1. b\n", &mut inline);
        assert_eq!(
            tex,
            "\\begin{itemize}\n  \\item a\n\\end{itemize}\n\\begin{enumerate}\n  \\item b\n\\end{enumerate}"
        );
    }
}
