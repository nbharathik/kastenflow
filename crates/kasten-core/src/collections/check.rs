//! What a saved collection may hold, checked the same way when a file is
//! read and when an edit is asked for. Each check gives a sentence a person
//! can act on.

use serde_json::Value;

use crate::dates::is_real_day;

pub const MAX_NAME: usize = 100;
pub const MAX_ICON: usize = 40;
/// The longest query, in characters.
pub const MAX_QUERY: usize = 2000;
pub const MAX_FILTERS: usize = 50;
pub const MAX_SORTS: usize = 10;
pub const MAX_COLUMNS: usize = 50;
pub const MAX_KEY: usize = 100;
pub const MAX_VALUE: usize = 500;
/// The most notes a collection shows.
pub const MAX_LIMIT: u64 = 5000;

/// The days a `when` can be about.
pub const WHEN_FIELDS: [&str; 3] = ["updated", "created", "on"];
/// The spans of days a `when` can name; the app turns one into a range of
/// days when it runs the collection.
pub const WHEN_TOKENS: [&str; 9] = [
    "today",
    "yesterday",
    "this-week",
    "last-7-days",
    "last-30-days",
    "this-month",
    "last-month",
    "this-year",
    "next-7-days",
];
/// The tests a tag database's filter can make.
pub const FILTER_OPS: [&str; 7] = [
    "is",
    "is_not",
    "contains",
    "empty",
    "not_empty",
    "before",
    "after",
];
/// How a collection can be shown, as a tag database's views are.
pub const DISPLAY_TYPES: [&str; 5] = ["table", "kanban", "list", "calendar", "gallery"];

type Check = Result<(), String>;

fn plain_text(text: &str) -> bool {
    !text.chars().any(char::is_control)
}

/// A collection's name, trimmed.
pub fn name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A collection needs a name".to_owned());
    }
    if name.chars().count() > MAX_NAME || !plain_text(name) {
        return Err(format!(
            "A collection’s name is one line of at most {MAX_NAME} characters"
        ));
    }
    Ok(name.to_owned())
}

pub fn icon(value: &Value) -> Check {
    match value.as_str().map(str::trim) {
        Some(icon) if !icon.is_empty() && icon.chars().count() <= MAX_ICON && plain_text(icon) => {
            Ok(())
        }
        _ => Err(format!(
            "An icon is a short name of at most {MAX_ICON} characters"
        )),
    }
}

pub fn query(value: &Value) -> Check {
    let Some(query) = value.as_str() else {
        return Err("A query is text, written as in the search box".to_owned());
    };
    if query.chars().count() > MAX_QUERY {
        return Err(format!(
            "A query is at most {MAX_QUERY} characters; this one has {}",
            query.chars().count()
        ));
    }
    if !plain_text(query) {
        return Err("A query is one line".to_owned());
    }
    Ok(())
}

pub fn when(value: &Value) -> Check {
    let Some(map) = value.as_object().filter(|m| !m.is_empty()) else {
        return Err(
            "“when” names a day field and a span, such as updated: last-30-days".to_owned(),
        );
    };
    for (field, token) in map {
        if !WHEN_FIELDS.contains(&field.as_str()) {
            return Err(format!(
                "“{}” is not something to look for in time: use {}",
                shown(field),
                WHEN_FIELDS.join(", ")
            ));
        }
        match token.as_str() {
            Some(token) if WHEN_TOKENS.contains(&token) => {}
            _ => {
                let given = token.as_str().map_or_else(|| token.to_string(), shown);
                return Err(format!(
                    "“{given}” is not a span of days: use {}",
                    WHEN_TOKENS.join(", ")
                ));
            }
        }
    }
    Ok(())
}

/// At most `MAX_KEY` characters of `text`, for a sentence.
fn shown(text: &str) -> String {
    text.chars().take(MAX_KEY).collect()
}

