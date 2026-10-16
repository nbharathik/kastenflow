//! Renewing the access token. One renewal runs at a time and runs to its end
//! as a task of its own: whoever needs a token while it runs waits for it
//! (a caller that gives up, because the person pressed Stop or the idle limit
//! came, does not stop it). The server rotates the refresh token on every
//! renewal, so the new one is written to the keychain before anything else is
//! done with the answer, and no request is ever allowed to cancel that.
//!
//! Only a verdict on the token itself ends a sign-in. A bad connection, a busy
//! server or a page in the way leave it as it was, and so does an ID token
//! that cannot be checked: the answer came over TLS from OpenAI, so its access
//! token is used, the problem is remembered for Settings, and the check is
//! made again at the next renewal. Only a verified ID token for another
//! account ends the sign-in.

use std::sync::Arc;
use std::time::Instant;

use tokio::sync::watch;

use super::authorize::Endpoints;
use super::hold::{Access, Core, Denied, Outcome, Token, locked};
use super::jwks::Failed;
use super::oauth::{self, Granted, Refused};
use super::saved::Saved;
use crate::chat::diagnostics::Stage;

/// A renewal brought an ID token for another account.
const OTHER_ACCOUNT: &str = "ChatGPT now reports another account for this sign-in, so it was forgotten. Sign in with ChatGPT again in Settings, AI providers";
/// The person signed out, or in again, while a renewal was under way.
const SIGNED_OUT: &str = "The ChatGPT sign-in changed while it was being renewed; try again";

/// What the ID token of a renewal came to.
enum Verdict {
    /// The renewal brought none: a refresh may leave it out.
    NoToken,
    /// Checked, and the same account.
    Fine,
    /// A verified token for another account.
    Other,
    /// Could not be checked, for this reason.
    Unchecked(String),
}

/// Hands a renewal's outcome to everyone waiting for it, however the task
/// ends: a task that stopped without an answer still frees the way for the
/// next one.
struct Finish {
    core: Arc<Core>,
    tx: Option<watch::Sender<Option<Outcome>>>,
}

impl Finish {
    fn send(mut self, outcome: Outcome) {
        self.release(outcome);
    }

    fn release(&mut self, outcome: Outcome) {
        locked(&self.core.live).renewing = None;
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(Some(outcome));
        }
    }
}

impl Drop for Finish {
    fn drop(&mut self) {
        if self.tx.is_some() {
            self.release(Err(Denied::stopped()));
        }
    }
}

impl Core {
    /// A new access token. If a renewal is under way, this waits for that
    /// one; if not, one is started, and it finishes whatever becomes of this
    /// call.
    pub(super) async fn renew(core: &Arc<Core>, http: &reqwest::Client) -> Outcome {
        let mut waiting = {
            let mut live = locked(&core.live);
            match &live.renewing {
                Some(running) => running.clone(),
                None => {
                    let Some(saved) = live.saved.clone() else {
                        return Err(Denied::first());
                    };
                    if !saved.confirmed() {
                        return Err(Denied::again());
                    }
                    let (tx, rx) = watch::channel(None);
                    live.renewing = Some(rx.clone());
                    let epoch = live.epoch;
                    let finish = Finish {
                        core: Arc::clone(core),
                        tx: Some(tx),
                    };
                    let (core, http) = (Arc::clone(core), http.clone());
                    tokio::spawn(async move {
                        let outcome = core.refresh(&http, saved, epoch).await;
                        finish.send(outcome);
                    });
                    rx
                }
            }
        };
        let arrived = waiting.wait_for(|outcome| outcome.is_some()).await;
        match arrived {
            Ok(outcome) => outcome.clone().unwrap_or_else(|| Err(Denied::stopped())),
            Err(_) => Err(Denied::stopped()),
        }
    }

