//! One request to GitHub's API: the token goes in a header to the address
//! given and nowhere else, and a refusal comes back as a typed error. The
//! API's base address is a value (`Endpoints`), so tests can ask a mock.

use std::time::Duration;

use reqwest::Method;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, LINK};
use serde_json::Value;

use super::endpoints::Endpoints;
use super::failure::{Rate, classify, offline};
use crate::backup::contract::BackupError;

const WAIT: Duration = Duration::from_secs(30);

/// GitHub's answer, read.
#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    /// The JSON body; null when there is none or it is not JSON.
    pub body: Value,
    pub rate: Rate,
    /// There is a next page (the `Link` header says so).
    pub next: bool,
}

impl Reply {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// This answer as a typed error, unless it was a success.
    pub fn or_fail(self, what: &str) -> Result<Reply, BackupError> {
        if self.ok() {
            Ok(self)
        } else {
            Err(classify(
                self.status,
                &self.rate,
                &self.body,
                what,
                kasten_core::Instant::now().millis,
            ))
        }
    }
}

/// Percent-encodes `text` for a path piece or a query value.
pub fn enc(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Sends one request. `token` None asks without signing in (public things
/// only). Any status comes back as a `Reply`; only a request that got no
/// answer is an error here.
pub async fn send(
    http: &reqwest::Client,
    ep: &Endpoints,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<&Value>,
    what: &str,
) -> Result<Reply, BackupError> {
    let mut request = http
        .request(method, format!("{}{path}", ep.api))
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(WAIT);
    if let Some(token) = token {
        request = request.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    if let Some(body) = body {
        request = request
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }
    let response = request.send().await.map_err(|e| offline(what, &e))?;
    let status = response.status().as_u16();
    let rate = Rate::from_headers(response.headers());
    let next = response
        .headers()
        .get(LINK)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("rel=\"next\""));
    let text = response.text().await.map_err(|e| offline(what, &e))?;
    Ok(Reply {
        status,
        body: serde_json::from_str(&text).unwrap_or(Value::Null),
        rate,
        next,
    })
}

/// A GET that must succeed.
pub async fn get(
    http: &reqwest::Client,
    ep: &Endpoints,
    path: &str,
    token: Option<&str>,
    what: &str,
) -> Result<Reply, BackupError> {
    send(http, ep, Method::GET, path, token, None, what)
        .await?
        .or_fail(what)
}

/// `owner/name` as GitHub spells it: safe to put in a path.
pub fn valid_full_name(full: &str) -> bool {
    let piece = |p: &str| {
        !p.is_empty()
            && p.len() <= 100
            && p != "."
            && p != ".."
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    full.split_once('/')
        .is_some_and(|(owner, name)| piece(owner) && piece(name))
}

/// The same check for the answer to "who am I" and a bare repository name.
pub fn valid_name(name: &str) -> bool {
    !name.contains('/') && valid_full_name(&format!("x/{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_names_go_into_a_path() {
        assert!(valid_full_name("me/notes-2.git"));
        assert!(valid_full_name("My_Org/a.b"));
        for bad in [
            "me", "me/", "/n", "a/b/c", "a/..", "../x", "a/b c", "a/b?x=1", "a/b#", "a/%2e", "",
        ] {
            assert!(!valid_full_name(bad), "{bad}");
        }
        assert!(valid_name("notes") && !valid_name("a/b") && !valid_name(""));
    }

    #[test]
    fn encodes_a_query_value() {
        assert_eq!(enc("my notes+x"), "my%20notes%2Bx");
    }
}
