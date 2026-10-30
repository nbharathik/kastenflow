//! Pushes to the backup remote: when one is due, the confirmed remote and
//! its token, the record of how the last tries went, and the status shown.

use std::fs;

use serde::{Deserialize, Serialize};

use super::Kasten;
use crate::backup::BackupNotice;
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
    /// The remote the last push went to: what `pushed_head` is the tip of.
    #[serde(default)]
    pub pushed_to: Option<String>,
    /// The remote no longer holds `pushed_head` (someone rewrote it), so
    /// pushes have stopped.
    #[serde(default)]
    pub lost_history: bool,
    /// The safety branch this computer's full history was last saved to.
    #[serde(default)]
    pub recovered_branch: Option<String>,
    /// When the weekly check last found the backup whole.
    #[serde(default)]
    pub verified_at: Option<u64>,
    /// When the current run of failed tries began.
    #[serde(default)]
    pub failing_since: Option<u64>,
    /// How many pushes in a row the backup refused as behind.
    #[serde(default)]
    pub refused: u32,
    /// The backup's newest commit when Get latest last looked, and the
    /// remote it came from: commits it reaches are in the backup.
    #[serde(default)]
    pub fetched: Option<String>,
    #[serde(default)]
    pub fetched_from: Option<String>,
    /// When the backup was last looked at for changes from other computers.
    /// Not kept: a new run looks at once.
    #[serde(skip)]
    pub last_checked: Option<u64>,
    /// When the backup was last read back, whether or not it was found whole;
    /// a check that failed is not repeated at once. Not kept.
    #[serde(skip)]
    pub last_verify_try: Option<u64>,
}

impl BackupRecord {
    /// The commit Get latest last fetched from the backup at `url`.
    pub(super) fn fetched_at(&self, url: &str) -> Option<&str> {
        self.fetched
            .as_deref()
            .filter(|_| self.fetched_from.as_deref() == Some(url))
    }

    /// Whether pushes to `url` have stopped for a rewritten backup.
    pub(super) fn lost_for(&self, url: &str) -> bool {
        self.lost_history && self.pushed_to.as_deref() == Some(url)
    }

    /// The commit the backup at `url` is known to hold from here: what was
    /// last pushed, when it went to that remote (or to one not recorded, as
    /// before this was kept).
    pub(super) fn known_at(&self, url: &str) -> Option<&str> {
        self.pushed_head
            .as_deref()
            .filter(|_| self.pushed_to.as_deref().is_none_or(|to| to == url))
    }
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

    pub(super) fn save_backup(&self, record: &BackupRecord) {
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
        self.wake_workers();
    }

    /// The token to sign in to the remote's server with, from the app's
    /// keychain, or None to use an SSH key or git's credential helper.
    /// Kept in memory only, and sent only to its own server.
    pub fn set_git_token(&self, token: Option<crate::history::GitToken>) {
        self.state().git_token = token;
        self.wake_workers();
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
        self.push_due_at().is_some_and(|due| now >= due)
    }

    /// The time (milliseconds since the Unix epoch) from which a push is due,
    /// or None when none is waiting: no history, no confirmed remote, nothing
    /// new to send, or a rewritten backup.
    pub(super) fn push_due_at(&self) -> Option<u64> {
        let config = self.config();
        let history = self.history.get()?;
        let url = self.confirmed_remote()?;
        let head = history.head();
        let state = self.state();
        // A rewritten backup takes no pushes until it is dealt with.
        if head.is_none() || head == state.backup.pushed_head || state.backup.lost_for(&url) {
            return None;
        }
        // After failures, each try waits longer, counted from the last
        // try: a long outage costs one try an hour, and new commits do not
        // cut the wait short.
        if state.backup.failures > 0 {
            let wait = backoff(state.backup.failures);
            return Some(
                state
                    .backup
                    .last_attempt
                    .map_or(0, |t| t.saturating_add(wait)),
            );
        }
        // Saturating: the waits come from a config file anyone can edit.
        let delay = config.git.push_delay_seconds.saturating_mul(1000);
        let interval = config.git.push_interval_minutes.saturating_mul(60_000);
        // Settled after the delay since the last commit, or overdue after the
        // interval since the last push: whichever comes first.
        let settled = state.last_commit.map_or(0, |t| t.saturating_add(delay));
        let overdue = state
            .backup
            .last_push
            .map_or(0, |t| t.saturating_add(interval));
        Some(settled.min(overdue))
    }

    /// Whether one last push is worth trying as Kasten closes: the backup
    /// lacks commits, is not known to be ahead, and no push failed within
    /// its wait.
    pub fn push_on_close_due(&self, now: u64) -> bool {
        let Some(history) = self.history.get() else {
            return false;
        };
        let Some(url) = self.confirmed_remote() else {
            return false;
        };
        let head = history.head();
        let state = self.state();
        if head.is_none()
            || head == state.backup.pushed_head
            || state.backup.behind
            || state.backup.lost_for(&url)
        {
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
        // A backup someone rewrote takes no push: it would be refused, or
        // bury what they did.
        let lost = self.backup_lost(history, &url, token.as_ref());
        // A check that could not be made (the backup cannot be reached, a Get
        // latest is half done) does not lift a stop already recorded.
        let stays_lost = lost.is_none() && self.state().backup.lost_for(&url);
        if lost == Some(true) || stays_lost {
            return Err(self.stop_for_lost_history(now));
        }
        let result = history
            .push_as(&url, token.as_ref())
            .map_err(|err| crate::history::redacted(err, token.as_ref()));
        let mut record = self.state().backup.clone();
        record.last_attempt = Some(now);
        if lost == Some(false) {
            record.lost_history = false;
        }
        match &result {
            Ok(sent) => {
                record.last_push = Some(now);
                record.pushed_head.clone_from(sent);
                record.pushed_to = Some(url);
                record.lost_history = false;
                record.failures = 0;
                record.last_error = None;
                record.behind = false;
                record.failing_since = None;
                record.refused = 0;
            }
            Err(err) => {
                record.failures += 1;
                record.failing_since.get_or_insert(now);
                record.last_error = Some(err.to_string());
                record.behind = err.to_string().contains(crate::history::BEHIND);
                record.refused = if record.behind { record.refused + 1 } else { 0 };
            }
        }
        self.save_backup(&record);
        self.state().backup = record;
        // The next try (or none) is counted from this one.
        self.wake_workers();
        result.map(|_| ())
    }

    pub fn backup_status(&self, now: u64) -> BackupStatus {
        let (record, confirmed) = {
            let state = self.state();
            (state.backup.clone(), state.confirmed_remote.clone())
        };
        let remote = self.config().git.remote;
        let on = self.has_history() && remote.is_some();
        // A run of failed tries is "failing" once it has gone on for hours
        // (or pushes were refused again and again), not after a few quick
        // tries: that is what the person is told.
        let notice =
            BackupNotice::judge(record.failing_since, record.failures, record.refused, now)
                .filter(|_| on);
        let mut status = BackupStatus::judge(
            on,
            record.last_push,
            if notice.is_some() {
                record.failures.max(3)
            } else {
                0
            },
            record.last_error.clone(),
            now,
        );
        status.failures = record.failures;
        status.notice = notice;
        status.verified_at = record.verified_at;
        if on && confirmed != remote {
            status.state = BackupState::Unconfirmed;
        }
        status.behind = record.behind;
        self.add_backup_facts(&mut status, &record, remote.as_deref());
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
