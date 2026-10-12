//! Sign in with ChatGPT's OpenID Connect, as OpenAI documents it for apps
//! that run on the person's own computer: the address of the sign-in page,
//! trading its code for tokens, refreshing them and revoking them. No
//! client secret exists; PKCE (pkce.rs) is the proof. Only auth.openai.com
//! is ever asked, and the tokens are for api.openai.com alone.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::Url;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde_json::Value;

use super::authorize::{Endpoints, ISSUER, PLAN_SCOPE, RESOURCE, WAIT};
use super::pkce;

/// What the token endpoint granted.
#[derive(Clone, PartialEq, Eq)]
pub struct Granted {
    pub access_token: String,
    /// A new one replaces the old: each refresh rotates it.
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub expires_in: Duration,
    /// None when the answer did not say, as a refresh may leave it out.
    pub scopes: Option<Vec<String>>,
}

/// Shown without the tokens.
impl std::fmt::Debug for Granted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Granted")
            .field("expires_in", &self.expires_in)
            .field("scopes", &self.scopes)
            .finish_non_exhaustive()
    }
}

impl Granted {
    /// Whether the ChatGPT plan may pay for requests: the answer named
    /// the scope.
    pub fn plan_use(&self) -> bool {
        self.scopes
            .as_ref()
            .is_some_and(|scopes| scopes.iter().any(|s| s == PLAN_SCOPE))
    }
}

/// Why the token endpoint said no.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refused {
    /// The code or refresh token is no good any more: only signing in
    /// again helps, and what was kept can go.
    Invalid(String),
    /// Not answered, or not now: nothing is lost by trying later.
    Unavailable(String),
}

/// Reads a token response.
pub fn read_grant(body: &str) -> Result<Granted, String> {
    let unreadable = || "ChatGPT's answer to the sign-in could not be read".to_owned();
    let value: Value = serde_json::from_str(body).map_err(|_| unreadable())?;
    let access_token = value["access_token"]
        .as_str()
        .filter(|t| !t.is_empty())
        .ok_or_else(unreadable)?;
    if value["token_type"]
        .as_str()
        .is_some_and(|t| !t.eq_ignore_ascii_case("bearer"))
    {
        return Err(unreadable());
    }
    let seconds = value["expires_in"].as_u64().unwrap_or(3600);
    if seconds == 0 {
        return Err(unreadable());
    }
    let text = |key: &str| {
        value[key]
            .as_str()
            .filter(|t| !t.is_empty())
            .map(str::to_owned)
    };
    Ok(Granted {
        access_token: access_token.to_owned(),
        refresh_token: text("refresh_token"),
        id_token: text("id_token"),
        expires_in: Duration::from_secs(seconds),
        scopes: value["scope"]
            .as_str()
            .map(|s| s.split_whitespace().map(str::to_owned).collect()),
    })
}

/// The error code and words of a refusal, in either shape OpenAI uses:
/// `{"error": "code", "error_description": "…"}` or
/// `{"error": {"code": "…", "message": "…"}}`.
fn error_of(body: &str) -> (String, String) {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let first = |keys: [Option<&Value>; 3]| {
        keys.into_iter()
            .flatten()
            .find_map(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let code = first([
        value.get("error"),
        value.pointer("/error/code"),
        value.get("code"),
    ]);
    let words = first([
        value.get("error_description"),
        value.pointer("/error/message"),
        value.get("message"),
    ]);
    (code, words)
}

/// Codes after which a refresh token is never good again.
const GONE: [&str; 7] = [
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
    "invalid_client",
];

fn refusal(status: u16, body: &str) -> Refused {
    let (code, said) = error_of(body);
    let said = said.trim().trim_end_matches('.');
    let said = if said.is_empty() {
        String::new()
    } else {
        format!(": {said}")
    };
    if GONE.contains(&code.as_str()) {
        Refused::Invalid(format!(
            "ChatGPT no longer accepts this sign-in ({code}){said}. Sign in again"
        ))
    } else {
        Refused::Unavailable(format!(
            "ChatGPT answered {status}{said}. Try again in a moment"
        ))
    }
}

/// A form body, each value percent-encoded (the app's HTTP client has no
/// form support of its own).
fn form(pairs: &[(&str, &str)]) -> String {
    let mut url = Url::parse("http://form.invalid/").expect("a constant address");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or_default().to_owned()
}

fn failed(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "ChatGPT took too long to answer; try again".to_owned()
    } else {
        "Could not reach ChatGPT. Check the connection and try again".to_owned()
    }
}

async fn post(
    http: &reqwest::Client,
    url: &str,
    pairs: &[(&str, &str)],
) -> Result<(u16, String), String> {
    let response = http
        .post(url)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form(pairs))
        .timeout(WAIT)
        .send()
        .await
        .map_err(|e| failed(&e))?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| failed(&e))?;
    Ok((status, body))
}

