//! "Back up now" and what goes with it: a typed answer that is never silence,
//! the early failure notice, and carrying on with a backup that was
//! rewritten, as it is now. Nothing here forces a push or rewrites history.

use super::Kasten;
use crate::backup::recovered::LOST;
use crate::backup::{BackUpNow, BackupNotice, CarryOn, NotBackedUp};
use crate::error::{Error, Result};
use crate::history::{BEHIND, redacted};

fn reason_for(err: &Error) -> NotBackedUp {
    let text = err.to_string();
    if text.contains(BEHIND) {
        NotBackedUp::Behind
    } else if text.contains(LOST) {
        NotBackedUp::LostHistory
    } else {
        NotBackedUp::Failed { message: text }
    }
}

impl Kasten {
    /// Backs up now: waiting typing and outside changes go into history, then
    /// the history is pushed. Always answers: done (and how many changes
    /// went), nothing to do, or the reason nothing was sent.
    pub fn back_up_now(&self, now: u64) -> BackUpNow {
        let not = |reason| BackUpNow::Not { reason };
        let Some(history) = self.history.get() else {
            return not(NotBackedUp::NoHistory);
        };
        // A failure here shows up again below if it matters.
        let _ = self.commit_edits();
        let _ = self.commit_external();
        if self.config().git.remote.is_none() {
            return not(NotBackedUp::NoBackup);
        }
        let Some(url) = self.confirmed_remote() else {
            return not(NotBackedUp::NotConfirmed);
        };
        let lost = self.state().backup.lost_for(&url);
        let sent = self.unpushed_for(history, &url);
        if sent == 0 && !lost {
            return BackUpNow::NothingToDo;
        }
        match self.push(now) {
            Ok(()) => BackUpNow::Done { sent },
            Err(err) => not(reason_for(&err)),
        }
    }

    /// What the person should hear about the backup now, if anything: it has
    /// failed for 6 hours, or a push was refused three times.
    pub fn backup_notice(&self, now: u64) -> Option<BackupNotice> {
        if !self.has_history() || self.config().git.remote.is_none() {
            return None;
        }
        let state = self.state();
        let record = &state.backup;
        BackupNotice::judge(record.failing_since, record.failures, record.refused, now)
    }

    /// Carries on with a backup that was rewritten, as it is now: its newest
    /// commit becomes the one this computer takes the backup to hold, and
    /// pushes start again. Nothing is forced and no history is rewritten: when
    /// the rewritten backup is an older line of this vault, the next push goes
    /// on top of it; when it shares nothing with this vault, the next push is
    /// refused as behind (`can_push` is false) until the person decides.
    pub fn carry_on_with_backup(&self) -> Result<CarryOn> {
        let history = self.history_or_err()?;
        let Some(url) = self.confirmed_remote() else {
            return Err(Error::Invalid(
                "The backup is not confirmed on this computer yet".into(),
            ));
        };
        if !self.state().backup.lost_for(&url) {
            return Err(Error::Invalid(
                "The backup is not stopped, so there is nothing to carry on with".into(),
            ));
        }
        let token = self.git_token();
        let tip = history
            .fetch_latest(&url, token.as_ref())
            .map_err(|err| redacted(err, token.as_ref()))?;
        let can_push = match (&tip, history.head()) {
            (Some(tip), Some(head)) => history.holds(&head, tip),
            _ => true,
        };
        let mut record = self.state().backup.clone();
        record.pushed_head.clone_from(&tip);
        record.pushed_to = Some(url.clone());
        record.fetched.clone_from(&tip);
        record.fetched_from = Some(url);
        record.lost_history = false;
        record.behind = false;
        record.failures = 0;
        record.refused = 0;
        record.failing_since = None;
        record.last_error = None;
        self.save_backup(&record);
        self.state().backup = record;
        Ok(CarryOn { tip, can_push })
    }
}
