//! Changing a `.bib` text by its spans: a value in place, a field added after
//! the last one or taken away, a key renamed, an entry replaced or added. Only
//! the bytes an edit means to change change; comments, `@string` macros, fields
//! it does not know, spacing and line endings stay, and every edit is checked
//! against a second scan of the new text before it is given back. How a field is
//! written into an entry is `layout`'s.

use std::collections::BTreeMap;

use slides_bib::{Kind, Span, expand, fields_of, macros, scan};

use super::layout::{Edit, insertion, removal, replacement};
use super::style::{check_name, check_value, eol_of};
use crate::error::{Error, Result};

fn refuse(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// The text with the edits made. They must not overlap.
fn apply(text: &str, mut edits: Vec<Edit>) -> Result<String> {
    edits.sort_by_key(|e| (e.range.start, e.range.end));
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    for edit in &edits {
        if edit.range.start < copied {
            return Err(refuse("Those changes overlap; make them one at a time"));
        }
        out.push_str(&text[copied..edit.range.start]);
        out.push_str(&edit.with);
        copied = edit.range.end;
    }
    out.push_str(&text[copied..]);
    Ok(out)
}

/// The first entry with this key.
pub fn find<'a>(text: &str, spans: &'a [Span], key: &str) -> Option<&'a Span> {
    spans
        .iter()
        .find(|s| s.kind == Kind::Entry && s.key_in(text) == Some(key))
}

fn missing(key: &str) -> Error {
    refuse(format!(
        "There is no reference with the key “{key}” in the managed file"
    ))
}

fn open_entry(text: &str, span: &Span) -> Error {
    refuse(format!(
        "The entry “{}” is not closed in the file; close it by hand first",
        span.key_in(text).unwrap_or_default()
    ))
}

/// The text of the entry with this key, as written.
pub fn entry_text(text: &str, key: &str) -> Option<String> {
    let spans = scan(text);
    find(text, &spans, key).map(|s| s.text(text).to_owned())
}

/// After an edit: the entry is still there and closed, nothing outside it moved, the
/// fields named have the values asked for, and the others have the ones they had.
fn verify(
    old: &str,
    new: &str,
    key: &str,
    changes: &BTreeMap<String, Option<String>>,
) -> Result<()> {
    let unsafe_edit = || {
        refuse(format!(
            "The change to “{key}” could not be made safely; edit the file by hand"
        ))
    };
    let (old_spans, new_spans) = (scan(old), scan(new));
    let (Some(before), Some(after)) = (find(old, &old_spans, key), find(new, &new_spans, key))
    else {
        return Err(unsafe_edit());
    };
    if !after.closed
        || new[..after.whole.start] != old[..before.whole.start]
        || new[after.whole.end..] != old[before.whole.end..]
        || after.type_in(new) != before.type_in(old)
    {
        return Err(unsafe_edit());
    }
    let (was, now) = (
        fields_of(old, before, &macros(old, &old_spans)),
        fields_of(new, after, &macros(new, &new_spans)),
    );
    let asked: BTreeMap<&str, Option<&str>> = changes
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_deref().filter(|v| !v.is_empty())))
        .collect();
    for (name, value) in &asked {
        if now.get(*name).map(String::as_str) != *value {
            return Err(unsafe_edit());
        }
    }
    for (name, value) in &was {
        if !asked.contains_key(name.as_str()) && now.get(name) != Some(value) {
            return Err(unsafe_edit());
        }
    }
    Ok(())
}

