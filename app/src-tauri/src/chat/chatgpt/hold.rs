//! What the ChatGPT account holds in memory, and the work that touches only
//! that: the record read from the keychain, the access token, who is being
//! renewed for whom, why the last ID token could not be checked, where the
//! sign-in endpoints are. The account's own methods are in session.rs; the
//! renewal in renew.rs.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tokio::sync::watch;

use super::authorize::{self, Endpoints};
use super::efforts::Learned;
use super::jwks::Cache;
use super::saved::{self, ENTRY, Saved};
use super::session::{SIGN_IN_AGAIN, SIGN_IN_FIRST};
use crate::chat::diagnostics::Stage;
use crate::chat::errors::FailKind;
use crate::secrets::KeyStore;

/// How long the documented endpoints stand in for a discovery document that
/// could not be had, before it is asked for again.
pub(super) const DISCOVERY_RETRY: Duration = Duration::from_secs(60);

/// A token to send with a request.
#[derive(Clone, PartialEq, Eq)]
pub struct Token {
    pub value: String,
    /// It was renewed for the request that asked.
    pub renewed: bool,
}

/// Shown without the token.
impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Token")
            .field("renewed", &self.renewed)
            .finish_non_exhaustive()
    }
}

/// Why there is no token to send, in words, and what kind of failure it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Denied {
    pub message: String,
    /// `Permission` when only Settings can mend it (sign in again);
    /// `Connection` when asking again later may work.
    pub kind: FailKind,
    pub stage: Stage,
    /// The connection itself failed: a fresh one is worth trying.
    pub stale: bool,
}

impl Denied {
    pub(super) fn settings(message: impl Into<String>) -> Denied {
        Denied {
            message: message.into(),
            kind: FailKind::Permission,
            stage: Stage::SignIn,
            stale: false,
        }
    }

    pub(super) fn first() -> Denied {
        Denied::settings(SIGN_IN_FIRST)
    }

    pub(super) fn again() -> Denied {
        Denied::settings(SIGN_IN_AGAIN)
    }

    pub(super) fn later(message: impl Into<String>, stage: Stage, stale: bool) -> Denied {
        Denied {
            message: message.into(),
            kind: FailKind::Connection,
            stage,
            stale,
        }
    }

    pub(super) fn stopped() -> Denied {
        Denied::later(
            "The ChatGPT sign-in stopped being renewed unexpectedly; try again",
            Stage::Renewal,
            false,
        )
    }

    /// The same refusal, said to have happened at `stage`.
    pub(super) fn at(mut self, stage: Stage) -> Denied {
        self.stage = stage;
        self
    }
}

pub(super) struct Access {
    pub(super) token: String,
    pub(super) until: Instant,
}

/// What a renewal in flight will hand to everyone who waited for it.
pub(super) type Outcome = Result<Token, Denied>;

#[derive(Default)]
pub(super) struct Live {
    /// `saved` is what the keychain held, or what a sign-in set since.
    pub(super) loaded: bool,
    pub(super) saved: Option<Saved>,
    pub(super) access: Option<Access>,
    /// The keychain refused the refresh token: the sign-in lasts until
    /// Kasten quits.
    pub(super) session_only: bool,
    /// Counts sign-ins and sign-outs, so a renewal that was under way when
    /// one happened is dropped instead of undoing it.
    pub(super) epoch: u64,
    /// The renewal under way, for those who need a token meanwhile.
    pub(super) renewing: Option<watch::Receiver<Option<Outcome>>>,
    /// Why the last ID token could not be checked, if it could not.
    pub(super) unverified: Option<String>,
    /// Why the keychain could not be read just now.
    pub(super) keychain: Option<String>,
}

pub(super) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

/// Where the sign-in endpoints are, and whether they are the documented
/// ones standing in for a discovery document that could not be had.
pub(super) struct Found {
    pub(super) endpoints: Endpoints,
    pub(super) fell_back_at: Option<Instant>,
}

pub(super) struct Core {
    pub(super) keys: Arc<dyn KeyStore>,
    pub(super) live: Mutex<Live>,
    /// Writes to and deletes from the keychain take turns here, so a late
    /// renewal never undoes a sign-out.
    pub(super) gate: tokio::sync::Mutex<()>,
    pub(super) endpoints: Mutex<Option<Found>>,
    /// Where OpenAI's discovery document is.
    pub(super) discovery: String,
    /// OpenAI's published signing keys, for the ID tokens.
    pub(super) signing_keys: Cache,
    /// What requests found out about each model.
    pub(super) learned: Learned,
    /// The flag that stops the sign-in under way.
    pub(super) pending: Mutex<Option<Arc<AtomicBool>>>,
}

