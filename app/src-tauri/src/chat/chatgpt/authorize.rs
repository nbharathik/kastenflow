//! Where Sign in with ChatGPT's pages are, and the address of the sign-in
//! page the browser opens: the client (a new registration or the one OpenAI
//! issued before), the loopback address to come back to, the PKCE
//! challenge, and the scopes. Only auth.openai.com is ever asked.

use std::time::Duration;

use reqwest::Url;
use reqwest::header::ACCEPT;
use serde_json::Value;

pub const ISSUER: &str = "https://auth.openai.com";
/// The API the tokens are for.
pub const RESOURCE: &str = "https://api.openai.com/v1";
/// Who the person is, and permission to use their ChatGPT plan.
pub const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The scope that lets requests be paid for by the ChatGPT plan.
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
/// The only path the browser comes back to, on 127.0.0.1.
pub const CALLBACK_PATH: &str = "/auth/callback";
/// The first sign-in's client: OpenAI registers a client of its own for
/// this installation during it, and names it in the answer.
pub const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
pub const APP_NAME: &str = "KastenFlow";
/// How long a request to OpenAI's sign-in servers may take.
pub const WAIT: Duration = Duration::from_secs(30);

/// Where the sign-in page and the token endpoints are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub authorize: String,
    pub token: String,
    /// Not known unless OpenAI's discovery document names it.
    pub revoke: Option<String>,
}

impl Endpoints {
    /// The addresses OpenAI documents, for when discovery cannot be read.
    pub fn official() -> Endpoints {
        Endpoints {
            authorize: format!("{ISSUER}/api/accounts/authorize"),
            token: format!("{ISSUER}/api/accounts/oauth/token"),
            revoke: None,
        }
    }

    /// The endpoints in OpenAI's discovery document, if it is OpenAI's own:
    /// its issuer, and every address, must be auth.openai.com.
    pub fn from_discovery(body: &str) -> Option<Endpoints> {
        let document: Value = serde_json::from_str(body).ok()?;
        if document["issuer"].as_str()? != ISSUER {
            return None;
        }
        let own = |key: &str| -> Option<String> {
            let address = document[key].as_str()?;
            let origin = Url::parse(address).ok()?.origin().ascii_serialization();
            (origin == ISSUER).then(|| address.to_owned())
        };
        Some(Endpoints {
            authorize: own("authorization_endpoint")?,
            token: own("token_endpoint")?,
            revoke: own("revocation_endpoint"),
        })
    }
}

/// OpenAI's endpoints from its discovery document, else the documented
/// ones.
pub async fn discover(http: &reqwest::Client) -> Endpoints {
    let asked = http
        .get(format!("{ISSUER}/.well-known/openid-configuration"))
        .header(ACCEPT, "application/json")
        .timeout(WAIT)
        .send()
        .await;
    let body = match asked {
        Ok(response) if response.status().is_success() => response.text().await.ok(),
        _ => None,
    };
    body.and_then(|body| Endpoints::from_discovery(&body))
        .unwrap_or_else(Endpoints::official)
}

/// What the sign-in page is asked for.
pub struct Authorization<'a> {
    /// The client OpenAI issued for an earlier sign-in; None registers a
    /// new one.
    pub client_id: Option<&'a str>,
    pub redirect_uri: &'a str,
    pub state: &'a str,
    pub nonce: &'a str,
    pub challenge: &'a str,
    pub host_id: &'a str,
    /// The account's email, to start from it again.
    pub email_hint: Option<&'a str>,
    /// Ask for the permission again, even if it was granted.
    pub reconsent: bool,
}

/// The address to open in the browser.
pub fn authorize_url(endpoints: &Endpoints, a: &Authorization<'_>) -> Result<String, String> {
    let mut url = Url::parse(&endpoints.authorize)
        .map_err(|_| "ChatGPT's sign-in address could not be read".to_owned())?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", a.client_id.unwrap_or(DYNAMIC_CLIENT))
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", a.redirect_uri)
            .append_pair("scope", SCOPES)
            .append_pair("resource", RESOURCE)
            .append_pair("state", a.state)
            .append_pair("nonce", a.nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", a.challenge)
            .append_pair("ext_agent_host_id", a.host_id);
        if a.client_id.is_none() {
            query.append_pair("agent_name_hint", APP_NAME);
        }
        if let Some(email) = a.email_hint {
            query.append_pair("login_hint", email);
        }
        if a.reconsent {
            query.append_pair("prompt", "consent");
        }
    }
    Ok(url.into())
}

#[cfg(test)]
#[path = "authorize_tests.rs"]
mod tests;