/// The text with the fields set (a value of `None` removes the field), in the entry
/// with this key. A value is changed where it stands; a field the entry lacks is added
/// as a new line after the last one.
pub fn set_fields(
    text: &str,
    key: &str,
    changes: &BTreeMap<String, Option<String>>,
) -> Result<String> {
    let spans = scan(text);
    let span = find(text, &spans, key).ok_or_else(|| missing(key))?;
    if !span.closed {
        return Err(open_entry(text, span));
    }
    let known = macros(text, &spans);
    let mut edits = Vec::new();
    let mut added: BTreeMap<String, String> = BTreeMap::new();
    let mut named: BTreeMap<String, Option<String>> = BTreeMap::new();
    for (name, change) in changes {
        let name = check_name(name)?;
        let value = match change {
            Some(value) => Some(check_value(&name, value)?).filter(|v| !v.is_empty()),
            None => None,
        };
        let field = span.field(&name);
        match (field, &value) {
            (Some(field), Some(value)) => {
                if expand(text, &field.pieces, &known).as_deref() != Some(value.as_str()) {
                    edits.push(replacement(text, field, value));
                }
            }
            (None, Some(value)) => {
                added.insert(name.clone(), value.clone());
            }
            (Some(field), None) => edits.push(removal(text, field)),
            (None, None) => {}
        }
        named.insert(name, value);
    }
    if !added.is_empty() {
        edits.push(insertion(text, span, &added));
    }
    if edits.is_empty() {
        return Ok(text.to_owned());
    }
    let new = apply(text, edits)?;
    verify(text, &new, key, &named)?;
    Ok(new)
}

/// The text with the key of the entry `from` written as `to`.
pub fn rename_key(text: &str, from: &str, to: &str) -> Result<String> {
    let spans = scan(text);
    let span = find(text, &spans, from).ok_or_else(|| missing(from))?;
    let key = span.key.clone().ok_or_else(|| missing(from))?;
    let edit = Edit {
        range: key,
        with: to.to_owned(),
    };
    let new = apply(text, vec![edit])?;
    let renamed = scan(&new);
    let count = |text: &str, spans: &[Span], key: &str| {
        spans
            .iter()
            .filter(|s| s.kind == Kind::Entry && s.key_in(text) == Some(key))
            .count()
    };
    // One entry gave up the old key and one took the new; nothing else came or went.
    let moved = count(&new, &renamed, from) + 1 == count(text, &spans, from)
        && count(&new, &renamed, to) == count(text, &spans, to) + 1
        && renamed.len() == spans.len();
    if from == to || !moved {
        return Err(refuse(format!(
            "Renaming “{from}” could not be done safely; edit the file by hand"
        )));
    }
    Ok(new)
}

/// `entry` with the line breaks of `like`.
pub fn with_eol_of(entry: &str, like: &str) -> String {
    let plain = entry.replace("\r\n", "\n");
    if eol_of(like) == "\r\n" {
        plain.replace('\n', "\r\n")
    } else {
        plain
    }
}

/// The text with the entry `key` replaced by `replacement`, which must be one whole,
/// closed entry with the same key and nothing else but blank space.
pub fn replace_entry(text: &str, key: &str, replacement: &str) -> Result<String> {
    let spans = scan(text);
    let span = find(text, &spans, key).ok_or_else(|| missing(key))?;
    let wanted = replacement.trim();
    let given = scan(wanted);
    let entries: Vec<&Span> = given.iter().filter(|s| s.kind == Kind::Entry).collect();
    let other = given
        .iter()
        .any(|s| s.kind != Kind::Entry && !s.text(wanted).trim().is_empty());
    let [entry] = entries.as_slice() else {
        return Err(refuse("Give one reference: a single @type{key, ...} entry"));
    };
    if entry.key_in(wanted) != Some(key) {
        return Err(refuse(format!(
            "The key has to stay “{key}”; use Rename key to change it, so the citations follow"
        )));
    }
    if other || !entry.closed {
        return Err(refuse(
            "That is not one complete entry: close its last brace and leave out anything around it",
        ));
    }
    apply(
        text,
        vec![Edit {
            range: span.whole.clone(),
            with: with_eol_of(wanted, text),
        }],
    )
}

/// The text with `chunk` added at the end, a blank line after what is there.
pub fn append(text: &str, chunk: &str) -> String {
    let eol = eol_of(text);
    let mut out = text.to_owned();
    if !out.is_empty() {
        if !out.ends_with('\n') {
            out.push_str(eol);
        }
        if !out.ends_with("\n\n") && !out.ends_with("\r\n\r\n") {
            out.push_str(eol);
        }
    }
    out.push_str(&with_eol_of(chunk, text));
    if !out.ends_with('\n') {
        out.push_str(eol);
    }
    out
}
