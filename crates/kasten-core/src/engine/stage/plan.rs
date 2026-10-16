//! Staging an agent op: the guardrails that always hold run first, then the
//! op is planned into the set, or, when it cannot be previewed, kept for
//! review as a proposal that never runs.

use serde_json::Value;

use super::super::{Kasten, Outcome};
use crate::agent::{AgentOp, ChangeSet, Session, Step};
use crate::error::{Error, Result};
use crate::time::Instant;

/// What staging an op made of it.
pub(super) enum Planned {
    /// Held in the set: the files it touched, what the tool tells the agent,
    /// and the step in words.
    Staged {
        paths: Vec<String>,
        result: Value,
        summary: String,
    },
    /// Not previewed: it waits for review, for this reason.
    Review(String),
}

/// Why an op that is not previewed waits for review.
fn not_previewed(op: &AgentOp) -> String {
    let what = match op {
        AgentOp::Rename { .. } => "Renaming a note",
        AgentOp::Move { .. } => "Moving a note",
        AgentOp::Trash { .. } => "Moving something to the trash",
        AgentOp::Edit { .. } => "A full rewrite",
        AgentOp::TagSchema { .. } => "A change to a tag's schema",
        AgentOp::Template { .. } => "A template",
        _ => "This change",
    };
    format!("{what} is not previewed with the other changes, so it waits for your review")
}

/// Ops a note that only the set has may be the target of: they change its
/// text in the set. The rest need a note that is in the vault.
fn works_on_staged_files(op: &AgentOp) -> bool {
    matches!(
        op,
        AgentOp::Append { .. }
            | AgentOp::ReplaceSection { .. }
            | AgentOp::UpdateProps { .. }
            | AgentOp::Tags { .. }
            | AgentOp::EditDeck { .. }
            | AgentOp::UpdateDiagram { .. }
            | AgentOp::EditDiagram { .. }
            | AgentOp::AddToBoard { .. }
            | AgentOp::Connect { .. }
            | AgentOp::Group { .. }
    )
}

impl Kasten {
    /// Runs an agent op as a chat that previews its changes does: refused
    /// when a guardrail that no trust lifts says so, held in `set` when it
    /// can be previewed, kept for review when it cannot. Nothing reaches the
    /// vault, and the op's soft limits are not counted: the person looks at
    /// the whole set before it is applied.
    pub fn stage(
        &self,
        set: &mut ChangeSet,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Outcome> {
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.stage_held(set, session, op, now)
    }

    /// `stage`, with the turn lock already held.
    pub(super) fn stage_held(
        &self,
        set: &mut ChangeSet,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Outcome> {
        match self.plan_into(set, op, now)? {
            Planned::Review(reason) => self.hold_for_review(session, op, reason, now),
            Planned::Staged { paths, result, .. } => Ok(Outcome::Staged {
                change_set: set.id.clone(),
                paths,
                result,
            }),
        }
    }

    /// Plans `op` into `set`, the refusals first. A step that fails leaves
    /// the set as it was; one that changes something is recorded and the set
    /// kept in the cache.
    fn plan_into(&self, set: &mut ChangeSet, op: &AgentOp, now: Instant) -> Result<Planned> {
        self.staged_refusals(set, op)?;
        let mut work = set.clone();
        let planned = self.plan_op(&mut work, op, now)?;
        if let Planned::Staged { paths, summary, .. } = &planned
            && !paths.is_empty()
        {
            work.steps.push(Step {
                op: Some(op.clone()),
                name: op.name().to_owned(),
                summary: summary.clone(),
                paths: paths.clone(),
            });
            self.save_changes(&work)?;
            *set = work;
        }
        Ok(planned)
    }

    /// Plans `op` into `set` again, for `rebase_changes`: whether it was
    /// staged (else it would wait for review, which a replay never starts).
    pub(super) fn replan(&self, set: &mut ChangeSet, op: &AgentOp, now: Instant) -> Result<bool> {
        Ok(matches!(
            self.plan_into(set, op, now)?,
            Planned::Staged { .. }
        ))
    }

    /// The refusals no trust lifts, with the notes only the set has taken as
    /// the notes they are.
    pub(super) fn staged_refusals(&self, set: &ChangeSet, op: &AgentOp) -> Result<()> {
        let new_paths = op
            .path()
            .into_iter()
            .chain(match op {
                AgentOp::AddToBoard { notes, .. } => notes.iter().map(String::as_str).collect(),
                _ => Vec::new(),
            })
            .filter(|p| set.is_new(p));
        for path in new_paths {
            let board_note = matches!(op, AgentOp::AddToBoard { board, .. } if board != path);
            if !works_on_staged_files(op) || board_note {
                return Err(Error::Invalid(format!(
                    "{path} is only in the staged changes so far, not in the vault. Apply the changes first, then do this"
                )));
            }
        }
        self.refusals_with(op, &|p| set.is_new(p))
    }

    /// Plans `op` into `set`.
    fn plan_op(&self, set: &mut ChangeSet, op: &AgentOp, now: Instant) -> Result<Planned> {
        if let Some(planned) = self.plan_note_op(set, op, now)? {
            return Ok(planned);
        }
        if let Some(planned) = self.plan_file_op(set, op, now)? {
            return Ok(planned);
        }
        if let Some(planned) = self.plan_board_op(set, op, now)? {
            return Ok(planned);
        }
        Ok(Planned::Review(not_previewed(op)))
    }
}
