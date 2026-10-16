//! The ChatGPT account on this computer. The keychain holds one entry (see
//! saved.rs) with only what a later start needs to sign back in; the access
//! token and the ID token stay in memory (hold.rs). The access token is
//! renewed when it ends within a minute, or once after the API refuses it,
//! and every renewed refresh token is saved back, since each one replaces the
//! last.
//!
//! A renewal (renew.rs) is one task that runs to its end whatever happens to
//! the request that asked for it: a request that is stopped or gives up
//! does not lose the refresh token the server has just rotated. Requests
//! that need a token while one is being renewed wait for that renewal
//! instead of starting another.
//!
//! The account is the one whose ID token was verified at sign-in (its `sub`
//! is kept). A renewal that brings a verified ID token for another account
//! ends the sign-in. An entry from before accounts were verified has no
//! `sub`: it is kept, but asks to be signed in again before it is used.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::authorize::Endpoints;
use super::efforts::{Feature, Tried};
use super::hold::{Access, Core, locked, owner_of};
#[cfg(test)]
use super::hold::{DISCOVERY_RETRY, Found};
use super::idtoken::Identity;
use super::jwks::Failed;
use super::oauth::{self, Granted};
use super::pkce;
use super::saved::Saved;
use crate::chat::responses::Shape;
use crate::secrets::KeyStore;

pub use super::hold::{Denied, Token};

/// The keychain account of this installation's host id.
pub(crate) const HOST_ENTRY: &str = "chatgpt host @ https://auth.openai.com";
/// A token is replaced when it ends within this long.
const MARGIN: Duration = Duration::from_secs(60);

pub const SIGN_IN_FIRST: &str =
    "Sign in with ChatGPT first: open Settings, AI providers, and choose Continue with ChatGPT";
/// What an entry from before accounts were verified says until the person
/// signs in again.
pub const SIGN_IN_AGAIN: &str = "Sign in with ChatGPT again to confirm the account: open Settings, AI providers, and choose Sign in again";

/// What Settings shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub signed_in: bool,
    pub email: Option<String>,
    /// False when this computer's keychain would not keep the sign-in.
    pub remembered: bool,
    /// A sign-in from before accounts were verified: it is kept, but cannot
    /// be used until the person signs in once more.
    pub reauth: bool,
    /// The same as `!remembered` while signed in: the sign-in lasts until
    /// KastenFlow quits.
    pub session_only: bool,
    /// The ID token of the last renewal could not be checked. The access
    /// token it came with works; the check is made again at the next renewal.
    pub identity_unverified: bool,
    /// Words for whichever of the two above is so.
    pub warning: Option<String>,
    /// The system keychain could not be read just now, so whether there is a
    /// sign-in is not known.
    pub keychain_error: Option<String>,
}

/// The ChatGPT account, shared by every chat and every AI request.
pub struct Account {
    pub(super) core: Arc<Core>,
}

impl Account {
    pub fn new(keys: Arc<dyn KeyStore>) -> Account {
        Account {
            core: Arc::new(Core::new(keys, super::authorize::DISCOVERY)),
        }
    }

    /// An account that asks `endpoints`, a server of a test.
    #[cfg(test)]
    pub(crate) fn at(keys: Arc<dyn KeyStore>, endpoints: Endpoints) -> Account {
        let account = Account::new(keys);
        *locked(&account.core.endpoints) = Some(Found {
            endpoints,
            fell_back_at: None,
        });
        account
    }

    /// An account whose discovery document is at `url`, a server of a test.
    #[cfg(test)]
    pub(crate) fn discovering_at(keys: Arc<dyn KeyStore>, url: &str) -> Account {
        Account {
            core: Arc::new(Core::new(keys, url)),
        }
    }

    /// Keeps what requests find out in `dir`, not the app's cache folder.
    #[cfg(test)]
    pub(crate) fn learn_in(&self, dir: std::path::PathBuf) {
        self.core.learned.keep_in(dir);
    }

