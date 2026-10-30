//! Commits that are not one op: human typing after a quiet spell and changes
//! made outside Kasten, and the clock that runs them and the pushes.

use serde::Serialize;

use super::{Kasten, QUIET_MS};
use crate::error::Result;
use crate::history::{Actor, History};

/// What a tick did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tick {
    /// The commit for batched human edits, if one was made.
    pub edits: Option<String>,
    /// The commit for outside changes, if one was made.
    pub external: Option<String>,
    pub pushed: bool,
}

fn listing(items: &[String], max: usize) -> String {
    match items.len() {
        n if n <= max => items.join(", "),
        n => format!("{} and {} more", items[..max].join(", "), n - max),
    }
}

impl Kasten {
    /// Commits the batched human edits now, as `edit: <titles>`.
    pub fn commit_edits(&self) -> Result<Option<String>> {
        let Some(history) = self.history.get() else {
            return Ok(None);
        };
        if self.state().edits.is_empty() {
            return Ok(None);
        }
        self.lock.hold(|| self.commit_edits_held(history))
    }

    /// `commit_edits` with the write lock held. The paths are read under
    /// it, so a save that lands meanwhile is either in this commit or
    /// still waiting with its clock running.
    pub(super) fn commit_edits_held(&self, history: &History) -> Result<Option<String>> {
        let paths: Vec<String> = self.state().edits.keys().cloned().collect();
        if paths.is_empty() {
            return Ok(None);
        }
        let mut titles: Vec<String> = paths
            .iter()
            .filter_map(|p| crate::board::file_title(&self.vault, p))
            .collect();
        // A diagram and its picture have one title.
        titles.dedup();
        let message = format!(
            "edit: {}",
            if titles.is_empty() {
                listing(&paths, 3)
            } else {
                listing(&titles, 3)
            }
        );
        let id = history.commit(&paths, &message, &Actor::Human, "edit")?;
        let mut state = self.state();
        for path in &paths {
            state.edits.remove(path);
        }
        if state.edits.is_empty() {
            state.last_edit = None;
        }
        if id.is_some() {
            state.last_commit = Some(crate::time::Instant::now().millis);
        }
        drop(state);
        // The backup worker counts its push delay from this commit.
        self.wake_workers();
        Ok(id)
    }

    /// Stops tracking Kasten's cache in a repository where an earlier
    /// version committed it; the files stay on disk.
    pub fn untrack_local_files(&self) -> Result<Option<String>> {
        let Some(history) = self.history.get() else {
            return Ok(None);
        };
        self.lock.hold(|| history.untrack_local())
    }

    /// The watcher saw these files change; they are indexed now and
    /// committed after a quiet spell.
    pub fn outside_changes(&self, paths: &[String], now: u64) {
        let _ = self.index().refresh(&self.vault, paths);
        self.state().outside = Some(now);
        // The quiet spell before its commit starts now.
        self.wake_workers();
        self.revised(paths);
    }

    /// Commits whatever changed outside Kasten, as `external: <paths>`.
    /// Human edits waiting for their own commit are left for it.
    pub fn commit_external(&self) -> Result<Option<String>> {
        let Some(history) = self.history.get() else {
            return Ok(None);
        };
        self.lock.hold(|| self.commit_external_held(history))
    }

    /// `commit_external` with the write lock held.
    pub(super) fn commit_external_held(&self, history: &History) -> Result<Option<String>> {
        // A Get latest stopped part way owns the folder until it is
        // finished: its files are not outside changes.
        if self.unfinished_get_latest() {
            return Ok(None);
        }
        let waiting: Vec<String> = self.state().edits.keys().cloned().collect();
        // A file too big for GitHub that the list already names (at the size
        // it has now) has nothing to commit: it stays in `dirty`, which tells
        // a batch that History does not hold it, but this pass need not read
        // it again.
        let left_out = crate::backup::skip::read_list(self.vault.root());
        let paths: Vec<String> = history
            .dirty()?
            .into_iter()
            .filter(|p| !waiting.contains(p))
            .filter(|p| !crate::backup::skip::already_left_out(self.vault.root(), &left_out, p))
            .collect();
        if paths.is_empty() {
            return Ok(None);
        }
        self.index().refresh(&self.vault, &paths)?;
        let id = history.commit(
            &paths,
            &format!("external: {}", listing(&paths, 5)),
            &Actor::Human,
            "external",
        )?;
        if id.is_some() {
            self.state().last_commit = Some(crate::time::Instant::now().millis);
            self.wake_workers();
        }
        Ok(id)
    }

    /// Runs the schedule: batched edits and outside changes are committed
    /// after `QUIET_MS` without changes, and the remote gets a push when due.
    pub fn tick(&self, now: u64) -> Result<Tick> {
        let mut tick = self.commit_tick(now)?;
        tick.pushed = self.push_if_due(now).is_some_and(|pushed| pushed.is_ok());
        Ok(tick)
    }

    /// The clock's commits alone, never a push: the app runs pushes on a
    /// thread of their own, since one can wait on the network for minutes
    /// and commits must not wait with it.
    pub fn commit_tick(&self, now: u64) -> Result<Tick> {
        let mut tick = Tick::default();
        let (edits_due, outside_due) = {
            let state = self.state();
            (
                !state.edits.is_empty() && state.last_edit.is_some_and(|t| now >= t + QUIET_MS),
                state.outside.is_some_and(|t| now >= t + QUIET_MS),
            )
        };
        if edits_due {
            tick.edits = self.commit_edits()?;
        }
        // While a Get latest waits to be finished, the files it wrote are
        // its own, not outside edits.
        if outside_due && !self.unfinished_get_latest() {
            tick.external = self.commit_external()?;
            self.state().outside = None;
        }
        // Between edits, keep the search index quick. A failed tidy only
        // leaves it a little slower, so it does not fail the tick.
        if self.state().edits.is_empty() {
            let _ = self.index().tidy();
        }
        Ok(tick)
    }

    /// Whether nothing has changed for `idle` ms: no typing waiting for its
    /// commit, and no typing or outside change that recent.
    pub(super) fn quiet_for(&self, now: u64, idle: u64) -> bool {
        let state = self.state();
        state.edits.is_empty()
            && state.typed.is_none_or(|t| now >= t + idle)
            && state.outside.is_none_or(|t| now >= t + idle)
    }
}
