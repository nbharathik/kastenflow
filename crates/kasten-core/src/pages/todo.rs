//! The task lines of a list block (`- [ ] buy milk`): which line, whether it
//! is done, and where its checkbox character is, so ticking one changes a
//! single byte.

use serde::Serialize;

use super::lines::{split_lines, trim_indent};
use super::scan_list::{is_task, list_marker};
use super::scan_rules::{fence_closes, fence_open};

/// One task line, as an agent is told of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Todo {
    /// The line in the block, from 0.
    pub line: usize,
    pub done: bool,
    /// The task's text, cut short.
    pub text: String,
}

/// A task line found in a block's source.
pub(crate) struct Task {
    pub line: usize,
    pub done: bool,
    /// The checkbox character's byte offset in the block's source.
    pub mark_at: usize,
    pub text: String,
}

/// The tasks of `source`, in order. Lines inside a code fence are not tasks.
pub(crate) fn tasks(source: &str) -> Vec<Task> {
    let mut out = Vec::new();
    let mut fence = None;
    for (line, l) in split_lines(source).iter().enumerate() {
        if let Some(open) = fence {
            if fence_closes(trim_indent(l.text), open) {
                fence = None;
            }
            continue;
        }
        if let Some(marker) = list_marker(l.text) {
            if is_task(l.text, &marker) {
                let mark_at = l.start + marker.content_at + 1;
                out.push(Task {
                    line,
                    done: source.as_bytes()[mark_at] != b' ',
                    mark_at,
                    text: l.text[marker.content_at + 3..]
                        .trim()
                        .chars()
                        .take(80)
                        .collect(),
                });
            }
            let content = l.text.get(marker.content_at..).unwrap_or("");
            fence = fence_open(content);
        } else {
            fence = fence_open(trim_indent(l.text));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_task_lines_and_their_checkbox_bytes() {
        let source = "- [ ] one\n  - [x] two\n* [X] three\n- plain [ ] four\n```\n- [ ] in code\n```\n1. [ ] five";
        let found = tasks(source);
        let lines: Vec<(usize, bool, &str)> = found
            .iter()
            .map(|t| (t.line, t.done, t.text.as_str()))
            .collect();
        assert_eq!(
            lines,
            [
                (0, false, "one"),
                (1, true, "two"),
                (2, true, "three"),
                (7, false, "five")
            ]
        );
        assert_eq!(&source[found[0].mark_at..found[0].mark_at + 1], " ");
        assert_eq!(&source[found[1].mark_at..found[1].mark_at + 1], "x");
    }
}