/// A short stand-in for an account's id: enough to tell accounts apart in a
/// file, not the id itself.
pub(super) fn owner_of(saved: &Saved) -> Option<String> {
    let sub = saved.sub.as_deref().filter(|s| !s.is_empty())?;
    let digest = Sha256::digest(sub.as_bytes());
    Some(digest.iter().take(8).map(|b| format!("{b:02x}")).collect())
}

impl Core {
    pub(super) fn new(keys: Arc<dyn KeyStore>, discovery: &str) -> Core {
        Core {
            keys,
            live: Mutex::default(),
            gate: tokio::sync::Mutex::new(()),
            endpoints: Mutex::new(None),
            discovery: discovery.to_owned(),
            signing_keys: Cache::default(),
            learned: Learned::default(),
            pending: Mutex::new(None),
        }
    }

    /// Where the sign-in endpoints are. Found in OpenAI's discovery
    /// document, and kept; when the document could not be had, the
    /// documented addresses are used for a minute and then it is asked for
    /// again.
    pub(super) async fn endpoints_for(&self, http: &reqwest::Client) -> Endpoints {
        {
            let known = locked(&self.endpoints);
            if let Some(found) = known.as_ref()
                && found
                    .fell_back_at
                    .is_none_or(|at| at.elapsed() < DISCOVERY_RETRY)
            {
                return found.endpoints.clone();
            }
        }
        let found = match authorize::discover(http, &self.discovery).await {
            Some(endpoints) => Found {
                endpoints,
                fell_back_at: None,
            },
            None => Found {
                endpoints: Endpoints::official(),
                fell_back_at: Some(Instant::now()),
            },
        };
        let endpoints = found.endpoints.clone();
        *locked(&self.endpoints) = Some(found);
        endpoints
    }

    /// Keychain work off the async threads.
    pub(super) async fn keychain<T: Send + 'static>(
        &self,
        job: impl FnOnce(&dyn KeyStore) -> T + Send + 'static,
    ) -> Result<T, String> {
        let keys = Arc::clone(&self.keys);
        tokio::task::spawn_blocking(move || job(keys.as_ref()))
            .await
            .map_err(|_| "The system keychain stopped unexpectedly".to_owned())
    }

    /// Saves to the keychain; whether it took.
    pub(super) async fn keep(&self, saved: &Saved) -> bool {
        let saved = saved.clone();
        matches!(
            self.keychain(move |keys| saved::write(keys, &saved)).await,
            Ok(Ok(()))
        )
    }

    /// Forgets the sign-in, here and in the keychain: all of it when
    /// `epoch` is None, else only if it is still the sign-in of that epoch.
    pub(super) async fn forget(&self, epoch: Option<u64>) {
        let _turn = self.gate.lock().await;
        {
            let mut live = locked(&self.live);
            if epoch.is_some_and(|e| e != live.epoch) {
                return;
            }
            live.epoch += 1;
            live.saved = None;
            live.access = None;
            live.session_only = false;
            live.unverified = None;
            live.keychain = None;
            live.loaded = true;
        }
        self.learned.for_owner(None);
        let _ = self.keychain(|keys| keys.delete(ENTRY)).await;
    }

    /// Reads the keychain once. A keychain that cannot be read now is asked
    /// again next time, and says so meanwhile.
    pub(super) async fn load(&self) -> Result<(), Denied> {
        if locked(&self.live).loaded {
            return Ok(());
        }
        let read = match self.keychain(saved::read).await {
            Ok(Ok(saved)) => Ok(saved),
            Ok(Err(why)) | Err(why) => Err(why),
        };
        let mut live = locked(&self.live);
        if live.loaded {
            return Ok(());
        }
        match read {
            Ok(saved) => {
                self.learned.for_owner(saved.as_ref().and_then(owner_of));
                live.saved = saved;
                live.loaded = true;
                live.keychain = None;
                Ok(())
            }
            Err(why) => {
                live.keychain = Some(why.clone());
                Err(Denied::later(
                    format!(
                        "KastenFlow could not read the ChatGPT sign-in from the system keychain: {why}"
                    ),
                    Stage::SignIn,
                    false,
                ))
            }
        }
    }
}
