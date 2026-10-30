//! A tag database's view applied to notes: its filters and sorts as the app
//! applies them (`app/src/features/tags/model.ts`), so an agent's `query_tag`
//! sees what the person sees.

use std::cmp::Ordering;

use serde_json::{Value, json};

use crate::note::NoteMeta;
use crate::tags::{PropDef, TagSchema};

/// A note's value for `key`: its property, else a built-in field (title,
/// created, updated, modified).
pub fn value_of(note: &NoteMeta, key: &str) -> Value {
    if let Some(value) = note.props.get(key) {
        return value.clone();
    }
    let text = |field: &Option<String>| field.clone().map_or(Value::Null, Value::String);
    match key {
        "title" => Value::String(note.title.clone()),
        "created" => text(&note.created),
        "updated" => text(&note.updated),
        "modified" => Value::from(note.modified),
        _ => Value::Null,
    }
}

fn is_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(s) => s.is_empty(),
        Value::Array(items) => items.is_empty(),
        _ => false,
    }
}

fn text_of(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.to_lowercase(),
        Value::Array(items) => items.iter().map(text_of).collect::<Vec<_>>().join(" "),
        other => other.to_string().to_lowercase(),
    }
}

fn day_of(value: &Value) -> Option<&str> {
    let text = value.as_str()?;
    let day = text.get(..10)?;
    let bytes = day.as_bytes();
    let shaped = bytes.iter().enumerate().all(|(i, b)| {
        if i == 4 || i == 7 {
            *b == b'-'
        } else {
            b.is_ascii_digit()
        }
    });
    shaped.then_some(day)
}

fn truthy(value: &Value) -> bool {
    *value == Value::Bool(true) || value.as_str() == Some("true")
}

fn is_checkbox(def: Option<&PropDef>) -> bool {
    def.is_some_and(|d| d.kind == "checkbox")
}

fn same(value: &Value, wanted: &Value, def: Option<&PropDef>) -> bool {
    if is_checkbox(def) {
        return truthy(value) == truthy(wanted);
    }
    if let Value::Array(items) = value {
        return items.iter().any(|v| same(v, wanted, None));
    }
    !is_empty(value) && text_of(value) == text_of(wanted)
}

/// Whether a note passes one filter, `{key, op, value}`, with `op` one of
/// is, is_not, contains, empty, not_empty, before, after. A filter it
/// cannot read lets every note through.
pub fn passes(note: &NoteMeta, filter: &Value, def: Option<&PropDef>) -> bool {
    let Some(key) = filter.get("key").and_then(Value::as_str) else {
        return true;
    };
    let wanted = filter.get("value").unwrap_or(&Value::Null);
    let value = value_of(note, key);
    let unset = is_empty(&value) || (is_checkbox(def) && !truthy(&value));
    match filter.get("op").and_then(Value::as_str).unwrap_or("is") {
        "empty" => unset,
        "not_empty" => !unset,
        "is" => same(&value, wanted, def),
        "is_not" => !same(&value, wanted, def),
        "contains" => text_of(&value).contains(&text_of(wanted)),
        "before" => matches!((day_of(&value), day_of(wanted)), (Some(a), Some(b)) if a < b),
        "after" => matches!((day_of(&value), day_of(wanted)), (Some(a), Some(b)) if a > b),
        // Numbers, for number properties and formulas that give numbers.
        op @ ("gt" | "gte" | "lt" | "lte") => match (as_number(&value), as_number(wanted)) {
            (Some(a), Some(b)) => match op {
                "gt" => a > b,
                "gte" => a >= b,
                "lt" => a < b,
                _ => a <= b,
            },
            _ => false,
        },
        _ => true,
    }
}

/// A number, or text that is one; `None` for anything else.
fn as_number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.trim().parse().ok()))
        .filter(|n| n.is_finite())
}

fn number(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.trim().parse().ok()))
        .unwrap_or(0.0)
}

fn first_text(value: &Value) -> String {
    match value {
        Value::Array(items) => items.first().map(text_of).unwrap_or_default(),
        other => text_of(other),
    }
}

