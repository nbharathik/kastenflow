//! Copying entries from one `.bib` text into another, as written, with the
//! `@string` macros their values use, so a copy reads as the original did.

use std::collections::{HashMap, HashSet};

use slides_bib::{Kind, PieceKind, Span, macros, scan};

use super::edit::find;
use super::model::SkippedKey;

/// What `pick` chose to copy and what it left.
#[derive(Debug, Default)]
pub struct Picked {
    /// Each key with the text to add for it: the macros it needs that the target lacks, then the entry.
    pub chunks: Vec<(String, String)>,
    pub skipped: Vec<SkippedKey>,
}

/// The names of the macros the values of `span` use (lower case, whether defined or not).
fn used(text: &str, span: &Span) -> Vec<String> {
    let mut names = Vec::new();
    for field in &span.fields {
        for piece in field.pieces.iter().filter(|p| p.kind == PieceKind::Word) {
            let word = text.get(piece.text.clone()).unwrap_or("");
            if !word.is_empty() && !word.bytes().all(|b| b.is_ascii_digit()) {
                names.push(word.to_ascii_lowercase());
            }
        }
    }
    names
}

/// How deep macros are followed: one that names another that names another...
const DEEPEST: usize = 32;

/// The macros `span` needs, those they need first, each once.
fn needed(
    text: &str,
    span: &Span,
    defs: &HashMap<String, &Span>,
    out: &mut Vec<String>,
    path: &mut Vec<String>,
) {
    for name in used(text, span) {
        if out.contains(&name) || path.contains(&name) || path.len() >= DEEPEST {
            continue;
        }
        if let Some(def) = defs.get(&name) {
            path.push(name.clone());
            needed(text, def, defs, out, path);
            path.pop();
            out.push(name);
        }
    }
}

/// The entries of `source` named by `keys` (all of them for `None`), to be added to
/// `into`. A key `into` has, one that never closes, one that is not in `source`, and one
/// that uses a macro `into` defines differently are skipped, with the reason.
pub fn pick(source: &str, keys: Option<&[String]>, into: &str) -> Picked {
    let spans = scan(source);
    let source_macros = macros(source, &spans);
    let into_spans = scan(into);
    let into_macros = macros(into, &into_spans);
    let defs: HashMap<String, &Span> = spans
        .iter()
        .filter(|s| s.kind == Kind::String)
        .filter_map(|s| Some((s.fields.first()?.name.clone(), s)))
        .collect();
    let wanted: Option<HashSet<&str>> = keys.map(|k| k.iter().map(String::as_str).collect());
    let mut picked = Picked::default();
    let mut seen: HashSet<&str> = HashSet::new();
    let mut emitted: HashSet<String> = HashSet::new();
    for span in spans.iter().filter(|s| s.kind == Kind::Entry) {
        let Some(key) = span.key_in(source) else {
            continue;
        };
        if wanted.as_ref().is_some_and(|w| !w.contains(key)) || !seen.insert(key) {
            continue;
        }
        let skip = |why: &str| SkippedKey {
            key: key.to_owned(),
            why: why.to_owned(),
        };
        if find(into, &into_spans, key).is_some() {
            picked
                .skipped
                .push(skip("the managed file has that key already"));
            continue;
        }
        if !span.closed {
            picked.skipped.push(skip("it never closes in that file"));
            continue;
        }
        let mut macros_needed = Vec::new();
        needed(source, span, &defs, &mut macros_needed, &mut Vec::new());
        if let Some(name) = macros_needed.iter().find(|n| {
            into_macros
                .get(*n)
                .is_some_and(|have| source_macros.get(*n) != Some(have))
        }) {
            picked.skipped.push(skip(&format!(
                "it uses the macro {name}, which the managed file defines differently"
            )));
            continue;
        }
        let mut chunk = String::new();
        for name in &macros_needed {
            if into_macros.contains_key(name) || !emitted.insert(name.clone()) {
                continue;
            }
            if let Some(def) = defs.get(name) {
                chunk.push_str(def.text(source));
                chunk.push('\n');
            }
        }
        chunk.push_str(span.text(source));
        picked.chunks.push((key.to_owned(), chunk));
    }
    if let Some(keys) = keys {
        for key in keys.iter().filter(|k| !seen.contains(k.as_str())) {
            picked.skipped.push(SkippedKey {
                key: key.clone(),
                why: "it is not in that file".to_owned(),
            });
        }
    }
    picked
}
