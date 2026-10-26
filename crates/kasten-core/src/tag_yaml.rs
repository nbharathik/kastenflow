//! Changing one top-level key in a YAML file that holds other keys the
//! person wrote (a tag's `views:` or `properties:`, a saved collection's
//! `query:`) by rewriting only that key's lines, so comments, key order and
//! spacing elsewhere stay as written.

use serde_json::Value;

use crate::props::yaml_value;

/// Whether `line` is the top-level `key:` line.
fn is_key_line(line: &str, key: &str) -> bool {
    let line = line.strip_prefix('\u{feff}').unwrap_or(line);
    line.strip_prefix(key)
        .is_some_and(|rest| rest.trim_start_matches([' ', '\t']).starts_with(':'))
}

/// Whether `line` continues a top-level value: indented, or a list item
/// written at the left edge.
fn continues(line: &str) -> bool {
    line.starts_with([' ', '\t'])
        || line.starts_with("- ")
        || line.trim_end_matches(['\n', '\r']) == "-"
}

fn eol_of(yaml: &str) -> &'static str {
    if yaml.contains("\r\n") { "\r\n" } else { "\n" }
}

/// The lines of the top-level `key` in `lines`: from its own line up to
/// (not including) the first line that is no part of its value.
fn find(lines: &[&str], key: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| is_key_line(l, key))?;
    let mut end = start + 1;
    while end < lines.len() {
        if continues(lines[end]) {
            end += 1;
            continue;
        }
        // Blank lines and comments at the left edge belong to the value only
        // when more of it follows (`views:`, a comment, then the items).
        let next =
            (end..lines.len()).find(|&i| !lines[i].trim().is_empty() && !lines[i].starts_with('#'));
        match next {
            Some(i) if continues(lines[i]) => end = i,
            _ => break,
        }
    }
    Some((start, end))
}

/// `yaml` with the lines `found` stand for replaced by `block` (which ends
/// in a line break, or is empty to take the key out), or, if the key was not
/// there, `block` added at the end.
fn replace(yaml: &str, lines: &[&str], found: Option<(usize, usize)>, block: &str) -> String {
    let Some((start, end)) = found else {
        let sep = if yaml.is_empty() || yaml.ends_with('\n') || block.is_empty() {
            ""
        } else {
            eol_of(yaml)
        };
        return format!("{yaml}{sep}{block}");
    };
    // A byte order mark on the key's own line stays at the file's start.
    let bom = if lines[start].starts_with('\u{feff}') {
        "\u{feff}"
    } else {
        ""
    };
    format!(
        "{}{bom}{block}{}",
        lines[..start].concat(),
        lines[end..].concat()
    )
}

/// `yaml` with the top-level `key` set to `items`, one flow mapping per
/// line (`  - {name: Board, type: kanban}`), or `key: []` for none. The
/// key's old lines go and every other byte stays; a missing key is added at
/// the end.
pub fn set_list(yaml: &str, key: &str, items: &[Value]) -> String {
    let eol = eol_of(yaml);
    let block = if items.is_empty() {
        format!("{key}: []{eol}")
    } else {
        let lines: String = items
            .iter()
            .map(|item| format!("  - {}{eol}", yaml_value(item)))
            .collect();
        format!("{key}:{eol}{lines}")
    };
    let lines: Vec<&str> = yaml.split_inclusive('\n').collect();
    replace(yaml, &lines, find(&lines, key), &block)
}

/// The line a list item starts on: indented or not, `- ` or a lone `-`.
fn starts_item(line: &str) -> bool {
    let text = line.trim_start_matches([' ', '\t']);
    text.starts_with("- ") || text.trim_end_matches(['\n', '\r']) == "-"
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start_matches([' ', '\t']).len()
}

/// Whether `line` is empty or only a comment: it belongs to no item's value.
fn is_gap(line: &str) -> bool {
    let text = line.trim();
    text.is_empty() || text.starts_with('#')
}

