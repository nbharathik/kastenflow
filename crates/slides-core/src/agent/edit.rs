//! The tools that change slides: every operation of the engine as a tool of
//! its own name, a batch of them, and a few that take the shape an agent
//! reaches for (a layout by name, slides in a new order, a Morph).

use std::collections::HashSet;

use serde_json::{Value, json};

use super::read::slide_id;
use super::session::Agent;
use super::store::Store;
use super::{ToolError, ToolResult};
use crate::markdown;
use crate::model::{Deck, Element, Text};
use crate::ops::{self, Engine};

/// The most operations one batch holds.
const MOST_OPERATIONS: usize = 200;
/// The most copies one call makes of a slide.
const MOST_COPIES: u64 = 10;

/// What follows `$` in a reference to the answer of an earlier operation of a batch: `1.slide`.
fn look_up(results: &[Value], path: &str) -> Option<Value> {
    let mut parts = path.split('.');
    let mut at = results.get(parts.next()?.parse::<usize>().ok()?.checked_sub(1)?)?;
    for part in parts {
        at = match at {
            Value::Array(items) => items.get(part.parse::<usize>().ok()?)?,
            other => other.get(part)?,
        };
    }
    Some(at.clone())
}

/// Puts the answers of earlier operations where an input says `"$1.slide"`.
fn substitute(input: &mut Value, results: &[Value]) -> Result<(), ToolError> {
    match input {
        Value::String(s)
            if s.starts_with('$')
                && s.len() > 1
                && s[1..].chars().next().is_some_and(|c| c.is_ascii_digit()) =>
        {
            let found = look_up(results, &s[1..]);
            *input = found.ok_or_else(|| ToolError::new(format!("`{s}` names nothing: it must be the number of an earlier operation of the batch, a dot, and a name in what that operation returned, such as `$1.slide`.")))?;
        }
        Value::Array(items) => items.iter_mut().try_for_each(|v| substitute(v, results))?,
        Value::Object(map) => map.values_mut().try_for_each(|v| substitute(v, results))?,
        _ => {}
    }
    Ok(())
}

/// Lets a text or shape element say its words in `markdown`.
fn expand_markdown(elements: &mut Value) {
    let Some(list) = elements.as_array_mut() else {
        return;
    };
    for element in list {
        let Some(map) = element.as_object_mut() else {
            continue;
        };
        if let Some(Value::String(md)) = map.get("markdown").cloned() {
            let text = Text::from_paragraphs(markdown::parse(&md));
            if let Ok(value) = serde_json::to_value(text) {
                map.remove("markdown");
                map.insert("text".to_owned(), value);
            }
        }
        if let Some(children) = map.get_mut("children") {
            expand_markdown(children);
        }
    }
}

/// Makes an operation's input what the engine wants: slides named by their place become ids, Markdown becomes text.
fn prepare(deck: &Deck, op: &str, input: &mut Value) -> Result<(), ToolError> {
    super::comments::mark_as_assistants(op, input);
    if let Some(Value::String(_) | Value::Number(_)) = input.get("slide") {
        let id = slide_id(deck, &input["slide"])?;
        input["slide"] = Value::String(id);
    }
    if op == "add_elements"
        && let Some(elements) = input.get_mut("elements")
    {
        expand_markdown(elements);
        super::embeds::note_providers(elements);
    }
    Ok(())
}

/// Operations that are a person's to do. The marks that show an assistant's work are taken off by the person
/// who accepts it, never by the assistant: it can neither call these nor put them in a batch.
pub(super) const PERSONS: &[&str] = &["accept_marks"];

/// The operations a change removes content with: a copy of the deck is kept first.
/// Tools that are an operation under another name and take the same input, so a batch takes either name.
const ALIASES: &[(&str, &str)] = &[("apply_layout", "set_layout")];

fn removes(op: &str) -> Option<&'static str> {
    match op {
        "delete_slides" => Some("before delete_slides"),
        _ => None,
    }
}

