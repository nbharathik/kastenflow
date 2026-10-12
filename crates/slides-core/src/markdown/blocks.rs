//! Block Markdown to paragraphs: a line is a paragraph, a list item, a
//! heading or a quote, and a fence makes a paragraph of code per line. There
//! is no nesting and no lazy continuation; the one way to carry a paragraph
//! over a line break is a hard break.

use super::inline::{inline, push_merged};
use crate::model::{ListKind, Paragraph, Run};

/// The deepest list level; deeper indentation counts as this one.
pub(super) const MAX_LEVEL: usize = 5;

/// The paragraphs of `md`: one for each non-blank line (or hard-broken run of
/// lines), and one for each line of a fence. See the module for the dialect.
pub fn parse(md: &str) -> Vec<Paragraph> {
    let lines: Vec<&str> = md.lines().collect();
    let mut out = Vec::new();
    // The number each paragraph was written with, for those that are numbered.
    let mut typed: Vec<Option<u32>> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        i += 1;
        if let Some((ch, n)) = fence {
            if fence_closes(line, ch, n) {
                fence = None;
            } else {
                out.push(code_line(line));
                typed.push(None);
            }
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        if let Some(open) = fence_open(line) {
            fence = Some(open);
            continue;
        }
        let head = classify(line);
        let mut text = String::new();
        let mut current = head.content;
        loop {
            let (marked, whole, broke) = split_break(current);
            match lines.get(i) {
                Some(next) if broke && !next.trim().is_empty() => {
                    text.push_str(marked);
                    text.push('\n');
                    current = next.trim_start();
                    i += 1;
                }
                _ => {
                    text.push_str(whole);
                    break;
                }
            }
        }
        if let Some(made) = paragraph(&head, &text) {
            out.push(made);
            typed.push(head.number);
        }
    }
    // An item written with a number it would not have had by counting on is told where to begin.
    crate::list::reconcile(&mut out, &typed);
    out
}

/// What a line's start says about the paragraph, and the text after it.
struct Head<'a> {
    list: Option<ListKind>,
    level: u8,
    /// The number a numbered item was written with.
    number: Option<u32>,
    style: Option<&'static str>,
    /// `###` and deeper: body text that is bold.
    bold: bool,
    content: &'a str,
}

fn classify(line: &str) -> Head<'_> {
    let rest = line.trim_start();
    let indent: usize = line[..line.len() - rest.len()]
        .chars()
        .map(|c| if c == '\t' { 2 } else { 1 })
        .sum();
    let hashes = rest.bytes().take_while(|&b| b == b'#').count();
    let mut head = Head {
        list: None,
        level: 0,
        number: None,
        style: None,
        bold: false,
        content: rest,
    };
    if let Some((kind, content, number)) = list_marker(rest) {
        head.list = Some(kind);
        head.number = number;
        head.level = (indent / 2).min(MAX_LEVEL) as u8;
        head.content = content;
    } else if hashes > 0
        && let Some(content) = after(rest, hashes)
    {
        match hashes {
            1 => head.style = Some("title"),
            2 => head.style = Some("subtitle"),
            _ => head.bold = true,
        }
        head.content = content;
    } else if rest.starts_with('>')
        && let Some(content) = after(rest, 1)
    {
        head.style = Some("quote");
        head.content = content;
    }
    head
}

/// The text after a marker `len` bytes long, if a space or the end follows.
fn after(rest: &str, len: usize) -> Option<&str> {
    let tail = &rest[len..];
    (tail.is_empty() || tail.starts_with(char::is_whitespace)).then(|| tail.trim_start())
}

/// The kind of list a line starts, the text after the marker, and the number a numbered item is written with.
fn list_marker(rest: &str) -> Option<(ListKind, &str, Option<u32>)> {
    if rest.starts_with(['-', '*', '+']) {
        return after(rest, 1).map(|text| (ListKind::Bullet, text, None));
    }
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if (1..=9).contains(&digits) && matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) {
        let number = rest[..digits].parse::<u32>().ok().map(|n| n.max(1));
        return after(rest, digits + 1).map(|text| (ListKind::Number, text, number));
    }
    None
}

/// The paragraph for `text`, or none where there is nothing to show.
fn paragraph(head: &Head, text: &str) -> Option<Paragraph> {
    let mut runs = inline(text);
    if head.bold {
        let mut merged = Vec::new();
        for mut run in runs {
            run.bold = true;
            push_merged(&mut merged, run);
        }
        runs = merged;
    }
    if runs.is_empty() {
        // An empty list item or heading is kept; an empty line is not.
        if head.bold || (head.list.is_none() && head.style.is_none()) {
            return None;
        }
        runs.push(Run::plain(""));
    }
    Some(Paragraph {
        runs,
        list: head.list.clone(),
        level: (head.list.is_some() && head.level > 0).then_some(head.level),
        style: head.style.map(str::to_owned),
        ..Paragraph::plain("")
    })
}

fn code_line(line: &str) -> Paragraph {
    Paragraph {
        style: Some("code".to_owned()),
        ..Paragraph::plain(line)
    }
}

/// The line without its hard break, the line without its trailing spaces,
/// and whether it ended in a hard break: two spaces, or a backslash that is
/// not itself escaped.
fn split_break(line: &str) -> (&str, &str, bool) {
    let whole = line.trim_end();
    if line.ends_with("  ") {
        return (whole, whole, true);
    }
    let slashes = whole.chars().rev().take_while(|&c| c == '\\').count();
    if slashes % 2 == 1 {
        return (whole[..whole.len() - 1].trim_end(), whole, true);
    }
    (whole, whole, false)
}

/// A line opening a fence: its character and length. A backtick fence may
/// not have a backtick in its info string, so "```a```" is a code span.
pub(crate) fn fence_open(line: &str) -> Option<(char, usize)> {
    let t = line.trim_start();
    let ch = t.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let n = t.chars().take_while(|&c| c == ch).count();
    (n >= 3 && !(ch == '`' && t[n..].contains('`'))).then_some((ch, n))
}

/// Whether `line` closes a fence of `n` times `ch`.
pub(crate) fn fence_closes(line: &str, ch: char, n: usize) -> bool {
    let t = line.trim();
    t.chars().count() >= n && t.chars().all(|c| c == ch)
}
