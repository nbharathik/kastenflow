//! What an agent's output means, in one shape for both agents: the parsers
//! (`claude`, `opencode`) turn each line into these, and the turn (`drive`)
//! turns these into the chat's events.

use serde_json::Value;

use crate::chat::errors::FailKind;

/// Why a run failed, as far as the CLI's own words say.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Problem {
    /// The CLI is not signed in, or its login was refused.
    SignIn,
    /// A usage limit or too many requests.
    Limit,
    Other,
}

impl Problem {
    pub fn kind(self) -> FailKind {
        match self {
            Problem::SignIn => FailKind::Permission,
            Problem::Limit => FailKind::RateLimited,
            Problem::Other => FailKind::Other,
        }
    }
}

/// Reads a failure's kind from the CLI's words (`text`) and its own error
/// category when it names one (Claude Code's `authentication_failed`,
/// `rate_limit`, ...).
pub fn classify(category: Option<&str>, text: &str) -> Problem {
    let category = category.unwrap_or_default().to_ascii_lowercase();
    let words = text.to_ascii_lowercase();
    if [
        "authentication_failed",
        "oauth_org_not_allowed",
        "account_on_hold",
    ]
    .contains(&category.as_str())
    {
        return Problem::SignIn;
    }
    if ["rate_limit", "billing_error", "overloaded"].contains(&category.as_str()) {
        return Problem::Limit;
    }
    const SIGN_IN: [&str; 9] = [
        "/login",
        "not logged in",
        "invalid api key",
        "authentication",
        "unauthorized",
        "not authenticated",
        "no credentials",
        "credentials not found",
        "sign in",
    ];
    const LIMIT: [&str; 7] = [
        "rate limit",
        "usage limit",
        "limit reached",
        "limit will reset",
        "quota",
        "credit balance",
        "overloaded",
    ];
    if SIGN_IN.iter().any(|w| words.contains(w)) {
        Problem::SignIn
    } else if LIMIT.iter().any(|w| words.contains(w)) {
        Problem::Limit
    } else {
        Problem::Other
    }
}

/// The CLI asks whether it may use a tool.
#[derive(Debug, Clone, PartialEq)]
pub struct Ask {
    /// The id to answer with.
    pub request_id: String,
    pub tool: String,
    pub input: Value,
    /// The CLI's own one-line title for the request, when it gave one.
    pub title: Option<String>,
}

/// How a run ended, by the CLI's own account.
#[derive(Debug, Clone, PartialEq)]
pub struct Finish {
    pub ok: bool,
    /// The CLI's closing words (the answer, or the reason it failed).
    pub text: String,
    pub problem: Problem,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    /// The CLI's id for the conversation, to resume it with.
    Session(String),
    /// A piece of the answer.
    Text(String),
    /// A tool call began.
    Tool {
        id: String,
        name: String,
        input: Value,
    },
    /// A tool call ended; `text` is what it gave back.
    ToolDone {
        id: String,
        ok: bool,
        text: String,
    },
    Ask(Ask),
    /// The CLI withdrew a question (its request id).
    AskWithdrawn(String),
    Notice {
        text: String,
        code: Option<String>,
    },
    Finished(Finish),
}

/// The text of a tool result's `content`: a string, or blocks with `text`.
pub fn content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}
