//! The MCP server: the agent tools of `slides_core::agent`, over stdio, for a
//! folder of decks. This is only the protocol; what each tool does is in
//! slides-core, and where the decks live is in [`FolderStore`].

use std::sync::{Arc, Mutex};

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
    ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer, ServerHandler};
use serde_json::{Map, Value};
use slides_core::agent::{self, Agent, ToolOutput, ToolSpec};

use super::store::FolderStore;

/// One connection: what the agent last saw of each deck, and the folder.
struct Session {
    agent: Agent,
    store: FolderStore,
}

#[derive(Clone)]
pub struct SlidesServer {
    session: Arc<Mutex<Session>>,
    tools: Arc<Vec<Tool>>,
    instructions: Arc<String>,
}

/// Tools this program cannot run: they draw or run code in KastenFlow's window, which a folder of decks
/// does not have (the store answers "not available in this build"), so listing them would only invite a refusal.
const NEEDS_THE_APP: [&str; 5] = [
    "render_diff",
    "place_diagram",
    "place_code_picture",
    "run_code_picture",
    "rerun_code_pictures",
];

/// Settings and table touch-ups that are seldom the point of a request. They are left out of the list so that
/// an agent does not read their schemas with every session (the list is sent whole and has to stay small), and
/// they stay what they always were: operations, which `update_elements` takes by name and which can be called
/// by name too.
const BY_OPERATION: [&str; 13] = [
    "set_present",
    "set_header_footer",
    "set_guides",
    "set_slide_access",
    "set_slide_steps",
    "add_section",
    "rename_section",
    "remove_section",
    "set_cell_borders",
    "set_table_style",
    "resize_table_column",
    "distribute_table",
    "set_page_size",
];

/// The tools this program lists, and for `update_elements` a line that names the operations it takes in their place.
fn listed() -> Vec<ToolSpec> {
    let mut tools: Vec<ToolSpec> = agent::tools()
        .into_iter()
        .filter(|t| {
            !NEEDS_THE_APP.contains(&t.name.as_str()) && !BY_OPERATION.contains(&t.name.as_str())
        })
        .collect();
    if let Some(batch) = tools.iter_mut().find(|t| t.name == "update_elements") {
        batch.description.push_str(&format!(
            " Also takes, by name as `op`, the settings that have no tool in this list: {}.",
            BY_OPERATION.join(", ")
        ));
    }
    tools
}

fn tool_of(spec: ToolSpec) -> Tool {
    let schema = match spec.input_schema {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    // Nothing a tool does deletes: a deck put aside is kept, a copy is kept
    // before something is removed, and a file is never written over.
    let notes = ToolAnnotations::new()
        .read_only(spec.read_only)
        .destructive(false)
        .open_world(false);
    Tool::new(spec.name, spec.description, Arc::new(schema)).with_annotations(notes)
}

/// What a tool answered, as the protocol carries it: the text, then any pictures.
fn answered(out: ToolOutput) -> CallToolResult {
    let mut content = vec![ContentBlock::text(out.text)];
    for image in out.images {
        content.push(ContentBlock::image(
            agent::base64_encode(&image.bytes),
            image.mime,
        ));
    }
    CallToolResult::success(content)
}

/// A tool error the agent can read and act on.
fn failed(message: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message.into())])
}

impl SlidesServer {
    pub fn new(store: FolderStore) -> SlidesServer {
        SlidesServer {
            session: Arc::new(Mutex::new(Session {
                agent: Agent::new(),
                store,
            })),
            tools: Arc::new(listed().into_iter().map(tool_of).collect()),
            instructions: Arc::new(agent::instructions()),
        }
    }
}

impl ServerHandler for SlidesServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "kasten-slides",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(self.instructions.as_str())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.tools.as_ref().clone()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let name = request.name.to_string();
        let args = Value::Object(request.arguments.unwrap_or_default());
        let session = Arc::clone(&self.session);
        // Reading files, laying out and linting are work for a thread of their own.
        let done = tokio::task::spawn_blocking(move || {
            let mut session = session.lock().unwrap_or_else(|p| p.into_inner());
            let Session { agent, store } = &mut *session;
            agent.call(store, &name, args)
        })
        .await;
        let result = match done {
            Ok(Ok(out)) => answered(out),
            Ok(Err(e)) => failed(e.message),
            Err(e) => failed(format!("The tool stopped unexpectedly: {e}")),
        };
        Ok(result.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_left_out_of_the_list_is_a_tool_and_stays_callable_as_an_operation() {
        let all: Vec<String> = agent::tools().into_iter().map(|t| t.name).collect();
        let shown: Vec<String> = listed().into_iter().map(|t| t.name).collect();
        for name in NEEDS_THE_APP.iter().chain(BY_OPERATION.iter()) {
            assert!(all.iter().any(|n| n == name), "{name} is not a tool");
            assert!(!shown.iter().any(|n| n == name), "{name} is listed");
        }
        for name in BY_OPERATION {
            assert!(
                slides_core::ops::names().contains(&name),
                "{name} is not an operation, so update_elements could not take it"
            );
        }
        let batch = listed().into_iter().find(|t| t.name == "update_elements");
        assert!(batch.is_some_and(|t| t.description.contains("set_header_footer")));
    }
}
