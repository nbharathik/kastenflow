//! Citing a Reference in a LaTeX file: where `\cite{key}` goes (the end of the
//! paragraph that holds a piece of text, or the end of the file), what is
//! written there (the app's rule for its "Insert citation": a new command, or
//! the key added to the citation the place is inside), and the `.bib` entry the
//! document keeps for the Reference, written so that no title or key can
//! break out of it.

use std::collections::BTreeMap;

use super::append::{places, with_crlf};
use crate::bib::style;
use crate::error::{Error, Result};

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// What citing made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cited {
    /// The whole file with the citation in it.
    pub text: String,
    /// Where the citation was put (a byte offset).
    pub at: usize,
    /// What was put there.
    pub added: String,
}

/// Where a line's code ends: before its first `%` that is not escaped.
fn code_end(line: &str) -> usize {
    let mut escaped = false;
    for (at, c) in line.char_indices() {
        match c {
            '\\' => escaped = !escaped,
            '%' if !escaped => return at,
            _ => escaped = false,
        }
    }
    line.len()
}

/// Whether a line cannot continue the paragraph above it: a blank line, or one
/// that begins a block (an environment, a heading, a list item, display maths).
fn ends_paragraph(line: &str) -> bool {
    let line = line.trim();
    line.is_empty()
        || [
            "\\begin{",
            "\\end{",
            "\\item",
            "\\[",
            "$$",
            "\\chapter",
            "\\section",
            "\\subsection",
            "\\subsubsection",
            "\\paragraph",
        ]
        .iter()
        .any(|start| line.starts_with(start))
}

/// The start of the last line that begins `\end{document}`, else the end of the text.
fn end_limit(text: &str) -> usize {
    let mut offset = 0;
    let mut found = text.len();
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with("\\end{document}") {
            found = offset;
        }
        offset += line.len();
    }
    found
}

/// The last place before `limit` (and not before `lower`) where a line of code
/// ends: after its last non-blank character and before any comment. Lines that
/// hold only a comment or nothing are passed over.
fn code_end_before(text: &str, limit: usize, lower: usize) -> Option<usize> {
    let mut end = limit;
    while end > lower {
        let start = text[..end].rfind('\n').map_or(0, |i| i + 1).max(lower);
        let line = &text[start..end];
        let code = line[..code_end(line)].trim_end();
        if !code.trim().is_empty() {
            return Some(start + code.len());
        }
        if start <= lower {
            break;
        }
        end = start - 1;
    }
    None
}

/// Where the paragraph that holds the one `marker` ends: the start of its line,
/// and the end of its last line.
fn paragraph_of(text: &str, marker: &str, name: &str) -> Result<(usize, usize)> {
    if marker.trim().is_empty() {
        return Err(invalid(
            "at is empty: give a piece of the paragraph to cite at the end of, exactly as it is in the file, or leave it out to cite at the end of the file",
        ));
    }
    let mut wanted = marker.to_owned();
    let mut found = places(text, &wanted);
    // A marker copied from a file with Windows line breaks may have been sent with plain ones.
    if found.0.is_none() && text.contains("\r\n") {
        wanted = with_crlf(marker);
        found = places(text, &wanted);
    }
    let Some(start) = found.0 else {
        return Err(invalid(format!(
            "The text to cite at is not in {name}. Read the file again and copy the text exactly, spaces and line breaks included"
        )));
    };
    if found.1 > 1 {
        return Err(invalid(format!(
            "The text to cite at is in {name} {} times. Add some of the lines around it so it matches once",
            found.1
        )));
    }
    let end = start + wanted.len();
    let in_comment = |at: usize| {
        let from = text[..at].rfind('\n').map_or(0, |i| i + 1);
        let line_end = text[from..].find('\n').map_or(text.len(), |i| from + i);
        code_end(&text[from..line_end]) < at - from
    };
    // The last character of the text, so that a text ending in a line break
    // stays on its own line.
    let anchor = text[..end].trim_end_matches(['\n', '\r']).len();
    if in_comment(start) || in_comment(anchor) {
        return Err(invalid(format!(
            "The text to cite at is in a comment in {name}, which TeX does not read"
        )));
    }
    let line_start = text[..anchor].rfind('\n').map_or(0, |i| i + 1);
    let mut limit = text[anchor..].find('\n').map_or(text.len(), |i| anchor + i);
    while limit < text.len() {
        let next = limit + 1;
        let next_end = text[next..].find('\n').map_or(text.len(), |i| next + i);
        if ends_paragraph(&text[next..next_end]) {
            break;
        }
        limit = next_end;
    }
    Ok((line_start, limit))
}

/// Whether `prefix` ends in a citation command: `\cite`, `\citep*`, `\parencite[p. 3]`...
fn cite_command_before(prefix: &str) -> bool {
    let mut rest = prefix;
    for _ in 0..2 {
        if let Some(inner) = rest.strip_suffix(']')
            && let Some(open) = inner.rfind('[')
            && !inner[open + 1..].contains(']')
        {
            rest = &inner[..open];
        }
    }
    let rest = rest.strip_suffix('*').unwrap_or(rest);
    let letters = rest
        .bytes()
        .rev()
        .take_while(u8::is_ascii_alphabetic)
        .count();
    let (head, name) = rest.split_at(rest.len() - letters);
    head.ends_with('\\') && name.contains("cite")
}

