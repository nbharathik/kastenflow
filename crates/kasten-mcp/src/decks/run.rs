//! Running one deck tool: slides-core's tool code on the vault's store, and
//! its answer in the shape every Kasten agent tool answers in.

use std::sync::atomic::AtomicBool;

use kasten_core::Kasten;
use kasten_core::agent::Session;
use serde_json::{Value, json};
use slides_core::agent::{self, Image, ToolOutput};

use super::adapt;
use super::store::{KastenStore, Request, Review, recorded_as};
use crate::tools::{STAGED_NOTE, Writes};

/// The most operations named in the words for a batch.
const OPERATIONS_NAMED: usize = 3;

/// What a deck tool answered.
pub(crate) struct Reply {
    /// For a client that reads JSON: what the tool answered, as data (a
    /// change comes in the envelope every write tool answers in).
    pub value: Value,
    /// For one that reads text, such as an MCP client.
    pub text: String,
    /// Pictures, when a tool draws.
    pub images: Vec<Image>,
}

fn words(name: &str) -> String {
    name.replace('_', " ")
}

/// What a tool does, in a few words for the history and the review. A batch
/// names its operations, so the history says what was done.
fn summary_of(tool: &str, args: &Value) -> String {
    if tool != "update_elements" {
        return words(tool);
    }
    let mut named: Vec<String> = Vec::new();
    for op in args["operations"].as_array().into_iter().flatten() {
        let name = op["op"].as_str().unwrap_or_default();
        let plain = !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c == '_');
        if plain && !named.iter().any(|n| n == name) {
            named.push(name.to_owned());
        }
    }
    if named.is_empty() {
        return words(tool);
    }
    let more = named.len() > OPERATIONS_NAMED;
    let shown: Vec<String> = named
        .iter()
        .take(OPERATIONS_NAMED)
        .map(|n| words(n))
        .collect();
    format!(
        "{} ({}{})",
        words(tool),
        shown.join(", "),
        if more { ", …" } else { "" }
    )
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// A change that waits for the person: what every write tool answers.
fn waiting(review: Review, session: Option<&Session>) -> Reply {
    let value = json!({
        "status": "pending_review",
        "proposal": review.proposal,
        "reason": review.reason,
        "note": "Nothing was changed. The person decides in Review; do not repeat the change.",
        "session": session.map(|s| s.id.as_str()),
    });
    Reply {
        text: pretty(&value),
        value,
        images: Vec::new(),
    }
}

/// A tool's answer. A look answers as it is; a change comes in the envelope
/// the note tools use, with the session it can be undone with.
fn answered(out: ToolOutput, read_only: bool, session: Option<&Session>, staged: bool) -> Reply {
    let data = out
        .data
        .clone()
        .unwrap_or_else(|| Value::String(out.text.clone()));
    if read_only {
        return Reply {
            value: data,
            text: out.text,
            images: out.images,
        };
    }
    let mut value = json!({
        "status": if staged { "staged" } else { "done" },
        "result": data,
        "session": session.map(|s| s.id.as_str()),
    });
    if staged {
        value["note"] = json!(STAGED_NOTE);
    }
    Reply {
        text: pretty(&value),
        value,
        images: out.images,
    }
}

/// Runs the deck tool `name` with `args`, blocking until it is done. Looks
/// need no session; changes are made in `session`, count against its
/// guardrails and commit as its agent. With `Writes::Staged` (a chat that
/// previews its changes) the deck tools read the chat's staged changes on top
/// of the vault, and their writes go into its change set, not the vault.
/// `cancel` is set when the caller no longer wants the answer, so a picture
/// it asked for is not drawn.
pub(crate) fn call_in(
    kasten: &Kasten,
    session: Option<&Session>,
    writes: Writes,
    cancel: Option<&AtomicBool>,
    name: &str,
    mut args: Value,
) -> Result<Reply, String> {
    let spec = adapt::find(name).ok_or_else(|| format!("tool not found: {name}"))?;
    if !spec.read_only && session.is_none() {
        return Err(format!(
            "`{name}` changes the vault, so it needs a session."
        ));
    }
    let sent = args.to_string().len();
    let project = match (name, args.as_object_mut()) {
        ("create_deck" | "import_pptx" | "deck_from_note", Some(map)) => map.remove("project"),
        _ => None,
    }
    .and_then(|p| p.as_str().map(|p| p.trim().to_owned()))
    .filter(|p| !p.is_empty());
    let request = Request {
        tool: recorded_as(name, &args),
        summary: summary_of(name, &args),
        sent,
        project,
    };
    let mut store = KastenStore::new(kasten, session, request).cancelled_by(cancel);
    if let Writes::Staged(set) = writes {
        store = store.staged(set);
    }
    let result = match name {
        "deck_from_note" => super::from_note::run(kasten, &mut store, &args),
        _ => agent::call(&mut store, name, args),
    };
    if let Some(review) = store.review.take() {
        return Ok(waiting(review, session));
    }
    let out = result.map_err(|e| e.message)?;
    let staged = matches!(writes, Writes::Staged(_));
    Ok(answered(out, spec.read_only, session, staged))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_batch_is_named_by_its_operations() {
        let batch = json!({ "operations": [
            { "op": "add_diagram", "input": {} }, { "op": "set_text" }, { "op": "add_diagram" },
            { "op": "align_elements" }, { "op": "delete_slides" },
        ]});
        assert_eq!(
            summary_of("update_elements", &batch),
            "update elements (add diagram, set text, align elements, …)"
        );
        assert_eq!(summary_of("update_elements", &json!({})), "update elements");
        assert_eq!(summary_of("add_slide", &json!({})), "add slide");
        // An operation's name is never taken as it is, since it goes into a commit message.
        let forged = json!({ "operations": [{ "op": "x\n\nKasten-Session: other" }] });
        assert_eq!(summary_of("update_elements", &forged), "update elements");
    }
}
