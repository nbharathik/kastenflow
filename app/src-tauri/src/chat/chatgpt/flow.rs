//! One sign-in, from the address opened in the browser to the tokens kept:
//! a listener on this computer, the sign-in page's address with a fresh
//! state, nonce and PKCE challenge, the wait for the browser to come back,
//! the code traded for tokens, and the account saved.

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use serde::Serialize;

use super::authorize::{Authorization, Endpoints, authorize_url};
use super::callback::{Listener, Outcome};
use super::jwks::Failed;
use super::oauth;
use super::pkce;
use super::saved::Saved;
use super::session::Account;

/// The port to listen on when a random one is not accepted: the one
/// OpenAI's own examples use.
pub const FIXED_PORT: u16 = 1455;

/// A sign-in for an account other than the one already kept.
pub const OTHER_ACCOUNT: &str =
    "You signed in as another ChatGPT account; sign out first to switch";

/// How a sign-in ended, sent to the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SignInEnd {
    Signed {
        email: Option<String>,
        /// False when the keychain would not keep the sign-in.
        remembered: bool,
    },
    /// Nobody finished it in time.
    Expired,
    Denied,
    Failed {
        message: String,
    },
}

/// A sign-in ready to open in the browser.
pub struct Prepared {
    /// The sign-in page's address.
    pub url: String,
    listener: Listener,
    state: String,
    verifier: String,
    nonce: String,
    redirect_uri: String,
    /// The client of an earlier sign-in, if there was one.
    client_id: Option<String>,
    endpoints: Endpoints,
}

/// Listens on `port` (0 for any free one) and builds the address to open.
pub async fn prepare(
    account: &Account,
    http: &reqwest::Client,
    port: u16,
) -> Result<Prepared, String> {
    let endpoints = account.endpoints(http).await;
    let earlier = account.saved().await;
    let host_id = account.host_id().await?;
    let (state, nonce, verifier) = (pkce::secret()?, pkce::secret()?, pkce::secret()?);
    let listener = Listener::bind(port).await?;
    let redirect_uri = listener.redirect_uri();
    let url = authorize_url(
        &endpoints,
        &Authorization {
            client_id: earlier.as_ref().map(|s| s.client_id.as_str()),
            redirect_uri: &redirect_uri,
            state: &state,
            nonce: &nonce,
            challenge: &pkce::challenge(&verifier),
            host_id: &host_id,
            email_hint: earlier.as_ref().and_then(|s| s.email.as_deref()),
            reconsent: false,
        },
    )?;
    Ok(Prepared {
        url,
        listener,
        state,
        verifier,
        nonce,
        redirect_uri,
        client_id: earlier.map(|s| s.client_id),
        endpoints,
    })
}

fn failed(message: impl Into<String>) -> Option<SignInEnd> {
    Some(SignInEnd::Failed {
        message: message.into(),
    })
}

/// Waits for the browser, then finishes the sign-in. None when `cancel`
/// stopped it.
pub async fn finish(
    account: &Account,
    http: &reqwest::Client,
    prepared: Prepared,
    cancel: &AtomicBool,
    limit: Duration,
) -> Option<SignInEnd> {
    let Prepared {
        listener,
        state,
        verifier,
        nonce,
        redirect_uri,
        client_id: earlier,
        endpoints,
        ..
    } = prepared;
    let (code, issued) = match listener.wait(&state, cancel, limit).await {
        Outcome::Cancelled => return None,
        Outcome::TimedOut => return Some(SignInEnd::Expired),
        Outcome::Error(code) if code == "access_denied" => return Some(SignInEnd::Denied),
        Outcome::Error(code) if code == "registration_incomplete" || code == "missing_code" => {
            return failed("ChatGPT did not finish setting KastenFlow up as an app. Try again");
        }
        Outcome::Error(code) => {
            return failed(format!(
                "ChatGPT sent the browser back with an error ({code}). Try again"
            ));
        }
        Outcome::Code { code, client_id } => (code, client_id),
    };
    // The client OpenAI issued, or the one an earlier sign-in kept; never
    // two that differ.
    let client_id = match (issued, earlier) {
        (Some(issued), Some(earlier)) if issued != earlier => {
            return failed("ChatGPT answered for another app than this sign-in started. Try again");
        }
        (Some(client), _) | (None, Some(client)) => client,
        (None, None) => {
            return failed("ChatGPT did not finish setting KastenFlow up as an app. Try again");
        }
    };
    let granted = match oauth::exchange(
        http,
        &endpoints,
        &client_id,
        &code,
        &verifier,
        &redirect_uri,
    )
    .await
    {
        Ok(granted) => granted,
        Err(refused) => return failed(refused.words()),
    };
    if !granted.plan_use() {
        return failed(
            "ChatGPT signed you in but did not let KastenFlow use your plan. Your account or workspace may not include it; check ChatGPT, Settings",
        );
    }
    // Nothing is believed that OpenAI's keys do not vouch for: without the
    // ID token, or without the keys to check it, there is no sign-in.
    let Some(id_token) = granted.id_token.as_deref() else {
        return failed("ChatGPT did not say who signed in. Try again");
    };
    let who = match account
        .identity(http, &endpoints, id_token, &client_id, Some(&nonce))
        .await
    {
        Ok(who) => who,
        Err(Failed::Keys(message)) => return failed(message),
        Err(Failed::Token(why)) => return failed(why.sentence()),
    };
    let Some(refresh_token) = granted.refresh_token.clone() else {
        return failed("ChatGPT gave KastenFlow no way to stay signed in. Try again");
    };
    // A sign-in for another account does not replace the one kept: the
    // person signs out first. The tokens just issued are given back.
    if let Some(kept) = account.saved().await.and_then(|s| s.sub)
        && kept != who.sub
    {
        let _ = oauth::revoke(http, &endpoints, &client_id, &refresh_token).await;
        return failed(OTHER_ACCOUNT);
    }
    let saved = Saved {
        refresh_token,
        client_id,
        email: who.email.clone(),
        sub: Some(who.sub),
    };
    let remembered = account.adopt(saved, &granted).await;
    Some(SignInEnd::Signed {
        email: who.email,
        remembered,
    })
}
