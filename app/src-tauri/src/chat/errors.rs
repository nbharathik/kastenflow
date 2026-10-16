//! A refused or unanswered request in words for the person: what the
//! provider said, and what to check. And what kind of failure it was, so the
//! message can offer the way on (ask again, choose another model, open
//! Settings).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::retry::status_passes;

/// What kind of failure ended an answer.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailKind {
    /// The person stopped it. A stopped turn ends as a done today; the
    /// window's side of the contract names the kind all the same.
    #[allow(dead_code)]
    Cancelled,
    /// The provider could not be reached, or did not answer in time.
    Connection,
    /// The model is not there, or this key or plan cannot use it.
    ModelUnavailable,
    /// The key, token or plan was refused.
    Permission,
    /// Too many requests, or a usage limit.
    RateLimited,
    /// The chat no longer fits the model's context window.
    TooLong,
    /// The model declined to go on.
    Refused,
    #[default]
    Other,
}

/// The `error` object's fields of a body, lower case: code, type and message.
fn error_words(body: &str) -> String {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let error = if parsed["error"].is_object() {
        &parsed["error"]
    } else {
        &parsed
    };
    let field = |key: &str| error[key].as_str().unwrap_or_default();
    let text = if error.is_object() {
        format!(
            "{} {} {} {}",
            field("code"),
            field("type"),
            field("param"),
            field("message")
        )
    } else {
        body.chars().take(400).collect()
    };
    text.to_lowercase()
}

/// What a provider's own error code says about the failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Meaning {
    pub kind: FailKind,
    /// Asking again after a wait can help.
    pub passes: bool,
}

/// A quota or a plan's allowance is used up: it comes back with the day or
/// the month, not with the next try.
const SPENT: [&str; 7] = [
    "insufficient_quota",
    "usage_limit_reached",
    "usage_not_included",
    "quota_exceeded",
    "billing_hard_limit_reached",
    "credit_balance_too_low",
    "subscription_sharing_usage_limit_exceeded",
];
/// Too many requests at once: a short wait helps.
const SLOW_DOWN: [&str; 5] = [
    "rate_limit_exceeded",
    "rate_limit_error",
    "rate_limited",
    "too_many_requests",
    "requests_limit_exceeded",
];
/// The provider is busy or failing for the moment.
const BUSY: [&str; 9] = [
    "overloaded_error",
    "overloaded",
    "server_error",
    "service_unavailable",
    "internal_server_error",
    "api_error",
    "bad_gateway",
    "gateway_timeout",
    "request_timeout",
];
/// The key, token or plan was refused.
const DENIED: [&str; 6] = [
    "invalid_api_key",
    "authentication_error",
    "permission_error",
    "invalid_authentication",
    "insufficient_permissions",
    "subscription_sharing_user_not_eligible",
];

/// What `code` (an error's `code` or `type`) means, if it is one that is known.
pub fn meaning(code: &str) -> Option<Meaning> {
    let code = code.trim().to_lowercase();
    let is = |names: &[&str]| names.contains(&code.as_str());
    let (kind, passes) = if is(&SPENT) {
        (FailKind::RateLimited, false)
    } else if is(&SLOW_DOWN) {
        (FailKind::RateLimited, true)
    } else if is(&BUSY) {
        (FailKind::Connection, true)
    } else if is(&DENIED) {
        (FailKind::Permission, false)
    } else if code == "context_length_exceeded" {
        (FailKind::TooLong, false)
    } else {
        return None;
    };
    Some(Meaning { kind, passes })
}

/// The `code` and `type` of an error body.
fn codes(body: &str) -> [String; 2] {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let error = if parsed["error"].is_object() {
        &parsed["error"]
    } else {
        &parsed
    };
    let field = |key: &str| error[key].as_str().unwrap_or_default().to_owned();
    [field("code"), field("type")]
}

/// Whether the body says a quota or a plan's allowance is used up.
fn spent(body: &str) -> bool {
    let named = codes(body)
        .iter()
        .filter_map(|c| meaning(c))
        .any(|m| m.kind == FailKind::RateLimited && !m.passes);
    let said = error_words(body);
    named || said.contains("exceeded your current quota") || said.contains("usage limit")
}

/// Whether asking again can help after a refusal: the status is one that
/// passes, and the body does not say that a limit is used up.
pub fn passes(status: u16, body: &str) -> bool {
    status_passes(status) && !spent(body)
}

