//! GitHub, for "Sign in with GitHub": the device flow (a code the person
//! types at github.com/login/device) and the account. Only the addresses in
//! `Endpoints` are ever asked, and the token goes nowhere else. Repositories
//! are in `repos.rs`.

use std::time::Duration;

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::Value;

use super::api::{self, enc};
use super::endpoints::Endpoints;
use super::failure::offline;
use crate::backup::contract::BackupError;

/// The only page a sign-in code may be typed at.
pub const VERIFY: &str = "https://github.com/login/device";
/// Private repositories, to create one and push to it.
const SCOPE: &str = "repo";
const WAIT: Duration = Duration::from_secs(30);

/// Where GitHub's git server is, for the keychain and the token's origin.
pub const ORIGIN: &str = "https://github.com";
/// The user name GitHub takes with an OAuth token.
pub const TOKEN_USER: &str = "x-access-token";

/// The code to type at GitHub, and how to ask whether it was.
#[derive(Clone, PartialEq, Eq, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    #[serde(default = "five")]
    pub interval: u64,
}

fn five() -> u64 {
    5
}

/// Shown without the device code, which asks for the token.
impl std::fmt::Debug for DeviceCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeviceCode")
            .field("device_code", &"<hidden>")
            .field("user_code", &self.user_code)
            .field("verification_uri", &self.verification_uri)
            .field("expires_in", &self.expires_in)
            .field("interval", &self.interval)
            .finish()
    }
}

/// What asking for the token answered.
#[derive(Clone, PartialEq, Eq)]
pub enum Poll {
    /// Not typed yet: ask again after the interval.
    Pending,
    /// Asked too often: wait five seconds longer from now on.
    SlowDown,
    /// The code ran out before it was typed.
    Expired,
    /// The person said no.
    Denied,
    /// Sign-in by code is off for this app.
    Disabled,
    Token(String),
    Failed(String),
}

/// Shown without the token.
impl std::fmt::Debug for Poll {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Poll::Pending => f.write_str("Pending"),
            Poll::SlowDown => f.write_str("SlowDown"),
            Poll::Expired => f.write_str("Expired"),
            Poll::Denied => f.write_str("Denied"),
            Poll::Disabled => f.write_str("Disabled"),
            Poll::Token(_) => f.write_str("Token(<hidden>)"),
            Poll::Failed(why) => f.debug_tuple("Failed").field(why).finish(),
        }
    }
}

/// Reads the answer to asking for a code; the page to type it at must be
/// GitHub's own.
pub fn read_code(body: &str) -> Result<DeviceCode, String> {
    let code: DeviceCode = serde_json::from_str(body)
        .map_err(|_| "GitHub's answer could not be read; try again".to_owned())?;
    if code.verification_uri != VERIFY {
        return Err(
            "GitHub named a sign-in page that is not its own, so KastenFlow stopped".into(),
        );
    }
    Ok(code)
}

/// Reads the answer to asking whether the code was typed.
pub fn read_poll(body: &str) -> Poll {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Poll::Failed("GitHub's answer could not be read".into());
    };
    if let Some(token) = value["access_token"].as_str().filter(|t| !t.is_empty()) {
        return Poll::Token(token.to_owned());
    }
    match value["error"].as_str() {
        Some("authorization_pending") => Poll::Pending,
        Some("slow_down") => Poll::SlowDown,
        Some("expired_token") => Poll::Expired,
        Some("access_denied") => Poll::Denied,
        Some("device_flow_disabled") => Poll::Disabled,
        Some(other) => Poll::Failed(format!("GitHub said {other}")),
        None => Poll::Failed("GitHub's answer had no token".into()),
    }
}

/// A name GitHub takes for a new repository, from the vault's.
pub fn repo_name(vault: &str) -> String {
    let mut name: String = vault
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    name.truncate(80);
    if name.is_empty() {
        "kasten-notes".to_owned()
    } else {
        format!("{}-notes", name.to_lowercase().trim_end_matches("-notes"))
    }
}

/// A form body, each value percent-encoded (the app's HTTP client has no
/// form support of its own).
fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", enc(key), enc(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn post_form(http: &reqwest::Client, url: &str, pairs: &[(&str, &str)]) -> reqwest::RequestBuilder {
    http.post(url)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form(pairs))
        .timeout(WAIT)
}

