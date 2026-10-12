//! The ChatGPT account on this computer. The keychain holds one entry,
//! `chatgpt @ https://auth.openai.com`, with only what a later start needs
//! to sign back in: the refresh token, the client OpenAI issued for this
//! installation, and the email to show. The access token and the ID token
//! stay in memory (the keychain takes little per entry, and an access
//! token lasts an hour); the access token is renewed when it ends within a
//! minute, or once after the API refuses it, and every renewed refresh
//! token is saved back, since each one replaces the last. Renewals take
//! turns, so two requests never spend one refresh token twice.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::authorize::{self, Endpoints};
use super::oauth::{self, Granted, Refused};
use super::pkce;
use crate::chat::responses::Shape;
use crate::secrets::KeyStore;

/// The keychain account of the sign-in.
pub const ENTRY: &str = "chatgpt @ https://auth.openai.com";
/// The keychain account of this installation's host id.
pub(crate) const HOST_ENTRY: &str = "chatgpt host @ https://auth.openai.com";
/// A token is replaced when it ends within this long.
const MARGIN: Duration = Duration::from_secs(60);

pub const SIGN_IN_FIRST: &str =
    "Sign in with ChatGPT first: open Settings, AI providers, and choose Continue with ChatGPT";

/// What the keychain keeps.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Saved {
    pub refresh_token: String,
    pub client_id: String,
    pub email: Option<String>,
}

/// Shown without the refresh token.
impl std::fmt::Debug for Saved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Saved")
            .field("client_id", &self.client_id)
            .field("email", &self.email)
            .finish_non_exhaustive()
    }
}

fn read_saved(keys: &dyn KeyStore) -> Result<Option<Saved>, String> {
    Ok(keys
        .get(ENTRY)?
        .and_then(|text| serde_json::from_str(&text).ok()))
}

fn write_saved(keys: &dyn KeyStore, saved: &Saved) -> Result<(), String> {
    let text = serde_json::to_string(saved).map_err(|e| e.to_string())?;
    keys.set(ENTRY, &text)
}

/// Whether the keychain holds a sign-in.
pub fn signed_in(keys: &dyn KeyStore) -> bool {
    read_saved(keys).is_ok_and(|saved| saved.is_some())
}

struct Access {
    token: String,
    until: Instant,
}

#[derive(Default)]
struct Live {
    /// `saved` is what the keychain held, or what a sign-in set since.
    loaded: bool,
    saved: Option<Saved>,
    access: Option<Access>,
    /// The keychain refused the refresh token: the sign-in lasts until
    /// Kasten quits.
    session_only: bool,
}

/// What Settings shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub signed_in: bool,
    pub email: Option<String>,
    /// False when this computer's keychain would not keep the sign-in.
    pub remembered: bool,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

/// The ChatGPT account, shared by every chat and every AI request.
pub struct Account {
    keys: Arc<dyn KeyStore>,
    live: tokio::sync::Mutex<Live>,
    endpoints: Mutex<Option<Endpoints>>,
    shape: Mutex<Shape>,
    /// The flag that stops the sign-in under way.
    pending: Mutex<Option<Arc<AtomicBool>>>,
}

impl Account {
    pub fn new(keys: Arc<dyn KeyStore>) -> Account {
        Account {
            keys,
            live: tokio::sync::Mutex::default(),
            endpoints: Mutex::new(None),
            shape: Mutex::new(Shape::default()),
            pending: Mutex::new(None),
        }
    }

    /// An account that asks `endpoints`, a server of a test.
    #[cfg(test)]
    pub(crate) fn at(keys: Arc<dyn KeyStore>, endpoints: Endpoints) -> Account {
        let account = Account::new(keys);
        *locked(&account.endpoints) = Some(endpoints);
        account
    }

