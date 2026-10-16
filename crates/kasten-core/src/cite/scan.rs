//! Finding Pandoc-style citations in a page: `[@key]`, `[@key, p. 4]`,
//! `[see @a; @b]`, `[-@key]`. A citation is inside square brackets, and an `@`
//! begins one only after the bracket, a space, a `;` or a `-` that itself
//! follows one of those, so an address (`a@b.com`, `https://x.org/@user`) is
//! not one. Code (fences and inline spans), `[[wiki links]]`, `[text](links)`,
//! `[text][references]`, escaped brackets and the page's frontmatter are left
//! out, as the index leaves them out of its links.

use std::ops::Range;

use crate::extract::fence_after;
use crate::frontmatter::split;

/// One citation of a key: where the key is written, without its `@`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cite {
    pub key: Range<usize>,
}

/// The longest stretch inside one pair of brackets that is looked at.
const LONGEST_GROUP: usize = 2_000;

/// A character a key is made of; punctuation is part of a key only inside it.
fn key_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn inner_punctuation(c: char) -> bool {
    matches!(
        c,
        ':' | '.' | '#' | '$' | '%' | '&' | '-' | '+' | '?' | '<' | '>' | '~' | '/'
    )
}

/// The end of the key that starts at byte `at` of `group`, if one does.
fn key_end(group: &str, at: usize) -> Option<usize> {
    let mut chars = group[at..].char_indices().peekable();
    let (_, first) = chars.next()?;
    if !key_char(first) {
        return None;
    }
    let mut end = at + first.len_utf8();
    while let Some((i, c)) = chars.next() {
        let here = at + i;
        if key_char(c) {
            end = here + c.len_utf8();
        } else if inner_punctuation(c) && chars.peek().is_some_and(|(_, next)| key_char(*next)) {
            // Internal punctuation is part of the key only when a key character follows.
        } else {
            break;
        }
    }
    Some(end)
}

/// Byte ranges of the inline code spans of `line`, backticks included.
fn code_spans(line: &str) -> Vec<Range<usize>> {
    let bytes = line.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' || (i > 0 && bytes[i - 1] == b'\\') {
            i += 1;
            continue;
        }
        let run = bytes[i..].iter().take_while(|&&b| b == b'`').count();
        let mut j = i + run;
        let mut end = None;
        while j < bytes.len() {
            if bytes[j] == b'`' {
                let close = bytes[j..].iter().take_while(|&&b| b == b'`').count();
                if close == run {
                    end = Some(j + close);
                    break;
                }
                j += close;
            } else {
                j += 1;
            }
        }
        match end {
            Some(end) => {
                spans.push(i..end);
                i = end;
            }
            None => i += run,
        }
    }
    spans
}

fn in_code(code: &[Range<usize>], at: usize) -> bool {
    code.iter().any(|span| span.contains(&at))
}

/// The `]` that closes the `[` at `open`, with brackets inside balanced.
fn closing(line: &str, open: usize, code: &[Range<usize>]) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut depth = 0usize;
    let mut i = open;
    while i < bytes.len() && i - open <= LONGEST_GROUP {
        match bytes[i] {
            b'\\' => i += 1,
            b'`' if in_code(code, i) => {
                // Skip the code span as a whole.
                if let Some(span) = code.iter().find(|s| s.contains(&i)) {
                    i = span.end;
                    continue;
                }
            }
            b'[' => depth += 1,
            b']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn in_line(line: &str, base: usize, out: &mut Vec<Cite>) {
    let bytes = line.as_bytes();
    let code = code_spans(line);
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'[' || in_code(&code, i) || (i > 0 && bytes[i - 1] == b'\\') {
            i += 1;
            continue;
        }
        if bytes.get(i + 1) == Some(&b'[') {
            // A wiki link: skip to its end.
            i = line[i + 2..]
                .find("]]")
                .map_or(bytes.len(), |end| i + 2 + end + 2);
            continue;
        }
        let Some(close) = closing(line, i, &code) else {
            i += 1;
            continue;
        };
        // A link `[text](target)`, a reference link `[text][ref]` or a definition `[ref]:`.
        if matches!(bytes.get(close + 1), Some(b'(' | b'[' | b':')) {
            i = close + 1;
            continue;
        }
        let group = &line[i + 1..close];
        let mut j = 0;
        while let Some(found) = group[j..].find('@') {
            let at = j + found;
            j = at + 1;
            if in_code(&code, i + 1 + at) {
                continue;
            }
            let before = group[..at].chars().next_back();
            let after_dash = before == Some('-') && {
                let earlier = group[..at - 1].chars().next_back();
                earlier.is_none_or(|c| c == ' ' || c == ';')
            };
            if !(before.is_none_or(|c| c == ' ' || c == ';') || after_dash) {
                continue;
            }
            if let Some(end) = key_end(group, at + 1) {
                let start = base + i + 1 + at + 1;
                out.push(Cite {
                    key: start..start + (end - (at + 1)),
                });
                j = end;
            }
        }
        i = close + 1;
    }
}

/// The citations in a page's text, in order, outside its frontmatter and code.
/// The ranges are bytes of `text`.
pub fn citations(text: &str) -> Vec<Cite> {
    let mut out = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut offset = split(text).prefix.len();
    for raw in text[offset..].split_inclusive('\n') {
        let start = offset;
        offset += raw.len();
        let line = raw.trim_end_matches('\n').trim_end_matches('\r');
        let (after, marker) = fence_after(fence, line);
        fence = after;
        if !marker && fence.is_none() && line.contains('@') && line.contains('[') {
            in_line(line, start, &mut out);
        }
    }
    out
}