    /// Makes the documented endpoints, if they stand in for a discovery
    /// document, old enough to be replaced.
    #[cfg(test)]
    pub(crate) fn age_fallback(&self) {
        if let Some(found) = locked(&self.core.endpoints).as_mut() {
            found.fell_back_at = Instant::now().checked_sub(DISCOVERY_RETRY * 2);
        }
    }

    /// Whether the account is signed in, and as whom.
    pub async fn status(&self) -> Status {
        let loaded = self.core.load().await;
        let live = locked(&self.core.live);
        let confirmed = live.saved.as_ref().is_some_and(Saved::confirmed);
        let session_only = confirmed && live.session_only;
        let identity_unverified = confirmed && live.unverified.is_some();
        let mut warnings = Vec::new();
        if let Some(why) = live.unverified.as_ref().filter(|_| confirmed) {
            warnings.push(format!(
                "{}. The sign-in works; it is checked again the next time it renews",
                why.trim_end_matches('.')
            ));
        }
        if session_only {
            warnings.push(
                "The system keychain would not keep this sign-in, so it lasts only until KastenFlow closes"
                    .to_owned(),
            );
        }
        Status {
            signed_in: confirmed,
            email: live.saved.as_ref().and_then(|s| s.email.clone()),
            remembered: !live.session_only,
            reauth: live.saved.is_some() && !confirmed,
            session_only,
            identity_unverified,
            warning: (!warnings.is_empty()).then(|| warnings.join(". ")),
            keychain_error: loaded.err().map(|d| d.message),
        }
    }

    /// A short stand-in for the signed-in account's id, for files that hold
    /// what was found for one account and must not be believed for another.
    pub async fn owner(&self) -> Option<String> {
        let _ = self.core.load().await;
        locked(&self.core.live).saved.as_ref().and_then(owner_of)
    }

    /// What a new sign-in starts from: the client and email of the one
    /// before it, if any.
    pub(super) async fn saved(&self) -> Option<Saved> {
        let _ = self.core.load().await;
        locked(&self.core.live).saved.clone()
    }

    /// Where the sign-in endpoints are (see `Core::endpoints_for`).
    pub(crate) async fn endpoints(&self, http: &reqwest::Client) -> Endpoints {
        self.core.endpoints_for(http).await
    }

    /// This installation's host id, made on first use and kept.
    pub(super) async fn host_id(&self) -> Result<String, String> {
        self.core
            .keychain(|keys| -> Result<String, String> {
                if let Ok(Some(id)) = keys.get(HOST_ENTRY)
                    && id.starts_with("urn:uuid:")
                {
                    return Ok(id);
                }
                let id = pkce::host_id()?;
                // A keychain that refuses it leaves a new one for each start,
                // which still works.
                let _ = keys.set(HOST_ENTRY, &id);
                Ok(id)
            })
            .await?
    }

    /// Checks an ID token against OpenAI's published keys.
    pub(super) async fn identity(
        &self,
        http: &reqwest::Client,
        endpoints: &Endpoints,
        token: &str,
        client_id: &str,
        nonce: Option<&str>,
    ) -> Result<Identity, Failed> {
        self.core
            .signing_keys
            .identity(http, &endpoints.jwks, token, client_id, nonce, oauth::now())
            .await
    }

    /// An access token to send: the one held, unless it ends within a
    /// minute.
    pub async fn token(&self, http: &reqwest::Client) -> Result<Token, Denied> {
        self.core.load().await?;
        {
            let live = locked(&self.core.live);
            if let Some(access) = &live.access
                && access.until > Instant::now() + MARGIN
            {
                return Ok(Token {
                    value: access.token.clone(),
                    renewed: false,
                });
            }
        }
        Core::renew(&self.core, http).await
    }

    /// An access token after the API refused `rejected`: one renewed since,
    /// if there is one, else a new one.
    pub async fn token_after(
        &self,
        http: &reqwest::Client,
        rejected: &str,
    ) -> Result<Token, Denied> {
        self.core.load().await?;
        {
            let live = locked(&self.core.live);
            if let Some(access) = &live.access
                && access.token != rejected
                && access.until > Instant::now() + MARGIN
            {
                return Ok(Token {
                    value: access.token.clone(),
                    renewed: false,
                });
            }
        }
        Core::renew(&self.core, http).await
    }

