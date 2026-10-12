//! Commits that are not one op: human typing after a quiet spell, changes
//! made outside Kasten, and pushes to the backup remote on their schedule.

use std::fs;

use serde::{Deserialize, Serialize};

use super::{Kasten, QUIET_MS};
use crate::error::{Error, Result};
use crate::history::{Actor, BackupState, BackupStatus, History};

const BACKUP_PATH: &str = ".kasten/cache/backup.json";

/// When the vault last reached its remote, kept in the cache.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub last_push: Option<u64>,
    pub pushed_head: Option<String>,
    pub failures: u32,
    pub last_error: Option<String>,
    /// When a push was last tried, whether it worked or not.
    pub last_attempt: Option<u64>,
    /// The last push was refused because the backup has changes this
    /// computer lacks.
    #[serde(default)]
    pub behind: bool,
}

/// How long to wait after the last try once pushes have failed `failures`
/// times in a row: 2, 4, 8, 16 and 32 minutes, then an hour.
pub(super) fn backoff(failures: u32) -> u64 {
    (1u64 << failures.min(6)).min(60) * 60_000
}

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
    pub(super) fn load_backup(&self) {
        let path = self.vault.root().join(BACKUP_PATH);
        if let Ok(text) = fs::read_to_string(path)
            && let Ok(record) = serde_json::from_str::<BackupRecord>(&text)
        {
            self.state().backup = record;
        }
        let head_time = self
            .log(None, 1)
            .ok()
            .and_then(|l| l.first().map(|c| c.time));
        self.state().last_commit = head_time;
    }

    fn save_backup(&self, record: &BackupRecord) {
        let path = self.vault.root().join(BACKUP_PATH);
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(record) {
            let _ = crate::atomic::write_atomic(&path, text.as_bytes());
        }
    }

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
        let paths: Vec<String> = history
            .dirty()?
            .into_iter()
            .filter(|p| !waiting.contains(p))
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

    /// Pushes to the remote if a push is due; None when none is.
    pub fn push_if_due(&self, now: u64) -> Option<Result<()>> {
        self.push_due(now).then(|| self.push(now))
    }

    /// The remote the person confirmed on this computer. A vault's config
    /// alone never chooses where its notes are pushed: a vault someone
    /// shares could name any server. The app keeps the answer
    /// outside the vault and gives it here on opening.
    pub fn confirm_remote(&self, url: Option<&str>) {
        self.state().confirmed_remote = url.map(str::to_owned);
    }

    /// The token to sign in to the remote's server with, from the app's
    /// keychain, or None to use an SSH key or git's credential helper.
    /// Kept in memory only, and sent only to its own server.
    pub fn set_git_token(&self, token: Option<crate::history::GitToken>) {
        self.state().git_token = token;
    }

    pub(super) fn git_token(&self) -> Option<crate::history::GitToken> {
        self.state().git_token.clone()
    }

    /// The vault's remote, when it is the one confirmed on this computer:
    /// the only one Kasten pushes to or reaches.
    pub(super) fn confirmed_remote(&self) -> Option<String> {
        let remote = self.config().git.remote?;
        let confirmed = self.state().confirmed_remote.as_deref() == Some(remote.as_str());
        confirmed.then_some(remote)
    }

    fn push_due(&self, now: u64) -> bool {
        let config = self.config();
        let Some(history) = self.history.get() else {
            return false;
        };
        if self.confirmed_remote().is_none() {
            return false;
        }
        let head = history.head();
        let state = self.state();
        if head.is_none() || head == state.backup.pushed_head {
            return false;
        }
        // After failures, each try waits longer, counted from the last
        // try: a long outage costs one try an hour, and new commits do not
        // cut the wait short.
        if state.backup.failures > 0 {
            let wait = backoff(state.backup.failures);
            return state
                .backup
                .last_attempt
                .is_none_or(|t| now >= t.saturating_add(wait));
        }
        // Saturating: the waits come from a config file anyone can edit.
        let delay = config.git.push_delay_seconds.saturating_mul(1000);
        let interval = config.git.push_interval_minutes.saturating_mul(60_000);
        let settled = state
            .last_commit
            .is_none_or(|t| now >= t.saturating_add(delay));
        let overdue = state
            .backup
            .last_push
            .is_none_or(|t| now >= t.saturating_add(interval));
        settled || overdue
    }

    /// Whether one last push is worth trying as Kasten closes: the backup
    /// lacks commits, is not known to be ahead, and no push failed within
    /// its wait.
    pub fn push_on_close_due(&self, now: u64) -> bool {
        let Some(history) = self.history.get() else {
            return false;
        };
        if self.confirmed_remote().is_none() {
            return false;
        }
        let head = history.head();
        let state = self.state();
        if head.is_none() || head == state.backup.pushed_head || state.backup.behind {
            return false;
        }
        state.backup.failures == 0
            || state
                .backup
                .last_attempt
                .is_none_or(|t| now >= t.saturating_add(backoff(state.backup.failures)))
    }

    /// Pushes to the confirmed remote now.
    pub fn push(&self, now: u64) -> Result<()> {
        let Some(history) = self.history.get() else {
            return Err(Error::Invalid("This vault has no history yet".into()));
        };
        if self.config().git.remote.is_none() {
            return Err(Error::Invalid("No backup remote is set up".into()));
        }
        let Some(url) = self.confirmed_remote() else {
            return Err(Error::Invalid(
                "The backup remote is not confirmed on this computer yet".into(),
            ));
        };
        let token = self.git_token();
        let result = history
            .push_as(&url, token.as_ref())
            .map_err(|err| crate::history::redacted(err, token.as_ref()));
        let mut record = self.state().backup.clone();
        record.last_attempt = Some(now);
        match &result {
            Ok(sent) => {
                record.last_push = Some(now);
                record.pushed_head.clone_from(sent);
                record.failures = 0;
                record.last_error = None;
                record.behind = false;
            }
            Err(err) => {
                record.failures += 1;
                record.last_error = Some(err.to_string());
                record.behind = err.to_string().contains(crate::history::BEHIND);
            }
        }
        self.save_backup(&record);
        self.state().backup = record;
        result.map(|_| ())
    }

    pub fn backup_status(&self, now: u64) -> BackupStatus {
        let (record, confirmed) = {
            let state = self.state();
            (state.backup.clone(), state.confirmed_remote.clone())
        };
        let remote = self.config().git.remote;
        let on = self.has_history() && remote.is_some();
        let mut status = BackupStatus::judge(
            on,
            record.last_push,
            record.failures,
            record.last_error,
            now,
        );
        if on && confirmed != remote {
            status.state = BackupState::Unconfirmed;
        }
        status.behind = record.behind;
        status
    }

    /// Checks `url` answers, signing in with `token` where it is for that
    /// server, without changing anything there.
    pub fn reach_remote(&self, url: &str, token: Option<&crate::history::GitToken>) -> Result<()> {
        self.history_or_err()?
            .reach_as(url, token)
            .map_err(|err| crate::history::redacted(err, token))
    }

    /// Whether the backup has commits this vault lacks, from a quick look
    /// at where it stands; nothing is fetched.
    pub fn backup_ahead(&self) -> Result<bool> {
        let Some(history) = self.history.get() else {
            return Ok(false);
        };
        let Some(url) = self.confirmed_remote() else {
            return Ok(false);
        };
        let token = self.git_token();
        let there = history
            .remote_head(&url, token.as_ref())
            .map_err(|err| crate::history::redacted(err, token.as_ref()))?;
        Ok(match (there, history.head()) {
            (None, _) => false,
            (Some(_), None) => true,
            (Some(there), Some(here)) => !history.holds(&here, &there),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::backoff;

    #[test]
    fn waits_double_after_each_failure_up_to_an_hour() {
        let minutes: Vec<u64> = (1..=9).map(|f| backoff(f) / 60_000).collect();
        assert_eq!(minutes, [2, 4, 8, 16, 32, 60, 60, 60, 60]);
        assert_eq!(backoff(u32::MAX), 60 * 60_000);
    }
}
