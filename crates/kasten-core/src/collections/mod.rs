//! Saved collections (`views/<slug>.yaml`): reading, checking and editing
//! them while keeping unknown keys and comments.
//!
//! A collection is a saved search: the search box's own query, a span of
//! recent days, the filters and sorts a tag database has, and how to show the
//! result. The notes it holds are never stored; the app runs the collection
//! when it is opened. A file made by a newer version, or one that cannot be
//! read, is listed with the reason and left alone.

mod check;
mod edit;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::loose::Loose;
use crate::note::content_hash;

pub use check::{
    DISPLAY_TYPES, FILTER_OPS, MAX_COLUMNS, MAX_FILTERS, MAX_LIMIT, MAX_NAME, MAX_QUERY, MAX_SORTS,
    WHEN_FIELDS, WHEN_TOKENS,
};
pub use edit::{edit_text, new_text, rename_text};

/// The version of the file format this build writes and reads.
pub const FORMAT: u64 = 1;
/// The folder collections live in.
pub const DIR: &str = "views";
/// Bigger files are not collections.
const MAX_FILE: usize = 256 * 1024;

/// Whether `rel` names a collection's file: `views/<name>.yaml`, one level
/// down, in that exact folder name.
pub fn is_path(rel: &str) -> bool {
    rel.strip_prefix("views/").is_some_and(|name| {
        name.strip_suffix(".yaml").is_some_and(|stem| {
            !stem.is_empty()
                && !stem.starts_with('.')
                && !stem.contains(['/', '\\', ':', '\0'])
                && stem != ".."
        })
    })
}

/// The file name without its folder or `.yaml`.
pub fn slug_of(rel: &str) -> &str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name.strip_suffix(".yaml").unwrap_or(name)
}

/// A saved collection as the app shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    /// `views/<slug>.yaml`.
    pub path: String,
    pub slug: String,
    pub name: String,
    pub icon: Option<String>,
    /// The search box's syntax: words, `#tag`, `project:`, `under:`...
    pub query: String,
    /// `{updated: last-30-days}`: days to look at, as a span the app turns
    /// into a range when it runs the collection.
    pub when: Option<Value>,
    /// A tag database's filters: `{key, op, value}`.
    pub filter: Vec<Value>,
    /// `{key, dir}`.
    pub sort: Vec<Value>,
    /// `{type, columns, limit}`.
    pub display: Option<Value>,
    pub format: u64,
    /// Hash of the file's text; an edit brings it back as `base_hash`.
    pub hash: String,
    pub modified: u64,
    /// Why the file cannot be used, when it cannot: unreadable, made by a
    /// newer version, or holding something that is not allowed.
    pub problem: Option<String>,
    /// Listed to be looked at, not edited.
    pub read_only: bool,
}

/// Lists `found` as one that cannot be used, for `why`.
fn stop(found: &mut Collection, why: String) {
    found.problem = Some(why);
    found.read_only = true;
}

fn list(map: &Map<String, Value>, key: &str) -> Vec<Value> {
    map.get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// The collection a file holds. It never fails: what cannot be read is
/// listed under its file name with the reason in `problem`.
pub fn read(path: &str, text: &str, modified: u64) -> Collection {
    let slug = slug_of(path).to_owned();
    let mut found = Collection {
        path: path.to_owned(),
        name: slug.clone(),
        slug,
        icon: None,
        query: String::new(),
        when: None,
        filter: Vec::new(),
        sort: Vec::new(),
        display: None,
        format: FORMAT,
        hash: content_hash(text),
        modified,
        problem: None,
        read_only: false,
    };
    if text.len() > MAX_FILE {
        stop(
            &mut found,
            "This file is too big to be a collection".to_owned(),
        );
        return found;
    }
    if text.trim().is_empty() {
        stop(&mut found, "This file holds no collection".to_owned());
        return found;
    }
    // A byte order mark belongs to the file, not to its first key.
    let value = match serde_saphyr::from_str::<Loose>(text.trim_start_matches('\u{feff}')) {
        Ok(Loose(value)) => value,
        Err(why) => {
            stop(&mut found, format!("This file is not valid YAML: {why}"));
            return found;
        }
    };
    let Some(map) = value.as_object() else {
        stop(&mut found, "This file holds no collection".to_owned());
        return found;
    };
    match map.get("format") {
        None | Some(Value::Null) => {}
        Some(format) => match format.as_u64() {
            Some(n) if n >= 1 => found.format = n,
            _ => stop(&mut found, "Its format is not a version number".to_owned()),
        },
    }
    if let Some(name) = map.get("name").and_then(Value::as_str)
        && !name.trim().is_empty()
    {
        found.name = name.trim().to_owned();
    }
    found.icon = map
        .get("icon")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|icon| !icon.is_empty())
        .map(str::to_owned);
    found.query = map
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    found.when = map.get("when").filter(|v| !v.is_null()).cloned();
    found.filter = list(map, "filter");
    found.sort = list(map, "sort");
    found.display = map.get("display").filter(|v| !v.is_null()).cloned();
    // What is in the file must be what a collection may hold.
    let mut wrong: Option<String> = None;
    for key in ["icon", "query", "when", "filter", "sort", "display"] {
        let Some(check) = check::of_key(key) else {
            continue;
        };
        if let Some(value) = map.get(key).filter(|v| !v.is_null())
            && let Err(why) = check(value)
        {
            wrong = Some(why);
            break;
        }
    }
    if found.problem.is_none() {
        if let Some(why) = wrong {
            stop(&mut found, why);
        } else if found.format > FORMAT {
            let newer = format!(
                "Made by a newer version of KastenFlow (format {}; this one reads up to {FORMAT})",
                found.format
            );
            stop(&mut found, newer);
        }
    }
    found
}

/// A file that could not be read at all, listed under its file name.
pub fn unreadable(path: &str, why: &str, modified: u64) -> Collection {
    let mut found = read(path, "", modified);
    stop(&mut found, why.to_owned());
    found
}

/// A collection's name from its file's text, for lists that only need it.
pub fn name_of(path: &str, text: &str) -> String {
    read(path, text, 0).name
}

#[cfg(test)]
mod tests;
