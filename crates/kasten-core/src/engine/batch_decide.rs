//! Deciding a batch: every change is checked against the vault as it is
//! now (nothing is written), the way a single change is. One refusal refuses
//! the whole batch, naming the change; the worst class among the changes, and
//! the strictest mode among the projects they touch, decide whether the batch
//! is made at once or waits, as a whole, for review.

use std::collections::BTreeSet;

use super::Kasten;
use super::agent::WINDOW_MS;
use super::review::Preview;
use crate::agent::{AgentOp, Session};
use crate::batch::{self, refused};
use crate::error::Result;
use crate::policy::{self, Decision, OpClass};
use crate::time::Instant;

impl Kasten {
    /// What to do with a batch: refuse it, keep it for review, or make it.
    pub(super) fn decide_batch(
        &self,
        session: &Session,
        ops: &[AgentOp],
        now: Instant,
    ) -> Result<Decision> {
        if let Err(err) = batch::check_shape(ops) {
            return Ok(Decision::Refuse(err));
        }
        let total = ops.len();
        let mut classes = Vec::with_capacity(total + 1);
        let mut projects = Vec::new();
        for (index, op) in ops.iter().enumerate() {
            let class = self
                .refusals(op)
                .and_then(|()| self.batch_rules(op))
                .and_then(|()| self.op_class(session, op, now));
            match class {
                Ok(class) => classes.push(class),
                Err(err) => return Ok(Decision::Refuse(refused(index, total, op, &err))),
            }
            match self.touched_projects(op) {
                Ok(more) => projects.extend(more),
                Err(err) => return Ok(Decision::Refuse(refused(index, total, op, &err))),
            }
        }
        // Each change was weighed alone; together they may be more than a
        // session is let change in ten minutes.
        match self.batch_notes_limit(session, ops, now) {
            Ok(Some(why)) => classes.push(OpClass::Soft(why)),
            Ok(None) => {}
            Err(err) => return Ok(Decision::Refuse(err)),
        }
        projects.extend(self.floor_of(session));
        let mode = self.mode_among(&projects, now);
        Ok(policy::decide(mode, batch::worst(classes)))
    }

    /// What a reviewer sees of a batch: each change in turn, as it would be
    /// shown alone, under what the batch is.
    pub(super) fn batch_preview(&self, ops: &[AgentOp]) -> Preview {
        let total = ops.len();
        let mut diff = format!("A batch of {total} changes: {}\n", batch::describe(ops));
        for (index, op) in ops.iter().enumerate() {
            let shown = match self.preview(op) {
                Ok(preview) if preview.diff.is_empty() => String::new(),
                Ok(preview) => preview.diff,
                Err(err) => format!("(not shown: {err})"),
            };
            diff.push_str(&format!(
                "\n{}\n{shown}\n",
                batch::position(index, total, op)
            ));
        }
        Preview {
            target: None,
            before: None,
            after: None,
            diff,
        }
    }

    /// The limit on notes changed in ten minutes, counted over the whole
    /// batch: the notes it touches that the session has not changed lately,
    /// and the ones it makes.
    fn batch_notes_limit(
        &self,
        session: &Session,
        ops: &[AgentOp],
        now: Instant,
    ) -> Result<Option<String>> {
        if self.trusted(&session.id, now) {
            return Ok(None);
        }
        let recent: BTreeSet<String> = {
            let state = self.state();
            state
                .tallies
                .get(&session.id)
                .map(|tally| {
                    tally
                        .recent(now.millis, WINDOW_MS)
                        .into_iter()
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default()
        };
        let mut seen = recent.clone();
        let mut fresh = 0;
        for op in ops {
            let (paths, new) = self.touches(op)?;
            fresh += paths.into_iter().filter(|p| seen.insert(p.clone())).count() + new;
        }
        let max = self.config().guardrails.max_notes_per_session_10min as usize;
        if fresh > 0 && recent.len() + fresh > max {
            return Ok(Some(format!(
                "This batch changes {fresh} notes at once, after {} in the last 10 minutes (the limit is {max})",
                recent.len()
            )));
        }
        Ok(None)
    }
}
