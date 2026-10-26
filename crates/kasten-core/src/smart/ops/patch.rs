//! Setting the manifest without rewriting what the person wrote: only the
//! top-level keys whose value changed are replaced, so comments, key order,
//! quoting, line endings and every key this version does not know stay byte
//! for byte. A file that cannot be patched safely is written out whole.

use serde_json::Value;

use crate::smart::{SmartManifest, parse_manifest};

/// The keys of the manifest this version knows.
const KNOWN: [&str; 6] = ["version", "title", "kit", "queries", "views", "size"];

/// One top-level key of the file: the comment and blank lines in front of it,
/// then its own line and every line below it that belongs to it.
struct Block {
    key: Option<String>,
    lead: String,
    body: String,
}

/// The key a line at column 0 starts, when it is a plain `key:` line.
fn key_of(line: &str) -> Option<&str> {
    let line = line.strip_prefix('\u{feff}').unwrap_or(line);
    let first = line.chars().next()?;
    if first.is_whitespace()
        || matches!(
            first,
            '#' | '-'
                | '?'
                | '"'
                | '\''
                | '{'
                | '['
                | '&'
                | '*'
                | '!'
                | '|'
                | '>'
                | '%'
                | '@'
                | '`'
        )
    {
        return None;
    }
    let (key, rest) = line.split_once(':')?;
    let ends = rest.is_empty() || rest.starts_with([' ', '\t', '\r', '\n']);
    (ends && !key.is_empty() && !key.contains(['#', ' ', '\t'])).then_some(key)
}

/// The file cut into blocks, or None when it is not a plain map of keys at
/// column 0 (a document marker, a flow map, a key spelled in quotes, a key that
/// stands twice).
fn blocks(text: &str) -> Option<(Vec<Block>, String)> {
    let mut out: Vec<Block> = Vec::new();
    let mut pending = String::new();
    for line in text.split_inclusive('\n') {
        let bare = line.strip_prefix('\u{feff}').unwrap_or(line);
        if bare.starts_with("---") || bare.starts_with("...") {
            return None;
        }
        if let Some(key) = key_of(line) {
            if out.iter().any(|b| b.key.as_deref() == Some(key)) {
                return None;
            }
            out.push(Block {
                key: Some(key.to_owned()),
                lead: std::mem::take(&mut pending),
                body: line.to_owned(),
            });
        } else if bare.trim().is_empty() || bare.starts_with('#') {
            pending.push_str(line);
        } else {
            // Below a key: its value goes on, after any blank lines between.
            let last = out.last_mut()?;
            last.body.push_str(&std::mem::take(&mut pending));
            last.body.push_str(line);
        }
    }
    Some((out, pending))
}

/// The one-key YAML text of `key: value`, with the file's line endings.
fn block_of(key: &str, value: &Value, eol: &str) -> Option<String> {
    let mut map = serde_json::Map::new();
    map.insert(key.to_owned(), value.clone());
    let mut text = serde_saphyr::to_string(&map).ok()?;
    if !text.ends_with('\n') {
        text.push('\n');
    }
    Some(if eol == "\n" {
        text
    } else {
        text.replace('\n', eol)
    })
}