/// Runs the operations one after another, so a later one can use the answer of an earlier; if one fails, the earlier ones are taken back.
pub(super) fn apply_all(
    engine: &mut Engine,
    operations: Vec<(String, Value)>,
) -> Result<Vec<Value>, ToolError> {
    let total = operations.len();
    let mut results: Vec<Value> = Vec::new();
    for (n, (op, mut input)) in operations.into_iter().enumerate() {
        let done = |e: ToolError| step_error(n, total, &op, e);
        if PERSONS.contains(&op.as_str()) {
            let why = ToolError::new(format!(
                "`{op}` is the person's to do: an assistant's work is accepted by the person who looks at it, not by the assistant."
            ));
            for _ in 0..n {
                engine.undo();
            }
            return Err(done(why));
        }
        substitute(&mut input, &results).map_err(done)?;
        prepare(engine.deck(), &op, &mut input).map_err(|e| step_error(n, total, &op, e))?;
        // Raw elements are made by an import, not by an assistant.
        let applied = super::raw::refuse(engine.deck(), &op, &input)
            .and_then(|()| engine.apply(&op, input).map_err(ToolError::from));
        match applied {
            Ok(applied) => results.push(applied.output),
            Err(e) => {
                for _ in 0..n {
                    engine.undo();
                }
                return Err(step_error(n, total, &op, e));
            }
        }
    }
    Ok(results)
}

/// A failed operation, said plainly for a single one and with its place in a batch for several.
fn step_error(n: usize, total: usize, op: &str, e: ToolError) -> ToolError {
    if total == 1 {
        return e;
    }
    ToolError::new(format!(
        "Operation {} of {total} (`{op}`) failed, so none of the batch was applied: {}",
        n + 1,
        e.message
    ))
}

/// One operation of the engine as a tool: `deck` names the deck, the rest is the operation's input.
pub fn run_op(agent: &mut Agent, store: &mut dyn Store, op: &str, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let mut input = args.clone();
    if let Some(map) = input.as_object_mut() {
        map.remove("deck");
    }
    let edited = agent.edit(store, &name, removes(op), |engine| {
        let mut results = apply_all(engine, vec![(op.to_owned(), input)])?;
        Ok(results.pop().unwrap_or(Value::Null))
    })?;
    agent.answer(store, &edited, json!({}))
}

pub fn update_elements(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let list = args.get("operations").and_then(Value::as_array).ok_or_else(|| ToolError::new("`operations` is a list of {\"op\": name, \"input\": {...}}: the operations to apply together."))?;
    if list.is_empty() || list.len() > MOST_OPERATIONS {
        return Err(ToolError::new(format!(
            "Give between 1 and {MOST_OPERATIONS} operations in `operations`."
        )));
    }
    let known: Vec<&str> = ops::names()
        .into_iter()
        .filter(|name| !PERSONS.contains(name))
        .collect();
    let mut operations = Vec::new();
    for (n, item) in list.iter().enumerate() {
        let given = item.get("op").and_then(Value::as_str).unwrap_or("");
        let op = ALIASES
            .iter()
            .find(|(tool, _)| *tool == given)
            .map_or(given, |(_, op)| *op);
        if PERSONS.contains(&op) {
            return Err(ToolError::new(format!(
                "Operation {} names `{given}`, which is the person's to do: an assistant's work is accepted by the person who looks at it, not by the assistant.",
                n + 1
            )));
        }
        if !known.contains(&op) {
            let why = if super::tools().iter().any(|t| t.name == given) {
                "a tool of its own, which takes other input than an operation does, so it cannot be part of a batch: call it by itself"
            } else {
                "not an operation"
            };
            return Err(ToolError::new(format!(
                "Operation {} names `{given}`, which is {why}. The operations a batch takes are: {}.",
                n + 1,
                known.join(", ")
            )));
        }
        operations.push((
            op.to_owned(),
            item.get("input").cloned().unwrap_or_else(|| json!({})),
        ));
    }
    let keep = operations.iter().find_map(|(op, _)| removes(op));
    let count = operations.len();
    let edited = agent.edit(store, &name, keep, |engine| apply_all(engine, operations))?;
    agent.answer(store, &edited, json!({ "operations": count }))
}

