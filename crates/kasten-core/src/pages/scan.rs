//! A page body cut into its top-level blocks, each with the exact bytes it
//! covers. The rules are CommonMark's, read line by line; where a rule is
//! unsure the block comes out larger (a lazy line stays with its paragraph, a
//! table that interrupts a paragraph is part of it), never smaller, so a block
//! is never cut through the middle of something that belongs together.

use super::lines::{Line, indent, is_blank, split_lines, trim_indent};
use super::scan_html::{html_end, html_start};
use super::scan_list::{is_task, list_end, list_interrupts, list_marker};
use super::scan_rules::{
    atx_level, callout_header, embed_target, fence_closes, fence_open, is_footnote_definition,
    is_link_definition, is_quote_start, is_thematic, math_closes, math_open, quote_inner_all,
    quote_inner_once, setext_level,
};
use super::table::table_end;

/// What a block is, as far as the text alone says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RawKind {
    Paragraph,
    Heading(u8),
    List { todo: bool },
    Table,
    Code,
    Quote,
    Callout,
    Divider,
    Html,
    Math,
    Embed,
}

/// A block at the top level: the bytes from its first line's start to its
/// last line's end (the line end itself is not in it).
#[derive(Debug, Clone, Copy)]
pub(crate) struct Raw {
    pub start: usize,
    pub end: usize,
    pub kind: RawKind,
}

/// The blocks of `body`, in order.
pub(crate) fn scan(body: &str) -> Vec<Raw> {
    let lines = split_lines(body);
    let mut out = Vec::new();
    let mut i = 0;
    // The block after indented code, blank lines or not: a list item that could
    // not interrupt a paragraph (empty, or not numbered 1) does not start a list
    // there; the parsers read it as text.
    let mut after_code = false;
    while i < lines.len() {
        if is_blank(lines[i].text) {
            i += 1;
            continue;
        }
        let (kind, last) = block_at(&lines, i, after_code);
        after_code = kind == RawKind::Code && indent(lines[i].text) >= 4;
        out.push(Raw {
            start: lines[i].start,
            end: lines[last].end,
            kind,
        });
        i = last + 1;
    }
    out
}

/// Whether a line that follows paragraph text it does not continue (the
/// paragraph is inside a quote or list item the line is not part of) starts a
/// block of its own. Here any list item starts a list. (A lone tag is left
/// with the paragraph: the parsers differ on it, and a larger block is safe.)
pub(crate) fn starts_block(text: &str) -> bool {
    indent(text) < 4
        && (fence_open(text).is_some()
            || math_open(text).is_some()
            || atx_level(text).is_some()
            || is_thematic(text)
            || is_quote_start(text)
            || list_marker(text).is_some()
            || is_footnote_definition(text)
            || html_start(text, true).is_some())
}

/// Whether a line starts a block that interrupts a paragraph.
pub(crate) fn interrupts_paragraph(text: &str) -> bool {
    indent(text) < 4
        && (fence_open(text).is_some()
            || math_open(text).is_some()
            || atx_level(text).is_some()
            || is_thematic(text)
            || is_quote_start(text)
            || list_interrupts(text)
            || is_footnote_definition(text)
            || html_start(text, true).is_some())
}

/// The last non-blank line from `from` on (or `from`).
fn last_filled(lines: &[Line], from: usize) -> usize {
    (from..lines.len())
        .rev()
        .find(|&k| !is_blank(lines[k].text))
        .unwrap_or(from)
}

fn block_at(lines: &[Line], i: usize, after_code: bool) -> (RawKind, usize) {
    let text = lines[i].text;
    if indent(text) >= 4 {
        return (RawKind::Code, indented_code_end(lines, i));
    }
    if let Some(fence) = fence_open(text) {
        let end = (i + 1..lines.len())
            .find(|&k| fence_closes(lines[k].text, fence))
            .unwrap_or_else(|| last_filled(lines, i));
        return (RawKind::Code, end);
    }
    if let Some(n) = math_open(text) {
        let end = (i + 1..lines.len())
            .find(|&k| math_closes(lines[k].text, n))
            .unwrap_or_else(|| last_filled(lines, i));
        return (RawKind::Math, end);
    }
    if let Some(level) = atx_level(text) {
        return (RawKind::Heading(level), i);
    }
    if is_thematic(text) {
        return (RawKind::Divider, i);
    }
    if is_quote_start(text) {
        return quote_end(lines, i);
    }
    if let Some(marker) = list_marker(text)
        && (!after_code || list_interrupts(text))
    {
        let todo = is_task(text, &marker);
        return (RawKind::List { todo }, list_end(lines, i, &marker));
    }
    if let Some(kind) = html_start(text, false) {
        return (RawKind::Html, html_end(lines, i, kind));
    }
    if let Some(last) = table_end(lines, i) {
        return (RawKind::Table, last);
    }
    paragraph(lines, i)
}

