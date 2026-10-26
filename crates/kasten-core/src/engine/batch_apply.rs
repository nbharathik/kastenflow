//! Running a batch. The write lock is held once for all of it. First what
//! is waiting for a commit is committed as the person's own (as for any agent
//! op), then every change runs in turn, each checked again against the vault
//! as the ones before it left it; the writes of the changes are collected and
//! committed once, as `Kasten-Op: batch` with `Kasten-Batch: <count>`.
//!
//! All or nothing: if a change is refused or fails, or the commit fails, every
//! file the batch touched goes back to what the last commit holds (files it
//! made go away; they were in no commit), the session's soft-limit tally is
//! put back, and nothing of the batch is in the history. Files that were
//! changed before the batch started and could not be committed (too big for
//! the backup) are left as they are.

use std::collections::BTreeSet;
use std::thread::ThreadId;

use serde_json::{Value, json};

use super::batch_rollback::Before;
use super::{Kasten, Revision};
use crate::agent::{AgentOp, Session};
use crate::batch::{self, refused};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::policy::BATCH_CHECKPOINT_OVER;
use crate::time::Instant;

/// Whose guardrails a batch is held to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Guard {
    /// An agent's batch, or one a person accepted from an agent.
    Agent,
    /// A batch a person runs from the app (engine/batch_person.rs).
    Person,
}

/// A commit summary on one line.
fn one_line(text: &str) -> String {
    let line: String = text
        .trim()
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    line.chars().take(120).collect()
}

/// The batch being run, and the thread running it.
#[derive(Debug)]
pub(super) struct Running {
    thread: ThreadId,
    paths: BTreeSet<String>,
}

/// While it lives, the thread's ops join the batch; dropping it (even in a
/// panic) ends that.
struct Scope<'a>(&'a Kasten);

impl<'a> Scope<'a> {
    fn start(kasten: &'a Kasten) -> Scope<'a> {
        kasten.state().batch = Some(Running {
            thread: std::thread::current().id(),
            paths: BTreeSet::new(),
        });
        Scope(kasten)
    }

    /// The files the batch wrote so far.
    fn paths(&self) -> Vec<String> {
        self.0
            .state()
            .batch
            .as_ref()
            .map(|r| r.paths.iter().cloned().collect())
            .unwrap_or_default()
    }
}

impl Drop for Scope<'_> {
    fn drop(&mut self) {
        self.0.state().batch = None;
    }
}

impl Kasten {
    /// Whether this thread is running a batch, whose ops commit together.
    pub(super) fn in_batch(&self) -> bool {
        self.state()
            .batch
            .as_ref()
            .is_some_and(|r| r.thread == std::thread::current().id())
    }

    /// An op of the running batch wrote `paths`.
    pub(super) fn joins_batch(&self, paths: &[String]) {
        if let Some(running) = self.state().batch.as_mut() {
            running.paths.extend(paths.iter().cloned());
        }
    }

    /// Runs `ops` as one batch for `actor` (an agent, or the person who
    /// approved its proposal): the result of each, in order. A person's own
    /// batch is `batch_as_person`; it is not reached from here.
    pub(super) fn execute_batch(
        &self,
        actor: &Actor,
        ops: &[AgentOp],
        now: Instant,
    ) -> Result<Value> {
        if matches!(actor, Actor::Human) {
            return Err(Error::Invalid(
                "A batch with no agent behind it is run with batch_as_person".to_owned(),
            ));
        }
        self.run_batch(actor, ops, now, Guard::Agent, None)
            .map(|(value, _)| value)
    }

