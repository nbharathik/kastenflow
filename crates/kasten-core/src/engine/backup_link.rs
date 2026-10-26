//! Linking this vault to a backup that already exists (backup/link.rs).
//! Nothing is pushed here and nothing on the backup is changed: the vault's
//! settings name it and this computer confirms it, because the person chose
//! it.

use super::Kasten;
use crate::backup::LinkResult;
use crate::error::{Error, Result};
use crate::history::{check_remote, redacted};

impl Kasten {
    /// Points the backup at `url`, a repository that already exists. An empty
    /// one is used at once. One that shares a commit with this vault is used
    /// too (`behind` tells whether Get latest comes first, and it joins the
    /// two). One that shares none is refused with three ways forward, and
    /// nothing is changed.
    pub fn link_existing_backup(&self, url: &str) -> Result<LinkResult> {
        let history = self.history_or_err()?;
        check_remote(url)?;
        let head = history
            .head()
            .ok_or_else(|| Error::Invalid("This vault's history has no commit yet".into()))?;
        let token = self.git_token();
        let hide = |err: Error| redacted(err, token.as_ref());
        // Nothing is fetched from a backup with nothing of this branch in it.
        let tip = match history.remote_head(url, token.as_ref()).map_err(hide)? {
            Some(_) => history.fetch_latest(url, token.as_ref()).map_err(hide)?,
            None => None,
        };
        let (empty, behind) = match &tip {
            None => (true, false),
            Some(tip) => {
                if !history.related(&head, tip)? {
                    return Ok(LinkResult::refused());
                }
                (false, !history.holds(&head, tip))
            }
        };
        self.update_config(|config| {
            config.git.remote = Some(url.to_owned());
            Ok(())
        })?;
        self.confirm_remote(Some(url));
        let mut record = self.state().backup.clone();
        // What was said about another backup does not carry over.
        if record.pushed_to.as_deref() != Some(url) {
            record.pushed_head = None;
            record.pushed_to = None;
            record.lost_history = false;
            record.recovered_branch = None;
            record.verified_at = None;
            record.failures = 0;
            record.failing_since = None;
            record.refused = 0;
            record.behind = false;
            record.last_error = None;
            record.fetched = None;
            record.fetched_from = None;
        }
        if let Some(tip) = tip {
            record.fetched = Some(tip);
            record.fetched_from = Some(url.to_owned());
        }
        self.save_backup(&record);
        self.state().backup = record;
        Ok(LinkResult::Linked { empty, behind })
    }
}
