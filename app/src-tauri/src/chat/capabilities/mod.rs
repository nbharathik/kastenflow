//! What each model route and model family takes: reasoning effort, thinking
//! budget, temperature and output length. The table (table.rs) says what to
//! offer for a route and a model name; `resolve` (resolve.rs) turns the
//! person's settings into what a request carries, and refuses what the model
//! does not take with a sentence. A model the table does not know is offered
//! nothing, so its requests stay as they were.

pub mod commands;
mod resolve;
mod table;
mod window;

use serde::{Deserialize, Serialize};

pub use resolve::{Applied, apply};
pub use table::{lookup, route_of};
pub use window::DEFAULT_WINDOW;

/// Bumped when the table changes what some model is offered, so a stored
/// answer from an older table can be told apart. Version 2 added the
/// context window and whether the model reads pictures.
pub const CAPABILITIES_VERSION: u32 = 2;

/// Which API a request goes to; the settings a model takes depend on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Route {
    /// The Anthropic Messages API.
    AnthropicMessages,
    /// Chat completions, from OpenAI itself (`official`) or any server that
    /// speaks the same API.
    ChatCompletions { official: bool },
    /// OpenAI's Responses API, paid for by a ChatGPT plan.
    ChatGptResponses,
}

/// How hard a reasoning model thinks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Minimal,
    Low,
    Medium,
    High,
}

impl Effort {
    pub fn as_str(self) -> &'static str {
        match self {
            Effort::Minimal => "minimal",
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
        }
    }
}

/// A closed range of numbers a setting may take.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Range<T> {
    pub min: T,
    pub max: T,
}

/// Tokens a Claude model may think with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Budget {
    pub min: u32,
    pub max: u32,
    pub default: u32,
}

/// What one model takes on one route.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub version: u32,
    pub route: Route,
    pub model: String,
    /// The family the table matched, or "unknown".
    pub family: String,
    /// True when the model's family is confirmed in the provider's
    /// documentation; false when a control is offered to be tried on first
    /// use (a reasoning effort on the ChatGPT plan), or nothing is known.
    pub verified: bool,
    /// The efforts the model takes; none when it takes none.
    pub reasoning_effort: Option<Vec<Effort>>,
    /// The thinking budget a Claude model takes (Claude models that think
    /// by themselves take none).
    pub thinking: Option<Budget>,
    pub temperature: Option<Range<f64>>,
    pub max_output: Option<Range<u32>>,
    /// This computer found that the model refused a reasoning effort.
    pub effort_refused: bool,
    /// The model reads pictures. On the ChatGPT plan this is a try: a refusal
    /// is reported in words.
    pub vision: bool,
    /// Whether the table knows if the model reads pictures. False for a
    /// local server's models, where `GenerationSettings::allow_images` lets
    /// the person try.
    pub vision_known: bool,
    /// Tokens the model reads at most: the window a long chat is kept within.
    pub context_window: u32,
}

/// What the person set for a thread (the Advanced popover). Each is
/// optional; left out, the provider's own default applies.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GenerationSettings {
    pub reasoning_effort: Option<Effort>,
    pub thinking_budget: Option<u32>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<u32>,
    /// Send pictures to a model whose reading of them is not known (a local
    /// server): the person's choice to try. Models known to read pictures
    /// need no setting, and models known not to are never sent any.
    pub allow_images: Option<bool>,
}

impl GenerationSettings {
    /// Whether nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == GenerationSettings::default()
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