pub async fn request_code(
    http: &reqwest::Client,
    ep: &Endpoints,
    client_id: &str,
) -> Result<DeviceCode, String> {
    let response = post_form(
        http,
        &ep.device_code,
        &[("client_id", client_id), ("scope", SCOPE)],
    )
    .send()
    .await
    .map_err(|e| offline("start signing in", &e).message())?;
    let body = response
        .text()
        .await
        .map_err(|e| offline("start signing in", &e).message())?;
    read_code(&body)
}

pub async fn poll(
    http: &reqwest::Client,
    ep: &Endpoints,
    client_id: &str,
    device_code: &str,
) -> Poll {
    let sent = post_form(
        http,
        &ep.access_token,
        &[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ],
    )
    .send()
    .await;
    match sent {
        Ok(response) => match response.text().await {
            Ok(body) => read_poll(&body),
            Err(err) => Poll::Failed(offline("finish signing in", &err).message()),
        },
        Err(err) => Poll::Failed(offline("finish signing in", &err).message()),
    }
}

/// The account the token signs in as.
pub async fn whoami(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
) -> Result<String, BackupError> {
    let reply = api::get(http, ep, "/user", Some(token), "read your account").await?;
    reply.body["login"]
        .as_str()
        .filter(|login| api::valid_name(login))
        .map(str::to_owned)
        .ok_or_else(|| BackupError::other("GitHub's answer named no account"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_never_shows_a_token_or_device_code() {
        let shown = format!("{:?}", Poll::Token("gho_secret".into()));
        assert!(!shown.contains("gho_secret"), "{shown}");
        let code = DeviceCode {
            device_code: "device-secret".into(),
            user_code: "ABCD-1234".into(),
            verification_uri: "https://github.com/login/device".into(),
            expires_in: 900,
            interval: 5,
        };
        let shown = format!("{code:?}");
        assert!(
            !shown.contains("device-secret") && shown.contains("ABCD-1234"),
            "{shown}"
        );
    }

    #[test]
    fn reads_a_code_only_for_githubs_own_page() {
        let code = read_code(
            r#"{"device_code":"d","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900}"#,
        )
        .unwrap();
        assert_eq!((code.user_code.as_str(), code.interval), ("ABCD-1234", 5));
        let elsewhere = r#"{"device_code":"d","user_code":"X","verification_uri":"https://github.com.evil.example/login/device","expires_in":900,"interval":5}"#;
        assert!(read_code(elsewhere).unwrap_err().contains("not its own"));
        assert!(read_code("<html>").is_err());
    }

    #[test]
    fn reads_every_answer_to_asking_for_the_token() {
        assert_eq!(
            read_poll(r#"{"error":"authorization_pending"}"#),
            Poll::Pending
        );
        assert_eq!(
            read_poll(r#"{"error":"slow_down","interval":10}"#),
            Poll::SlowDown
        );
        assert_eq!(read_poll(r#"{"error":"expired_token"}"#), Poll::Expired);
        assert_eq!(read_poll(r#"{"error":"access_denied"}"#), Poll::Denied);
        assert_eq!(
            read_poll(r#"{"error":"device_flow_disabled"}"#),
            Poll::Disabled
        );
        assert_eq!(
            read_poll(r#"{"access_token":"gho_x","token_type":"bearer","scope":"repo"}"#),
            Poll::Token("gho_x".into())
        );
        assert!(matches!(read_poll("nope"), Poll::Failed(_)));
        assert!(matches!(
            read_poll(r#"{"error":"incorrect_client_credentials"}"#),
            Poll::Failed(_)
        ));
    }

    #[test]
    fn encodes_a_form() {
        assert_eq!(
            form(&[("client_id", "Iv1.ab"), ("grant_type", "urn:x:y z&=")]),
            "client_id=Iv1.ab&grant_type=urn%3Ax%3Ay%20z%26%3D"
        );
    }

    #[test]
    fn names_a_repository_after_the_vault() {
        assert_eq!(repo_name("My notes"), "my-notes");
        assert_eq!(repo_name("Kasten"), "kasten-notes");
        assert_eq!(repo_name("Работа"), "kasten-notes");
        assert_eq!(repo_name("Dev vault"), "dev-vault-notes");
    }
}
