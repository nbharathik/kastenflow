//! What the engine remembers between ops: edits waiting for a commit, recent
//! note versions for three-way merges, the backup record and the soft-limit
//! tallies. It lives in memory only.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::MutexGuard;

use super::{BackupRecord, Kasten};
use crate::agent::Tally;

/// Recent note versions kept for three-way merges.
const BASES: usize = 64;

#[derive(Debug, Default)]
pub(super) struct State {
    /// Human edits not committed yet: path, and when it last changed.
    pub(super) edits: BTreeMap<String, u64>,
    pub(super) last_edit: Option<u64>,
    /// When the person last typed, kept after the commit: backup files
    /// wait until the vault has been quiet a while.
    pub(super) typed: Option<u64>,
    /// When the watcher last saw a change made outside Kasten.
    pub(super) outside: Option<u64>,
    /// Recent versions by hash, so a save can merge with edits made meanwhile.
    pub(super) bases: VecDeque<(String, String)>,
    pub(super) last_commit: Option<u64>,
    pub(super) backup: BackupRecord,
    /// The remote the person confirmed on this computer, the only one
    /// scheduled pushes go to.
    pub(super) confirmed_remote: Option<String>,
    /// The token for the remote's server, from the app's keychain; held
    /// in memory only.
    pub(super) git_token: Option<crate::history::GitToken>,
    /// What each agent session changed lately, for the soft limits.
    pub(super) tallies: HashMap<String, Tally>,
    /// Paths an op wrote that the index could not take yet.
    pub(super) unindexed: BTreeSet<String>,
    /// Stop the next Get latest before its branch moves (tests).
    pub(super) stop_before_branch: bool,
    /// Fail the next Get latest after this many files (tests).
    pub(super) fail_writes_after: Option<usize>,
}

impl Kasten {
    /// Indexes `paths`, with any an earlier refresh could not take. The
    /// files are written by then: an index that fails now (SQLite busy)
    /// catches up with the next op rather than failing this one.
    pub(super) fn refresh_or_later(&self, paths: &[String]) {
        let mut all: BTreeSet<String> = std::mem::take(&mut self.state().unindexed);
        all.extend(paths.iter().cloned());
        let all: Vec<String> = all.into_iter().collect();
        if self.index().refresh(&self.vault, &all).is_err() {
            self.state().unindexed.extend(all);
        }
    }

    pub(super) fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub(super) fn remember(&self, hash: &str, text: &str) {
        let mut state = self.state();
        if state.bases.iter().any(|(h, _)| h == hash) {
            return;
        }
        if state.bases.len() >= BASES {
            state.bases.pop_front();
        }
        state.bases.push_back((hash.to_owned(), text.to_owned()));
    }

    pub(super) fn base(&self, hash: &str) -> Option<String> {
        self.state()
            .bases
            .iter()
            .find(|(h, _)| h == hash)
            .map(|(_, t)| t.clone())
    }
}
