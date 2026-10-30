//! Keeping part of a proposed change: the reviewer takes some of a text
//! proposal's hunks and leaves the others out. What is written is the text
//! they chose, as the proposing agent's change approved by them, merged with
//! edits made since (refused where those overlap, as a whole acceptance is).

use serde_json::Value;

use super::Kasten;
use crate::agent::{AgentOp, Proposal, ProposalStatus};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;

impl Kasten {
    /// Accepts a proposed change to a page's text with `body` in place of the
    /// text it proposed: the body the reviewer put together from the hunks
    /// they kept. Only a change that has the text before and after it (an
    /// append, a section replaced, a full rewrite) can be taken in part.
    pub fn accept_proposal_hunks(
        &self,
        id: &str,
        by: &str,
        body: &str,
        now: Instant,
    ) -> Result<Value> {
        // One decision at a time, as `accept_proposal`.
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut proposal = Proposal::read(self.vault.root(), id)?;
        let (path, before) = match (&proposal.op, &proposal.before, &proposal.after) {
            (
                AgentOp::Append { path, .. }
                | AgentOp::ReplaceSection { path, .. }
                | AgentOp::Edit { path, .. },
                Some(before),
                Some(_),
            ) if path.ends_with(".md") => (path.clone(), before.clone()),
            _ => {
                return Err(Error::Invalid(
                    "Only a change to the text of a page can be kept in part".to_owned(),
                ));
            }
        };
        // The guardrails that held the change back still hold: a locked note stays read-only.
        self.refusals(&proposal.op)?;
        let actor = Actor::Approved {
            client: proposal.client.clone(),
            session: proposal.session.clone(),
            by: by.to_owned(),
        };
        let kept = AgentOp::Edit {
            path,
            body: body.to_owned(),
            base: before,
            reason: None,
        };
        let value = self.execute(&actor, &kept, now)?;
        proposal.status = ProposalStatus::Accepted;
        self.archive(&actor, proposal, by, "accept", now)?;
        Ok(value)
    }
}