/// Two present values in the property's order: numbers by size, dates by
/// day (as text), selects by their options' order, the rest as text.
fn compare(a: &Value, b: &Value, def: Option<&PropDef>, key: &str) -> Ordering {
    let kind = def.map(|d| d.kind.as_str()).unwrap_or(match key {
        "modified" => "number",
        "created" | "updated" => "date",
        _ => "text",
    });
    match (kind, def) {
        // A total order, so values that are not numbers can never upset a sort.
        ("number", _) => number(a).total_cmp(&number(b)),
        ("checkbox", _) => truthy(a).cmp(&truthy(b)),
        // A formula gives numbers or text; two numbers sort as numbers.
        ("formula", _) if a.is_number() && b.is_number() => number(a).total_cmp(&number(b)),
        ("select", Some(def)) => {
            let at = |v: &Value| {
                let text = text_of(v);
                def.options
                    .iter()
                    .position(|o| o.to_lowercase() == text)
                    .unwrap_or(def.options.len())
            };
            at(a).cmp(&at(b)).then_with(|| text_of(a).cmp(&text_of(b)))
        }
        _ => first_text(a).cmp(&first_text(b)),
    }
}

/// The notes a saved view shows: its `filter` list, then its `sort` list;
/// empty values sort last either way and titles break ties.
pub fn apply_view(notes: Vec<NoteMeta>, view: &Value, schema: Option<&TagSchema>) -> Vec<NoteMeta> {
    let def = |key: &str| schema.and_then(|s| s.properties.iter().find(|p| p.key == key));
    let empty = Vec::new();
    let filters = view
        .get("filter")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let sorts: Vec<(&str, bool)> = view
        .get("sort")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter_map(|s| {
            Some((
                s.get("key")?.as_str()?,
                s.get("dir").and_then(Value::as_str) == Some("desc"),
            ))
        })
        .collect();
    // `filter_mode: any` keeps a note that passes at least one filter.
    let any = view.get("filter_mode").and_then(Value::as_str) == Some("any");
    let mut rows: Vec<NoteMeta> = notes
        .into_iter()
        .filter(|n| {
            let ok = |f: &Value| passes(n, f, f.get("key").and_then(Value::as_str).and_then(def));
            if any && !filters.is_empty() {
                filters.iter().any(ok)
            } else {
                filters.iter().all(ok)
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        for &(key, desc) in &sorts {
            let (va, vb) = (value_of(a, key), value_of(b, key));
            match (is_empty(&va), is_empty(&vb)) {
                (true, true) => continue,
                (true, false) => return Ordering::Greater,
                (false, true) => return Ordering::Less,
                (false, false) => {}
            }
            let order = compare(&va, &vb, def(key), key);
            if order != Ordering::Equal {
                return if desc { order.reverse() } else { order };
            }
        }
        a.title.to_lowercase().cmp(&b.title.to_lowercase())
    });
    rows
}

/// A board's columns with their counts: the select's options in order, then
/// values the schema does not list, with "No <key>" first when some notes
/// have none.
pub fn board_columns(notes: &[NoteMeta], def: &PropDef) -> Value {
    let mut columns: Vec<(Value, String, usize)> = def
        .options
        .iter()
        .map(|o| (Value::String(o.clone()), o.clone(), 0))
        .collect();
    let mut none = 0;
    for note in notes {
        let text = match value_of(note, &def.key) {
            Value::String(s) => s.trim().to_owned(),
            Value::Array(items) => items
                .first()
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            _ => String::new(),
        };
        if text.is_empty() {
            none += 1;
            continue;
        }
        match columns
            .iter_mut()
            .find(|(_, label, _)| label.eq_ignore_ascii_case(&text))
        {
            Some(column) => column.2 += 1,
            None => columns.push((Value::String(text.clone()), text, 1)),
        }
    }
    let mut out: Vec<Value> = Vec::new();
    if none > 0 {
        out.push(json!({"value": null, "label": format!("No {}", def.key), "count": none}));
    }
    out.extend(
        columns
            .into_iter()
            .map(|(value, label, count)| json!({"value": value, "label": label, "count": count})),
    );
    Value::Array(out)
}

#[cfg(test)]
#[path = "tag_query_tests.rs"]
mod tests;
