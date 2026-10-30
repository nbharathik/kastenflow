//! The tools as a library: the tools the MCP server serves, with the same
//! arguments, results, guardrails and errors, called in-process. The MCP
//! handlers and the app's chat both go through here, so each tool has one
//! implementation: the chat acts through the same core ops and guardrails
//! as MCP.

mod batch;
mod board;
mod board_edit;
mod diagram;
mod diagram_ai;
mod digest;
mod extras;
mod figure;
mod finders;
mod history_more;
mod latex;
mod latex_app;
mod latex_files;
mod latex_more;
mod lookup;
mod notes_more;
mod pages;
mod read;
mod smart;
mod smart_check;
mod smart_data;
mod smart_errors;
mod staged;
mod status;
mod structure;
mod templates;
mod write;

use std::sync::atomic::AtomicBool;

use kasten_core::agent::Session;
use kasten_core::{Error, Instant, Kasten};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) use batch::batch_op;
#[cfg(test)]
pub(crate) use batch::batchable_names;
pub(crate) use board::*;
pub(crate) use board_edit::board_edit;
pub(crate) use diagram::*;
pub(crate) use diagram_ai::{
    diagram_describe, diagram_edit, diagram_export, diagram_find_shapes, diagram_lint, diagram_new,
    diagram_preview,
};
pub(crate) use digest::activity_digest;
pub(crate) use extras::*;
pub(crate) use figure::{diagram_to_latex_figure, export_png, get_selection};
pub(crate) use history_more::*;
pub(crate) use latex::{latex_build, latex_edit, latex_list, latex_read};
pub(crate) use latex_app::latex_export_pdf;
pub(crate) use latex_files::{
    latex_append, latex_create_document, latex_delete_file, latex_write_file,
};
pub(crate) use latex_more::{latex_add_asset, latex_cite, latex_send_page};
pub use lookup::Writes;
pub(crate) use lookup::{STAGED_NOTE, locked};
pub(crate) use notes_more::*;
pub(crate) use pages::{edit_page, read_page_blocks};
pub(crate) use read::*;
pub(crate) use smart::{
    request_smart_pages, smart_create, smart_delete_file, smart_edit, smart_read, smart_render,
    smart_write_file,
};
pub(crate) use smart_check::smart_check;
pub(crate) use status::{health, plugins, server_status};
pub(crate) use structure::*;
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
    // A plugin's tools answer only while the plugin is on.
    if let Some(id) = crate::plugins::owner_of(name)
        && !crate::plugins::is_on(k, id)
    {
        return Err(crate::plugins::off_sentence(k, id));
    }
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
        "batch" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| batch_op(l, a))
        }
        "read_page_blocks" => read_page_blocks(k, parse(args)?),
        "edit_page" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| edit_page(l, a))
        }
        "set_parent" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| set_parent(l, a))
        }
        "reorder_children" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| reorder_children(l, a))
        }
        "create_project" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| create_project(l, a))
        }
        "save_project_setup" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| save_project_setup(l, a))
        }
        "set_project_state" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| set_project_state(l, a))
        }
        "set_tag_views" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| set_tag_views(l, a))
        }
        "set_view_order" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| set_view_order(l, a))
        }
        "duplicate_note" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| duplicate_note(l, a))
        }
        "restore_note" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| restore_note(l, a))
        }
        "set_note_meta" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| set_note_meta(l, a))
        }
        "apply_template" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| apply_template(l, a))
        }
        "journal_day" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| journal_day(l, a))
        }
        "set_task" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| set_task(l, a))
        }
        "add_comment" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| add_comment(l, a))
        }
        "resolve_comment" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| resolve_comment(l, a))
        }
        "create_collection" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| create_collection(l, a))
        }
        "update_collection" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| update_collection(l, a))
        }
        "add_reference" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| add_reference(l, a))
        }
        "board_edit" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| board_edit(l, a))
        }
        "rename_diagram" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| rename_diagram(l, a))
        }
        "move_diagram" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| move_diagram(l, a))
        }
        "duplicate_diagram" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| duplicate_diagram(l, a))
        }
        "undo_session" => {
            let a = parse(args)?;
            agent_in(k, s, writes, |l| undo_session(l, a, &s.id))
        }
        "list_trash" => list_trash(k),
        "list_tasks" => list_tasks(k, parse(args)?),
        "list_projects" => list_projects(k, parse(args)?),
        "list_setups" => list_setups(k),
        "list_comments" => list_comments(k, parse(args)?),
        "list_collections" => list_collections(k),
        "list_references" => list_references(k, parse(args)?),
        "list_sessions" => list_sessions(k, parse(args)?),
        "activity_digest" => activity_digest(k, parse(args)?),
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
        // The LaTeX plugin's tools (the plugin is on, or the call was turned away above).
        "latex_list" => latex_list(k),
        "latex_read" => latex_read(k, parse(args)?),
        "latex_edit" => latex_edit(k, s, writes, parse(args)?),
        "latex_build" => latex_build(k, Some(s), parse(args)?),
        "latex_export_pdf" => latex_export_pdf(k, s, writes, parse(args)?),
        "latex_create_document" => latex_create_document(k, s, writes, parse(args)?),
        "latex_write_file" => latex_write_file(k, s, writes, parse(args)?),
        "latex_append" => latex_append(k, s, writes, parse(args)?),
        "latex_delete_file" => latex_delete_file(k, s, writes, parse(args)?),
        "latex_add_asset" => latex_add_asset(k, s, writes, parse(args)?),
        "latex_cite" => latex_cite(k, s, writes, parse(args)?),
        "latex_send_page" => latex_send_page(k, s, writes, parse(args)?),
        // A diagram as a figure: both plugins are on, or the call was turned away above.
        "diagram_to_latex_figure" => diagram_to_latex_figure(k, s, writes, parse(args)?),
        // The user's selection: no plugin, the app's.
        "get_selection" => get_selection(k),
        // The smart page tools: reads of the page's folder, and writes that go through `agent_in`.
        "smart_create" => smart_create(k, s, writes, parse(args)?),
        "smart_read" => smart_read(k, parse(args)?),
        "smart_edit" => smart_edit(k, s, writes, parse(args)?),
        "smart_write_file" => smart_write_file(k, s, writes, parse(args)?),
        "smart_delete_file" => smart_delete_file(k, s, writes, parse(args)?),
        "smart_check" => smart_check(k, parse(args)?),
        "smart_render" => smart_render(k, parse(args)?),
        "request_smart_pages" => request_smart_pages(k, s, writes, parse(args)?),
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
