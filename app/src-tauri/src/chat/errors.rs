//! A refused or unanswered request in words for the person: what the
//! provider said, and what to check.

use serde_json::Value;

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
