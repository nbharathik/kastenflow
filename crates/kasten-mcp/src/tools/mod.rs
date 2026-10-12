//! The tools as a library: the tools the MCP server serves, with the same
//! arguments, results, guardrails and errors, called in-process. The MCP
//! handlers and the app's chat both go through here, so each tool has one
//! implementation: the chat acts through the same core ops and guardrails
//! as MCP.

mod board;
mod diagram;
mod read;
mod templates;
mod write;

use kasten_core::agent::Session;
use kasten_core::{Error, Instant, Kasten};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) use board::*;
pub(crate) use diagram::*;
pub(crate) use read::*;
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
}

/// Every tool, by name, exactly as `tools/list` describes it to MCP clients.
pub fn specs() -> Vec<ToolSpec> {
    KastenServer::router()
        .list_all()
        .into_iter()
        .map(|tool| ToolSpec {
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
    let k = kasten;
    let s = session;
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
            agent(k, s, |k| capture(k, a))
        }
        "create_note" => {
            let a = parse(args)?;
            agent(k, s, |k| create_note(k, a))
        }
        "append" => {
            let a = parse(args)?;
            agent(k, s, |k| append(k, a))
        }
        "replace_section" => {
            let a = parse(args)?;
            agent(k, s, |k| replace_section(k, a))
        }
        "update_props" => {
            let a = parse(args)?;
            agent(k, s, |k| update_props(k, a))
        }
        "add_tags" => {
            let a = parse(args)?;
            agent(k, s, |k| add_tags(k, a))
        }
        "remove_tags" => {
            let a = parse(args)?;
            agent(k, s, |k| remove_tags(k, a))
        }
        "rename_note" => {
            let a = parse(args)?;
            agent(k, s, |k| rename_note(k, a))
        }
        "move_note" => {
            let a = parse(args)?;
            agent(k, s, |k| move_note(k, a))
        }
        "journal_append" => {
            let a = parse(args)?;
            agent(k, s, |k| journal_append(k, a))
        }
        "trash_note" => {
            let a = parse(args)?;
            agent(k, s, |k| trash_note(k, a))
        }
        "propose_edit" => {
            let a = parse(args)?;
            agent(k, s, |k| propose_edit(k, a))
        }
        "update_tag_schema" => {
            let a = parse(args)?;
            agent(k, s, |k| update_tag_schema(k, a))
        }
        "create_template" => {
            let a = parse(args)?;
            agent(k, s, |k| create_template(k, a))
        }
        "update_template" => {
            let a = parse(args)?;
            agent(k, s, |k| update_template(k, a))
        }
        "create_board" => {
            let a = parse(args)?;
            agent(k, s, |k| create_board(k, a))
        }
        "add_to_board" => {
            let a = parse(args)?;
            agent(k, s, |k| add_to_board(k, a))
        }
        "connect" => {
            let a = parse(args)?;
            agent(k, s, |k| connect(k, a))
        }
        "group_on_board" => {
            let a = parse(args)?;
            agent(k, s, |k| group_on_board(k, a))
        }
        "create_diagram" => {
            let a = parse(args)?;
            agent(k, s, |k| create_diagram(k, a))
        }
        "update_diagram" => {
            let a = parse(args)?;
            agent(k, s, |k| update_diagram(k, a))
        }
        "trash_diagram" => {
            let a = parse(args)?;
            agent(k, s, |k| trash_diagram(k, a))
        }
        // The deck tools: slides-core's, on the vault (see decks/).
        other if crate::decks::is_tool(other) => {
            return crate::decks::call(k, Some(s), other, args).map(|reply| reply.value);
        }
        other => return Err(format!("tool not found: {other}")),
    };
    result.map_err(|e| e.to_string())
}