    /// Runs `ops` as one batch under `guard`: the value the batch answers,
    /// and the commit it made. `label` is the commit's summary, in place of
    /// the changes counted.
    pub(super) fn run_batch(
        &self,
        actor: &Actor,
        ops: &[AgentOp],
        now: Instant,
        guard: Guard,
        label: Option<&str>,
    ) -> Result<(Value, Option<String>)> {
        match guard {
            Guard::Agent => batch::check_shape(ops)?,
            Guard::Person => {
                batch::check_shape_person(ops)?;
                // What no one writes is turned away before anything is made.
                for (index, op) in ops.iter().enumerate() {
                    self.person_refusals(op)
                        .and_then(|()| self.spelled_as_on_disk(op))
                        .map_err(|err| refused(index, ops.len(), op, &err))?;
                }
            }
        }
        let history = self.history.get().ok_or_else(|| {
            Error::Invalid(
                "A batch is undone as one step, which needs the vault's history. Turn on history first, or send the changes one at a time".to_owned(),
            )
        })?;
        let checkpoint = self.checkpoint_before(actor, ops.len(), now)?;
        let total = ops.len();
        let mut trailers = vec![("Kasten-Batch", total.to_string())];
        if guard == Guard::Person {
            // An agent's commit says its op already; a person's does not.
            trailers.insert(0, ("Kasten-Op", "batch".to_owned()));
        }
        let mut before: Option<Before> = None;
        let mut ran: Vec<String> = Vec::new();
        let mut rolled: Option<Revision> = None;
        let outcome = self.apply_committing(actor, "batch", false, now.millis, &trailers, |_| {
            let started = Before {
                dirty: history.dirty()?.into_iter().collect(),
                tally: actor
                    .session()
                    .and_then(|s| self.state().tallies.get(s).cloned()),
            };
            self.refuse_unsaved(ops, &started.dirty)?;
            let scope = Scope::start(self);
            let results = ops.iter().enumerate().try_fold(
                Vec::with_capacity(total),
                |mut results, (index, op)| -> Result<Vec<Value>> {
                    // The same guardrails as for a single change, once more,
                    // under the lock and against what the earlier changes left.
                    let step = self.may_fail_batch(index).and_then(|()| {
                        let made = self.guarded(guard, op, &results)?;
                        let value = self.execute(actor, &made, now)?;
                        Ok((made, value))
                    });
                    match step {
                        Ok((made, value)) => {
                            if guard == Guard::Person {
                                batch::refs::follow(&mut results, &made, &value);
                            }
                            results.push(value);
                            Ok(results)
                        }
                        Err(err) => Err(refused(index, total, op, &err)),
                    }
                },
            );
            let paths = scope.paths();
            drop(scope);
            match results {
                Ok(results) => {
                    ran.clone_from(&paths);
                    before = Some(started);
                    let message = match label.map(one_line).filter(|l| !l.is_empty()) {
                        Some(label) => label,
                        None => format!("batch: {} ({total} changes)", batch::describe(ops)),
                    };
                    Ok(super::Change {
                        value: json!({ "changes": total, "results": results }),
                        paths,
                        message,
                    })
                }
                Err(err) => {
                    let (revision, left) = self.put_back(history, actor, &started, &paths);
                    rolled = revision;
                    Err(left.told(err))
                }
            }
        });
        // The commit itself failed: the batch is not in the history, so it is
        // not in the vault either.
        let outcome = match (outcome, before) {
            (Err(err), Some(before)) => {
                let (revision, left) = self
                    .lock
                    .hold(|| Ok(self.put_back(history, actor, &before, &ran)))?;
                rolled = revision;
                Err(left.told(err))
            }
            (other, _) => other,
        };
        if let Some(revision) = rolled {
            self.announce(revision);
        }
        // A batch that was rolled back never happened: its "Before a batch"
        // checkpoint would only offer a restore to where the vault already is.
        if outcome.is_err()
            && let Some(id) = checkpoint
        {
            let _ = self
                .lock
                .hold(|| crate::policy::forget_checkpoint(self.vault.root(), &id));
        }
        outcome
    }

    /// The change as it is made, once the guardrails of `guard` let it
    /// through. An agent's holds the lock's refusals (locked notes, private
    /// folders, templates); a person's has its references put by the notes
    /// they name and is held to what no one may write (the vault's own
    /// folders). Both keep the rules that belong to a batch.
    fn guarded<'a>(
        &self,
        guard: Guard,
        op: &'a AgentOp,
        made: &[Value],
    ) -> Result<std::borrow::Cow<'a, AgentOp>> {
        match guard {
            Guard::Agent => {
                self.refusals(op)?;
                self.batch_rules(op)?;
                Ok(std::borrow::Cow::Borrowed(op))
            }
            Guard::Person => {
                let op = batch::refs::resolve(op, made)?;
                self.person_refusals(&op)?;
                self.batch_rules(&op)?;
                Ok(op)
            }
        }
    }

    /// Fails like a full disk before change `index`, when a test asked for it
    /// with `fail_batch_after`.
    fn may_fail_batch(&self, index: usize) -> Result<()> {
        let mut state = self.state();
        if state.fail_batch_after.is_some_and(|n| index >= n) {
            state.fail_batch_after = None;
            return Err(std::io::Error::new(
                std::io::ErrorKind::StorageFull,
                "No space left on the disk",
            )
            .into());
        }
        Ok(())
    }

    /// Makes the next batch fail after `changes` changes are made, as a full
    /// disk would: for testing that everything is put back.
    #[doc(hidden)]
    pub fn fail_batch_after(&self, changes: usize) {
        self.state().fail_batch_after = Some(changes);
    }

    /// A batch of more than 20 changes notes where the vault is first, so one
    /// click in History goes back to before it. An autonomous session's own
    /// checkpoint (taken as its first write begins) already covers it.
    fn checkpoint_before(
        &self,
        actor: &Actor,
        count: usize,
        now: Instant,
    ) -> Result<Option<String>> {
        if count <= BATCH_CHECKPOINT_OVER || self.state().autonomous.is_some() {
            return Ok(None);
        }
        let session = match actor {
            Actor::Agent { client, session }
            | Actor::Approved {
                client, session, ..
            } => Session {
                id: session.clone(),
                client: client.clone(),
                started: now.millis,
            },
            Actor::Human => return Ok(None),
        };
        Ok(self
            .maybe_checkpoint(&session, false, count, now)?
            .map(|c| c.id))
    }
}
