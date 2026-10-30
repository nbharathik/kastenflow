//! The text inside a block: emphasis, code spans, math and the rest, written
//! as LaTeX (links, citations and images are in `links`). What is not
//! understood is written as plain text; a note says so (`notes` become
//! `% TODO` comment lines after the block). The work done is bounded by
//! `budget`, so no input takes quadratic time, and nesting by `MAX_DEPTH`.

use super::escape::{escape_text, math_is_safe, push_escaped};
use super::spans::{code_end, find_closer, find_pair, run_of};

/// How deep emphasis and links may nest before the rest is plain text.
const MAX_DEPTH: usize = 10;

/// What a bounded look-ahead (to the end of a link, a tag, a wiki link) costs of the budget.
const LOOK_AHEAD: usize = 64;

pub(super) const MATH_NOTE: &str = "% TODO: math could not be converted and is shown as text";
pub(super) const FOOTNOTE_NOTE: &str = "% TODO: footnotes are shown as superscript numbers";

#[derive(Default)]
pub(super) struct Inline {
    /// Whole comment lines for after the block, each once.
    pub notes: Vec<String>,
    /// Citation keys used, each once, in order.
    pub cites: Vec<String>,
    /// A link was written with `\href`.
    pub links: bool,
    pub(super) budget: usize,
}

impl Inline {
    pub fn note(&mut self, line: impl Into<String>) {
        let line = line.into();
        if !self.notes.contains(&line) && self.notes.len() < 50 {
            self.notes.push(line);
        }
    }

    /// Pays for a look-ahead that is bounded but not free; false when the work
    /// allowed for this text is used up.
    pub(super) fn afford(&mut self) -> bool {
        if self.budget < LOOK_AHEAD {
            self.budget = 0;
            return false;
        }
        self.budget -= LOOK_AHEAD;
        true
    }

    /// `text` (the lines of one paragraph or cell) as LaTeX.
    pub fn convert(&mut self, text: &str) -> String {
        let chars: Vec<char> = text.chars().collect();
        self.budget = chars.len() * 8 + 2_000;
        let mut out = self.run(&chars, 0);
        loop {
            let trimmed = out.trim_end();
            match trimmed.strip_suffix("\\\\") {
                Some(rest) => out = rest.to_owned(),
                None => {
                    out.truncate(trimmed.len());
                    break;
                }
            }
        }
        out.trim_start().to_owned()
    }

    pub(super) fn run(&mut self, c: &[char], depth: usize) -> String {
        if depth > MAX_DEPTH {
            return c.iter().fold(String::new(), |mut s, &x| {
                push_escaped(&mut s, x);
                s
            });
        }
        let mut out = String::with_capacity(c.len() + 16);
        let mut i = 0;
        while i < c.len() {
            match c[i] {
                '\\' => i = self.backslash(c, i, &mut out),
                '`' => i = self.code(c, i, &mut out),
                '$' => {
                    let (text, next) = self.dollar(c, i);
                    out.push_str(&text);
                    i = next;
                }
                '*' | '_' => i = self.emphasis(c, i, depth, &mut out),
                '~' => i = self.strike(c, i, depth, &mut out),
                '[' => {
                    let (text, next) = self.bracket(c, i, depth);
                    out.push_str(&text);
                    i = next;
                }
                '!' if c.get(i + 1) == Some(&'[') => i = self.image(c, i, &mut out),
                '<' => i = self.angle(c, i, &mut out),
                '&' => i = entity(c, i, &mut out),
                '\n' => i = newline(c, i, &mut out),
                x => {
                    push_escaped(&mut out, x);
                    i += 1;
                }
            }
        }
        out
    }

    fn backslash(&mut self, c: &[char], i: usize, out: &mut String) -> usize {
        match c.get(i + 1) {
            Some('\n') => {
                let mut next = i + 2;
                while matches!(c.get(next), Some(' ' | '\t')) {
                    next += 1;
                }
                hard_break(out, c.get(next).copied());
                out.push('\n');
                next
            }
            Some(&p) if p.is_ascii_punctuation() => {
                push_escaped(out, p);
                i + 2
            }
            _ => {
                push_escaped(out, '\\');
                i + 1
            }
        }
    }

    fn code(&mut self, c: &[char], i: usize, out: &mut String) -> usize {
        let k = run_of(c, i, '`');
        match code_end(c, i, k, &mut self.budget) {
            Some(after) => {
                let inner: String = c[i + k..after - k]
                    .iter()
                    .map(|&x| if x == '\n' { ' ' } else { x })
                    .collect();
                let both = inner.starts_with(' ') && inner.ends_with(' ') && inner.trim() != "";
                let inner = if both {
                    &inner[1..inner.len() - 1]
                } else {
                    &inner
                };
                out.push_str("\\texttt{");
                out.push_str(&escape_text(inner));
                out.push('}');
                after
            }
            None => {
                out.push_str(&"`".repeat(k));
                i + k
            }
        }
    }

