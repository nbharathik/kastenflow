//! Getting the latest by itself (backup/auto_pull.rs). The backup is looked
//! at on open and every `backup.fetch_interval` minutes. A fast-forward is
//! taken when nothing here is waiting and no open page has unsaved edits; a
//! merge is never done without asking.

use super::{Kasten, LatestOutcome};
use crate::backup::{AutoPull, GetLatest, Held, skip};
use crate::error::{Error, Result};
use crate::history::{History, redacted};
use crate::time::Instant;

impl Kasten {
    /// Whether a change here is waiting for its commit: typing not yet in
    /// history, or a file changed outside and not yet committed. A file left
    /// out of history for its size is not a waiting change.
    pub(super) fn waiting_here(&self, history: &History) -> bool {
        if !self.state().edits.is_empty() {
            return true;
        }
        let left_out: Vec<String> = skip::read_list(self.root())
            .into_iter()
            .map(|file| file.path)
            .collect();
        match history.dirty() {
            Ok(dirty) => dirty.iter().any(|path| !left_out.contains(path)),
            Err(_) => true,
        }
    }

    /// Why no look can go ahead, whatever the setting says.
    fn pull_blocked(&self, url: &str) -> Option<Held> {
        if self.state().backup.lost_for(url) {
            Some(Held::LostHistory)
        } else if self.unfinished_get_latest() {
            Some(Held::Unfinished)
        } else {
            None
        }
    }

    /// Why a fast-forward must wait: an open page has unsaved edits (told by
    /// the app), or something here is waiting to be committed or backed up.
    fn pull_waits(&self, history: &History, url: &str, unsaved_edits: bool) -> Option<Held> {
        if unsaved_edits {
            Some(Held::UnsavedEdits)
        } else if self.unpushed_for(history, url) > 0 || self.waiting_here(history) {
            Some(Held::WaitingHere)
        } else {
            None
        }
    }

    /// Whether changes from the backup could be taken in by themselves right
    /// now, as far as this computer can tell without looking at the backup:
    /// the setting is automatic, nothing here is waiting (no commit the
    /// backup lacks, no change not yet committed), no Get latest is half done,
    /// and `unsaved_edits` (an open page the app knows is unsaved) is false.
    pub fn can_auto_pull(&self, unsaved_edits: bool) -> bool {
        let Some(history) = self.history.get() else {
            return false;
        };
        let Some(url) = self.confirmed_remote() else {
            return false;
        };
        self.config().get_latest_mode() == GetLatest::Auto
            && self.pull_blocked(&url).is_none()
            && self.pull_waits(history, &url, unsaved_edits).is_none()
    }

    /// Whether the backup is due to be looked at for changes from other
    /// computers: on open (never looked at in this run), then every
    /// `backup.fetch_interval` minutes; never when that is 0 or the setting
    /// is manual. `now` is milliseconds since the Unix epoch.
    pub fn fetch_due(&self, now: u64) -> bool {
        let config = self.config();
        let interval = config.fetch_interval_minutes();
        if interval == 0 || config.get_latest_mode() == GetLatest::Manual {
            return false;
        }
        if self.history.get().is_none() {
            return false;
        }
        let Some(url) = self.confirmed_remote() else {
            return false;
        };
        let state = self.state();
        if state.backup.lost_for(&url) {
            return false;
        }
        state
            .backup
            .last_checked
            .is_none_or(|at| now >= at.saturating_add(interval.saturating_mul(60_000)))
    }

    /// Looks at the backup and, in the automatic setting, takes in what other
    /// computers added, when that is safe. `unsaved_edits` is whether an open
    /// page has edits not yet saved, which only the app knows. Never a merge:
    /// when the two lines of history would have to be joined, or the setting
    /// is to ask, the answer is `Available` and the person decides.
    pub fn auto_pull(&self, now: Instant, unsaved_edits: bool) -> Result<AutoPull> {
        let held = |why| Ok(AutoPull::Held { why });
        let (Some(history), Some(url)) = (self.history.get(), self.confirmed_remote()) else {
            return held(Held::NoBackup);
        };
        let mode = self.config().get_latest_mode();
        if mode == GetLatest::Manual {
            return held(Held::Manual);
        }
        if let Some(why) = self.pull_blocked(&url) {
            return held(why);
        }
        if mode == GetLatest::Auto
            && let Some(why) = self.pull_waits(history, &url, unsaved_edits)
        {
            return held(why);
        }
        let Some(ours) = history.head() else {
            return held(Held::NoBackup);
        };
        let token = self.git_token();
        let hide = |err: Error| redacted(err, token.as_ref());
        // A cheap look first: nothing is fetched when the backup has nothing new.
        let there = history.remote_head(&url, token.as_ref()).map_err(hide)?;
        self.state().backup.last_checked = Some(now.millis);
        let Some(there) = there else {
            return Ok(AutoPull::UpToDate);
        };
        if history.holds(&ours, &there) {
            return Ok(AutoPull::UpToDate);
        }
        let Some(theirs) = history.fetch_latest(&url, token.as_ref()).map_err(hide)? else {
            return Ok(AutoPull::UpToDate);
        };
        self.note_fetched(&url, &theirs);
        if history.holds(&ours, &theirs) {
            return Ok(AutoPull::UpToDate);
        }
        if !history.related(&ours, &theirs)? {
            return held(Held::Unrelated);
        }
        let fast_forward = history.holds(&theirs, &ours);
        if mode == GetLatest::Ask || !fast_forward {
            return Ok(AutoPull::Available {
                merge: !fast_forward,
            });
        }
        match self.take_latest(history, &theirs, now, true)? {
            Some(latest) if latest.outcome == LatestOutcome::FastForward => {
                let files = latest.changed.len();
                let head = latest.head.unwrap_or_default();
                let changes = history.commits_beyond(&head, &[ours.as_str()]);
                Ok(AutoPull::Brought {
                    changes: usize::try_from(changes).unwrap_or(usize::MAX),
                    files,
                    head,
                })
            }
            Some(_) => Ok(AutoPull::UpToDate),
            // Something started waiting between the look and the lock.
            None => held(Held::WaitingHere),
        }
    }
}
