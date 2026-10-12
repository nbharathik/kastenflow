//! The in-app chat: a model from the Anthropic API, any
//! OpenAI-compatible endpoint or the person's ChatGPT plan (chatgpt/)
//! answers in a thread, and acts on the vault
//! through the MCP server's tools, in the thread's own agent session, so
//! its changes pass the same guardrails and undo together.
//!
//! The UI starts a turn with `chat_send` and reads the answer from
//! `chat-event`s: text as it streams, each tool call and its result, then
//! one `done` or `error`.

pub mod address;
pub mod anthropic;
pub mod chatgpt;
pub mod check;
pub mod clients;
pub mod commands;
pub mod context;
pub mod drafts;
pub mod errors;
pub mod http;

pub mod model;
pub mod openai;
pub mod prompt;
pub mod providers;
pub(crate) mod public_dns;
pub mod responses;
pub mod sse;
pub mod summary;
pub mod threads;
pub mod turn;
pub mod write;

#[cfg(test)]
pub(crate) mod tests;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The client name of every chat thread's session, as History shows it.
pub const CLIENT: &str = "kasten-chat";
/// Tool calls one turn may make before it stops and says so.
pub const MAX_CALLS: usize = 12;

/// What the UI sends to start a turn.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// The thread's id, made by the UI.
    pub chat: String,
    /// A provider's name in the vault's config.
    pub provider: String,
    /// The model to ask; empty means the provider's own.
    #[serde(default)]
    pub model: String,
    pub text: String,
    #[serde(default)]
    pub context: Vec<ContextChip>,
    /// The person's day, YYYY-MM-DD, for the prompt's "today" (an addition
    /// to the contract); UTC's day when not given.
    #[serde(default)]
    pub date: Option<String>,
}

/// Something the person attached to a message: a note, a board, cards, a
/// tag's view or search results. `refs` holds `ref`: paths, a tag and view,
/// or a query.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextChip {
    pub kind: String,
    #[serde(default)]
    pub label: String,
    #[serde(rename = "ref", default)]
    pub refs: Vec<String>,
}

/// What `chat_send` answers at once; the reply follows as events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurn {
    pub chat: String,
    /// The thread's agent session.
    pub session: String,
    pub turn: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Text,
    Tool,
    ToolResult,
    Done,
    Error,
}

/// A tool the model called.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// How a tool call went, in words for the person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultInfo {
    pub id: String,
    pub ok: bool,
    pub summary: String,
    /// The notes or boards it touched.
    pub paths: Vec<String>,
}

/// One `chat-event`. Per turn: text, tool and toolResult events in any
/// mix, then exactly one done or error.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEvent {
    pub chat: String,
    pub turn: String,
    pub kind: EventKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolUse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ToolResultInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ChatEvent {
    pub fn new(chat: &str, turn: &str, kind: EventKind) -> ChatEvent {
        ChatEvent {
            chat: chat.to_owned(),
            turn: turn.to_owned(),
            kind,
            text: None,
            tool: None,
            result: None,
            stopped: None,
            error: None,
        }
    }
}

/// Where a turn's events go: the window in the app, a list in tests.
pub trait Events: Send + Sync {
    fn emit(&self, event: ChatEvent);
}