    /// Keychain work off the async threads.
    async fn keychain<T: Send + 'static>(
        &self,
        job: impl FnOnce(&dyn KeyStore) -> T + Send + 'static,
    ) -> Result<T, String> {
        let keys = Arc::clone(&self.keys);
        tokio::task::spawn_blocking(move || job(keys.as_ref()))
            .await
            .map_err(|_| "The system keychain stopped unexpectedly".to_owned())
    }

    /// Reads the keychain once; a keychain that cannot be read now is
    /// asked again next time.
    async fn load(&self, live: &mut Live) {
        if live.loaded {
            return;
        }
        if let Ok(Ok(saved)) = self.keychain(read_saved).await {
            live.saved = saved;
            live.loaded = true;
        }
    }

    /// Whether the account is signed in, and as whom.
    pub async fn status(&self) -> Status {
        let mut live = self.live.lock().await;
        self.load(&mut live).await;
        Status {
            signed_in: live.saved.is_some(),
            email: live.saved.as_ref().and_then(|s| s.email.clone()),
            remembered: !live.session_only,
        }
    }

    /// What a new sign-in starts from: the client and email of the one
    /// before it, if any.
    pub(super) async fn saved(&self) -> Option<Saved> {
        let mut live = self.live.lock().await;
        self.load(&mut live).await;
        live.saved.clone()
    }

    /// Where the sign-in endpoints are; asked once, and kept.
    pub(super) async fn endpoints(&self, http: &reqwest::Client) -> Endpoints {
        let known = locked(&self.endpoints).clone();
        if let Some(known) = known {
            return known;
        }
        let found = authorize::discover(http).await;
        *locked(&self.endpoints) = Some(found.clone());
        found
    }

    /// This installation's host id, made on first use and kept.
    pub(super) async fn host_id(&self) -> Result<String, String> {
        self.keychain(|keys| -> Result<String, String> {
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

    /// An access token to send: the one held, unless it ends within a
    /// minute.
    pub async fn access(&self, http: &reqwest::Client) -> Result<String, String> {
        let mut live = self.live.lock().await;
        self.load(&mut live).await;
        if let Some(access) = &live.access
            && access.until > Instant::now() + MARGIN
        {
            return Ok(access.token.clone());
        }
        self.renew(&mut live, http).await
    }

    /// An access token after the API refused `rejected`: one renewed since,
    /// if there is one, else a new one.
    pub async fn after_rejection(
        &self,
        http: &reqwest::Client,
        rejected: &str,
    ) -> Result<String, String> {
        let mut live = self.live.lock().await;
        self.load(&mut live).await;
        if let Some(access) = &live.access
            && access.token != rejected
            && access.until > Instant::now() + MARGIN
        {
            return Ok(access.token.clone());
        }
        self.renew(&mut live, http).await
    }

    async fn renew(&self, live: &mut Live, http: &reqwest::Client) -> Result<String, String> {
        let Some(saved) = live.saved.clone() else {
            return Err(SIGN_IN_FIRST.to_owned());
        };
        let endpoints = self.endpoints(http).await;
        let asked = Instant::now();
        match oauth::refresh(http, &endpoints, &saved.client_id, &saved.refresh_token).await {
            Ok(granted) => {
                // Each refresh token replaces the one before: keep the new one.
                if let Some(next) = granted
                    .refresh_token
                    .clone()
                    .filter(|n| *n != saved.refresh_token)
                {
                    let updated = Saved {
                        refresh_token: next,
                        ..saved
                    };
                    live.session_only = !self.keep(&updated).await;
                    live.saved = Some(updated);
                }
                live.access = Some(Access {
                    token: granted.access_token.clone(),
                    until: asked + granted.expires_in,
                });
                Ok(granted.access_token)
            }
            Err(Refused::Invalid(words)) => {
                // The sign-in is over: forget it, so Settings says so.
                self.forget(live).await;
                Err(format!("{words} in Settings, AI providers"))
            }
            Err(Refused::Unavailable(words)) => Err(words),
        }
    }

    /// Saves to the keychain; whether it took.
    async fn keep(&self, saved: &Saved) -> bool {
        let saved = saved.clone();
        matches!(
            self.keychain(move |keys| write_saved(keys, &saved)).await,
            Ok(Ok(()))
        )
    }

    async fn forget(&self, live: &mut Live) {
        live.saved = None;
        live.access = None;
        live.session_only = false;
        live.loaded = true;
        let _ = self.keychain(|keys| keys.delete(ENTRY)).await;
    }

    /// A sign-in just finished: keeps it in the keychain, and the access
    /// token in memory. Whether the keychain took it.
    pub(super) async fn adopt(&self, saved: Saved, granted: &Granted) -> bool {
        let mut live = self.live.lock().await;
        let remembered = self.keep(&saved).await;
        live.loaded = true;
        live.saved = Some(saved);
        live.session_only = !remembered;
        live.access = Some(Access {
            token: granted.access_token.clone(),
            until: Instant::now() + granted.expires_in,
        });
        remembered
    }

    /// Signs out here at once, then asks OpenAI to end the sign-in; whether
    /// it said it did. Without that, Kasten's access stays listed in the
    /// person's ChatGPT settings until they remove it there.
    pub async fn sign_out(&self, http: &reqwest::Client) -> bool {
        self.cancel();
        let saved = {
            let mut live = self.live.lock().await;
            self.load(&mut live).await;
            let saved = live.saved.clone();
            self.forget(&mut live).await;
            saved
        };
        let Some(saved) = saved else {
            return false;
        };
        let endpoints = self.endpoints(http).await;
        oauth::revoke(http, &endpoints, &saved.client_id, &saved.refresh_token).await
    }

    /// The request shape the API has been found to take.
    pub fn shape(&self) -> Shape {
        *locked(&self.shape)
    }

    pub fn learn(&self, shape: Shape) {
        *locked(&self.shape) = shape;
    }

    /// Starts a sign-in: stops the one under way, and gives the flag that
    /// stops this one.
    pub fn begin(&self) -> Arc<AtomicBool> {
        let next = Arc::new(AtomicBool::new(false));
        if let Some(old) = locked(&self.pending).replace(Arc::clone(&next)) {
            old.store(true, Ordering::SeqCst);
        }
        next
    }

    /// Stops the sign-in under way.
    pub fn cancel(&self) {
        if let Some(old) = locked(&self.pending).take() {
            old.store(true, Ordering::SeqCst);
        }
    }

    /// The sign-in `flag` stopped is over.
    pub fn end(&self, flag: &Arc<AtomicBool>) {
        let mut pending = locked(&self.pending);
        if pending.as_ref().is_some_and(|p| Arc::ptr_eq(p, flag)) {
            *pending = None;
        }
    }
}
