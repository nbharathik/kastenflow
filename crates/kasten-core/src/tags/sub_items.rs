//! The `sub_items: true` option of a view: show a note's sub-pages under it
//! (a note whose `parent` is the row's note). Only the type of the setting is
//! checked; a view without it, or with `null`, has sub-items off.

use serde_json::Value;

/// Checks the `sub_items` setting of one view (any kind): absent, `null`,
/// `true` or `false`. The error is a plain sentence naming the view.
pub fn check_view(view: &Value) -> Result<(), String> {
    match view.get("sub_items") {
        None | Some(Value::Null | Value::Bool(_)) => Ok(()),
        Some(_) => {
            let name = view
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("view");
            Err(format!(
                "The view “{name}” has a sub_items setting that is not true or false"
            ))
        }
    }
}
