//! The words for a deck that holds a value this build does not know: an element type, a transition,
//! a dash or the like that a newer version added. The refusal stays (a value that is not understood is
//! never guessed at); what changes is that the message names the field and says what to do.

use serde_json::Value;

/// A readable message for serde's `unknown variant` refusal of `value`, or `None` for any other.
pub(super) fn explain(message: &str, value: &Value) -> Option<String> {
    let rest = message.strip_prefix("unknown variant `")?;
    let (name, after) = rest.split_once('`')?;
    let field = match find(value, name, "") {
        Some(path) if !path.is_empty() => format!("`{path}`"),
        _ => "a field".to_owned(),
    };
    let known = after
        .strip_prefix(", expected one of ")
        .or_else(|| after.strip_prefix(", expected "))
        .map(|list| list.replace('`', ""))
        .filter(|list| !list.is_empty() && !list.contains("no variants"));
    let knows = known.map_or_else(String::new, |list| format!(" (it knows {list})"));
    Some(format!(
        "{field} is `{name}`, a value this version of KastenFlow Slides does not know{knows}. \
         The deck was probably made by a newer version: update KastenFlow Slides to open it."
    ))
}

/// Where in the deck a string equal to `name` stands, as `slides[2].elements[0].type`.
fn find(value: &Value, name: &str, path: &str) -> Option<String> {
    match value {
        Value::String(text) if text == name => Some(path.to_owned()),
        Value::Object(map) => map.iter().find_map(|(key, child)| {
            let at = if path.is_empty() {
                key.clone()
            } else {
                format!("{path}.{key}")
            };
            find(child, name, &at)
        }),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .find_map(|(i, child)| find(child, name, &format!("{path}[{i}]"))),
        _ => None,
    }
}
