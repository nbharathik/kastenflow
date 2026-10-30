//! A backup someone rewrote. If the commit this computer last sent is no
//! longer in the backup's branch (a force push or a reset), pushes stop: the
//! next one could only be refused, or would bury what the other side did.
//! This computer's full history can instead go to a branch of its own, a
//! normal push to a new name, so nothing there is overwritten and nothing is
//! forced.

use crate::error::{Error, Result};
use crate::history::{BEHIND, GitToken, History};

/// Why pushes stopped, and what to do.
pub(crate) const LOST: &str = "The backup no longer holds the history this computer sent it, so nothing was pushed; save this computer's full history to a safety branch first";

/// How many names a day's safety branch tries before giving up.
const TRIES: u32 = 20;

impl History {
    /// Whether the backup's branch no longer holds `pushed`, the commit this
    /// computer last sent it. A branch that is missing is not rewritten: the
    /// next push makes it again. A branch ahead of `pushed` is not either.
    /// When the backup's tip is not in this history, it is fetched into
    /// Kasten's own ref to see where it came from.
    pub fn backup_rewritten(
        &self,
        url: &str,
        token: Option<&GitToken>,
        pushed: &str,
    ) -> Result<bool> {
        let Some(there) = self.remote_head(url, token)? else {
            return Ok(false);
        };
        if self.holds(&there, pushed) {
            return Ok(false);
        }
        if self.knows(&there) {
            return Ok(true);
        }
        match self.fetch_latest(url, token)? {
            Some(fetched) => Ok(!self.holds(&fetched, pushed)),
            None => Ok(false),
        }
    }

    /// Whether `commit` is in this history.
    fn knows(&self, commit: &str) -> bool {
        git2::Oid::from_str(commit)
            .ok()
            .is_some_and(|id| self.repo().find_commit(id).is_ok())
    }

    /// Pushes this computer's newest history to `kasten/recovered-<date>` on
    /// the backup, a new branch. When that name holds other history it tries
    /// `-2`, `-3`, and so on. Answers the branch that was written.
    pub fn push_recovered(
        &self,
        url: &str,
        token: Option<&GitToken>,
        date: &str,
    ) -> Result<String> {
        let local = self.branch()?;
        for n in 1..=TRIES {
            let name = if n == 1 {
                format!("kasten/recovered-{date}")
            } else {
                format!("kasten/recovered-{date}-{n}")
            };
            match self.push_branch_to(url, token, &local, &name) {
                Ok(_) => return Ok(name),
                // Other history already sits under that name: take the next.
                Err(Error::Git(why)) if why == BEHIND => {}
                Err(err) => return Err(err),
            }
        }
        Err(Error::Invalid(
            "There are too many safety branches from today in the backup already".into(),
        ))
    }
}