    async fn refresh(&self, http: &reqwest::Client, mut saved: Saved, epoch: u64) -> Outcome {
        let asked = Instant::now();
        let endpoints = self.endpoints_for(http).await;
        let granted =
            match oauth::refresh(http, &endpoints, &saved.client_id, &saved.refresh_token).await {
                Ok(granted) => granted,
                Err(Refused::Invalid(words)) => {
                    // The sign-in is over: forget it, so Settings says so.
                    self.forget(Some(epoch)).await;
                    return Err(
                        Denied::settings(format!("{words} in Settings, AI providers"))
                            .at(Stage::Renewal),
                    );
                }
                Err(Refused::Unavailable(words)) => {
                    return Err(Denied::later(words, Stage::Renewal, false));
                }
                Err(Refused::Unreachable(words)) => {
                    return Err(Denied::later(words, Stage::Renewal, true));
                }
            };
        // Each refresh token replaces the one before, and the one just spent
        // is no good any more: keep the new one before anything else.
        if let Some(next) = granted
            .refresh_token
            .clone()
            .filter(|n| *n != saved.refresh_token)
        {
            saved.refresh_token = next;
            if !self.commit(epoch, &saved).await {
                return Err(Denied::later(SIGNED_OUT, Stage::Renewal, false));
            }
        }
        match self.verify(http, &endpoints, &saved, &granted).await {
            Verdict::Other => {
                self.forget(Some(epoch)).await;
                // The refresh token that came belongs to the other account.
                let _ =
                    oauth::revoke(http, &endpoints, &saved.client_id, &saved.refresh_token).await;
                return Err(Denied::settings(OTHER_ACCOUNT).at(Stage::Renewal));
            }
            Verdict::Fine => self.mark_unverified(epoch, None),
            Verdict::Unchecked(why) => self.mark_unverified(epoch, Some(why)),
            // Nothing was checked: what was said about the last check stands.
            Verdict::NoToken => {}
        }
        let mut live = locked(&self.live);
        if live.epoch != epoch {
            return Err(Denied::later(SIGNED_OUT, Stage::Renewal, false));
        }
        live.access = Some(Access {
            token: granted.access_token.clone(),
            until: asked + granted.expires_in,
        });
        Ok(Token {
            value: granted.access_token,
            renewed: true,
        })
    }

    /// Writes a renewed refresh token to the keychain and to memory, if the
    /// sign-in it belongs to still stands; whether it did.
    async fn commit(&self, epoch: u64, saved: &Saved) -> bool {
        let _turn = self.gate.lock().await;
        if locked(&self.live).epoch != epoch {
            return false;
        }
        let kept = self.keep(saved).await;
        let mut live = locked(&self.live);
        live.session_only = !kept;
        live.saved = Some(saved.clone());
        true
    }

    /// Remembers why the ID token of this renewal could not be checked, or
    /// that it could.
    fn mark_unverified(&self, epoch: u64, why: Option<String>) {
        let mut live = locked(&self.live);
        if live.epoch == epoch {
            live.unverified = why;
        }
    }

    /// When a renewal brings an ID token, it must be OpenAI's and name the
    /// account that signed in. One that cannot be checked is no reason to
    /// throw away the access token it came with.
    async fn verify(
        &self,
        http: &reqwest::Client,
        endpoints: &Endpoints,
        saved: &Saved,
        granted: &Granted,
    ) -> Verdict {
        let Some(id_token) = granted.id_token.as_deref() else {
            return Verdict::NoToken;
        };
        let checked = self
            .signing_keys
            .identity(
                http,
                &endpoints.jwks,
                id_token,
                &saved.client_id,
                None,
                oauth::now(),
            )
            .await;
        match checked {
            Ok(who) if saved.sub.as_deref() == Some(who.sub.as_str()) => Verdict::Fine,
            Ok(_) => Verdict::Other,
            Err(Failed::Keys(why)) => Verdict::Unchecked(why),
            Err(Failed::Token(why)) => Verdict::Unchecked(why.sentence()),
        }
    }
}
