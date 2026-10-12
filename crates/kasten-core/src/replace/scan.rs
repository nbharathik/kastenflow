//! Which stretches of a page's Markdown a find may match, line by line:
//! prose, code (matched, and written into raw), text between HTML tags,
//! and what stays untouched because changing it would break the page: the
//! target of a `[[link]]` (alias included), a link's `(address)`,
//! `<autolinks>` and the tags themselves, bare web addresses, reference
//! definitions and comments.

use std::ops::Range;

use crate::extract::fence_after;

/// How the text of a stretch is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Ctx {
    /// Markdown: marks in a replacement are escaped.
    Prose,
    /// Inside an HTML block, such as `<summary>` text: tags and entities
    /// are escaped.
    Html,
    /// A code span: raw.
    Inline,
    /// A fenced code block or a `$$` block: raw.
    Block,
}

/// A stretch of a line (byte offsets) a match may lie in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Region {
    pub range: Range<usize>,
    pub ctx: Ctx,
}

/// HTML block tags (CommonMark's list): a line starting with one starts a
/// block that reads as HTML up to the next blank line.
const BLOCK_TAGS: &str = "address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul";

/// What carries over from one line to the next.
#[derive(Debug, Default)]
pub(super) struct Scanner {
    fence: Option<(char, usize)>,
    math: bool,
    comment: bool,
    html_block: bool,
}

fn whole(line: &str, ctx: Ctx) -> Vec<Region> {
    if line.is_empty() {
        Vec::new()
    } else {
        vec![Region {
            range: 0..line.len(),
            ctx,
        }]
    }
}

impl Scanner {
    /// The stretches of `line` (without its line break) a match may lie in,
    /// in order; reading the line moves the scanner on to the next.
    pub(super) fn regions(&mut self, line: &str) -> Vec<Region> {
        let (fence, marker) = fence_after(self.fence, line);
        self.fence = fence;
        if marker {
            return Vec::new();
        }
        if self.fence.is_some() {
            return whole(line, Ctx::Block);
        }
        let trimmed = line.trim();
        let math_line = self.math || trimmed.starts_with("$$");
        if trimmed == "$$" {
            self.math = !self.math;
            return Vec::new();
        } else if trimmed.starts_with("$$") && !(trimmed.len() > 2 && trimmed.ends_with("$$")) {
            self.math = true;
        } else if self.math && trimmed.ends_with("$$") {
            self.math = false;
        }
        if math_line {
            return whole(line, Ctx::Block);
        }
        let mut blocked: Vec<Range<usize>> = Vec::new();
        if self.comment {
            match line.find("-->") {
                Some(end) => {
                    blocked.push(0..end + 3);
                    self.comment = false;
                }
                None => return Vec::new(),
            }
        }
        if trimmed.is_empty() {
            self.html_block = false;
            return Vec::new();
        }
        if !self.html_block && starts_block_tag(line) {
            self.html_block = true;
        }
        if !self.html_block && is_definition(line) {
            return Vec::new();
        }
        let spans = if self.html_block {
            Vec::new()
        } else {
            code_spans(line)
        };
        let masked = mask(line, &spans);
        blocked.extend(protected(&masked, &mut self.comment));
        let mut code = Vec::new();
        for (full, content) in spans {
            // A span inside a protected stretch is part of it; any other is
            // code, matched apart from its backticks.
            let inside = blocked
                .iter()
                .any(|b| b.start < full.end && full.start < b.end);
            blocked.push(full);
            if !inside && !content.is_empty() {
                code.push(content);
            }
        }
        let prose = if self.html_block {
            Ctx::Html
        } else {
            Ctx::Prose
        };
        let mut out: Vec<Region> = gaps(line.len(), blocked)
            .into_iter()
            .map(|range| Region { range, ctx: prose })
            .chain(code.into_iter().map(|range| Region {
                range,
                ctx: Ctx::Inline,
            }))
            .collect();
        out.sort_by_key(|r| r.range.start);
        out
    }
}

/// The stretches of `0..len` outside `blocked`, which may overlap.
fn gaps(len: usize, mut blocked: Vec<Range<usize>>) -> Vec<Range<usize>> {
    blocked.sort_by_key(|r| r.start);
    let mut out = Vec::new();
    let mut at = 0;
    for range in blocked {
        if range.start > at {
            out.push(at..range.start);
        }
        at = at.max(range.end);
    }
    if at < len {
        out.push(at..len);
    }
    out
}

