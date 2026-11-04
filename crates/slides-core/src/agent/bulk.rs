//! `set_notes_bulk`: speaker notes for many slides in one change.

use serde_json::{Value, json};

use super::edit::apply_all;
use super::read::slide_id;
use super::session::Agent;
use super::store::Store;
use super::{ToolError, ToolResult};

/// The most slides one call writes notes for.
const MOST_NOTES: usize = 200;

/// The slide and the notes asked for in each entry of `notes`, and the problems with the entries.
fn entries(args: &Value) -> (Vec<(Value, String)>, Vec<String>) {
    let (mut found, mut errors) = (Vec::new(), Vec::new());
    match args.get("notes") {
        Some(Value::Array(list)) => {
            for (i, item) in list.iter().enumerate() {
                let slide = item.get("slide").filter(|s| s.is_string() || s.is_number());
                let notes = item.get("notes").and_then(Value::as_str);
                match (slide, notes) {
                    (Some(slide), Some(notes)) => found.push((slide.clone(), notes.to_owned())),
                    (None, _) => errors.push(format!(
                        "`notes[{i}].slide` is missing: a slide's id or number"
                    )),
                    (_, None) => errors.push(format!(
                        "`notes[{i}].notes` must be text (Markdown); empty clears the notes"
                    )),
                }
            }
        }
        Some(Value::Object(map)) => {
            for (slide, notes) in map {
                match notes.as_str() {
                    Some(notes) => found.push((json!(slide), notes.to_owned())),
                    None => errors.push(format!(
                        "`notes.{slide}` must be text (Markdown); empty clears the notes"
                    )),
                }
            }
        }
        _ => errors
            .push("`notes` is a list of {slide, notes}, or an object of slide to notes".to_owned()),
    }
    if found.len() + errors.len() > MOST_NOTES {
        errors.push(format!(
            "`notes` holds more than {MOST_NOTES} entries: write them in more than one call"
        ));
    }
    (found, errors)
}

pub fn set_notes_bulk(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (asked, mut errors) = entries(args);
    let edited = agent.edit(store, &name, None, |engine| {
        let mut operations = Vec::new();
        let mut slides: Vec<String> = Vec::new();
        for (n, (slide, notes)) in asked.iter().enumerate() {
            match slide_id(engine.deck(), slide) {
                Ok(id) if slides.contains(&id) => {
                    errors.push(format!(
                        "`notes` names slide {id} more than once (entry {})",
                        n + 1
                    ));
                }
                Ok(id) => {
                    operations.push((
                        "set_notes".to_owned(),
                        json!({ "slide": id, "notes": notes }),
                    ));
                    slides.push(id);
                }
                Err(e) => errors.push(format!("entry {} of `notes`: {}", n + 1, e.message)),
            }
        }
        if !errors.is_empty() {
            return Err(ToolError::new(format!(
                "Nothing was changed. {}",
                errors.join(" ")
            )));
        }
        apply_all(engine, operations)?;
        Ok(json!({ "slides": slides }))
    })?;
    agent.answer(store, &edited, json!({}))
}