/// `existing` changed to say `new`, touching only the lines of the keys that
/// differ; None when that cannot be done safely (the caller writes the whole
/// manifest instead).
pub(super) fn patched(existing: &str, new: &SmartManifest) -> Option<String> {
    let old = parse_manifest(existing).ok()?;
    if old == *new {
        return Some(existing.to_owned());
    }
    // A key this version does not know that changed is a whole rewrite.
    if old.extra != new.extra {
        return None;
    }
    let (mut parts, tail) = blocks(existing)?;
    let eol = if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let (was, now) = (
        serde_json::to_value(&old).ok()?,
        serde_json::to_value(new).ok()?,
    );
    for key in KNOWN {
        let (before, after) = (was.get(key), now.get(key));
        if before == after {
            continue;
        }
        let at = parts.iter().position(|b| b.key.as_deref() == Some(key));
        match (at, after) {
            (Some(at), Some(value)) => parts[at].body = block_of(key, value, eol)?,
            (Some(at), None) => parts[at].body.clear(),
            (None, Some(value)) => {
                let body = block_of(key, value, eol)?;
                // The new key goes after the last one, on a line of its own.
                match parts.last_mut() {
                    Some(last) if !last.body.ends_with('\n') => last.body.push_str(eol),
                    _ => {}
                }
                parts.push(Block {
                    key: Some(key.to_owned()),
                    lead: String::new(),
                    body,
                });
            }
            (None, None) => {}
        }
    }
    let mut text = String::with_capacity(existing.len() + 64);
    for part in &parts {
        text.push_str(&part.lead);
        text.push_str(&part.body);
    }
    text.push_str(&tail);
    // The result has to say exactly what was asked for.
    (parse_manifest(&text).ok()? == *new).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "# The tracker\nversion: 1\ntitle: Conference tracker   # shown on top\n\n# what it reads\nqueries:\n  venues:\n    tag: venue   # a comment\n    future_query_key: 3\nfuture: [a, b]  # kept\nkit: \"1\"\n";

    fn manifest(text: &str) -> SmartManifest {
        parse_manifest(text).unwrap()
    }

    #[test]
    fn a_manifest_that_is_the_same_is_not_touched() {
        let m = manifest(FILE);
        assert_eq!(patched(FILE, &m).as_deref(), Some(FILE));
    }

    #[test]
    fn one_changed_key_changes_only_its_lines() {
        let mut m = manifest(FILE);
        m.title = "Venue tracker".to_owned();
        let out = patched(FILE, &m).unwrap();
        assert_eq!(
            out,
            FILE.replace(
                "title: Conference tracker   # shown on top\n",
                "title: Venue tracker\n"
            )
        );
    }

    #[test]
    fn a_changed_block_keeps_the_comment_in_front_of_it_and_the_rest() {
        let mut m = manifest(FILE);
        m.queries.get_mut("venues").unwrap().tag = "place".to_owned();
        let out = patched(FILE, &m).unwrap();
        assert!(out.starts_with("# The tracker\nversion: 1\ntitle: Conference tracker   # shown on top\n\n# what it reads\nqueries:\n"));
        assert!(
            out.ends_with("future: [a, b]  # kept\nkit: \"1\"\n"),
            "{out}"
        );
        assert_eq!(manifest(&out), m);
        assert!(out.contains("future_query_key"), "{out}");
    }

    #[test]
    fn adding_and_removing_a_key_keeps_the_others_and_the_line_endings() {
        let crlf = FILE.replace('\n', "\r\n");
        let mut m = manifest(&crlf);
        m.size = Some(crate::smart::SmartSize {
            height: Some(300),
            ..Default::default()
        });
        m.queries.clear();
        let out = patched(&crlf, &m).unwrap();
        assert!(!out.contains("queries"), "{out:?}");
        assert!(out.contains("size:\r\n"), "{out:?}");
        assert!(!out.replace("\r\n", "").contains('\n'), "{out:?}");
        assert!(out.contains("# The tracker\r\n") && out.contains("future: [a, b]  # kept\r\n"));
        assert_eq!(manifest(&out), m);
    }

    #[test]
    fn no_final_newline_and_a_bom_survive() {
        let text = "\u{feff}title: A\nfuture: 1";
        let mut m = manifest(text);
        m.kit = "2".to_owned();
        let out = patched(text, &m).unwrap();
        assert!(
            out.starts_with("\u{feff}title: A\nfuture: 1\nkit:"),
            "{out:?}"
        );
        assert_eq!(manifest(&out), m);
    }

    #[test]
    fn what_cannot_be_patched_is_left_to_a_whole_rewrite() {
        // A changed unknown key, a document marker, a repeated key.
        let mut m = manifest(FILE);
        m.extra.insert("other".to_owned(), serde_json::json!(1));
        assert!(patched(FILE, &m).is_none());
        let marked = "---\ntitle: A\n";
        let mut m = manifest(marked);
        m.kit = "2".to_owned();
        assert!(patched(marked, &m).is_none());
    }
}