/// Whether the line opens an HTML block.
fn starts_block_tag(line: &str) -> bool {
    let Some(rest) = line.trim_start_matches(' ').strip_prefix('<') else {
        return false;
    };
    let rest = rest.strip_prefix('/').unwrap_or(rest);
    let name: String = rest
        .chars()
        .take_while(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_lowercase();
    BLOCK_TAGS.split(' ').any(|tag| tag == name)
        && rest[name.len()..]
            .chars()
            .next()
            .is_none_or(|c| c.is_whitespace() || c == '>' || c == '/')
}

/// A link reference definition, `[label]: address`, which is not a
/// footnote: the whole line is the link's.
fn is_definition(line: &str) -> bool {
    let Some(rest) = line.trim_start_matches(' ').strip_prefix('[') else {
        return false;
    };
    rest.find("]:")
        .is_some_and(|end| end > 0 && !rest.starts_with('^') && !rest[..end].contains('['))
}

/// Code spans of a line: the whole span with its backticks, and what is
/// between them. A run of backticks closes a span only if it is as long as
/// the one that opened it; a backslash makes the next character plain.
fn code_spans(line: &str) -> Vec<(Range<usize>, Range<usize>)> {
    let b = line.as_bytes();
    let run = |from: usize| b[from..].iter().take_while(|c| **c == b'`').count();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'`' => {
                let start = i;
                let n = run(i);
                i += n;
                let mut j = i;
                let mut close = None;
                while j < b.len() {
                    if b[j] == b'`' {
                        let m = run(j);
                        if m == n {
                            close = Some(j);
                            break;
                        }
                        j += m;
                    } else {
                        j += 1;
                    }
                }
                if let Some(close) = close {
                    out.push((start..close + n, i..close));
                    i = close + n;
                }
            }
            _ => i += 1,
        }
    }
    out
}

/// `line` with every byte of its code spans blanked, as long as it was.
fn mask(line: &str, spans: &[(Range<usize>, Range<usize>)]) -> String {
    let mut bytes = line.as_bytes().to_vec();
    for (full, _) in spans {
        bytes[full.clone()].fill(b' ');
    }
    // Only whole characters were blanked.
    String::from_utf8(bytes).unwrap_or_else(|_| line.to_owned())
}

/// The end of a link's `(address "title")`: the `)` that closes the one
/// before `from`. A title in quotes may hold parentheses.
fn paren_end(b: &[u8], from: usize) -> Option<usize> {
    let mut depth = 1;
    let mut quote: Option<u8> = None;
    let mut i = from;
    while i < b.len() {
        let c = b[i];
        match quote {
            Some(q) => {
                if c == q {
                    quote = None;
                }
            }
            None => match c {
                b'\\' => i += 1,
                b'"' | b'\'' if i > from && b[i - 1].is_ascii_whitespace() => quote = Some(c),
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            },
        }
        i += 1;
    }
    None
}

/// The `>` that closes the tag whose `<` comes before `from`; one inside
/// quotes does not.
fn tag_end(b: &[u8], from: usize) -> Option<usize> {
    let mut quote: Option<u8> = None;
    for (at, &c) in b.iter().enumerate().skip(from) {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, b'"' | b'\'') => quote = Some(c),
            (None, b'>') => return Some(at),
            _ => {}
        }
    }
    None
}

/// What a find must leave alone in a line (code spans blanked): see the
/// top of this file. An opened comment that goes on in the next lines
/// sets `comment`.
fn protected(line: &str, comment: &mut bool) -> Vec<Range<usize>> {
    let b = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'[' if b.get(i + 1) == Some(&b'[') => {
                let found = line[i + 2..].find("]]").filter(|&p| {
                    let inner = &line[i + 2..i + 2 + p];
                    !inner.is_empty() && !inner.contains('[')
                });
                if let Some(p) = found {
                    let start = if i > 0 && b[i - 1] == b'!' { i - 1 } else { i };
                    out.push(start..i + 2 + p + 2);
                    i += 2 + p + 2;
                } else {
                    i += 1;
                }
            }
            b']' if b.get(i + 1) == Some(&b'(') => match paren_end(b, i + 2) {
                Some(end) => {
                    out.push(i..end + 1);
                    i = end + 1;
                }
                None => i += 1,
            },
            b']' if b.get(i + 1) == Some(&b'[') => match line[i + 2..].find(']') {
                Some(p) => {
                    out.push(i..i + 2 + p + 1);
                    i += 2 + p + 1;
                }
                None => i += 1,
            },
            b'<' if line[i..].starts_with("<!--") => match line[i + 4..].find("-->") {
                Some(p) => {
                    out.push(i..i + 4 + p + 3);
                    i += 4 + p + 3;
                }
                None => {
                    out.push(i..b.len());
                    *comment = true;
                    i = b.len();
                }
            },
            b'<' if b
                .get(i + 1)
                .is_some_and(|c| c.is_ascii_alphabetic() || matches!(*c, b'/' | b'!' | b'?')) =>
            {
                match tag_end(b, i + 1) {
                    Some(end) => {
                        out.push(i..end + 1);
                        i = end + 1;
                    }
                    None => i += 1,
                }
            }
            b'h' if (line[i..].starts_with("http://") || line[i..].starts_with("https://"))
                && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) =>
            {
                let mut end = i;
                while end < b.len()
                    && !b[end].is_ascii_whitespace()
                    && !matches!(b[end], b'<' | b'>')
                {
                    end += 1;
                }
                while end > i
                    && matches!(
                        b[end - 1],
                        b'.' | b',' | b';' | b':' | b'!' | b'?' | b'\'' | b'"'
                    )
                {
                    end -= 1;
                }
                out.push(i..end);
                i = end.max(i + 1);
            }
            _ => i += 1,
        }
    }
    out
}