/// `yaml` with the `index`th item of the top-level list `key` replaced by
/// `item` and every other byte as it was: the item's line keeps its indent,
/// its dash and its line end. Only an item written as one flow mapping on a
/// line of its own (`  - {name: Table, type: table}`, a comment after it stays)
/// can be replaced this way; `None` for any other, and the caller writes
/// the whole list instead (`set_list`).
pub fn replace_list_item(yaml: &str, key: &str, index: usize, item: &Value) -> Option<String> {
    let lines: Vec<&str> = yaml.split_inclusive('\n').collect();
    let (start, end) = find(&lines, key)?;
    let body = &lines[start + 1..end];
    let base = body
        .iter()
        .filter(|l| starts_item(l))
        .map(|l| indent_of(l))
        .min()?;
    let starts: Vec<usize> = (0..body.len())
        .filter(|&i| starts_item(body[i]) && indent_of(body[i]) == base)
        .collect();
    let from = *starts.get(index)?;
    let to = starts.get(index + 1).copied().unwrap_or(body.len());
    // Whatever follows the item's own line must be blank or a comment.
    if !body[from + 1..to].iter().all(|l| is_gap(l)) {
        return None;
    }
    let line = body[from];
    let eol = &line[line.trim_end_matches(['\n', '\r']).len()..];
    let text = line.trim_end_matches(['\n', '\r']);
    let dash = text.find('-')?;
    let after = &text[dash + 1..];
    let value = after.trim_start_matches([' ', '\t']);
    let lead = &text[..text.len() - value.len()];
    // The mapping ends where a comment starts, if there is one; the comment
    // (whatever it ends in) stays after the new item.
    let flow = value.trim_end_matches([' ', '\t']);
    let flow = match flow.find(" #").or_else(|| flow.find("\t#")) {
        Some(at) => flow[..at].trim_end_matches([' ', '\t']),
        None => flow,
    };
    if !flow.starts_with('{') || !flow.ends_with('}') {
        return None;
    }
    let trailing = &value[flow.len()..];
    let at = start + 1 + from;
    Some(format!(
        "{}{lead}{}{trailing}{eol}{}",
        lines[..at].concat(),
        yaml_value(item),
        lines[at + 1..].concat()
    ))
}

/// A ` # comment` after a one-line value, with the spacing before it, so it
/// can stay when the value changes.
fn trailing_comment(line: &str, key: &str) -> String {
    let line = line.strip_prefix('\u{feff}').unwrap_or(line);
    let value = line[key.len()..].trim_end_matches(['\n', '\r']);
    let body = value
        .trim_start_matches([' ', '\t'])
        .trim_start_matches(':')
        .trim_start();
    let from = match body.chars().next() {
        Some(q @ ('"' | '\'')) => body[1..].find(q).map_or(body.len(), |i| i + 2),
        _ => 0,
    };
    let Some(at) = body[from..].find(" #").or_else(|| body[from..].find("\t#")) else {
        return String::new();
    };
    let hash = from + at + 1;
    let start = body[..hash].trim_end_matches([' ', '\t']).len();
    body[start..].to_owned()
}

/// `yaml` with the top-level `key` set to `value`, or taken out with
/// `None`. A list is written as `set_list` writes it; any other value on one
/// line, as a plain or quoted scalar or a flow mapping, keeping a comment
/// that followed the old one-line value. The key's old lines go and every
/// other byte stays; a missing key is added at the end.
pub fn set_value(yaml: &str, key: &str, value: Option<&Value>) -> String {
    let lines: Vec<&str> = yaml.split_inclusive('\n').collect();
    let found = find(&lines, key);
    let block = match value {
        None => String::new(),
        Some(Value::Array(items)) => return set_list(yaml, key, items),
        Some(other) => {
            let comment = match found {
                Some((start, end)) if end == start + 1 => trailing_comment(lines[start], key),
                _ => String::new(),
            };
            format!("{key}: {}{comment}{}", yaml_value(other), eol_of(yaml))
        }
    };
    if value.is_none() && found.is_none() {
        return yaml.to_owned();
    }
    replace(yaml, &lines, found, &block)
}

#[cfg(test)]
#[path = "tag_yaml_tests.rs"]
mod tests;
