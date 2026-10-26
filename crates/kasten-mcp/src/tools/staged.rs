//! The read tools of a chat that previews its changes. They read the vault
//! with the chat's staged changes on top, so a note the chat made or changed a
//! moment ago reads as it will be saved. Lists and searches come from the
//! index, which does not know the staged changes, and say so.

use std::sync::Mutex;

use kasten_core::agent::ChangeSet;
use kasten_core::{Kasten, Result};
use serde_json::{Value, json};

use super::as_json;
use super::board::board_json;
use super::diagram::diagram_json;
use super::diagram_ai::{describe_json, lint_report};
use super::lookup::locked;
use super::pages::{DEFAULT_BLOCKS, MOST_BLOCKS};
use super::read::{list_notes, note_json, search};
use super::{parse, today};
use crate::params::*;
use crate::params_diagram::DiagramPageArgs;
use crate::params_pages::ReadPageBlocksArgs;

/// What a list or a search says when the chat has staged changes.
const NOT_LISTED: &str = "The chat's staged changes are not in this result yet: lists and searches see only what is saved. read_note shows a staged note.";

/// The result of read tool `name`, as the chat sees it with `set`'s staged
/// changes; none for a tool the staged changes do not change.
pub(super) fn read(
    k: &Kasten,
    set: &Mutex<ChangeSet>,
    name: &str,
    args: &Value,
) -> Option<std::result::Result<Value, String>> {
    let set = locked(set);
    let result = match name {
        "read_note" => parse(args.clone()).map(|a| read_note(k, &set, a)),
        "get_journal" => parse(args.clone()).map(|a| get_journal(k, &set, a)),
        "read_page_blocks" => parse(args.clone()).map(|a| read_page_blocks(k, &set, a)),
        "read_board" => parse(args.clone()).map(|a| read_board(k, &set, a)),
        "get_diagram" => parse(args.clone()).map(|a| get_diagram(k, &set, a)),
        "diagram_describe" => parse(args.clone()).map(|a| diagram_described(k, &set, a)),
        "diagram_lint" => parse(args.clone()).map(|a| diagram_linted(k, &set, a)),
        "list_notes" => parse(args.clone()).map(|a| listed(&set, list_notes(k, a))),
        "search" => parse(args.clone()).map(|a| searched(&set, search(k, a))),
        _ => return None,
    };
    Some(match result {
        Ok(value) => value.map_err(|e| e.to_string()),
        Err(message) => Err(message),
    })
}

fn read_note(k: &Kasten, set: &ChangeSet, a: ReadNoteArgs) -> Result<Value> {
    let path = k.resolve_staged(set, &a.note)?;
    let note = k.read_in(set, &path)?;
    let mut out = note_json(&note);
    // The index knows the saved links only, and only of a saved note.
    if a.with_backlinks && !set.is_new(&path) {
        out["backlinks"] = json!(k.backlinks(&path)?);
    }
    if set.text_of(&path).is_some() {
        out["staged"] = json!(true);
    }
    Ok(out)
}

fn get_journal(k: &Kasten, set: &ChangeSet, a: JournalArgs) -> Result<Value> {
    let date = a.date.unwrap_or_else(today);
    let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
    if !set.is_new(&path) && !k.vault().exists(&path) {
        return Ok(json!({ "date": date, "exists": false }));
    }
    let mut out = note_json(&k.read_in(set, &path)?);
    if set.text_of(&path).is_some() {
        out["staged"] = json!(true);
    }
    Ok(out)
}

/// The blocks of a page as the chat's staged changes leave it: the ids and
/// hashes the chat's next `edit_page` must name.
fn read_page_blocks(k: &Kasten, set: &ChangeSet, a: ReadPageBlocksArgs) -> Result<Value> {
    let path = k.resolve_staged(set, &a.note)?;
    let limit = a.limit.unwrap_or(DEFAULT_BLOCKS).clamp(1, MOST_BLOCKS);
    let mut out = as_json(k.read_page_blocks_in(set, &path, a.from.unwrap_or(1).max(1), limit)?)?;
    if set.text_of(&path).is_some() {
        out["staged"] = json!(true);
    }
    Ok(out)
}

fn read_board(k: &Kasten, set: &ChangeSet, a: BoardArgs) -> Result<Value> {
    let path = k.resolve_board_staged(set, &a.board)?;
    board_json(&k.board_in(set, &path)?)
}

fn get_diagram(k: &Kasten, set: &ChangeSet, a: DiagramArgs) -> Result<Value> {
    let path = k.resolve_diagram_staged(set, &a.diagram)?;
    diagram_json(&path, &k.diagram_in(set, &path)?)
}

fn diagram_described(k: &Kasten, set: &ChangeSet, a: DiagramPageArgs) -> Result<Value> {
    let path = k.resolve_diagram_staged(set, &a.diagram)?;
    describe_json(&path, &k.diagram_in(set, &path)?, a.page.as_deref())
}

fn diagram_linted(k: &Kasten, set: &ChangeSet, a: DiagramPageArgs) -> Result<Value> {
    let path = k.resolve_diagram_staged(set, &a.diagram)?;
    lint_report(&path, &k.diagram_in(set, &path)?, a.page.as_deref())
}

/// A list, with a word that the staged changes are not in it.
fn listed(set: &ChangeSet, list: Result<Value>) -> Result<Value> {
    let mut list = list?;
    if !set.is_empty() {
        list["note"] = json!(NOT_LISTED);
    }
    Ok(list)
}

/// Search hits, with a word that the staged changes are not among them.
fn searched(set: &ChangeSet, hits: Result<Value>) -> Result<Value> {
    let hits = hits?;
    if set.is_empty() {
        return Ok(hits);
    }
    Ok(json!({ "results": hits, "note": NOT_LISTED }))
}
