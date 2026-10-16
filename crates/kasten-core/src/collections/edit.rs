//! Changing a collection's text one top-level key at a time, so the keys
//! this version does not know and the comments the person wrote stay exactly
//! as they were.

use serde_json::{Map, Value};

use super::{FORMAT, check};
use crate::error::{Error, Result};
use crate::frontmatter::yaml_scalar;
use crate::tag_yaml::set_value;

/// The keys an edit can set, in the order a new file gets them.
const KEYS: [&str; 6] = ["icon", "query", "when", "filter", "sort", "display"];

/// Refuses an edit that names a key it cannot set or holds a value a
/// collection may not, before anything is changed.
fn checked(edits: &Map<String, Value>) -> Result<()> {
    for (key, value) in edits {
        let Some(check) = check::of_key(key) else {
            let shown: String = key.chars().take(check::MAX_KEY).collect();
            return Err(Error::Invalid(format!(
                "A collection’s “{shown}” cannot be changed here: only {} can",
                KEYS.join(", ")
            )));
        };
        if !value.is_null() {
            check(value).map_err(Error::Invalid)?;
        }
    }
    Ok(())
}

/// `yaml` with `edits` made: each key set to its value, or taken out when
/// the value is `null`. Nothing else in the text changes.
pub fn edit_text(yaml: &str, edits: &Map<String, Value>) -> Result<String> {
    checked(edits)?;
    let mut out = yaml.to_owned();
    for key in KEYS {
        if let Some(value) = edits.get(key) {
            out = set_value(&out, key, (!value.is_null()).then_some(value));
        }
    }
    Ok(out)
}

/// The text of a new collection called `name` with `edits` made.
pub fn new_text(name: &str, edits: &Map<String, Value>) -> Result<String> {
    let name = check::name(name).map_err(Error::Invalid)?;
    let start = format!("format: {FORMAT}\nname: {}\n", yaml_scalar(&name));
    edit_text(&start, edits)
}

/// `yaml` with its `name` changed.
pub fn rename_text(yaml: &str, name: &str) -> Result<String> {
    let name = check::name(name).map_err(Error::Invalid)?;
    Ok(set_value(yaml, "name", Some(&Value::String(name))))
}