/// Indented lines, and the blank lines between them.
fn indented_code_end(lines: &[Line], i: usize) -> usize {
    let mut last = i;
    for (k, line) in lines.iter().enumerate().skip(i + 1) {
        if is_blank(line.text) {
            continue;
        }
        if indent(line.text) < 4 {
            break;
        }
        last = k;
    }
    last
}

fn paragraph(lines: &[Line], i: usize) -> (RawKind, usize) {
    let mut last = i;
    for (k, line) in lines.iter().enumerate().skip(i + 1) {
        if is_blank(line.text) {
            break;
        }
        if let Some(level) = setext_level(line.text)
            && !is_footnote_definition(lines[i].text)
        {
            // Link definitions are no heading text: the line under them starts a block of its own.
            if (i..k).all(|j| is_link_definition(lines[j].text)) {
                break;
            }
            return (RawKind::Heading(level), k);
        }
        // A footnote definition holds blocks, as a list item does: any list item starts a list under it.
        let footnote = is_footnote_definition(lines[i].text);
        let starts = if footnote {
            starts_block(line.text)
        } else {
            interrupts_paragraph(line.text)
        };
        // A table starts under a paragraph's lines (its header is the line above the
        // delimiter row), but not under a footnote's: a container's lines continue it.
        if starts || (!footnote && table_end(lines, k).is_some()) {
            break;
        }
        last = k;
    }
    // A footnote's own paragraphs, indented under it, belong to it, and so do
    // the lines that follow such a paragraph without a blank line between
    // (they continue it, as a lazy line does) until a block starts.
    if is_footnote_definition(lines[i].text) {
        let mut k = last + 1;
        let mut open = false;
        while k < lines.len() {
            let text = lines[k].text;
            if is_blank(text) {
                open = false;
                k += 1;
            } else if indent(text) >= 4 {
                last = k;
                open = true;
                k += 1;
            } else if open && !starts_block(text) {
                last = k;
                k += 1;
            } else {
                break;
            }
        }
    }
    let kind = if last == i && embed_target(lines[i].text).is_some() {
        RawKind::Embed
    } else {
        RawKind::Paragraph
    };
    (kind, last)
}

