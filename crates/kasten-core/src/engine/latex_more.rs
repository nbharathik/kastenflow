//! The LaTeX ops that bring other things into a document: a picture
//! (latex_figures.rs), a citation (latex_cite.rs) and a page sent to LaTeX
//! (latex_send_agent.rs). The three go through `decide` like every agent op;
//! this is the one place the engine's refusals, previews and runs reach them.

use serde_json::Value;

use super::Kasten;
use super::review::Preview;
use crate::agent::AgentOp;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;

impl Kasten {
    /// What no mode or approval lifts for these ops.
    pub(super) fn latex_more_refusals(&self, op: &AgentOp) -> Result<()> {
        match op {
            AgentOp::AddLatexAsset { .. } => self.latex_figures_refusals(op),
            AgentOp::CiteReference { .. } => self.latex_cite_refusals(op),
            AgentOp::SendPageToLatex { .. } => self.latex_send_refusals(op),
            _ => Ok(()),
        }
    }

    /// What a reviewer sees of these ops.
    pub(super) fn latex_more_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        Ok(Some(match op {
            AgentOp::AddLatexAsset { .. } => self.latex_figures_preview(op),
            AgentOp::CiteReference { .. } => self.latex_cite_preview(op)?,
            AgentOp::SendPageToLatex { .. } => self.latex_send_preview(op)?,
            _ => return Ok(None),
        }))
    }

    /// Runs one of these ops as `actor`; what the agent is told comes back.
    pub(super) fn latex_more_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        match op {
            AgentOp::AddLatexAsset { .. } => self.latex_figures_execute(actor, op, now),
            AgentOp::CiteReference { .. } => self.latex_cite_execute(actor, op, now),
            AgentOp::SendPageToLatex { .. } => self.latex_send_execute(actor, op, now),
            other => Err(Error::Invalid(format!(
                "{} is not a LaTeX op of this kind",
                other.name()
            ))),
        }
    }
}
