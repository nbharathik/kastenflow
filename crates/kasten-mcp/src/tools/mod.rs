//! The tools as a library: the tools the MCP server serves, with the same
//! arguments, results, guardrails and errors, called in-process. The MCP
//! handlers and the app's chat both go through here, so each tool has one
//! implementation: the chat acts through the same core ops and guardrails
//! as MCP.

mod board;
mod diagram;
mod diagram_ai;
mod lookup;
mod read;
mod staged;
mod status;
mod templates;
mod write;

use std::sync::atomic::AtomicBool;

use kasten_core::agent::Session;
use kasten_core::{Error, Instant, Kasten};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) use board::*;
pub(crate) use diagram::*;
pub(crate) use diagram_ai::{
    diagram_describe, diagram_edit, diagram_export, diagram_find_shapes, diagram_lint, diagram_new,
    diagram_preview,
};
pub use lookup::Writes;
pub(crate) use lookup::{STAGED_NOTE, locked};
pub(crate) use read::*;
pub(crate) use status::{health, server_status};
pub(crate) use templates::*;
pub(crate) use write::*;

use crate::server::KastenServer;

/// A tool as a model sees it: its name, what it does, and a JSON Schema for
/// its arguments.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    /// The tool's `readOnlyHint` annotation: it changes nothing, so a chat may
    /// run several of these at once.
    #[serde(skip)]
    pub read_only: bool,
}

/// Every tool, by name, exactly as `tools/list` describes it to MCP clients.
pub fn specs() -> Vec<ToolSpec> {
    KastenServer::router()
        .list_all()
        .into_iter()
        .map(|tool| ToolSpec {
            read_only: tool
                .annotations
                .as_ref()
                .and_then(|a| a.read_only_hint)
                .unwrap_or(false),
            name: tool.name.into_owned(),
            description: tool.description.map(|d| d.into_owned()).unwrap_or_default(),
            input_schema: Value::Object(tool.input_schema.as_ref().clone()),
        })
        .collect()
}

/// Today in UTC; the core has no time zone data, so agents pass their own day.
pub(crate) fn today() -> String {
    Instant::now().rfc3339()[..10].to_owned()
}

pub(crate) fn as_json(value: impl Serialize) -> kasten_core::Result<Value> {
    serde_json::to_value(value).map_err(|e| Error::Invalid(e.to_string()))
}

/// The arguments as a tool's own type, failing as rmcp does.
fn parse<T: DeserializeOwned>(args: Value) -> Result<T, String> {
    let args = match args {
        Value::Null => Value::Object(Default::default()),
        other => other,
    };
    serde_json::from_value(args).map_err(|e| format!("failed to deserialize parameters: {e}"))
}

/// Runs the tool `name` with `args` in `session`, blocking until it is done:
/// its JSON result, or the error an MCP client would read. Writes carry
/// `session`, commit as its agent and count against its guardrails.
pub fn call(kasten: &Kasten, session: &Session, name: &str, args: Value) -> Result<Value, String> {
    call_in(kasten, session, Writes::Direct, name, args)
}

/// `call`, for a chat that may preview its changes. With `Writes::Direct` it
/// is `call`. With `Writes::Staged` every write is held in the chat's change
/// set instead of reaching the vault (what cannot be shown there waits for
/// review as a proposal and never runs), and the read tools see the staged
/// changes on top of the vault.
pub fn call_in(
    kasten: &Kasten,
    session: &Session,
    writes: Writes,
    name: &str,
    args: Value,
) -> Result<Value, String> {
    call_with(kasten, session, writes, None, name, args)
}

/// `call_in` for a caller that can withdraw its request: `cancel` is set when
/// the answer is no longer wanted (the person pressed Stop), and a picture it
/// asked for that has not been started is then never drawn.
pub fn call_with(
    kasten: &Kasten,
    session: &Session,
    writes: Writes,
    cancel: Option<&AtomicBool>,
    name: &str,
    args: Value,
) -> Result<Value, String> {
    let k = kasten;
    let s = session;
    if let Writes::Staged(set) = writes
        && let Some(result) = staged::read(k, set, name, &args)
    {
        return result;
    }
    let result = match name {
        "search" => search(k, parse(args)?),
        "read_note" => read_note(k, parse(args)?),
        "list_notes" => list_notes(k, parse(args)?),
        "query_tag" => query_tag(k, parse(args)?),
        "get_journal" => get_journal(k, parse(args)?),
        "get_history" => get_history(k, parse(args)?),
        "list_tags" => list_tags(k),
        "list_boards" => list_boards(k),
        "list_templates" => list_templates(k),
        "list_diagrams" => list_diagrams(k),
        "get_diagram" => get_diagram(k, parse(args)?),
        "read_board" => read_board(k, parse(args)?),
        "capture" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| capture(l, a))
        }
        "create_note" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| create_note(l, a))
        }
        "append" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| append(l, a))
        }
        "replace_section" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| replace_section(l, a))
        }
        "update_props" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| update_props(l, a))
        }
        "add_tags" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| add_tags(l, a))
        }
        "remove_tags" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| remove_tags(l, a))
        }
        "rename_note" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| rename_note(l, a))
        }
        "move_note" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| move_note(l, a))
        }
        "journal_append" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| journal_append(l, a))
        }
        "trash_note" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| trash_note(l, a))
        }
        "propose_edit" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| propose_edit(l, a))
        }
        "update_tag_schema" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| update_tag_schema(l, a))
        }
        "create_template" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |_| create_template(k, a))
        }
        "update_template" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |_| update_template(k, a))
        }
        "create_board" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| create_board(l, a))
        }
        "add_to_board" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| add_to_board(l, a))
        }
        "connect" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| connect(l, a))
        }
        "group_on_board" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| group_on_board(l, a))
        }
        "create_diagram" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| create_diagram(l, a))
        }
        "update_diagram" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| update_diagram(l, a))
        }
        "trash_diagram" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| trash_diagram(l, a))
        }
        // The typed diagram tools: reads, then the writes that go through `agent_in` like the rest.
        "diagram_describe" => diagram_describe(k, parse(args)?),
        "diagram_find_shapes" => diagram_find_shapes(parse(args)?),
        "diagram_lint" => diagram_lint(k, parse(args)?),
        "diagram_preview" => diagram_preview(k, writes, parse(args)?),
        "diagram_new" => diagram_new(k, s, writes, parse(args)?),
        "diagram_edit" => diagram_edit(k, s, writes, parse(args)?),
        "diagram_export" => diagram_export(k, s, writes, parse(args)?),
        "server_status" => status::server_status(k, Some(s)),
        // The deck tools: slides-core's, on the vault (see decks/).
        other if crate::decks::is_tool(other) => {
            return crate::decks::call_in(k, Some(s), writes, cancel, other, args)
                .map(|reply| reply.value);
        }
        other => return Err(format!("tool not found: {other}")),
    };
    result.map_err(|e| e.to_string())
}
