//! Find and replace in the Markdown of a page, as the text is written. The
//! search is on that text: a phrase broken by formatting, such as `foo
//! **bar**`, is not found as `foo bar`. A match never reaches into what
//! must stay as it is (the target of a `[[link]]` with its alias, a link's
//! `(address)`, `<autolinks>`, HTML tags, web addresses); text between
//! tags, such as `<summary>…</summary>`, and callout titles are matched.
//! A replacement is escaped for Markdown in prose and for HTML between
//! tags, and written as it is inside code.

mod escape;
mod scan;

use std::borrow::Cow;
use std::ops::Range;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use scan::{Ctx, Scanner};

/// The longest search text, in characters.
pub const MAX_QUERY_CHARS: usize = 200;
/// The longest replacement, in characters.
pub const MAX_WITH_CHARS: usize = 1_000;
/// Characters kept on each side of a match in a sample.
const AROUND: usize = 40;

/// What to look for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindSpec {
    pub query: String,
    /// Capitals must agree (otherwise `ärger` finds `Ärger`).
    #[serde(default)]
    pub match_case: bool,
    /// No letter, digit or underscore may stand beside the match.
    #[serde(default)]
    pub whole_word: bool,
}

impl FindSpec {
    /// A search for `query`, ignoring case, anywhere in a word.
    pub fn new(query: &str) -> FindSpec {
        FindSpec {
            query: query.to_owned(),
            match_case: false,
            whole_word: false,
        }
    }

    /// The search text is 1 to 200 characters of one line.
    pub fn check(&self) -> Result<()> {
        let chars = self.query.chars().count();
        if chars == 0 || chars > MAX_QUERY_CHARS {
            return Err(Error::Invalid(format!(
                "The text to find is 1 to {MAX_QUERY_CHARS} characters"
            )));
        }
        if self.query.chars().any(char::is_control) {
            return Err(Error::Invalid(
                "The text to find is one line, without tabs, line breaks or control characters"
                    .to_owned(),
            ));
        }
        Ok(())
    }
}

/// The replacement is at most 1,000 characters of one line.
pub fn check_with(with: &str) -> Result<()> {
    if with.chars().count() > MAX_WITH_CHARS {
        return Err(Error::Invalid(format!(
            "The replacement is at most {MAX_WITH_CHARS} characters"
        )));
    }
    if with.chars().any(char::is_control) {
        return Err(Error::Invalid(
            "The replacement is one line, without tabs, line breaks or control characters"
                .to_owned(),
        ));
    }
    Ok(())
}

/// A match with some of the line around it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSample {
    /// Line of the page's body, from 0.
    pub line: usize,
    /// Up to 40 characters before the match on its line.
    pub before: String,
    /// The matched text, as written.
    pub text: String,
    /// Up to 40 characters after it.
    pub after: String,
}

/// A match: where it lies in the body, and how the text there is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Found {
    pub start: usize,
    pub end: usize,
    /// Line of the body, from 0, and where that line starts.
    pub line: usize,
    pub line_start: usize,
    pub ctx: Ctx,
}

/// A letter, digit or underscore, or a mark that belongs to the letter before.
fn is_word(c: char) -> bool {
    c.is_alphanumeric()
        || c == '_'
        || matches!(c,
            '\u{300}'..='\u{36f}'
            | '\u{1ab0}'..='\u{1aff}'
            | '\u{1dc0}'..='\u{1dff}'
            | '\u{20d0}'..='\u{20ff}'
            | '\u{fe20}'..='\u{fe2f}'
            | '\u{200d}')
}

/// A character in its lower case, when that is one character.
fn fold(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(one), None) => one,
        _ => c,
    }
}

struct Needle {
    chars: Vec<char>,
    match_case: bool,
    whole_word: bool,
}

impl Needle {
    fn new(spec: &FindSpec) -> Needle {
        let chars = if spec.match_case {
            spec.query.chars().collect()
        } else {
            spec.query.chars().map(fold).collect()
        };
        Needle {
            chars,
            match_case: spec.match_case,
            whole_word: spec.whole_word,
        }
    }

    /// Matches inside `line[region]`, left to right, none overlapping. A word
    /// boundary looks at the whole line, not only the region.
    fn find_all(&self, line: &str, region: Range<usize>) -> Vec<Range<usize>> {
        let size = self.chars.len();
        let hay: Vec<(usize, char)> = line[region.clone()]
            .char_indices()
            .map(|(at, c)| (region.start + at, c))
            .collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i + size <= hay.len() {
            let same = self.chars.iter().enumerate().all(|(k, &want)| {
                let c = hay[i + k].1;
                if self.match_case {
                    c == want
                } else {
                    fold(c) == want
                }
            });
            if same {
                let start = hay[i].0;
                let end = hay.get(i + size).map_or(region.end, |next| next.0);
                let apart = !self.whole_word
                    || (!line[..start].chars().next_back().is_some_and(is_word)
                        && !line[end..].chars().next().is_some_and(is_word));
                if apart {
                    out.push(start..end);
                    i += size;
                    continue;
                }
            }
            i += 1;
        }
        out
    }
}

