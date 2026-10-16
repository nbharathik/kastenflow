//! How a field is written into an entry that is already there: a new value put where the
//! old one stood, a field taken out with its line, and new fields added after the last
//! one in the entry's own style (its indent, a trailing comma or none, its equals signs
//! lined up when they were). Each gives the range of text to change and what to put there.

use std::collections::BTreeMap;
use std::ops::Range;

use slides_bib::{FieldSpan, PieceKind, Span};

use super::style::{eol_of, has_open_quote, ordered};

/// A change of `range` to `with`.
pub(super) struct Edit {
    pub range: Range<usize>,
    pub with: String,
}

/// The index after the spaces and tabs at `at`.
pub(super) fn blanks(text: &str, mut at: usize) -> usize {
    while matches!(text.as_bytes().get(at), Some(b' ' | b'\t')) {
        at += 1;
    }
    at
}

/// The length of the line break at `at`.
fn eol_len(text: &str, at: usize) -> usize {
    if text[at..].starts_with("\r\n") {
        2
    } else {
        usize::from(text[at..].starts_with('\n'))
    }
}

/// The edit that gives the field a new value, changing as little as it can.
pub(super) fn replacement(text: &str, field: &FieldSpan, value: &str) -> Edit {
    let piece = field.pieces.first().map(|p| p.kind);
    if let Some(inner) = &field.inner {
        let fits = match piece {
            Some(PieceKind::Braced) => true,
            Some(PieceKind::Quoted) => !has_open_quote(value),
            _ => false,
        };
        if fits {
            return Edit {
                range: inner.clone(),
                with: value.to_owned(),
            };
        }
    }
    let bare_number = piece == Some(PieceKind::Word)
        && field.pieces.len() == 1
        && text
            .get(field.value.clone())
            .is_some_and(|v| v.bytes().all(|b| b.is_ascii_digit()))
        && value.bytes().all(|b| b.is_ascii_digit());
    Edit {
        range: field.value.clone(),
        with: if bare_number {
            value.to_owned()
        } else {
            format!("{{{value}}}")
        },
    }
}

/// The edit that takes a field out: its own lines when it has them, else it and one comma.
pub(super) fn removal(text: &str, field: &FieldSpan) -> Edit {
    let start = field.whole.start;
    let mut end = field.whole.end;
    let after_value = blanks(text, end);
    let comma = text.as_bytes().get(after_value) == Some(&b',');
    if comma {
        end = after_value + 1;
    }
    let line_start = text[..start].rfind('\n').map_or(0, |n| n + 1);
    let alone_before = text[line_start..start]
        .bytes()
        .all(|b| b == b' ' || b == b'\t');
    let tail = blanks(text, end);
    let line_end = tail + eol_len(text, tail);
    if alone_before && line_end > tail {
        return Edit {
            range: line_start..line_end,
            with: String::new(),
        };
    }
    if comma {
        return Edit {
            range: start..blanks(text, end),
            with: String::new(),
        };
    }
    // The last field of an entry on one line: the comma before it goes too.
    let before = text[..start].trim_end();
    if before.ends_with(',') {
        return Edit {
            range: before.len() - 1..field.whole.end,
            with: String::new(),
        };
    }
    Edit {
        range: start..field.whole.end,
        with: String::new(),
    }
}

/// The column the equals signs of an entry line up at, and what follows them, when the
/// entry's fields are lined up: every one has plain spaces round its `=` and they all
/// put it at the same column, with more than one space before it in some.
fn alignment(text: &str, fields: &[FieldSpan]) -> Option<(usize, String)> {
    let mut column = None;
    let mut after = String::new();
    let mut wide = false;
    for field in fields {
        let sep = text.get(field.name_at.end..field.value.start)?;
        let (lead, tail) = sep.split_once('=')?;
        if lead.is_empty() || !lead.bytes().all(|b| b == b' ') || !tail.bytes().all(|b| b == b' ') {
            return None;
        }
        let here = lead.len() + field.name.len();
        if column.is_some_and(|known| known != here) {
            return None;
        }
        column = Some(here);
        wide |= lead.len() > 1;
        after = tail.to_owned();
    }
    wide.then_some(column)
        .flatten()
        .map(|column| (column, after))
}

/// What stands between a new field's name and its value: `" = "`, or enough spaces to
/// line the equals sign up with the entry's other fields when they are lined up.
fn separator(aligned: Option<&(usize, String)>, name: &str) -> String {
    match aligned {
        Some((column, after)) => {
            let spaces = column.saturating_sub(name.len()).max(1);
            format!("{}={after}", " ".repeat(spaces))
        }
        None => " = ".to_owned(),
    }
}

/// The edit that adds fields after the last one of the entry, in the entry's own style.
pub(super) fn insertion(text: &str, span: &Span, added: &BTreeMap<String, String>) -> Edit {
    let last = span.fields.last();
    let anchor = match last {
        Some(field) => field.whole.end,
        None => span.key.as_ref().map_or(span.whole.end, |key| key.end),
    };
    let after = blanks(text, anchor);
    let comma = text.as_bytes().get(after) == Some(&b',');
    let entry = span.text(text);
    let multiline = entry.contains('\n');
    let eol = if entry.contains("\r\n") {
        "\r\n"
    } else {
        eol_of(text)
    };
    let indent = last
        .map(|f| {
            let line_start = text[..f.name_at.start].rfind('\n').map_or(0, |n| n + 1);
            text[line_start..f.name_at.start].to_owned()
        })
        .filter(|lead| !lead.is_empty() && lead.bytes().all(|b| b == b' ' || b == b'\t'))
        .unwrap_or_else(|| "  ".to_owned());
    let aligned = if multiline {
        alignment(text, &span.fields)
    } else {
        None
    };
    let lines: Vec<String> = ordered(added)
        .into_iter()
        .map(|(name, value)| format!("{name}{}{{{value}}}", separator(aligned.as_ref(), name)))
        .collect();
    let (at, with) = match (multiline, comma) {
        (true, true) => (
            after + 1,
            lines
                .iter()
                .map(|l| format!("{eol}{indent}{l},"))
                .collect::<String>(),
        ),
        (true, false) => {
            let rows: Vec<String> = lines.iter().map(|l| format!("{eol}{indent}{l}")).collect();
            (anchor, format!(",{}", rows.join(",")))
        }
        (false, true) => (after + 1, lines.iter().map(|l| format!(" {l},")).collect()),
        (false, false) => (anchor, lines.iter().map(|l| format!(", {l}")).collect()),
    };
    Edit {
        range: at..at,
        with,
    }
}
