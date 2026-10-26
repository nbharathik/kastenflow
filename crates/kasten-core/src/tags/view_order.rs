//! The `order` of a view: the ids of the notes in the order a person put them
//! by dragging, stored in the view's own YAML (`order: [id, id, …]`). A reader
//! uses it only when the view has no sort; ids no row has are ignored and rows
//! the list does not name follow at the end.
//!
//! Only the type of the setting is checked when a view is saved with it; what
//! an op stores is cleaned first (`clean_ids`).

use serde_json::Value;

/// The most ids one view stores. A database is shown a page at a time and a
/// hand-ordered one stays small; a bigger list is a mistake, not an order.
pub const MAX_IDS: usize = 5000;

/// The longest id. Ids are 26 characters; this leaves room for any other.
const MAX_ID_CHARS: usize = 100;

fn name_of(view: &Value) -> &str {
    view.get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("view")
}

/// Checks the `order` setting of one view (any kind): absent, `null` or a list
/// of ids written as text. The error is a plain sentence naming the view.
pub fn check_view(view: &Value) -> Result<(), String> {
    let bad = || {
        format!(
            "The view “{}” has an order setting that is not a list of ids",
            name_of(view)
        )
    };
    match view.get("order") {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Array(items)) => {
            if items.iter().all(Value::is_string) {
                Ok(())
            } else {
                Err(bad())
            }
        }
        Some(_) => Err(bad()),
    }
}

/// The ids to store: each trimmed, none empty or holding a line break or other
/// control character, the first of any repeated id kept, at most `MAX_IDS`.
pub fn clean_ids(ids: &[String]) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::with_capacity(ids.len().min(MAX_IDS));
    for id in ids {
        let id = id.trim();
        if id.is_empty() {
            return Err("an id is empty".to_owned());
        }
        if id.chars().count() > MAX_ID_CHARS || id.chars().any(char::is_control) {
            return Err(format!(
                "“{}” is not an id",
                id.chars().take(40).collect::<String>()
            ));
        }
        if !out.iter().any(|seen| seen == id) {
            out.push(id.to_owned());
        }
    }
    if out.len() > MAX_IDS {
        return Err(format!(
            "it names {} notes; a view keeps the order of at most {MAX_IDS}",
            out.len()
        ));
    }
    Ok(out)
}

/// `view` with its `order` set to `ids` (a new `order` goes after the view's
/// other settings; an old one keeps its place), or taken out when `ids` is
/// empty. `None` when the view already says that.
pub fn with_order(view: &Value, ids: &[String]) -> Option<Value> {
    let Value::Object(map) = view else {
        return None;
    };
    let wanted: Vec<Value> = ids.iter().cloned().map(Value::String).collect();
    let mut map = map.clone();
    match (map.get("order"), ids.is_empty()) {
        (None, true) => return None,
        (Some(Value::Array(old)), false) if *old == wanted => return None,
        (Some(_), true) => {
            map.shift_remove("order");
        }
        (_, _) => {
            map.insert("order".to_owned(), Value::Array(wanted));
        }
    }
    Some(Value::Object(map))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn the_setting_is_a_list_of_text() {
        assert!(check_view(&json!({"name": "A", "type": "table"})).is_ok());
        assert!(check_view(&json!({"name": "A", "order": null})).is_ok());
        assert!(check_view(&json!({"name": "A", "order": ["x", "y"]})).is_ok());
        for bad in [
            json!("x"),
            json!([1, 2]),
            json!({"a": 1}),
            json!(["x", null]),
        ] {
            let why = check_view(&json!({"name": "Rows", "order": bad})).unwrap_err();
            assert!(
                why.contains("“Rows”") && why.contains("list of ids"),
                "{why}"
            );
        }
    }

    #[test]
    fn ids_are_cleaned_and_checked() {
        let ids = |list: &[&str]| list.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert_eq!(
            clean_ids(&ids(&[" a ", "b", "a"])).unwrap(),
            ids(&["a", "b"])
        );
        assert!(clean_ids(&ids(&["a", " "])).is_err());
        assert!(clean_ids(&ids(&["a\nb"])).is_err());
        assert!(clean_ids(&ids(&[&"x".repeat(101)])).is_err());
        let many: Vec<String> = (0..=MAX_IDS).map(|n| format!("id{n}")).collect();
        assert!(clean_ids(&many).unwrap_err().contains("at most 5000"));
        assert_eq!(clean_ids(&many[..MAX_IDS]).unwrap().len(), MAX_IDS);
    }

    #[test]
    fn the_order_goes_last_or_stays_where_it_was() {
        let view = json!({"name": "All", "type": "table", "custom": {"a": 1}});
        let set = with_order(&view, &["b".into(), "a".into()]).unwrap();
        assert_eq!(
            serde_json::to_string(&set).unwrap(),
            r#"{"name":"All","type":"table","custom":{"a":1},"order":["b","a"]}"#
        );
        let again = with_order(&set, &["a".into()]).unwrap();
        assert_eq!(again["order"], json!(["a"]));
        assert_eq!(
            again.as_object().unwrap().keys().collect::<Vec<_>>(),
            ["name", "type", "custom", "order"]
        );
        assert_eq!(with_order(&again, &["a".into()]), None, "already so");
        let cleared = with_order(&again, &[]).unwrap();
        assert!(cleared.get("order").is_none());
        assert_eq!(with_order(&cleared, &[]), None);
    }
}