    /// A `$` at `i`: inline math, display math, or a dollar sign.
    fn dollar(&mut self, c: &[char], i: usize) -> (String, usize) {
        if c.get(i + 1) == Some(&'$') {
            if let Some(j) = find_pair(c, i + 2, '$', &mut self.budget) {
                let content: String = c[i + 2..j].iter().collect();
                if math_is_safe(&content) {
                    return (format!("\\[{}\\]", content.trim()), j + 2);
                }
                self.note(MATH_NOTE);
                return (escape_text(&c[i..j + 2].iter().collect::<String>()), j + 2);
            }
            return ("\\$\\$".to_owned(), i + 2);
        }
        let opens = c.get(i + 1).is_some_and(|x| !x.is_whitespace());
        if opens && let Some(j) = single_closer(c, i + 1, &mut self.budget) {
            let content: String = c[i + 1..j].iter().collect();
            if math_is_safe(&content) {
                return (format!("${content}$"), j + 1);
            }
            self.note(MATH_NOTE);
            return (escape_text(&c[i..=j].iter().collect::<String>()), j + 1);
        }
        ("\\$".to_owned(), i + 1)
    }

    fn emphasis(&mut self, c: &[char], i: usize, depth: usize, out: &mut String) -> usize {
        let ch = c[i];
        let r = run_of(c, i, ch);
        let literal = |out: &mut String| {
            for _ in 0..r {
                push_escaped(out, ch);
            }
            i + r
        };
        let prev = i.checked_sub(1).map(|p| c[p]);
        let after = c.get(i + r).copied();
        let can_open = after.is_some_and(|x| !x.is_whitespace())
            && (ch == '*' || !prev.is_some_and(char::is_alphanumeric));
        if !can_open || r > 3 || depth >= MAX_DEPTH {
            return literal(out);
        }
        match find_closer(c, i + r, ch, r, &mut self.budget) {
            Some(j) => {
                let inner = self.run(&c[i + r..j], depth + 1);
                match r {
                    1 => out.push_str(&format!("\\emph{{{inner}}}")),
                    2 => out.push_str(&format!("\\textbf{{{inner}}}")),
                    _ => out.push_str(&format!("\\textbf{{\\emph{{{inner}}}}}")),
                }
                j + r
            }
            None => literal(out),
        }
    }

    /// `~~struck~~`: the words stay, the line through them does not.
    fn strike(&mut self, c: &[char], i: usize, depth: usize, out: &mut String) -> usize {
        if c.get(i + 1) == Some(&'~') && depth < MAX_DEPTH {
            let opens = c.get(i + 2).is_some_and(|x| !x.is_whitespace());
            if opens && let Some(j) = find_pair(c, i + 2, '~', &mut self.budget) {
                let inner = self.run(&c[i + 2..j], depth + 1);
                out.push_str(&inner);
                return j + 2;
            }
        }
        push_escaped(out, '~');
        i + 1
    }
}

/// The closing `$` of an inline formula that starts at `from`.
fn single_closer(c: &[char], from: usize, budget: &mut usize) -> Option<usize> {
    let mut j = from;
    while j < c.len() {
        if *budget == 0 {
            return None;
        }
        *budget -= 1;
        match c[j] {
            '\\' => j += 1,
            '$' if j > from
                && !c[j - 1].is_whitespace()
                && !c.get(j + 1).is_some_and(char::is_ascii_digit) =>
            {
                return Some(j);
            }
            '$' if j > from => {}
            '$' => return None,
            _ => {}
        }
        j += 1;
    }
    None
}

/// `\\` for a hard line break; `{}` keeps a following `[` or `*` from reading as its options.
pub(super) fn hard_break(out: &mut String, next: Option<char>) {
    out.push_str("\\\\");
    if matches!(next, Some('[' | '*')) {
        out.push_str("{}");
    }
}

/// A line end: two spaces before it make a hard break.
fn newline(c: &[char], i: usize, out: &mut String) -> usize {
    let kept = out.trim_end_matches(' ').len();
    let hard = out.len() - kept >= 2;
    out.truncate(kept);
    let mut next = i + 1;
    while matches!(c.get(next), Some(' ' | '\t')) {
        next += 1;
    }
    if hard && next < c.len() {
        hard_break(out, c.get(next).copied());
    }
    out.push('\n');
    next
}

/// `&amp;` and its few relatives, or an ampersand.
fn entity(c: &[char], i: usize, out: &mut String) -> usize {
    let named = c[i + 1..].iter().take(10).position(|&x| x == ';');
    if let Some(len) = named {
        let name: String = c[i + 1..i + 1 + len].iter().collect();
        let decoded = match name.as_str() {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{a0}'),
            _ => name
                .strip_prefix('#')
                .and_then(|n| match n.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => n.parse().ok(),
                })
                .and_then(char::from_u32),
        };
        if let Some(x) = decoded {
            if x == '\u{a0}' {
                out.push('~');
            } else {
                push_escaped(out, x);
            }
            return i + len + 2;
        }
    }
    out.push_str("\\&");
    i + 1
}
