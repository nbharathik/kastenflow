//! Changes to a diagram's text as replacements of byte ranges. Every change
//! to an existing cell is one of these, so the bytes around it stay exactly
//! as they were.

use std::ops::Range;

use super::scan::Node;
use super::text::esc_attr;

/// Replace `range` with `text` (an insertion has an empty range).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Edit {
    pub range: Range<usize>,
    pub text: String,
}

impl Edit {
    pub fn insert(at: usize, text: String) -> Edit {
        Edit {
            range: at..at,
            text,
        }
    }
}

/// `text` with the edits made. They must not overlap; edits at one place go
/// in the order given.
pub(crate) fn apply(text: &str, mut edits: Vec<Edit>) -> Result<String, String> {
    edits.sort_by_key(|e| e.range.start);
    let mut out =
        String::with_capacity(text.len() + edits.iter().map(|e| e.text.len()).sum::<usize>());
    let mut at = 0;
    for edit in &edits {
        if edit.range.start < at || edit.range.end > text.len() {
            return Err("two changes to a diagram touch the same bytes".to_owned());
        }
        out.push_str(&text[at..edit.range.start]);
        out.push_str(&edit.text);
        at = edit.range.end;
    }
    out.push_str(&text[at..]);
    Ok(out)
}

/// Sets attribute `name` of `node` to `value`.
pub(crate) fn set_attr(node: &Node, name: &str, value: &str) -> Edit {
    match node.attr(name) {
        Some(a) => Edit {
            range: a.inner.clone(),
            text: esc_attr(value),
        },
        None => Edit::insert(node.attr_end, format!(" {name}=\"{}\"", esc_attr(value))),
    }
}

/// Takes attribute `name` off `node`, if it has it.
pub(crate) fn drop_attr(node: &Node, name: &str) -> Option<Edit> {
    node.attr(name).map(|a| Edit {
        range: a.span.clone(),
        text: String::new(),
    })
}

/// The white space that starts the line `pos` is on, when that is all that
/// comes before `pos` on it; else none.
pub(crate) fn indent_before(text: &str, pos: usize) -> Option<&str> {
    let line = text[..pos].rfind('\n').map_or(0, |n| n + 1);
    let lead = &text[line..pos];
    lead.chars().all(|c| c == ' ' || c == '\t').then_some(lead)
}

/// The lines an element takes when nothing else is on them, else the element.
pub(crate) fn line_range(text: &str, span: Range<usize>) -> Range<usize> {
    let Some(lead) = indent_before(text, span.start) else {
        return span;
    };
    let start = span.start - lead.len();
    let after = &text[span.end..];
    let trailing = after
        .find('\n')
        .filter(|&n| after[..n].chars().all(|c| matches!(c, ' ' | '\t' | '\r')));
    match trailing {
        Some(n) => start..span.end + n + 1,
        None => span,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagrams::model::scan::parse;

    #[test]
    fn edits_are_made_at_their_places_and_nothing_else_moves() {
        let text = "<a x=\"1\" y=\"2\"/>\n";
        let tree = parse(text).unwrap();
        let a = &tree.nodes[tree.root];
        let out = apply(
            text,
            vec![
                set_attr(a, "x", "a&b"),
                set_attr(a, "z", "new"),
                drop_attr(a, "y").unwrap(),
            ],
        )
        .unwrap();
        assert_eq!(out, "<a x=\"a&amp;b\" z=\"new\"/>\n");
        assert!(
            apply(
                text,
                vec![
                    Edit {
                        range: 0..5,
                        text: String::new()
                    },
                    Edit {
                        range: 3..6,
                        text: String::new()
                    }
                ]
            )
            .is_err()
        );
    }

    #[test]
    fn a_whole_element_goes_with_its_lines_only_when_it_has_them_to_itself() {
        let text = "<r>\n  <c/>\n  <d/> <e/>\n</r>\n";
        let c = text.find("<c/>").unwrap();
        assert_eq!(&text[line_range(text, c..c + 4)], "  <c/>\n");
        let d = text.find("<d/>").unwrap();
        assert_eq!(line_range(text, d..d + 4), d..d + 4);
        assert_eq!(indent_before(text, c), Some("  "));
        assert_eq!(indent_before(text, 1), None);
    }
}
