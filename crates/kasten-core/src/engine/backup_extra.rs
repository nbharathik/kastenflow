//! What the backup status says beyond the last push (changes waiting, files
//! left out for their size, a rewritten backup), and the safety branch a
//! rewritten backup's history can be saved to.

use super::Kasten;
use super::push::BackupRecord;
use crate::backup::{BackupExtras, recovered::LOST, skip};
use crate::error::{Error, Result};
use crate::history::{BackupState, BackupStatus, GitToken, History};
use crate::time::Instant;

/// What `extras` were counted for: the newest commit, and the commits the
/// backup is known to hold (the one last sent, the one last fetched).
pub(super) type ExtrasKey = (Option<String>, Vec<String>);

impl Kasten {
    /// Whether the backup at `url` was rewritten: Some(true) when it no
    /// longer holds the commit sent from here, Some(false) when it does,
    /// None when that cannot be told (nothing sent there yet, a Get latest
    /// half done, or the backup cannot be reached right now).
    pub(super) fn backup_lost(
        &self,
        history: &History,
        url: &str,
        token: Option<&GitToken>,
    ) -> Option<bool> {
        let record = self.state().backup.clone();
        // Only a commit sent to this very remote says anything about it.
        let pushed = record
            .pushed_head
            .as_deref()
            .filter(|_| record.pushed_to.as_deref() == Some(url))?;
        if self.unfinished_get_latest() {
            return None;
        }
        history.backup_rewritten(url, token, pushed).ok()
    }

    /// Records that pushes stopped for a rewritten backup; the error to give.
    pub(super) fn stop_for_lost_history(&self, now: u64) -> Error {
        let mut record = self.state().backup.clone();
        record.last_attempt = Some(now);
        record.lost_history = true;
        record.last_error = Some(LOST.to_owned());
        self.save_backup(&record);
        self.state().backup = record;
        Error::Git(LOST.to_owned())
    }

    /// Fills in what the status holds beyond the last push.
    pub(super) fn add_backup_facts(
        &self,
        status: &mut BackupStatus,
        record: &BackupRecord,
        remote: Option<&str>,
    ) {
        let Some(history) = self.history.get() else {
            return;
        };
        status.skipped = skip::read_list(self.vault.root());
        status.recovered_branch.clone_from(&record.recovered_branch);
        let Some(remote) = remote else {
            return;
        };
        if record.lost_for(remote) {
            status.lost_history = true;
            status.state = BackupState::Failing;
            status.last_error = Some(LOST.to_owned());
        }
        let extras = self.extras_for(history, known_commits(record, remote));
        status.unpushed = extras.unpushed;
        status.waiting = extras.unpushed > 0;
        status.warn = extras.warn;
        status.repo_size = extras.repo_size;
    }

    /// The counts for the newest commit, kept while it and the commits the
    /// backup is known to hold stay as they are.
    fn extras_for(&self, history: &History, known: Vec<String>) -> BackupExtras {
        let key: ExtrasKey = (history.head(), known);
        if let Some((kept, extras)) = &self.state().backup_extras
            && *kept == key
        {
            return extras.clone();
        }
        // Counted with no lock held: the repository has its own.
        let hidden: Vec<&str> = key.1.iter().map(String::as_str).collect();
        let extras = history.extras(&hidden);
        self.state().backup_extras = Some((key, extras.clone()));
        extras
    }

    /// How many commits the backup at `url` lacks, as far as is known here.
    pub(super) fn unpushed_for(&self, history: &History, url: &str) -> u32 {
        let record = self.state().backup.clone();
        self.extras_for(history, known_commits(&record, url))
            .unpushed
    }

    /// Notes what Get latest fetched from the backup at `url`, so what it
    /// brought in is not counted as waiting.
    pub(super) fn note_fetched(&self, url: &str, tip: &str) {
        let mut record = self.state().backup.clone();
        if record.fetched.as_deref() == Some(tip) && record.fetched_from.as_deref() == Some(url) {
            return;
        }
        record.fetched = Some(tip.to_owned());
        record.fetched_from = Some(url.to_owned());
        self.save_backup(&record);
        self.state().backup = record;
    }

    /// Saves this computer's full history to a branch of its own on the
    /// backup (`kasten/recovered-<date>`), for a backup someone rewrote.
    /// A normal push to a new name: nothing there is overwritten. Answers
    /// the branch's name.
    pub fn save_full_history_to_safety_branch(&self, now: u64) -> Result<String> {
        let history = self.history_or_err()?;
        if self.config().git.remote.is_none() {
            return Err(Error::Invalid("No backup remote is set up".into()));
        }
        let Some(url) = self.confirmed_remote() else {
            return Err(Error::Invalid(
                "The backup remote is not confirmed on this computer yet".into(),
            ));
        };
        let token = self.git_token();
        let date = Instant { millis: now }.rfc3339();
        let name = history
            .push_recovered(&url, token.as_ref(), &date[..10])
            .map_err(|err| crate::history::redacted(err, token.as_ref()))?;
        let mut record = self.state().backup.clone();
        record.recovered_branch = Some(name.clone());
        self.save_backup(&record);
        self.state().backup = record;
        Ok(name)
    }
}

/// The commits the backup at `url` is known to hold from here: the one last
/// sent and the one last fetched.
fn known_commits(record: &BackupRecord, url: &str) -> Vec<String> {
    record
        .known_at(url)
        .into_iter()
        .chain(record.fetched_at(url))
        .map(str::to_owned)
        .collect()
}
