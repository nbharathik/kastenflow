//! Agent ops through the guardrails: each op is
//! refused, run, or kept as a proposal for review, by what it touches, how
//! much it writes and what its session did lately.

use serde::Serialize;
use serde_json::Value;

use super::Kasten;
use crate::agent::{AgentOp, Proposal, Session, load_trust};
use crate::error::{Error, Result};
use crate::policy::Decision;
use crate::time::Instant;

/// A note as an agent sees it after a write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NoteRef {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
}

/// What an agent op came to (MCP tools return it as is).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Done {
        result: Value,
    },
    PendingReview {
        proposal: String,
        reason: String,
    },
    /// Held back in a change set for the person to look at and apply: nothing
    /// is in the vault yet. `result` is what `Done` would have said.
    Staged {
        change_set: String,
        paths: Vec<String>,
        result: Value,
    },
}

/// Pending proposals one session may have before it is refused more.
pub const MAX_PENDING: usize = 100;
/// The window for "notes changed per session in 10 minutes", and for the
/// slides and pictures a session may take out or add in as long.
pub(super) const WINDOW_MS: u64 = 10 * 60 * 1000;

impl Kasten {
    /// A note's path from its path (`.md` optional), id or title, or a
    /// link to it (`[[path|Title]]`, `[[Title#Heading]]`). Titles shared by
    /// several notes are an error naming their paths.
    pub fn resolve(&self, reference: &str) -> Result<String> {
        let r = reference.trim();
        let r = match r.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")) {
            Some(inner) => crate::links::parts(inner).target,
            None => r,
        };
        if r.ends_with(".md") && self.vault.exists(r) {
            return Ok(r.to_owned());
        }
        if r.contains('/') && !r.ends_with(".md") && self.vault.exists(&format!("{r}.md")) {
            return Ok(format!("{r}.md"));
        }
        if let Some(path) = self.path_of_id(r)? {
            return Ok(path);
        }
        let found: Vec<String> = self
            .index()
            .by_title(r)?
            .into_iter()
            .filter(|p| !crate::vault::in_templates(p))
            .collect();
        match found.as_slice() {
            [one] => Ok(one.clone()),
            [] => Err(Error::Invalid(format!("No note called “{r}”"))),
            many => Err(Error::Invalid(format!(
                "Several notes are called “{r}”; name one by path: {}",
                many.join(", ")
            ))),
        }
    }

    /// Runs an agent op: refused with an error, done, or kept for review, as
    /// the mode that holds for what it touches says (`decide`).
    pub fn agent_run(&self, session: &Session, op: &AgentOp, now: Instant) -> Result<Outcome> {
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match self.decide(session, op, now)? {
            Decision::Refuse(err) => Err(err),
            Decision::Propose(reason) => self.hold_for_review(session, op, reason, now),
            Decision::Commit(how) => {
                let result = self.execute_committed(session, op, how, now)?;
                Ok(Outcome::Done { result })
            }
        }
    }

    /// Keeps `op` for review, for `reason`: the session's proposals are
    /// counted first, so one cannot fill the queue.
    pub(super) fn hold_for_review(
        &self,
        session: &Session,
        op: &AgentOp,
        reason: String,
        now: Instant,
    ) -> Result<Outcome> {
        let waiting = Proposal::pending(self.vault.root())?
            .iter()
            .filter(|p| p.session == session.id)
            .count();
        if waiting >= MAX_PENDING {
            return Err(Error::Invalid(format!(
                "This session has {waiting} proposals waiting for review; wait for them to be decided"
            )));
        }
        let id = self.propose(session, op, &reason, now)?;
        Ok(Outcome::PendingReview {
            proposal: id,
            reason,
        })
    }

    /// Whether a person trusted this session, lifting the soft limits.
    pub fn trusted(&self, session: &str, now: Instant) -> bool {
        load_trust(self.vault.root())
            .get(session)
            .is_some_and(|until| *until > now.millis)
    }

    /// Trusts a session until `until`.
    pub fn trust_session(&self, session: &str, until: u64) -> Result<()> {
        self.lock.hold(|| {
            let mut trust = load_trust(self.vault.root());
            trust.retain(|_, end| *end > crate::time::Instant::now().millis);
            trust.insert(session.to_owned(), until);
            crate::agent::save_trust(self.vault.root(), &trust)
        })
    }
}