/// Every match in a page's body (the text under its frontmatter), in order.
pub(crate) fn find_in_body(body: &str, spec: &FindSpec) -> Vec<Found> {
    let needle = Needle::new(spec);
    if needle.chars.is_empty() {
        return Vec::new();
    }
    let mut scanner = Scanner::default();
    let mut out = Vec::new();
    let mut offset = 0;
    for (line, raw) in body.split_inclusive('\n').enumerate() {
        let content = raw
            .strip_suffix('\n')
            .map_or(raw, |text| text.strip_suffix('\r').unwrap_or(text));
        for region in scanner.regions(content) {
            for found in needle.find_all(content, region.range) {
                out.push(Found {
                    start: offset + found.start,
                    end: offset + found.end,
                    line,
                    line_start: offset,
                    ctx: region.ctx,
                });
            }
        }
        offset += raw.len();
    }
    out
}

/// Whether `title` holds the search text.
pub fn title_matches(title: &str, spec: &FindSpec) -> bool {
    let needle = Needle::new(spec);
    !needle.chars.is_empty() && !needle.find_all(title, 0..title.len()).is_empty()
}

/// The last `n` characters of `text`.
fn tail(text: &str, n: usize) -> String {
    let skip = text.chars().count().saturating_sub(n);
    text.chars().skip(skip).collect()
}

/// The first `n` characters of `text`.
fn head(text: &str, n: usize) -> String {
    text.chars().take(n).collect()
}

/// The first `limit` matches, each with its line around it.
pub(crate) fn samples_of(body: &str, found: &[Found], limit: usize) -> Vec<MatchSample> {
    found
        .iter()
        .take(limit)
        .map(|m| {
            let line_end = body[m.end..]
                .find(['\n', '\r'])
                .map_or(body.len(), |at| m.end + at);
            MatchSample {
                line: m.line,
                before: tail(&body[m.line_start..m.start], AROUND),
                text: body[m.start..m.end].to_owned(),
                after: head(&body[m.end..line_end], AROUND),
            }
        })
        .collect()
}

/// Whether only the start of a block precedes a match on its line: spaces,
/// quote marks and a list marker.
fn at_block_start(before: &str) -> bool {
    let mut rest = before.trim_start();
    while let Some(after) = rest.strip_prefix('>') {
        rest = after.trim_start();
    }
    let marker = rest.split_once(' ').map(|(first, _)| first);
    let listed = marker.is_some_and(|first| {
        matches!(first, "-" | "+" | "*")
            || first
                .strip_suffix(['.', ')'])
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    });
    if listed {
        rest = rest.split_once(' ').map_or("", |(_, tail)| tail);
    }
    rest.trim().is_empty()
}

/// `body` with every match replaced, and how many there were. Everything
/// else, line endings included, stays as it was.
pub(crate) fn replace_in_body(body: &str, spec: &FindSpec, with: &str) -> Result<(String, usize)> {
    spec.check()?;
    check_with(with)?;
    let found = find_in_body(body, spec);
    let mut out = String::with_capacity(body.len());
    let mut cursor = 0;
    for m in &found {
        let before = &body[m.line_start..m.start];
        let piece: Cow<str> = match m.ctx {
            Ctx::Prose => escape::prose(with, at_block_start(before)).into(),
            Ctx::Html => escape::html(with).into(),
            Ctx::Inline if with.contains('`') => {
                return Err(Error::Invalid(
                    "A replacement with a backtick would end a code span early, so nothing was replaced"
                        .to_owned(),
                ));
            }
            Ctx::Block
                if before.trim().is_empty()
                    && (with.trim_start().starts_with("```")
                        || with.trim_start().starts_with("~~~")) =>
            {
                return Err(Error::Invalid(
                    "A replacement that starts with a code fence would end a code block, so nothing was replaced"
                        .to_owned(),
                ));
            }
            Ctx::Inline | Ctx::Block => with.into(),
        };
        out.push_str(&body[cursor..m.start]);
        out.push_str(&piece);
        cursor = m.end;
    }
    out.push_str(&body[cursor..]);
    Ok((out, found.len()))
}

#[cfg(test)]
mod tests;