async fn grant(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    pairs: &[(&str, &str)],
) -> Result<Granted, Refused> {
    let (status, body) = post(http, &endpoints.token, pairs)
        .await
        .map_err(Refused::Unavailable)?;
    if status == 200 {
        return read_grant(&body).map_err(Refused::Unavailable);
    }
    Err(refusal(status, &body))
}

/// Trades the code the browser brought for tokens.
pub async fn exchange(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<Granted, Refused> {
    grant(
        http,
        endpoints,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri),
            ("resource", RESOURCE),
        ],
    )
    .await
}

/// Trades a refresh token for a new access token, and a new refresh token.
pub async fn refresh(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    client_id: &str,
    refresh_token: &str,
) -> Result<Granted, Refused> {
    grant(
        http,
        endpoints,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("resource", RESOURCE),
        ],
    )
    .await
}

/// Asks OpenAI to end the sign-in; whether it said so. Without a
/// revocation address there is nothing to ask.
pub async fn revoke(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    client_id: &str,
    refresh_token: &str,
) -> bool {
    let Some(url) = &endpoints.revoke else {
        return false;
    };
    let pairs = [
        ("token", refresh_token),
        ("token_type_hint", "refresh_token"),
        ("client_id", client_id),
    ];
    post(http, url, &pairs)
        .await
        .is_ok_and(|(status, _)| status == 200)
}

/// Who signed in, from the ID token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub email: Option<String>,
}

/// Seconds since 1970.
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Reads the ID token's claims and checks them: OpenAI's issuer, this
/// client as the audience, not expired, and (when asked) this sign-in's
/// nonce. The token comes straight from OpenAI's token endpoint over TLS,
/// so its signature is not checked (OpenID Connect Core, 3.1.3.7); it only
/// says whose email to show, and grants nothing.
pub fn identity(
    id_token: &str,
    client_id: &str,
    nonce: Option<&str>,
    now: u64,
) -> Result<Identity, String> {
    let bad = |why: &str| format!("ChatGPT's answer did not say who signed in ({why})");
    let payload = id_token.split('.').nth(1).ok_or_else(|| bad("no claims"))?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| bad("unreadable"))?;
    let claims: Value = serde_json::from_slice(&bytes).map_err(|_| bad("unreadable"))?;
    if claims["iss"].as_str() != Some(ISSUER) {
        return Err(bad("another issuer"));
    }
    let audience = match &claims["aud"] {
        Value::String(one) => one == client_id,
        Value::Array(list) => list.iter().any(|a| a.as_str() == Some(client_id)),
        _ => false,
    };
    if !audience {
        return Err(bad("another client"));
    }
    // A minute of slack for clocks that differ.
    if claims["exp"].as_u64().is_none_or(|exp| exp + 60 < now) {
        return Err(bad("expired"));
    }
    if let Some(expected) = nonce
        && !claims["nonce"]
            .as_str()
            .is_some_and(|got| pkce::same(got, expected))
    {
        return Err(bad("another sign-in"));
    }
    if claims["sub"].as_str().is_none_or(str::is_empty) {
        return Err(bad("no account"));
    }
    Ok(Identity {
        email: claims["email"]
            .as_str()
            .map(str::trim)
            .filter(|e| !e.is_empty())
            .map(str::to_owned),
    })
}

#[cfg(test)]
#[path = "oauth_tests.rs"]
mod tests;