    /// `token`, with just the words of a refusal.
    pub async fn access(&self, http: &reqwest::Client) -> Result<String, String> {
        self.token(http)
            .await
            .map(|t| t.value)
            .map_err(|d| d.message)
    }

    /// `token_after`, with just the words of a refusal.
    pub async fn after_rejection(
        &self,
        http: &reqwest::Client,
        rejected: &str,
    ) -> Result<String, String> {
        self.token_after(http, rejected)
            .await
            .map(|t| t.value)
            .map_err(|d| d.message)
    }

    /// A sign-in just finished: keeps it in the keychain, and the access
    /// token in memory. Whether the keychain took it.
    pub(crate) async fn adopt(&self, saved: Saved, granted: &Granted) -> bool {
        let _turn = self.core.gate.lock().await;
        let remembered = self.core.keep(&saved).await;
        {
            let mut live = locked(&self.core.live);
            live.epoch += 1;
            live.loaded = true;
            live.keychain = None;
            live.unverified = None;
            live.session_only = !remembered;
            live.access = Some(Access {
                token: granted.access_token.clone(),
                until: Instant::now() + granted.expires_in,
            });
            live.saved = Some(saved.clone());
        }
        self.core.learned.for_owner(owner_of(&saved));
        remembered
    }

    /// Signs out here at once, then asks OpenAI to end the sign-in; whether
    /// it said it did. Without that, Kasten's access stays listed in the
    /// person's ChatGPT settings until they remove it there.
    pub async fn sign_out(&self, http: &reqwest::Client) -> bool {
        self.cancel();
        let _ = self.core.load().await;
        let saved = locked(&self.core.live).saved.clone();
        self.core.forget(None).await;
        let Some(saved) = saved else {
            return false;
        };
        let endpoints = self.endpoints(http).await;
        oauth::revoke(http, &endpoints, &saved.client_id, &saved.refresh_token).await
    }

    /// The request shape to start with for `model`.
    pub fn shape_for(&self, model: &str) -> Shape {
        self.core.learned.shape_for(model)
    }

    /// Whether a request found that `model` refuses `feature`.
    pub fn refused(&self, model: &str, feature: Feature) -> bool {
        self.core.learned.refused(model, feature)
    }

    /// Remembers what a request found out about `feature` of `model`.
    pub fn learn(&self, model: &str, feature: Feature, found: Tried) {
        self.core.learned.tried(model, feature, found);
    }

    /// Whether a request found that `model` refuses a reasoning effort.
    pub fn effort_refused(&self, model: &str) -> bool {
        self.refused(model, Feature::Effort)
    }

    /// Whether a request found that `model` takes a reasoning effort.
    pub fn effort_works(&self, model: &str) -> bool {
        self.core.learned.works(model, Feature::Effort)
    }

    /// Remembers what a request found out about `model` and a reasoning effort.
    pub fn tried_effort(&self, model: &str, found: Tried) {
        self.learn(model, Feature::Effort, found);
    }

    /// Starts a sign-in: stops the one under way, and gives the flag that
    /// stops this one.
    pub fn begin(&self) -> Arc<AtomicBool> {
        let next = Arc::new(AtomicBool::new(false));
        if let Some(old) = locked(&self.core.pending).replace(Arc::clone(&next)) {
            old.store(true, Ordering::SeqCst);
        }
        next
    }

    /// Stops the sign-in under way.
    pub fn cancel(&self) {
        if let Some(old) = locked(&self.core.pending).take() {
            old.store(true, Ordering::SeqCst);
        }
    }

    /// The sign-in `flag` stopped is over.
    pub fn end(&self, flag: &Arc<AtomicBool>) {
        let mut pending = locked(&self.core.pending);
        if pending.as_ref().is_some_and(|p| Arc::ptr_eq(p, flag)) {
            *pending = None;
        }
    }
}
