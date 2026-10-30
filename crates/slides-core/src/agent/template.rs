//! `apply_deck_template`: the look of another deck (a template is a deck whose look is the point)
//! put on a deck, through the `apply_template` operation. The operation takes a theme and a page
//! size as data, which an assistant cannot write; this tool takes the deck to copy them from.

use serde_json::{Value, json};

use super::edit::apply_all;
use super::session::{Agent, full_name};
use super::store::Store;
use super::{ToolError, ToolResult};
use crate::canonical;

pub fn apply_deck_template(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let given = args
        .get("template")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| {
            ToolError::new(
                "Say which deck's look to take with `template`: the path or title of a template, or of any deck.",
            )
        })?;
    let resize = match args.get("resize") {
        None | Some(Value::Null) => false,
        Some(value) => value
            .as_bool()
            .ok_or_else(|| ToolError::new("`resize` is true or false."))?,
    };
    let template = store.read(&full_name(given))?;
    if template.name == name {
        return Err(ToolError::new(format!(
            "`{name}` cannot take its own look from itself. Name another deck in `template`."
        )));
    }
    let look = canonical::parse(&template.text).map_err(|e| {
        ToolError::new(format!(
            "The deck `{}` cannot be read, so its look cannot be used: {e}",
            template.name
        ))
    })?;
    let input = json!({
        "theme": to_json(&look.theme)?,
        "size": to_json(&look.size)?,
        "resize": resize,
    });
    let edited = agent.edit(store, &name, None, |engine| {
        apply_all(engine, vec![("apply_template".to_owned(), input)])?;
        Ok(json!({ "template": template.name, "resize": resize }))
    })?;
    agent.answer(store, &edited, json!({}))
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<Value, ToolError> {
    serde_json::to_value(value)
        .map_err(|e| ToolError::new(format!("The template's look could not be read: {e}")))
}
