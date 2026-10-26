//! A smart page's code folder put back as an earlier version had it: the
//! person's "Restore earlier version" in the page's History. It is a new
//! commit on top (Undo takes it back whole); the versions under it stay.

use super::ops::title_of;
use super::restore::when;
use super::smart::person_only;
use super::{Change, Kasten};
use crate::error::Result;
use crate::history::Actor;
use crate::smart::ops::{self, Restored};
use crate::time::Instant;

impl Kasten {
    /// Puts the code folder of the smart page at `page` back as it was at the
    /// commit `rev` (a version listed by `log` for the folder). Files the
    /// version held come back byte for byte; files added since go to the
    /// trash. The page's own text is not touched. Person only.
    pub fn smart_restore_version(
        &self,
        actor: &Actor,
        page: &str,
        rev: &str,
        now: Instant,
    ) -> Result<Restored> {
        person_only(actor)?;
        let history = self.history_or_err()?;
        // Anything typed or changed outside is committed first, so the
        // version it replaces stays in history.
        self.commit_edits()?;
        self.commit_external()?;
        let label = when(history, rev);
        let (mut restored, commit) = self.apply_committing(
            actor,
            "smart_restore_version",
            false,
            now.millis,
            &[],
            |vault| {
                let restored = ops::restore_folder(vault, history, page, rev, now)?;
                let mut paths = restored.written.clone();
                paths.extend(restored.removed.iter().cloned());
                paths.extend(restored.trashed.iter().cloned());
                Ok(Change {
                    message: format!("restore: the code of {} to {label}", title_of(vault, page)),
                    paths,
                    value: restored,
                })
            },
        )?;
        restored.commit = commit;
        Ok(restored)
    }
}
