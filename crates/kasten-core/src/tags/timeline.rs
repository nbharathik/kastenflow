//! The settings of a `timeline` view:
//! `{name, type: timeline, start: <date>, end: <date?>, group_by: <choice?>, scale: week|month|quarter}`.
//!
//! The check is a pure function over the view and a way to look up a
//! property's type, so a whole schema (properties and views together) and a
//! views-only change are held to the same rules. Keys it does not know are
//! kept as written; only the ones it names are checked.

use serde_json::Value;

/// The zoom levels of a timeline.
pub const SCALES: [&str; 3] = ["week", "month", "quarter"];

/// Property types a timeline reads dates from (a formula may give a date).
const DATE_KINDS: [&str; 2] = ["date", "formula"];

/// Property types a timeline can make lanes from.
const LANE_KINDS: [&str; 3] = ["select", "multi_select", "relation"];

fn setting<'a>(view: &'a Value, key: &str) -> Option<&'a str> {
    view.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Checks one timeline view. `kind_of` gives the type of the property a key
/// names, or `None` when the tag has no such property. Errors are plain
/// sentences naming the view and the setting.
pub fn check_view<'a>(
    view: &Value,
    kind_of: &dyn Fn(&str) -> Option<&'a str>,
) -> Result<(), String> {
    let name = setting(view, "name").unwrap_or("timeline");
    let bad = |why: String| format!("The timeline “{name}” {why}");
    let Some(start) = setting(view, "start") else {
        return Err(bad(
            "needs a start: the date property its bars begin at".into()
        ));
    };
    match kind_of(start) {
        None => {
            return Err(bad(format!(
                "starts at “{start}”, which is not a property of this tag"
            )));
        }
        Some(kind) if !DATE_KINDS.contains(&kind) => {
            return Err(bad(format!(
                "starts at “{start}”, which is a {} property; a start must be a date",
                kind.replace('_', " ")
            )));
        }
        Some(_) => {}
    }
    if view.get("end").is_some_and(|v| !v.is_null()) {
        let Some(end) = setting(view, "end") else {
            return Err(bad("has an end that is not a property name".into()));
        };
        match kind_of(end) {
            None => {
                return Err(bad(format!(
                    "ends at “{end}”, which is not a property of this tag"
                )));
            }
            Some(kind) if !DATE_KINDS.contains(&kind) => {
                return Err(bad(format!(
                    "ends at “{end}”, which is a {} property; an end must be a date",
                    kind.replace('_', " ")
                )));
            }
            Some(_) => {}
        }
    }
    if view.get("group_by").is_some_and(|v| !v.is_null()) {
        let Some(group) = setting(view, "group_by") else {
            return Err(bad("has a group_by that is not a property name".into()));
        };
        match kind_of(group) {
            None => {
                return Err(bad(format!(
                    "groups by “{group}”, which is not a property of this tag"
                )));
            }
            Some(kind) if !LANE_KINDS.contains(&kind) => {
                return Err(bad(format!(
                    "groups by “{group}”, which is a {} property; lanes come from a select, multi select or relation property",
                    kind.replace('_', " ")
                )));
            }
            Some(_) => {}
        }
    }
    if let Some(scale) = view.get("scale").filter(|v| !v.is_null()) {
        let ok = scale.as_str().is_some_and(|s| SCALES.contains(&s));
        if !ok {
            return Err(bad(format!(
                "has a scale that is not one of {}",
                SCALES.join(", ")
            )));
        }
    }
    Ok(())
}
