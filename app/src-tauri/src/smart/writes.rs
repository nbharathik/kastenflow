//! What a smart page may change: a note's properties and tags, a new note, a
//! line added to a note, a to-do ticked. Each is one call of the tool an agent
//! would use, made as the agent `smart:<page path>` in the page's own session,
//! so the project's agent mode decides what happens: Review keeps it as a
//! proposal for the person, Balanced does it and counts it against the soft
//! limits (a page that loops runs into them), Autonomous does it. Locked notes
//! and private folders are refused as they are for any agent. One call is one
//! commit in History, under the agent's name.

use kasten_core::agent::Session;
use kasten_core::smart::BridgeCall;
use kasten_core::{Kasten, NoteFile};
use serde_json::{Value, json};

/// A body longer than this makes a page, not a card.
const CARD_CHARS: usize = 600;

/// Runs a write call; None for any other call.
pub fn run(
    kasten: &Kasten,
    session: &Session,
    page: &NoteFile,
    call: &BridgeCall,
) -> Option<Result<Value, String>> {
    // The stricter of the page's own project and the note's decides: a page in
    // a Review project holds its writes for review wherever they land.
    if call.is_write() {
        kasten.hold_session_to(session, page.meta.project.as_deref());
    }
    let tool = |name: &str, args: Value| kasten_mcp::tools::call(kasten, session, name, args);
    // A note that a call names is checked before the tool runs.
    let checked = |id: &str, then: &dyn Fn() -> Result<Value, String>| {
        outside_code_folders(kasten, id).and_then(|()| then())
    };
    Some(match call {
        BridgeCall::Update { id, props } => checked(id, &|| {
            tool("update_props", json!({ "note": id, "props": props }))
        }),
        BridgeCall::AddTags { id, tags } => checked(id, &|| {
            tool("add_tags", json!({ "note": id, "tags": tags }))
        }),
        BridgeCall::CreateNote {
            title,
            tags,
            props,
            body,
            project,
        } => {
            let body = body.clone().unwrap_or_default();
            let kind = if body.chars().count() > CARD_CHARS {
                "page"
            } else {
                "card"
            };
            // A note made by a page in a project belongs to that project, unless the page says another;
            // and the other has to be a project that is there, in the spelling of its folder or not.
            // (The core files a note under any name it is given, which would make a folder under
            // `projects/` that is no project.)
            let project = match project {
                Some(name) => {
                    let slug = kasten_core::slugify(name);
                    let overview = kasten
                        .root()
                        .join("projects")
                        .join(&slug)
                        .join("_project.md");
                    if !overview.is_file() {
                        return Some(Err(format!("There is no project called “{name}”.")));
                    }
                    Some(slug)
                }
                None => page.meta.project.clone(),
            };
            tool(
                "create_note",
                json!({
                    "type": kind,
                    "title": title,
                    "body": body,
                    "project": project,
                    "tags": tags,
                    "props": props,
                }),
            )
        }
        BridgeCall::Append { id, md } => checked(id, &|| {
            tool("append", json!({ "note": id, "markdown": md }))
        }),
        BridgeCall::ToggleTodo { id, index } => toggle(kasten, session, id, *index),
        _ => return None,
    })
}

/// Refuses a note inside a smart page's code folder (`<page>.smart/…`, however
/// it is spelled) or in a hidden folder (`.kasten/`, `.git/`, `.trash/`): the
/// code of a page, its own or another's, is not something a page changes, and
/// the files beside it belong to it. The tools refuse the hidden folders too;
/// this is the page's own rule on top of theirs. A name that leads nowhere is
/// left to the tool, which says so.
fn outside_code_folders(kasten: &Kasten, id: &str) -> Result<(), String> {
    let Ok(path) = kasten.resolve(id) else {
        return Ok(());
    };
    if kasten_core::companions::in_folder(&path)
        || path.split('/').any(|part| part.starts_with('.'))
    {
        return Err(
            "A smart page cannot change what is in a smart page's folder or a hidden folder."
                .to_owned(),
        );
    }
    Ok(())
}

/// Ticks or unticks the `index`th to-do of a note (from 0, in the note's order).
fn toggle(kasten: &Kasten, session: &Session, id: &str, index: u32) -> Result<Value, String> {
    let path = kasten.resolve(id).map_err(|e| e.to_string())?;
    outside_code_folders(kasten, &path)?;
    let note = kasten.read(&path).map_err(|e| e.to_string())?;
    let mut todos: Vec<_> = kasten
        .tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|row| row.path == path)
        .collect();
    todos.sort_by_key(|row| row.line);
    let todo = todos
        .get(index as usize)
        .ok_or_else(|| format!("“{}” has no to-do number {index}.", note.meta.title))?;
    kasten_mcp::tools::call(
        kasten,
        session,
        "set_task",
        json!({ "note": path, "line": todo.line, "done": !todo.done, "hash": note.hash }),
    )
}