fn key_of(entry: &Value, what: &str) -> Result<String, String> {
    match entry.get("key").and_then(Value::as_str).map(str::trim) {
        Some(key) if !key.is_empty() && key.chars().count() <= MAX_KEY && plain_text(key) => {
            Ok(key.to_owned())
        }
        _ => Err(format!("Each {what} needs a key, a property’s name")),
    }
}

pub fn filter(value: &Value) -> Check {
    let Some(list) = value.as_array() else {
        return Err("“filter” is a list".to_owned());
    };
    if list.len() > MAX_FILTERS {
        return Err(format!("A collection has at most {MAX_FILTERS} filters"));
    }
    for entry in list {
        if !entry.is_object() {
            return Err("Each filter is a key, an op and a value".to_owned());
        }
        let key = key_of(entry, "filter")?;
        let op = entry.get("op").and_then(Value::as_str).unwrap_or("");
        if !FILTER_OPS.contains(&op) {
            return Err(format!(
                "The filter on “{key}” has no test called “{}”: use {}",
                shown(op),
                FILTER_OPS.join(", ")
            ));
        }
        if matches!(op, "empty" | "not_empty") {
            continue;
        }
        let wanted = entry.get("value");
        let fine = match wanted {
            Some(Value::String(text)) => text.chars().count() <= MAX_VALUE && plain_text(text),
            Some(Value::Number(_) | Value::Bool(_)) => true,
            _ => false,
        };
        if !fine {
            return Err(format!(
                "The filter on “{key}” needs a value of up to {MAX_VALUE} characters"
            ));
        }
        let day = wanted.and_then(Value::as_str).and_then(|s| s.get(..10));
        if matches!(op, "before" | "after") && !day.is_some_and(is_real_day) {
            return Err(format!("“{op}” on “{key}” needs a day, such as 2026-10-01"));
        }
    }
    Ok(())
}

pub fn sort(value: &Value) -> Check {
    let Some(list) = value.as_array() else {
        return Err("“sort” is a list".to_owned());
    };
    if list.len() > MAX_SORTS {
        return Err(format!("A collection sorts by at most {MAX_SORTS} keys"));
    }
    for entry in list {
        let key = key_of(entry, "sort")?;
        if let Some(dir) = entry.get("dir")
            && !matches!(dir.as_str(), Some("asc" | "desc"))
        {
            return Err(format!("Sorting by “{key}” goes asc or desc"));
        }
    }
    Ok(())
}

pub fn display(value: &Value) -> Check {
    let Some(map) = value.as_object() else {
        return Err("“display” is a type, columns and a limit".to_owned());
    };
    if let Some(kind) = map.get("type")
        && !kind.as_str().is_some_and(|k| DISPLAY_TYPES.contains(&k))
    {
        return Err(format!(
            "A collection is shown as one of {}",
            DISPLAY_TYPES.join(", ")
        ));
    }
    if let Some(columns) = map.get("columns") {
        let fine = columns.as_array().is_some_and(|list| {
            list.len() <= MAX_COLUMNS
                && list.iter().all(|c| {
                    c.as_str().is_some_and(|c| {
                        !c.trim().is_empty() && c.chars().count() <= MAX_KEY && plain_text(c)
                    })
                })
        });
        if !fine {
            return Err(format!(
                "Columns are a list of up to {MAX_COLUMNS} property names"
            ));
        }
    }
    if let Some(limit) = map.get("limit")
        && !limit.as_u64().is_some_and(|n| (1..=MAX_LIMIT).contains(&n))
    {
        return Err(format!("A limit is a number from 1 to {MAX_LIMIT}"));
    }
    Ok(())
}

/// The check for the top-level key `key`; none for a key edits cannot set.
pub fn of_key(key: &str) -> Option<fn(&Value) -> Check> {
    match key {
        "icon" => Some(icon),
        "query" => Some(query),
        "when" => Some(when),
        "filter" => Some(filter),
        "sort" => Some(sort),
        "display" => Some(display),
        _ => None,
    }
}