/// What an error inside a stream means, as a refusal's status and body say
/// it: the kind of failure, and whether asking again can help.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamError {
    pub kind: FailKind,
    pub passes: bool,
    /// The provider's code, cleaned for the connection report.
    pub code: String,
}

impl StreamError {
    /// From an error event's `code`, `type` and `message`.
    pub fn of(code: &str, kind_type: &str, message: &str) -> StreamError {
        let named = if code.trim().is_empty() {
            kind_type
        } else {
            code
        };
        let code = super::diagnostics::tidy(named);
        match meaning(code.as_str()).or_else(|| meaning(kind_type)) {
            Some(m) => StreamError {
                kind: m.kind,
                passes: m.passes,
                code,
            },
            None => StreamError {
                // A stream that says the chat is too long is that kind of failure.
                kind: classify(200, message),
                passes: false,
                code,
            },
        }
    }
}

/// What kind of failure a refused request was, from its status and body.
pub fn classify(status: u16, body: &str) -> FailKind {
    let said = error_words(body);
    let has = |words: &[&str]| words.iter().any(|w| said.contains(w));
    if status == 413
        || has(&[
            "context_length_exceeded",
            "context length",
            "context window",
            "prompt is too long",
            "input is too long",
            "maximum context",
            "too many tokens",
            "request_too_large",
        ])
    {
        return FailKind::TooLong;
    }
    if status == 404
        || has(&["model_not_found", "model not found", "unknown model"])
        || (said.contains("model") && has(&["does not exist", "not exist", "no access"]))
    {
        return FailKind::ModelUnavailable;
    }
    // The provider's own code says more than the status does.
    if let Some(found) = codes(body).iter().find_map(|c| meaning(c)) {
        return found.kind;
    }
    match status {
        401 | 403 => FailKind::Permission,
        429 => FailKind::RateLimited,
        408 | 502 | 503 | 504 | 529 => FailKind::Connection,
        _ => FailKind::Other,
    }
}

/// The provider's own words in an error's body, if it has any.
fn said(body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let words = parsed.as_ref().and_then(|v| {
        [
            v.pointer("/error/message"),
            v.get("message"),
            v.get("detail"),
            v.get("error"),
        ]
        .into_iter()
        .flatten()
        .find_map(Value::as_str)
        .map(str::to_owned)
    });
    let words = words.unwrap_or_else(|| body.trim().chars().take(300).collect());
    words.trim().trim_end_matches('.').to_owned()
}

/// A refused request in words, with what the person can do about it.
pub fn http_error(provider: &str, status: u16, body: &str) -> String {
    let said = said(body);
    let said = if said.is_empty() {
        String::new()
    } else {
        format!(": {said}")
    };
    let hint = match status {
        401 | 403 => ". Check the API key in Settings",
        404 => ". Check the base URL and the model's name",
        408 | 429 | 500..=599 => ". Try again in a moment",
        _ => "",
    };
    format!("{provider} answered {status}{said}{hint}.")
}

/// A request that got no answer, in words, with what to check.
pub fn unreachable(provider: &str, url: &str, err: &dyn std::error::Error) -> String {
    let why = chain(err);
    format!("Could not reach {provider}: {why}{}", reach_hint(url, &why))
}

/// What to check when `url` could not be reached, from the error's words:
/// a local server not started, a certificate, a slow server, a name that
/// does not resolve. Empty when the words say nothing useful.
pub fn reach_hint(url: &str, why: &str) -> &'static str {
    let why = why.to_lowercase();
    let local = reqwest::Url::parse(url).is_ok_and(|u| super::address::loopback(&u));
    if why.contains("timed out") || why.contains("timeout") {
        ". The server took too long to answer; try again in a moment"
    } else if ["certificate", "tls", "ssl", "handshake"]
        .iter()
        .any(|w| why.contains(w))
    {
        ". Its certificate could not be checked: use the https address the provider documents"
    } else if local && (why.contains("refused") || why.contains("connect")) {
        ". Is Ollama or LM Studio running? Start it, then try again"
    } else if ["dns", "lookup", "resolve"].iter().any(|w| why.contains(w)) {
        ". Check the base URL, and that this computer is online"
    } else if why.contains("refused") {
        ". Check the base URL and its port"
    } else {
        ""
    }
}

/// An error and its causes, which say what actually went wrong.
pub(crate) fn chain(err: &dyn std::error::Error) -> String {
    let mut text = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        let words = cause.to_string();
        if !text.contains(&words) {
            text.push_str(": ");
            text.push_str(&words);
        }
        source = cause.source();
    }
    text
}