/// A quote: its `>` lines, and lazy lines under paragraph text.
fn quote_end(lines: &[Line], i: usize) -> (RawKind, usize) {
    let kind = if callout_header(quote_inner_once(lines[i].text)).is_some() {
        RawKind::Callout
    } else {
        RawKind::Quote
    };
    let mut fence = None;
    let mut lazy = false;
    let mut last = i;
    for (k, line) in lines.iter().enumerate().skip(i) {
        if is_quote_start(line.text) {
            let inner = quote_inner_all(line.text);
            fence = match fence {
                Some(open) => (!fence_closes(inner, open)).then_some(open),
                None => fence_open(inner),
            };
            let t = trim_indent(inner);
            lazy = fence.is_none()
                && !is_blank(inner)
                && fence_open(inner).is_none()
                && atx_level(t).is_none()
                && !is_thematic(inner);
            last = k;
        } else if k > i && lazy && !is_blank(line.text) && !starts_block(line.text) {
            last = k;
        } else {
            break;
        }
    }
    (kind, last)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(body: &str) -> Vec<(RawKind, &str)> {
        scan(body)
            .into_iter()
            .map(|r| (r.kind, &body[r.start..r.end]))
            .collect()
    }

    #[test]
    fn cuts_a_body_into_blocks_with_their_exact_bytes() {
        let body = "# T\n\nOne\ntwo  \n\n\n- a\n- b\n\n```\ncode\n\nmore\n```\n\n---\n\n> q\nlazy\n\n[x]: y\n";
        let got = kinds(body);
        assert_eq!(
            got,
            [
                (RawKind::Heading(1), "# T"),
                (RawKind::Paragraph, "One\ntwo  "),
                (RawKind::List { todo: false }, "- a\n- b"),
                (RawKind::Code, "```\ncode\n\nmore\n```"),
                (RawKind::Divider, "---"),
                (RawKind::Quote, "> q\nlazy"),
                (RawKind::Paragraph, "[x]: y"),
            ]
        );
    }

    #[test]
    fn tells_the_kinds_apart() {
        let body = "Setext\n===\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n> [!note] Hi\n> body\n\n$$\nx\n$$\n\n![[Page]]\n\n<!-- c -->\n\n    indented\n\n- [ ] task\n";
        let got: Vec<RawKind> = kinds(body).into_iter().map(|(k, _)| k).collect();
        assert_eq!(
            got,
            [
                RawKind::Heading(1),
                RawKind::Table,
                RawKind::Callout,
                RawKind::Math,
                RawKind::Embed,
                RawKind::Html,
                RawKind::Code,
                RawKind::List { todo: true },
            ]
        );
    }

    #[test]
    fn a_paragraph_is_cut_by_what_interrupts_it_and_nothing_else() {
        let got = kinds("text\n- item\n");
        assert_eq!(got.len(), 2);
        // An ordered list not at 1 and indented text stay in the paragraph.
        let got = kinds("text\n2. two\n    more\n");
        assert_eq!(got.len(), 1, "{got:?}");
        // A table starts under the paragraph's last line.
        let got = kinds("Here is the table:\n| a | b |\n|---|---|\n| 1 | 2 |\n");
        let seen: Vec<RawKind> = got.iter().map(|(kind, _)| *kind).collect();
        assert_eq!(seen, [RawKind::Paragraph, RawKind::Table], "{got:?}");
        // A fence interrupts, and an unterminated one runs to the end.
        let got = kinds("text\n```\nnever closed\n\nstill code\n");
        assert_eq!(got.len(), 2);
        assert_eq!(got[1].1, "```\nnever closed\n\nstill code");
    }

    #[test]
    fn html_comments_and_details_are_blocks_of_their_own() {
        let got = kinds("<details>\n<summary>S</summary>\n\nBody\n\n</details>\n");
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].1, "<details>\n<summary>S</summary>");
        // Text right under a closing tag is part of its HTML block.
        let got = kinds("</details>\nnext\n");
        assert_eq!(got.len(), 1);
    }

    /// The cuts the editor's parser makes, found by comparing the two on many
    /// small documents.
    #[test]
    fn follows_the_editors_parser_where_the_rules_are_subtle() {
        let lens = |body: &str| kinds(body).len();
        // An empty item takes no lazy line: the text under it is a paragraph.
        assert_eq!(lens("-\nx | y\n2) x"), 2);
        // A list after a quote's paragraph starts a list, whatever its number or content.
        assert_eq!(lens("> q\n-"), 2);
        assert_eq!(lens("> q\n2. two"), 2);
        // After indented code a list item that could not interrupt a paragraph is text.
        assert_eq!(lens("    code\n2. two"), 2);
        assert_eq!(kinds("    code\n\n-\ntext")[1].0, RawKind::Paragraph);
        assert_eq!(
            kinds("    code\n\n1. one")[1].0,
            RawKind::List { todo: false }
        );
        // An unclosed fence in an item ends with the item, which the next item follows.
        assert_eq!(lens("- a\n  ```\n- b"), 1);
        // Link definitions are no heading text; nor is a footnote's first line.
        assert_eq!(kinds("[x]: u\n---")[1].0, RawKind::Divider);
        assert_eq!(lens("[^1]: note\n===\ntext"), 1);
        // An indented four columns is text under a list item, fence-like or not.
        assert_eq!(lens("   - nested\n    ```\ntext"), 1);
        // A footnote definition starts under a paragraph, and holds the indented paragraphs after it.
        assert_eq!(lens("text\n[^1]: note\n\n    indented"), 2);
        // Any list item ends a table, an empty one too.
        assert_eq!(lens("| a | b |\n|---|---|\n-\n"), 2);
        // A line under a footnote's indented paragraph continues it, until a block starts.
        assert_eq!(lens("[^1]: f\n\n    p2\nPlain\nmore\n- item"), 2);
        assert_eq!(lens("[^1]: f\n\n    p2\n\nPlain"), 2);
        // An indented line ends a table: the editor's parser reads it as code.
        let got = kinds("a | b\n--|--\n1 | 2\n    code\n\n\t- tab");
        let seen: Vec<RawKind> = got.iter().map(|(kind, _)| *kind).collect();
        assert_eq!(seen, [RawKind::Table, RawKind::Code], "{got:?}");
        // A line with only a form feed or a vertical tab is text, not a gap.
        assert_eq!(lens("a\n\x0c\nb"), 1);
        assert_eq!(lens("a\n\x0b\nb"), 1);
        assert_eq!(lens("a\n \t \nb"), 2);
    }

    #[test]
    fn a_footnote_keeps_its_indented_paragraphs() {
        let body = "[^1]: first\n\n    second paragraph\n\n    third\n\nAfter\n";
        let got = kinds(body);
        assert_eq!(got.len(), 2, "{got:?}");
        assert_eq!(got[0].1, "[^1]: first\n\n    second paragraph\n\n    third");
    }
}
