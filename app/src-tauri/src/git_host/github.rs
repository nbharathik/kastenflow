//! GitHub, for "Sign in with GitHub": the device flow (a code the person
//! types at github.com/login/device), the account, and private repositories
//! to back up into. Only github.com and api.github.com are ever asked, and
//! the token goes nowhere else.

use std::time::Duration;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const DEVICE_CODE: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN: &str = "https://github.com/login/oauth/access_token";
/// The only page a sign-in code may be typed at.
pub const VERIFY: &str = "https://github.com/login/device";
const API: &str = "https://api.github.com";
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

/// A private repository to back up into.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub name: String,
    pub full_name: String,
    pub clone_url: String,
    pub html_url: String,
    pub updated_at: Option<String>,
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
    let encode = |text: &str| {
        text.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect::<String>()
    };
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", encode(key), encode(value)))
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

async fn read_json(response: reqwest::Response, what: &str) -> Result<Value, String> {
    let body = response.text().await.map_err(|e| failed(what, &e))?;
    serde_json::from_str(&body)
        .map_err(|_| format!("GitHub's answer could not be read when trying to {what}"))
}

fn failed(what: &str, err: &reqwest::Error) -> String {
    if err.is_timeout() {
        format!("GitHub took too long to {what}; try again")
    } else {
        format!("Could not reach GitHub to {what}. Check the connection and try again")
    }
}

pub async fn request_code(http: &reqwest::Client, client_id: &str) -> Result<DeviceCode, String> {
    let response = post_form(
        http,
        DEVICE_CODE,
        &[("client_id", client_id), ("scope", SCOPE)],
    )
    .send()
    .await
    .map_err(|e| failed("start signing in", &e))?;
    let body = response
        .text()
        .await
        .map_err(|e| failed("start signing in", &e))?;
    read_code(&body)
}

pub async fn poll(http: &reqwest::Client, client_id: &str, device_code: &str) -> Poll {
    let sent = post_form(
        http,
        ACCESS_TOKEN,
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
            Err(err) => Poll::Failed(failed("finish signing in", &err)),
        },
        Err(err) => Poll::Failed(failed("finish signing in", &err)),
    }
}

fn api(
    http: &reqwest::Client,
    method: reqwest::Method,
    path: &str,
    token: &str,
) -> reqwest::RequestBuilder {
    http.request(method, format!("{API}{path}"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(WAIT)
}

fn with_json(request: reqwest::RequestBuilder, body: &Value) -> reqwest::RequestBuilder {
    request
        .header(CONTENT_TYPE, "application/json")
        .body(body.to_string())
}

/// The account the token signs in as.
pub async fn whoami(http: &reqwest::Client, token: &str) -> Result<String, String> {
    let response = api(http, reqwest::Method::GET, "/user", token)
        .send()
        .await
        .map_err(|e| failed("read your account", &e))?;
    if response.status().as_u16() == 401 {
        return Err("GitHub no longer takes this sign-in; sign in again".into());
    }
    let value = read_json(response, "read your account").await?;
    value["login"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "GitHub's answer named no account".into())
}

fn read_repo(value: &Value) -> Option<Repo> {
    Some(Repo {
        name: value["name"].as_str()?.to_owned(),
        full_name: value["full_name"].as_str()?.to_owned(),
        clone_url: value["clone_url"]
            .as_str()
            .filter(|u| u.starts_with("https://github.com/"))?
            .to_owned(),
        html_url: value["html_url"].as_str()?.to_owned(),
        updated_at: value["updated_at"].as_str().map(str::to_owned),
    })
}

/// Makes a private repository. A name in use answers `Ok(None)`, so the
/// caller can offer another.
pub async fn create_private_repo(
    http: &reqwest::Client,
    token: &str,
    name: &str,
) -> Result<Option<Repo>, String> {
    let request = api(http, reqwest::Method::POST, "/user/repos", token);
    let response = with_json(
        request,
        &json!({
            "name": name,
            "private": true,
            "description": "KastenFlow vault backup",
            "has_issues": false,
            "has_projects": false,
            "has_wiki": false,
            "auto_init": false,
        }),
    )
    .send()
    .await
    .map_err(|e| failed("make the repository", &e))?;
    match response.status().as_u16() {
        201 => {
            let value = read_json(response, "make the repository").await?;
            read_repo(&value)
                .map(Some)
                .ok_or_else(|| "GitHub's answer named no repository".into())
        }
        422 => Ok(None),
        401 | 403 => Err("GitHub did not let this sign-in make a repository; sign in again".into()),
        status => Err(format!(
            "GitHub could not make the repository (it answered {status})"
        )),
    }
}

/// The account's private repositories, most recently changed first.
pub async fn private_repos(http: &reqwest::Client, token: &str) -> Result<Vec<Repo>, String> {
    let response = api(
        http,
        reqwest::Method::GET,
        "/user/repos?visibility=private&affiliation=owner&sort=updated&per_page=100",
        token,
    )
    .send()
    .await
    .map_err(|e| failed("list your repositories", &e))?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub could not list your repositories (it answered {})",
            response.status()
        ));
    }
    let value = read_json(response, "list your repositories").await?;
    Ok(value
        .as_array()
        .map(|list| list.iter().filter_map(read_repo).collect())
        .unwrap_or_default())
}

/// Asks GitHub to refuse force pushes to, and deletion of, the backup's
/// branch. Plans without rulesets for private repositories refuse this,
/// which is fine: Kasten never forces anyway.
pub async fn protect(http: &reqwest::Client, token: &str, full_name: &str) -> bool {
    let request = api(
        http,
        reqwest::Method::POST,
        &format!("/repos/{full_name}/rulesets"),
        token,
    );
    with_json(
        request,
        &json!({
            "name": "KastenFlow backup",
            "target": "branch",
            "enforcement": "active",
            "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
            "rules": [{ "type": "deletion" }, { "type": "non_fast_forward" }],
        }),
    )
    .send()
    .await
    .is_ok_and(|r| r.status().is_success())
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

    #[test]
    fn takes_only_repositories_on_github() {
        let repo = json!({"name":"n","full_name":"a/n","clone_url":"https://github.com/a/n.git","html_url":"https://github.com/a/n","updated_at":"2026-09-28T10:00:00Z"});
        assert!(read_repo(&repo).is_some());
        let elsewhere = json!({"name":"n","full_name":"a/n","clone_url":"https://evil.example/a/n.git","html_url":"x"});
        assert!(read_repo(&elsewhere).is_none());
    }
}