pub fn apply_layout(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let input = json!({ "slide": args.get("slide").cloned().unwrap_or(Value::Null), "layout": args.get("layout").cloned().unwrap_or(Value::Null) });
    let edited = agent.edit(store, &name, None, |engine| {
        let mut results = apply_all(engine, vec![("set_layout".to_owned(), input)])?;
        Ok(results.pop().unwrap_or(Value::Null))
    })?;
    agent.answer(store, &edited, json!({}))
}

pub fn duplicate_slide(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let count = args.get("count").and_then(Value::as_u64).unwrap_or(1);
    if !(1..=MOST_COPIES).contains(&count) {
        return Err(ToolError::new(format!(
            "`count` is between 1 and {MOST_COPIES}."
        )));
    }
    let edited = agent.edit(store, &name, None, |engine| {
        let id = slide_id(engine.deck(), args.get("slide").unwrap_or(&Value::Null))?;
        let mut made = Vec::new();
        for _ in 0..count {
            let applied = engine.apply("duplicate_slides", json!({ "ids": [id] }))?;
            made.extend(
                applied.output["slides"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default(),
            );
        }
        Ok(json!({ "slides": made }))
    })?;
    agent.answer(store, &edited, json!({}))
}

pub fn reorder_slides(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let order = args.get("order").and_then(Value::as_array).ok_or_else(|| {
        ToolError::new(
            "`order` is the list of every slide, in the order you want them: ids or numbers.",
        )
    })?;
    let edited = agent.edit(store, &name, None, |engine| {
        let mut wanted = Vec::new();
        for item in order {
            wanted.push(slide_id(engine.deck(), item)?);
        }
        let have: HashSet<&str> = engine.deck().slides.iter().map(|s| s.id.as_str()).collect();
        let named: HashSet<&str> = wanted.iter().map(String::as_str).collect();
        if wanted.len() != have.len() || named != have {
            let ids: Vec<&str> = engine.deck().slides.iter().map(|s| s.id.as_str()).collect();
            return Err(ToolError::new(format!(
                "`order` must list every slide once. The deck has {} slides: {}.",
                ids.len(),
                ids.join(", ")
            )));
        }
        let moves = wanted
            .iter()
            .enumerate()
            .map(|(to, id)| ("move_slides".to_owned(), json!({ "ids": [id], "to": to })))
            .collect();
        apply_all(engine, moves)?;
        Ok(json!({ "order": wanted }))
    })?;
    agent.answer(store, &edited, json!({}))
}

/// How many elements two slides share by id or by Morph pairing.
fn shared(a: &[Element], b: &[Element]) -> usize {
    fn keys(list: &[Element], out: &mut HashSet<String>) {
        for e in list {
            out.insert(e.id().to_owned());
            if let Some(m) = &e.base().morph_id {
                out.insert(m.clone());
            }
            keys(e.children(), out);
        }
    }
    let (mut x, mut y) = (HashSet::new(), HashSet::new());
    keys(a, &mut x);
    keys(b, &mut y);
    x.intersection(&y).count()
}

pub fn set_morph(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let edited = agent.edit(store, &name, None, |engine| {
        let id = slide_id(engine.deck(), args.get("slide").unwrap_or(&Value::Null))?;
        let at = engine.deck().index_of(&id).unwrap_or(0);
        if at == 0 {
            return Err(ToolError::new("The first slide has no slide before it to morph from. Put the Morph on the slide that follows the one it changes from."));
        }
        let mut transition = json!({ "kind": "morph" });
        if let Some(duration) = args.get("duration").filter(|d| !d.is_null()) {
            transition["duration"] = duration.clone();
        }
        let deck = engine.deck();
        let common = shared(&deck.slides[at - 1].elements, &deck.slides[at].elements);
        engine.apply("set_transition", json!({ "ids": [id], "transition": transition }))?;
        Ok(json!({
            "sharedWithPrevious": common,
            "note": if common == 0 { "No element of this slide shares an id (or morphId) with the slide before, so Morph will only fade. Copy the slide with duplicate_slide and change the copy: the copy keeps every element's id." } else { "Morph moves and resizes the elements the two slides share." },
        }))
    })?;
    agent.answer(store, &edited, json!({}))
}
