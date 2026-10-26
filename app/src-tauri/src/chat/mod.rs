//! The in-app chat: a model from the Anthropic API, any
//! OpenAI-compatible endpoint or the person's ChatGPT plan (chatgpt/)
//! answers in a thread, and acts on the vault
//! through the MCP server's tools, in the thread's own agent session, so
//! its changes pass the same guardrails and undo together.
//!
//! The UI starts a turn with `chat_send` and reads the answer from
//! `chat-event`s: text as it streams, each tool call and its result, the
//! plan and the steps, then one `done`, `error` or `paused`. A turn goes on
//! until the model is done or a budget (steps, tool calls, minutes) runs
//! out, and then it is paused, not failed: `chat_continue` lets it go on.
//! Threads are saved in the app's data folder (store/), so a chat can be
//! left working and come back to; a message sent while a turn works waits
//! for the next step.

pub mod actions;
pub mod address;
pub mod anthropic;
pub mod archive;
pub mod attach;
pub mod binding;
pub mod budget;
pub mod cache;
pub mod capabilities;
pub mod chatgpt;
pub mod check;
pub mod clients;
pub mod commands;
pub mod compact;
pub mod context;
pub mod diagnostics;
pub mod drafts;
pub mod errors;
pub mod event;
pub mod harness;
pub mod http;
mod http_wait;
pub mod limit;

pub mod changes;
pub mod model;
pub mod openai;
pub mod parts;
pub mod plan;
pub mod prompt;
pub mod providers;
pub(crate) mod public_dns;
pub mod responses;
pub mod retry;
pub mod selection;
pub mod sessions;
pub mod sse;
pub mod state;
pub mod steady;
pub mod store;
pub mod summary;
pub mod threads;
pub mod turn;
pub mod write;
mod write_prompt;

#[cfg(test)]
pub(crate) mod tests;

use serde::{Deserialize, Serialize};

pub use event::{ChangesInfo, ChatEvent, EventKind, Events, ToolResultInfo, ToolUse};

/// The client name of every chat thread's session, as History shows it.
pub const CLIENT: &str = "kasten-chat";

/// What the UI sends to start a turn.
#[derive(Debug, Clone, Default, Deserialize)]
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
    /// What the person set for the thread's model; checked against what the
    /// model takes before anything is sent.
    #[serde(default)]
    pub settings: Option<capabilities::GenerationSettings>,
    /// The text of the PDF pages the `pdf` chips name, which the window
    /// reads (this side has no PDF reader); capped again when it is used.
    #[serde(default)]
    pub excerpts: Vec<context::Excerpt>,
    /// Whether the chat's writes are held back for the person to review
    /// (`preview`, what a request that says nothing gets) or made at once,
    /// through the same guardrails (`direct`, a thread the person trusts).
    #[serde(default)]
    pub writes: WriteMode,
    /// Long text, pictures and files the person attached, kept by
    /// `chat_attach`: text goes into the message's context block, pictures
    /// go with the message to a model that reads them.
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,
}

/// How a chat's writes reach the vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WriteMode {
    /// Held in the thread's change set until the person applies them.
    #[default]
    Preview,
    /// Made at once, as an external agent's are.
    Direct,
}

/// What an attachment is to the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachKind {
    /// Text the model reads in the message.
    Text,
    /// A picture a model that reads pictures sees.
    Image,
}

/// An attachment a message carries, by the id `chat_attach` gave it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentRef {
    pub id: String,
    pub name: String,
    pub kind: AttachKind,
}

/// Something the person attached to a message: a note, a board, cards, a
/// tag's view or search results. `refs` holds `ref`: paths, a tag and view,
/// or a query.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextChip {
    pub kind: String,
    #[serde(default)]
    pub label: String,
    #[serde(rename = "ref", default)]
    pub refs: Vec<String>,
    /// For a `selection` chip: the passage and where it comes from.
    #[serde(default)]
    pub selection: Option<selection::Selection>,
}

/// What `chat_send` answers at once; the reply follows as events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurn {
    pub chat: String,
    /// The thread's agent session.
    pub session: String,
    pub turn: String,
    /// The thread was working: the message waits for the next step of the
    /// running turn (`turn` is that turn), and `queued` events say when it
    /// is taken up. No new turn was started.
    pub queued: bool,
}
