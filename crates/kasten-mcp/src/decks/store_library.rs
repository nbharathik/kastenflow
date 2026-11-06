//! The layout library as the deck tools see it: each usable entry in brief, for `list_layouts`. The
//! entries are read through kasten-core; a file that cannot be read is left out, not an error.

use kasten_core::Kasten;
use serde_json::{Value, json};

/// The library's entries, each as `{ id, label, slots: [{ role, kind }], decoration }`.
pub(super) fn entries(kasten: &Kasten) -> Vec<Value> {
    let Ok(listed) = kasten.layout_library() else {
        return Vec::new();
    };
    listed
        .into_iter()
        .filter(|info| info.problem.is_none())
        .filter_map(|info| {
            let file = kasten.library_layout(&info.path).ok()?;
            let value: Value = serde_json::from_str(&file.text).ok()?;
            let layout = value.get("layout")?;
            let slots: Vec<Value> = layout
                .get("placeholders")
                .and_then(Value::as_array)
                .map(|slots| {
                    slots
                        .iter()
                        .map(|slot| json!({ "role": slot["role"], "kind": slot["kind"] }))
                        .collect()
                })
                .unwrap_or_default();
            let decoration = layout
                .get("elements")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            Some(json!({
                "id": info.id,
                "label": info.label,
                "slots": slots,
                "decoration": decoration,
            }))
        })
        .collect()
}