/// What to write for `key` at a place with `before` and `after` on its line:
/// `\cite{key}`, or, when the place is inside the braces of a citation command,
/// just the key with the commas the list needs, so a second pick extends it.
pub fn citation_text(before: &str, after: &str, key: &str) -> String {
    let open = before
        .rfind(['{', '}'])
        .filter(|at| before[*at..].starts_with('{') && cite_command_before(&before[..*at]));
    let rest_len = after.find(['{', '}']);
    let closes = rest_len.is_some_and(|at| after[at..].starts_with('}'));
    let (Some(open), true) = (open, closes) else {
        return format!("\\cite{{{key}}}");
    };
    let arg = &before[open + 1..];
    let rest = &after[..rest_len.unwrap_or(0)];
    let comma_before = !arg.trim().is_empty() && !arg.trim_end().ends_with(',');
    let comma_after = !rest.trim().is_empty() && !rest.trim_start().starts_with(',');
    format!(
        "{}{key}{}",
        if comma_before { "," } else { "" },
        if comma_after { "," } else { "" }
    )
}

/// `text` with a citation of `key` at the end of the paragraph that holds the one
/// `at`, or at the end of the file (before `\end{document}` when it has one)
/// when `at` is left out. Only the citation is added: every other byte stays.
/// A comment at the end of the line is left after it.
pub fn cite_into(text: &str, at: Option<&str>, key: &str, name: &str) -> Result<Cited> {
    let key = style::check_key(key)?;
    let (lower, limit) = match at {
        Some(marker) => paragraph_of(text, marker, name)?,
        None => (0, end_limit(text)),
    };
    let pos = code_end_before(text, limit, lower).ok_or_else(|| {
        invalid(format!(
            "There is no text in {name} to put the citation after"
        ))
    })?;
    let line_start = text[..pos].rfind('\n').map_or(0, |i| i + 1);
    let line_end = text[pos..].find('\n').map_or(text.len(), |i| pos + i);
    let mut added = citation_text(
        &text[line_start..pos],
        text[pos..line_end].trim_end_matches('\r'),
        &key,
    );
    // A new citation stands apart from the word before it.
    let spaced = text[..pos]
        .chars()
        .next_back()
        .is_some_and(|c| !c.is_whitespace() && !matches!(c, '~' | '(' | '[' | '{'));
    if added.starts_with('\\') && spaced {
        added.insert(0, ' ');
    }
    let mut out = String::with_capacity(text.len() + added.len());
    out.push_str(&text[..pos]);
    out.push_str(&added);
    out.push_str(&text[pos..]);
    Ok(Cited {
        text: out,
        at: pos,
        added,
    })
}

/// Whether the `.bib` text has an entry with this key (BibTeX ignores case).
pub fn bib_has_key(bib: &str, key: &str) -> bool {
    slides_bib::read(bib)
        .iter()
        .any(|entry| entry.key.eq_ignore_ascii_case(key))
}

/// Whether the braces of `value` are in pairs when every one is counted, as
/// BibTeX and the scanner that reads the file count them (a backslash does not
/// hide a brace from either). A quoted value can hold a stray one.
fn braces_pair_up(value: &str) -> bool {
    let mut depth = 0usize;
    for c in value.chars() {
        match c {
            '{' => depth += 1,
            '}' => match depth.checked_sub(1) {
                Some(less) => depth = less,
                None => return false,
            },
            _ => {}
        }
    }
    depth == 0
}

fn brace_word(brace: char) -> &'static str {
    if brace == '{' {
        "\\textbraceleft{}"
    } else {
        "\\textbraceright{}"
    }
}

/// A field's value that can sit between braces: on one line, without control
/// characters, with its braces in pairs however they are counted. When they
/// are not, each brace becomes `\textbraceleft{}` or `\textbraceright{}`, and a
/// backslash that would swallow the closing brace is dropped. Empty when it
/// cannot be made safe.
fn safe_value(value: &str) -> String {
    let flat = value
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let flat: String = flat
        .chars()
        .filter(|c| !c.is_control() || *c == '\t')
        .collect();
    if let Ok(fine) = style::check_value("field", &flat)
        && braces_pair_up(&fine)
    {
        return fine;
    }
    let mut out = String::with_capacity(flat.len() + 16);
    let mut chars = flat.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, chars.peek().copied()) {
            ('\\', Some(brace @ ('{' | '}'))) => {
                chars.next();
                out.push_str(brace_word(brace));
            }
            ('\\', Some(next)) => {
                chars.next();
                out.push('\\');
                out.push(next);
            }
            ('\\', None) => {}
            ('{' | '}', _) => out.push_str(brace_word(c)),
            (other, _) => out.push(other),
        }
    }
    style::check_value("field", &out).unwrap_or_default()
}

/// A `.bib` entry for a Reference, in house style. The key must be a plain one
/// (it is written into `\cite{}` too); a field with a name that cannot be one
/// is left out; a type that cannot be one becomes `misc`.
pub fn bib_entry(
    kind: &str,
    key: &str,
    fields: &BTreeMap<String, String>,
    eol: &str,
) -> Result<String> {
    let kind = style::check_type(kind).unwrap_or_else(|_| "misc".to_owned());
    let key = style::check_key(key)?;
    let mut clean = BTreeMap::new();
    for (name, value) in fields {
        let Ok(name) = style::check_name(name) else {
            continue;
        };
        let value = safe_value(value);
        if !value.is_empty() {
            clean.insert(name, value);
        }
    }
    Ok(style::render_entry(&kind, &key, &clean, eol))
}

#[cfg(test)]
mod tests;
