//! The MCP server: the Kasten session each client's writes go into, and
//! helpers the tools share. Every tool calls a kasten-core op; none touches
//! files itself.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use kasten_core::agent::{AgentOp, Session};
use kasten_core::{Instant, Kasten};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ServerHandler, tool_handler};
use serde::Serialize;

pub const INSTRUCTIONS: &str = "KastenFlow is the user's notes vault: Markdown cards, pages, journal days, projects, whiteboards and slide decks. \
Capture quick thoughts to the inbox with `capture`. Link related notes by writing [[Their title]], or [[their/path|Their title]] when several notes share the title. \
Change one section with `replace_section` or add with `append` instead of rewriting a note; `propose_edit` sends a full rewrite to the user for review. \
Brainstorm on whiteboards. Nothing is ever deleted: `trash_note` moves notes to the trash. \
Diagrams (flowcharts, architecture, sketches) are draw.io files you draw with typed steps, never with XML: make one with `diagram_new` (from a spec, a Mermaid flowchart or a template), \
read one with `diagram_describe`, change it with `diagram_edit` (add_node, add_edge, update, move, group, delete, layout…), check it with `diagram_lint` and `diagram_preview`, keep a picture with `diagram_export`, \
and look shapes up by name with `diagram_find_shapes`. `get_diagram`, `create_diagram` and `update_diagram` read and write the raw XML; prefer the typed tools. `trash_diagram` always waits for the user. \
Slide decks are built and changed with the deck tools (`create_deck`, or `deck_from_note` to start from a note): \
run `lint_deck` after every batch of changes and fix what it reports. What you make in a deck is marked for the user until they accept it. \
Some writes come back as `pending_review` with a proposal id; the user decides those. Locked notes are read-only.";

/// What the server tells an agent on connecting: how to work in the vault,
/// then in its slide decks, then how to draw diagrams (the text of the
/// `kasten-diagrams` skill, written from the style catalogue).
fn instructions() -> &'static str {
    static TEXT: OnceLock<String> = OnceLock::new();
    TEXT.get_or_init(|| {
        format!(
            "{INSTRUCTIONS}\n\n{}\n\n{}",
            crate::decks::instructions(),
            kasten_core::diagrams::presets::instructions()
        )
    })
}

/// Sessions for HTTP, where a request may come without a connection: a
/// session lasts until it is idle this long.
const IDLE_MS: u64 = 30 * 60 * 1000;

pub type SharedSessions = Arc<Mutex<HashMap<String, (Session, u64)>>>;

#[derive(Clone)]
enum Sessions {
    /// stdio: one connection, one session.
    Own(Arc<Mutex<Option<Session>>>),
    /// HTTP: one session per MCP session, or per client name for requests
    /// without one, until it goes idle.
    Shared(SharedSessions),
}

#[derive(Clone)]
pub struct KastenServer {
    pub kasten: Arc<Kasten>,
    sessions: Sessions,
    pub tool_router: ToolRouter<KastenServer>,
}

/// The client's name, as the request gives it (protocol 2026-07-28 names
/// the client in every request) or the handshake did.
fn client_name(context: &RequestContext<RoleServer>) -> String {
    context
        .client_info()
        .map(|info| info.name)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "agent".to_owned())
}

/// Which HTTP session a request belongs to: the MCP session the server
/// gave its connection, or, for a request that has none, its client.
fn session_key(context: &RequestContext<RoleServer>, client: &str) -> String {
    context
        .extensions
        .get::<hyper::http::request::Parts>()
        .and_then(|parts| parts.headers.get("mcp-session-id"))
        .and_then(|id| id.to_str().ok())
        .map_or_else(|| format!("client {client}"), |id| format!("session {id}"))
}

impl KastenServer {
    pub fn new(kasten: Arc<Kasten>) -> KastenServer {
        KastenServer {
            kasten,
            sessions: Sessions::Own(Arc::new(Mutex::new(None))),
            tool_router: Self::router(),
        }
    }

    /// Every tool, as `tools/list` shows them.
    pub fn router() -> ToolRouter<KastenServer> {
        Self::read_tools()
            + Self::write_tools()
            + Self::board_tools()
            + Self::diagram_tools()
            + Self::diagram_ai_tools()
            + Self::deck_tools()
    }

    /// A server for one HTTP session or request, sharing sessions by client.
    pub fn shared(kasten: Arc<Kasten>, sessions: SharedSessions) -> KastenServer {
        KastenServer {
            sessions: Sessions::Shared(sessions),
            ..KastenServer::new(kasten)
        }
    }

    /// The session a write belongs to, started on the first write under the
    /// client's name.
    pub fn session(&self, context: &RequestContext<RoleServer>) -> Session {
        let now = Instant::now();
        let client = client_name(context);
        match &self.sessions {
            Sessions::Own(slot) => {
                let mut slot = slot.lock().unwrap_or_else(|p| p.into_inner());
                slot.get_or_insert_with(|| Session::start(&client, now))
                    .clone()
            }
            Sessions::Shared(all) => {
                let key = session_key(context, &client);
                let mut all = all.lock().unwrap_or_else(|p| p.into_inner());
                // Sessions idle this long are over; their records go.
                all.retain(|_, (_, last)| now.millis.saturating_sub(*last) <= IDLE_MS);
                let entry = all
                    .entry(key)
                    .or_insert_with(|| (Session::start(&client, now), now.millis));
                entry.1 = now.millis;
                entry.0.clone()
            }
        }
    }

    /// The client's session if it has made a change, and none otherwise:
    /// looking starts no session.
    pub fn peek_session(&self, context: &RequestContext<RoleServer>) -> Option<Session> {
        match &self.sessions {
            Sessions::Own(slot) => slot.lock().unwrap_or_else(|p| p.into_inner()).clone(),
            Sessions::Shared(all) => {
                let key = session_key(context, &client_name(context));
                let all = all.lock().unwrap_or_else(|p| p.into_inner());
                all.get(&key).map(|(session, _)| session.clone())
            }
        }
    }

    /// Runs a core call off the async threads.
    pub async fn run<T, F>(&self, work: F) -> CallToolResult
    where
        T: Serialize + Send + 'static,
        F: FnOnce(&Kasten) -> kasten_core::Result<T> + Send + 'static,
    {
        let kasten = Arc::clone(&self.kasten);
        match tokio::task::spawn_blocking(move || work(&kasten)).await {
            Ok(Ok(value)) => done(&value),
            Ok(Err(err)) => failed(err),
            Err(err) => failed(format!("The operation stopped: {err}")),
        }
    }

    /// Builds an agent op and runs it through the guardrails in the
    /// client's session.
    pub async fn agent<F>(&self, context: &RequestContext<RoleServer>, build: F) -> CallToolResult
    where
        F: FnOnce(&Kasten) -> kasten_core::Result<AgentOp> + Send + 'static,
    {
        let session = self.session(context);
        self.run(move |k| crate::tools::agent(k, &session, build))
            .await
    }
}

/// A tool's result as JSON text.
pub fn done(value: &impl Serialize) -> CallToolResult {
    let text =
        serde_json::to_string_pretty(value).unwrap_or_else(|e| format!("{{\"error\": \"{e}\"}}"));
    CallToolResult::success(vec![ContentBlock::text(text)])
}

/// A tool error the agent can read and act on.
pub fn failed(message: impl std::fmt::Display) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message.to_string())])
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for KastenServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("kasten", kasten_core::VERSION)
                    .with_title(kasten_core::PRODUCT_NAME),
            )
            .with_instructions(instructions())
    }
}
