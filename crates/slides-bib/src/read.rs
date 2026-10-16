//! A tolerant BibTeX reader. It finds the entries in a text and their fields
//! and does no more: a file written by hand, by a reference manager or by a
//! model has odd spacing, a missing comma, an entry that never closes, and
//! none of that may cost the entries around it. Nothing here recurses, panics
//! or reads without limit, so any text at all is safe to give it.
//!
//! It is built on the span scanner (`scan`): the scanner says where things are,
//! and this puts `@string` macros in and the pieces of each value together.

use std::collections::{BTreeMap, HashMap};

use crate::scan::{Kind, Piece, PieceKind, Span, cut, scan};

/// The most bytes of one field's value kept, and the most fields kept for one entry.
pub const MOST_VALUE: usize = 16 * 1024;
const MOST_FIELDS: usize = 64;

/// An entry as written: its type in lower case, its key, and its fields by
/// lower-case name, with `@string` macros put in and the value's outer braces
/// or quotes taken off. Braces and commands inside a value are left as written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Raw {
    pub kind: String,
    pub key: String,
    pub fields: BTreeMap<String, String>,
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

fn month(name: &str) -> Option<&'static str> {
    let short = name.get(..3)?;
    let at = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ]
    .iter()
    .position(|m| m.eq_ignore_ascii_case(short))?;
    (name.len() == 3).then_some(MONTHS[at])
}

/// The value of a field: its pieces put together, macros expanded. None when it has no piece.
pub fn expand(text: &str, pieces: &[Piece], macros: &HashMap<String, String>) -> Option<String> {
    let mut out = String::new();
    let mut any = false;
    for piece in pieces {
        let inside = text.get(piece.text.clone()).unwrap_or("");
        let part: String = match piece.kind {
            PieceKind::Braced | PieceKind::Quoted => cut(inside, MOST_VALUE).to_owned(),
            PieceKind::Word => {
                if inside.bytes().all(|b| b.is_ascii_digit()) {
                    inside.to_owned()
                } else if let Some(known) = macros.get(&inside.to_ascii_lowercase()) {
                    known.clone()
                } else {
                    month(inside).map_or_else(|| inside.to_owned(), str::to_owned)
                }
            }
        };
        any = true;
        if out.len() < MOST_VALUE {
            out.push_str(&part);
            out = cut(&out, MOST_VALUE).to_owned();
        }
    }
    any.then_some(out)
}

/// The fields of one entry span, by lower-case name; the first of a name stands.
pub fn fields_of(
    text: &str,
    span: &Span,
    macros: &HashMap<String, String>,
) -> BTreeMap<String, String> {
    let mut fields = BTreeMap::new();
    for field in &span.fields {
        if let Some(value) = expand(text, &field.pieces, macros)
            && fields.len() < MOST_FIELDS
        {
            fields.entry(field.name.clone()).or_insert(value);
        }
    }
    fields
}

/// The entries among `spans` (the scan of `text`), each with the index of its span.
/// A macro is known to the entries that come after its `@string`.
pub fn read_spans(text: &str, spans: &[Span]) -> Vec<(usize, Raw)> {
    let mut known: HashMap<String, String> = HashMap::new();
    let mut entries = Vec::new();
    for (index, span) in spans.iter().enumerate() {
        match span.kind {
            Kind::String => {
                if let Some(field) = span.fields.first()
                    && let Some(value) = expand(text, &field.pieces, &known)
                {
                    known.insert(field.name.clone(), value);
                }
            }
            Kind::Entry => {
                let raw = Raw {
                    kind: span.type_in(text),
                    key: span.key_in(text).unwrap_or_default().to_owned(),
                    fields: fields_of(text, span, &known),
                };
                entries.push((index, raw));
            }
            _ => {}
        }
    }
    entries
}

/// The macros that the `@string` spans define, each put in as the ones before it
/// stand: what an entry anywhere in the text can use.
pub fn macros(text: &str, spans: &[Span]) -> HashMap<String, String> {
    let mut known = HashMap::new();
    for span in spans.iter().filter(|s| s.kind == Kind::String) {
        if let Some(field) = span.fields.first()
            && let Some(value) = expand(text, &field.pieces, &known)
        {
            known.insert(field.name.clone(), value);
        }
    }
    known
}

/// The entries in `text`, in the order they are written.
pub fn read(text: &str) -> Vec<Raw> {
    read_spans(text, &scan(text))
        .into_iter()
        .map(|(_, raw)| raw)
        .collect()
}
