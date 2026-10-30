//! The settings a `table` view adds to the common ones: `group_by`, `calcs`
//! (a calculation per column, shown in the table's foot and group headers),
//! the `sort` list, `wrap`, `density`, `filter_mode` and `freeze_title`.
//!
//! The check is a pure function over the view and a way to look up a
//! property's type. Keys it does not know are kept as written; settings other
//! kinds of view read under the same names (a board's `group_by`) are theirs.

use serde_json::Value;

/// Calculations every column offers.
const ANY: [&str; 4] = ["count", "count_empty", "count_not_empty", "unique"];
const NUMBERS: [&str; 6] = ["sum", "average", "median", "min", "max", "range"];
const DATES: [&str; 3] = ["earliest", "latest", "range"];

/// Every calculation, for the sentence that lists them.
const ALL: [&str; 13] = [
    "count",
    "count_empty",
    "count_not_empty",
    "unique",
    "percent_checked",
    "sum",
    "average",
    "median",
    "min",
    "max",
    "earliest",
    "latest",
    "range",
];

/// Property types a table can group by.
const GROUPABLE: [&str; 5] = ["select", "multi_select", "checkbox", "date", "relation"];

const DENSITIES: [&str; 2] = ["compact", "comfortable"];
const MODES: [&str; 2] = ["all", "any"];

/// The type of a field every note has, for views of a tag.
fn builtin(key: &str) -> Option<&'static str> {
    match key {
        "title" | "project" | "type" => Some("text"),
        "created" | "updated" => Some("date"),
        "modified" => Some("number"),
        "tags" => Some("multi_select"),
        _ => None,
    }
}

fn suits(kind: &str, fun: &str) -> bool {
    if ANY.contains(&fun) {
        return true;
    }
    match kind {
        "checkbox" => fun == "percent_checked",
        "number" => NUMBERS.contains(&fun),
        "date" => DATES.contains(&fun),
        // A calculated value may be a number or a date.
        "formula" => NUMBERS.contains(&fun) || DATES.contains(&fun),
        _ => false,
    }
}

fn name_of(view: &Value) -> &str {
    view.get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("table")
}

fn present<'a>(view: &'a Value, key: &str) -> Option<&'a Value> {
    view.get(key).filter(|v| !v.is_null())
}

/// Checks one table view; other kinds of view are left alone. `kind_of` gives
/// the type of the property a key names, or `None` when the tag has no such
/// property. Errors are plain sentences naming the view and the setting.
pub fn check_view<'a>(
    view: &Value,
    kind_of: &dyn Fn(&str) -> Option<&'a str>,
) -> Result<(), String> {
    if view.get("type").and_then(Value::as_str) != Some("table") {
        return Ok(());
    }
    let name = name_of(view);
    let bad = |why: String| format!("The table “{name}” {why}");
    let kind = |key: &str| kind_of(key).or_else(|| builtin(key));

    if let Some(group) = present(view, "group_by") {
        let Some(key) = group.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
            return Err(bad("has a group_by that is not a property name".into()));
        };
        let kind = kind_of(key).or(match key {
            "created" | "updated" => Some("date"),
            "project" | "type" => Some("select"),
            _ => None,
        });
        match kind {
            None => {
                return Err(bad(format!(
                    "groups by “{key}”, which is not a property of this tag"
                )));
            }
            Some(k) if !GROUPABLE.contains(&k) => {
                return Err(bad(format!(
                    "groups by “{key}”, which is a {} property; groups come from a select, multi select, checkbox, date or relation property",
                    k.replace('_', " ")
                )));
            }
            Some(_) => {}
        }
    }

    if let Some(calcs) = present(view, "calcs") {
        let Some(map) = calcs.as_object() else {
            return Err(bad(
                "has a calcs setting that is not a list of column: calculation".into(),
            ));
        };
        for (key, fun) in map {
            let Some(fun) = fun.as_str() else {
                return Err(bad(format!(
                    "calculates “{key}” with something that is not a calculation name"
                )));
            };
            if !ALL.contains(&fun) {
                return Err(bad(format!(
                    "calculates “{key}” with “{fun}”, which is not one of {}",
                    ALL.join(", ")
                )));
            }
            let Some(kind) = kind(key) else {
                return Err(bad(format!(
                    "calculates “{key}”, which is not a property of this tag"
                )));
            };
            if !suits(kind, fun) {
                return Err(bad(format!(
                    "cannot calculate “{fun}” for “{key}”, which is a {} property",
                    kind.replace('_', " ")
                )));
            }
        }
    }

    if let Some(sort) = present(view, "sort") {
        let Some(list) = sort.as_array() else {
            return Err(bad("has a sort setting that is not a list".into()));
        };
        for item in list {
            let key = item.get("key").and_then(Value::as_str).map(str::trim);
            if key.is_none_or(str::is_empty) {
                return Err(bad(
                    "has a sort without a key (the property to sort by)".into()
                ));
            }
            if let Some(dir) = present(item, "dir")
                && !dir.as_str().is_some_and(|d| d == "asc" || d == "desc")
            {
                return Err(bad("has a sort direction that is not asc or desc".into()));
            }
        }
    }

    for key in ["wrap", "freeze_title"] {
        if present(view, key).is_some_and(|v| !v.is_boolean()) {
            return Err(bad(format!(
                "has a {key} setting that is not true or false"
            )));
        }
    }
    for (key, allowed) in [("density", &DENSITIES[..]), ("filter_mode", &MODES[..])] {
        if present(view, key).is_some_and(|v| !v.as_str().is_some_and(|s| allowed.contains(&s))) {
            return Err(bad(format!(
                "has a {key} setting that is not one of {}",
                allowed.join(", ")
            )));
        }
    }
    Ok(())
}
