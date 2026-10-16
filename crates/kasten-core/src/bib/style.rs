//! What may be written into the managed bibliography, and how: a type, a key,
//! field names and values are checked so that the file still reads as it did,
//! and a new entry is written in house style (two-space fields, braces round
//! every value, a trailing comma).

use std::collections::BTreeMap;

use crate::error::{Error, Result};

/// The order new fields are written in; fields not named here follow in alphabetical order.
pub const FIELD_ORDER: [&str; 18] = [
    "author",
    "editor",
    "title",
    "booktitle",
    "journal",
    "publisher",
    "school",
    "institution",
    "volume",
    "number",
    "pages",
    "year",
    "month",
    "doi",
    "eprint",
    "archiveprefix",
    "url",
    "note",
];

/// The longest key, in characters, and the longest value, in bytes.
pub const MOST_KEY: usize = 128;
const MOST_VALUE: usize = slides_bib::MOST_VALUE;

fn refuse(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// An entry type in lower case: letters and digits, not one of BibTeX's other `@` commands.
pub fn check_type(kind: &str) -> Result<String> {
    let kind = kind.trim().to_ascii_lowercase();
    if kind.is_empty() || kind.len() > 24 || !kind.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(refuse(
            "A type is a word such as article, inproceedings or book",
        ));
    }
    if matches!(kind.as_str(), "string" | "comment" | "preamble") {
        return Err(refuse(format!("{kind} is not a type of reference")));
    }
    Ok(kind)
}

/// A field name in lower case: a letter, then letters, digits, `_` and `-`.
pub fn check_name(name: &str) -> Result<String> {
    let name = name.trim().to_ascii_lowercase();
    let mut chars = name.chars();
    let fine = chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-'))
        && name.len() <= 40;
    if !fine {
        return Err(refuse(format!(
            "“{name}” cannot be a field name: use letters, digits, _ and -"
        )));
    }
    Ok(name)
}

/// A citation key for a new reference. The ones already in a file may be anything BibTeX
/// reads; a new one is plain enough to be written in a page as `[@key]` and in a deck.
pub fn check_key(key: &str) -> Result<String> {
    let key = key.trim();
    if key.is_empty() {
        return Err(refuse("A key is needed"));
    }
    if key.chars().count() > MOST_KEY {
        return Err(refuse(format!("A key is at most {MOST_KEY} characters")));
    }
    let edge = |c: char| c.is_alphanumeric() || c == '_';
    let inner = |c: char| {
        edge(c)
            || matches!(
                c,
                '-' | ':' | '.' | '/' | '+' | '?' | '<' | '>' | '~' | '&' | '$'
            )
    };
    let first = key.chars().next().is_some_and(edge);
    let last = key.chars().next_back().is_some_and(edge);
    if !(first && last && key.chars().all(inner)) {
        return Err(refuse(format!(
            "“{key}” cannot be a key: use letters, digits and _ - : . / + ? < > ~ & $, starting and ending with a letter, digit or _ (no spaces, commas, braces, quotes, backslashes, ( ) = @ % or #)"
        )));
    }
    Ok(key.to_owned())
}

/// A field's value on one line, with its braces in pairs. Gives the text to write
/// between a field's braces.
pub fn check_value(name: &str, value: &str) -> Result<String> {
    let one_line = value
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let value = one_line.trim();
    if value.len() > MOST_VALUE {
        return Err(refuse(format!("The {name} is longer than a field can be")));
    }
    if value.chars().any(|c| c.is_control() && c != '\t') {
        return Err(refuse(format!(
            "The {name} has a character a field cannot hold"
        )));
    }
    let mut depth = 0usize;
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if chars.next().is_none() {
                    return Err(refuse(format!(
                        "The {name} ends with a backslash, which would swallow the brace after it"
                    )));
                }
            }
            '{' => depth += 1,
            '}' => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| refuse(format!("The {name} has a }} without a {{ before it")))?;
            }
            _ => {}
        }
    }
    if depth != 0 {
        return Err(refuse(format!("The {name} has a {{ without a }} after it")));
    }
    Ok(value.to_owned())
}

/// Whether `value` has a `"` outside braces, which would end a quoted value.
pub fn has_open_quote(value: &str) -> bool {
    let mut depth = 0usize;
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            '"' if depth == 0 => return true,
            _ => {}
        }
    }
    false
}

/// The fields in the order they are written: the usual ones first, in their order, then the rest.
pub fn ordered(fields: &BTreeMap<String, String>) -> Vec<(&str, &str)> {
    let rank = |name: &str| {
        FIELD_ORDER
            .iter()
            .position(|known| *known == name)
            .unwrap_or(FIELD_ORDER.len())
    };
    let mut list: Vec<(&str, &str)> = fields
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();
    list.sort_by(|a, b| rank(a.0).cmp(&rank(b.0)).then_with(|| a.0.cmp(b.0)));
    list
}

/// A new entry in house style, ending with a line break. `fields` are already checked.
pub fn render_entry(kind: &str, key: &str, fields: &BTreeMap<String, String>, eol: &str) -> String {
    let mut out = format!("@{kind}{{{key},{eol}");
    for (name, value) in ordered(fields) {
        out.push_str(&format!("  {name} = {{{value}}},{eol}"));
    }
    out.push('}');
    out.push_str(eol);
    out
}

/// The line break a text uses: `\r\n` when it has one, else `\n`.
pub fn eol_of(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}
