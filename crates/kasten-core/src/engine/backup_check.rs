//! The weekly check of the backup itself (backup/verify.rs): it holds the
//! commit this computer last sent, and what was fetched from it reads back
//! whole. Nothing is changed on the remote or in the vault.

use super::Kasten;
use crate::backup::{CHECK_EVERY_MS, RemoteCheck};
use crate::error::{Error, Result};
use crate::history::redacted;

/// A failed check is not tried again for this long.
const RETRY_AFTER_MS: u64 = 60 * 60 * 1000;

impl Kasten {
    /// Whether the weekly check of the backup is due: something was sent to
    /// it, and it was never checked or the last good check is a week old. A
    /// check that was just tried (and failed) waits an hour.
    pub fn remote_check_due(&self, now: u64) -> bool {
        if !self.has_history() {
            return false;
        }
        let Some(url) = self.confirmed_remote() else {
            return false;
        };
        let state = self.state();
        let record = &state.backup;
        if record.known_at(&url).is_none() || record.lost_for(&url) {
            return false;
        }
        let week_old = record
            .verified_at
            .is_none_or(|at| now >= at.saturating_add(CHECK_EVERY_MS));
        let settled = record
            .last_verify_try
            .is_none_or(|at| now >= at.saturating_add(RETRY_AFTER_MS));
        week_old && settled
    }

    /// The weekly check, when it is due; None when it is not.
    pub fn verify_remote_if_due(&self, now: u64) -> Option<Result<RemoteCheck>> {
        self.remote_check_due(now).then(|| self.verify_remote(now))
    }

    /// Reads the backup back: it must hold the commit this computer last sent
    /// it, and the history fetched from it must be readable. An error when
    /// the backup cannot be reached; otherwise what was found, with the time
    /// kept as the last good check when nothing is wrong.
    pub fn verify_remote(&self, now: u64) -> Result<RemoteCheck> {
        let history = self.history_or_err()?;
        let Some(url) = self.confirmed_remote() else {
            return Err(Error::Invalid(
                "No backup is set up and confirmed on this computer to check".into(),
            ));
        };
        let record = self.state().backup.clone();
        let earlier = record.verified_at;
        let unwell = |problems: Vec<String>, objects: u32| RemoteCheck {
            ok: false,
            verified_at: earlier,
            objects,
            problems,
        };
        let Some(sent) = record.known_at(&url).map(str::to_owned) else {
            return Ok(unwell(
                vec!["Nothing has been sent to the backup from this computer yet, so there is nothing to check".into()],
                0,
            ));
        };
        self.state().backup.last_verify_try = Some(now);
        let token = self.git_token();
        let tip = history
            .fetch_latest(&url, token.as_ref())
            .map_err(|err| redacted(err, token.as_ref()))?;
        let Some(tip) = tip else {
            return Ok(unwell(
                vec!["The backup has no copy of this vault's history".into()],
                0,
            ));
        };
        self.note_fetched(&url, &tip);
        let mut problems = Vec::new();
        if !history.holds(&tip, &sent) {
            problems.push(
                "The backup no longer holds the last change this computer sent it".to_owned(),
            );
        }
        let head = history.head();
        let known: Vec<&str> = std::iter::once(sent.as_str())
            .chain(head.as_deref())
            .collect();
        let (objects, unreadable) = history.read_back(&tip, &known)?;
        problems.extend(unreadable);
        if !problems.is_empty() {
            return Ok(unwell(problems, objects));
        }
        let mut record = self.state().backup.clone();
        record.verified_at = Some(now);
        self.save_backup(&record);
        self.state().backup = record;
        Ok(RemoteCheck {
            ok: true,
            verified_at: Some(now),
            objects,
            problems,
        })
    }
}
