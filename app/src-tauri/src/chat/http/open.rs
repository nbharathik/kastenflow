//! Getting one request accepted: sent until a server takes it. A ChatGPT
//! request is asked again with a fresh token after a 401, and without a part
//! the server named as unsupported (the reasoning effort first, said in a
//! notice, then the rest); what is found is remembered for the model. Every
//! failure comes with its kind, so the window can offer the way on, and with
//! what asking again could do about it (retry.rs).

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use super::run::{Run, Trial};
use super::{HttpModel, Kind, http_error, unreachable};
use crate::chat::chatgpt::{self, Account, Feature, Tried};
use crate::chat::diagnostics::Stage;
use crate::chat::errors::{self, FailKind, classify};
use crate::chat::http_wait::{Waited, wait};
use crate::chat::model::Call;
use crate::chat::responses;
use crate::chat::retry::{self, Again, LONGEST_ASKED};

/// What the plan's route turned down, in the words a notice says it in.
const EFFORT_REFUSED: &str = "This model doesn't take a reasoning effort; sent without it.";
const INCLUDE_REFUSED: &str =
    "This model doesn't keep its reasoning between steps here; sent without it.";
const FLAT_REFUSED: &str = "This model wants its tools grouped; sent that way.";

/// How a wait is said.
fn human(wait: Duration) -> String {
    let seconds = wait.as_secs().max(1);
    if seconds >= 120 {
        format!("{} minutes", seconds.div_ceil(60))
    } else {
        format!("{seconds} seconds")
    }
}

impl HttpModel {
    /// A try that got no answer for as long as is waited.
    pub(super) fn silent(&self, stage: Stage) -> Trial {
        Trial::new(self.silent_words(), FailKind::Connection, stage)
            .again(Again {
                passes: true,
                stale: true,
                silent: true,
                ..Again::never()
            })
            .because("idle")
    }

    /// A try that could not send, or lost the connection before an answer.
    fn unsent(&self, err: &reqwest::Error) -> Trial {
        let why = errors::chain(err).to_lowercase();
        let local =
            reqwest::Url::parse(&self.url).is_ok_and(|u| crate::chat::address::loopback(&u));
        // Nothing listening on this computer is not a connection that dropped,
        // and a certificate that is wrong stays wrong.
        let hopeless = (local && err.is_connect())
            || err.is_builder()
            || err.is_redirect()
            || ["certificate", "cert_e_", "untrusted"]
                .iter()
                .any(|w| why.contains(w));
        let reason = if err.is_timeout() {
            "timeout"
        } else if err.is_connect() {
            "connect"
        } else {
            "closed"
        };
        Trial::new(
            unreachable(&self.name, &self.url, err),
            FailKind::Connection,
            Stage::Request,
        )
        .again(Again {
            passes: !hopeless,
            stale: true,
            ..Again::never()
        })
        .because(reason)
    }

    /// A refusal to give a token, as a failed try.
    fn denied(denied: chatgpt::session::Denied) -> Trial {
        let passes = denied.kind == FailKind::Connection;
        let reason = if passes { "renewal" } else { "signed-out" };
        Trial::new(denied.message, denied.kind, denied.stage)
            .again(Again {
                passes,
                stale: denied.stale,
                ..Again::never()
            })
            .because(reason)
    }

    /// A token for the next ChatGPT request, or a new one after the API
    /// refused `rejected`; None when the person stopped the turn.
    async fn token(
        &self,
        account: &Account,
        cancel: &AtomicBool,
        rejected: Option<&str>,
        run: &mut Run,
    ) -> Result<Option<String>, Trial> {
        let asked = match rejected {
            None => wait(account.token(&run.client), cancel).await,
            Some(old) => wait(account.token_after(&run.client, old), cancel).await,
        };
        match asked {
            Waited::Done(Ok(token)) => {
                run.renewed |= token.renewed;
                Ok(Some(token.value))
            }
            Waited::Done(Err(denied)) => Err(HttpModel::denied(denied)),
            Waited::Cancelled => Ok(None),
            Waited::TimedOut => Err(self.silent(Stage::Renewal)),
        }
    }

    /// What a part's refusal says to the person, once.
    fn taught(part: Feature) -> &'static str {
        match part {
            Feature::Effort => EFFORT_REFUSED,
            Feature::Include => INCLUDE_REFUSED,
            Feature::Flat => FLAT_REFUSED,
        }
    }

    /// Sends the request until a server accepts it; None when the person
    /// stopped the turn first.
    pub(super) async fn open(
        &self,
        call: &Call<'_>,
        cancel: &AtomicBool,
        run: &mut Run,
    ) -> Result<Option<reqwest::Response>, Trial> {
        let account = self
            .account
            .as_deref()
            .filter(|_| self.kind == Kind::ChatGpt);
        let mut token = String::new();
        let mut shape = responses::Shape::default();
        if self.kind == Kind::ChatGpt {
            let Some(account) = account else {
                return Err(Trial::new(
                    chatgpt::SIGN_IN_FIRST,
                    FailKind::Permission,
                    Stage::SignIn,
                )
                .because("signed-out"));
            };
            let Some(first) = self.token(account, cancel, None, run).await? else {
                return Ok(None);
            };
            token = first;
            // What this model has been found to turn down is left out at once.
            shape = account.shape_for(&self.model);
        }
        run.stage = Stage::Request;
        let (mut refreshed, mut adapted) = (false, 0);
        loop {
            let effort = account.is_some() && self.applied.effort.is_some() && shape.effort;
            let sent = self.request(&run.client, call, &token, shape).send();
            let response = match wait(sent, cancel).await {
                Waited::Done(Ok(response)) => response,
                Waited::Done(Err(err)) => return Err(self.unsent(&err)),
                Waited::Cancelled => return Ok(None),
                Waited::TimedOut => return Err(self.silent(Stage::Request)),
            };
            let status = response.status().as_u16();
            run.status = Some(status);
            if response.status().is_success() {
                if let Some(account) = account.filter(|a| effort && !a.effort_works(&self.model)) {
                    account.tried_effort(&self.model, Tried::Works);
                }
                return Ok(Some(response));
            }
            let asked = retry::asked_wait(response.headers());
            let body = match wait(response.text(), cancel).await {
                Waited::Done(Ok(body)) => body,
                _ => String::new(),
            };
            let kind = classify(status, &body);
            if let Some(account) = account {
                if status == 401 && !refreshed {
                    refreshed = true;
                    match self.token(account, cancel, Some(&token), run).await? {
                        Some(next) => token = next,
                        None => return Ok(None),
                    }
                    continue;
                }
                if status == 400
                    && adapted < 3
                    && let Some(next) = shape.adapted(&body, effort)
                {
                    adapted += 1;
                    for part in shape.dropped(next) {
                        account.learn(&self.model, part, Tried::Refused);
                        self.say(HttpModel::taught(part));
                    }
                    shape = next;
                    continue;
                }
            }
            let mut words = if account.is_some() {
                chatgpt::words::refused(&self.name, status, &body)
            } else {
                http_error(&self.name, status, &body)
            };
            let mut again = Again {
                passes: errors::passes(status, &body),
                asked,
                ..Again::never()
            };
            if let Some(wait) = asked.filter(|w| *w > LONGEST_ASKED) {
                again.passes = false;
                words = format!("{} It asked to wait {}.", words.trim_end(), human(wait));
            }
            return Err(Trial::new(words, kind, Stage::Request)
                .answered(status)
                .again(again)
                .because(format!("http {status}")));
        }
    }
}
