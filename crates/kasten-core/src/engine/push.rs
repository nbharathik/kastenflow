//! Pushes to the backup remote: when one is due, the confirmed remote and
//! its token, the record of how the last tries went, and the status shown.

use std::fs;

use serde::{Deserialize, Serialize};

use super::Kasten;
use crate::error::{Error, Result};
use crate::history::{BackupState, BackupStatus};

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
