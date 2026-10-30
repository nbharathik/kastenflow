//! What the app's commit and backup workers sleep on. They used to look at
//! the vault every five seconds all day; now each asks the engine how long
//! its pending work has to wait (`commit_wait`, `push_wait`) and sleeps that
//! long, or until the engine says something changed (`wake_workers`). A quiet
//! vault wakes nobody. Nothing here commits or pushes: the workers still call
//! `commit_tick` and `push_if_due` exactly as before, only less often.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use super::backup_file::{DAY, IDLE};
use super::{Kasten, QUIET_MS};

/// The change counter the workers sleep on, and how often they woke.
#[derive(Debug, Default)]
pub(super) struct Wakes {
    mark: Mutex<u64>,
    changed: Condvar,
    woke: AtomicU64,
}

impl Kasten {
    /// Tells the workers something they may have to act on changed: an op, an
    /// outside change, a commit, the backup's address or sign-in, and from the
    /// app, the folder backup files go to. Cheap, and safe to call with any
    /// lock held.
    pub fn wake_workers(&self) {
        let mut mark = self.wakes.mark.lock().unwrap_or_else(|p| p.into_inner());
        *mark += 1;
        self.wakes.changed.notify_all();
    }

    /// The counter now. A worker reads it before it looks at what is pending
    /// and sleeps on that reading, so a change made meanwhile is not lost.
    pub fn work_mark(&self) -> u64 {
        *self.wakes.mark.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Sleeps until the counter moves past `mark` or `limit` passes. True when
    /// a change woke it, false when the limit did. Returns at once when the
    /// counter is already past `mark`.
    pub fn wait_for_work(&self, mark: u64, limit: Duration) -> bool {
        let guard = self.wakes.mark.lock().unwrap_or_else(|p| p.into_inner());
        let (guard, _) = self
            .wakes
            .changed
            .wait_timeout_while(guard, limit, |now| *now == mark)
            .unwrap_or_else(|p| p.into_inner());
        let changed = *guard != mark;
        drop(guard);
        self.wakes.woke.fetch_add(1, Ordering::Relaxed);
        changed
    }

    /// How many times a wait has ended, for a change or a limit alike. Tests
    /// read it to show a quiet vault wakes no one.
    pub fn worker_wakeups(&self) -> u64 {
        self.wakes.woke.load(Ordering::Relaxed)
    }

    /// Milliseconds until `commit_tick` has something to commit: typing or an
    /// outside change waits for its quiet spell. Some(0) when that is over,
    /// None when nothing is pending.
    pub fn commit_wait(&self, now: u64) -> Option<u64> {
        let state = self.state();
        let edits = state
            .last_edit
            .filter(|_| !state.edits.is_empty())
            .map(|t| t.saturating_add(QUIET_MS));
        let outside = state.outside.map(|t| t.saturating_add(QUIET_MS));
        [edits, outside]
            .into_iter()
            .flatten()
            .min()
            .map(|due| due.saturating_sub(now))
    }

    /// Milliseconds until `push_if_due` would push: Some(0) when it would now,
    /// None when no push is waiting for time to pass (no confirmed remote, the
    /// backup holds the newest commit, or its history was rewritten).
    pub fn push_wait(&self, now: u64) -> Option<u64> {
        self.push_due_at().map(|due| due.saturating_sub(now))
    }

    /// Milliseconds until the daily backup file may be due (`backup_file_due`
    /// then says): Some(0) when only the app's folder setting is missing.
    /// None when only a change can make one due: no history, the newest file
    /// already holds the newest commit, or typing waits for its commit (which
    /// wakes the workers).
    pub fn backup_file_wait(&self, now: u64) -> Option<u64> {
        let head = self.history.get().and_then(|h| h.head())?;
        let record = self.backup_file_record();
        if record.last_written.is_some() && record.head.as_deref() == Some(head.as_str()) {
            return None;
        }
        let mut due = record
            .last_written
            .map_or(0, |written| written.saturating_add(DAY));
        if let (true, Some(tried)) = (record.failures > 0, record.last_attempt) {
            due = due.max(tried.saturating_add(super::push::backoff(record.failures)));
        }
        let state = self.state();
        if !state.edits.is_empty() {
            return None;
        }
        for t in [state.typed, state.outside].into_iter().flatten() {
            due = due.max(t.saturating_add(IDLE));
        }
        Some(due.saturating_sub(now))
    }
}
