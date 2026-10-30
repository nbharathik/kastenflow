//! Off-site backup: pushing to the private remote, never forcing, and the
//! status the status bar shows.

use git2::{PushOptions, RemoteCallbacks};
use serde::Serialize;

use super::auth::{GitToken, credentials};
use super::{History, check_remote};
use crate::backup::{BackupNotice, LargeFile, SkippedFile};
use crate::error::{Error, Result};

/// How the backup stands, for the status bar dot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupState {
    /// No remote set up, or no history.
    Off,
    /// Pushed within a day.
    Ok,
    /// Last push over 24 hours ago.
    Stale,
    /// Over 72 hours without a push, or the backup has failed for 6 hours or
    /// refused three pushes (`BackupStatus::notice`).
    Failing,
    /// The config names a remote that no one confirmed on this computer,
    /// so nothing is pushed yet.
    Unconfirmed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub state: BackupState,
    /// Milliseconds since the Unix epoch.
    pub last_push: Option<u64>,
    pub failures: u32,
    pub last_error: Option<String>,
    /// The last push was refused because the backup has changes this
    /// computer lacks: Get latest first.
    pub behind: bool,
    /// Local commits the backup lacks.
    pub unpushed: u32,
    /// Changes are waiting to go to the backup.
    pub waiting: bool,
    /// The backup no longer holds history this computer sent it (it was
    /// rewritten): pushes have stopped.
    pub lost_history: bool,
    /// The safety branch this computer's full history was last saved to.
    pub recovered_branch: Option<String>,
    /// Files left out of history for their size (over 100 MiB).
    pub skipped: Vec<SkippedFile>,
    /// Files in history at 50 MiB or more.
    pub warn: Vec<LargeFile>,
    /// Bytes the history takes on this computer, when known.
    pub repo_size: Option<u64>,
    /// When the weekly check last found the backup whole (milliseconds since
    /// the Unix epoch).
    pub verified_at: Option<u64>,
    /// Something the person should hear now: the backup has failed for 6
    /// hours, or a push was refused three times.
    pub notice: Option<BackupNotice>,
}

const DAY: u64 = 24 * 60 * 60 * 1000;

/// Why a push over newer changes is refused, and what to do.
pub(crate) const BEHIND: &str = "The backup has changes this computer doesn't have yet, so nothing was pushed; get the latest first";

impl BackupStatus {
    pub fn judge(
        remote: bool,
        last_push: Option<u64>,
        failures: u32,
        last_error: Option<String>,
        now: u64,
    ) -> BackupStatus {
        let state = match (remote, last_push) {
            (false, _) => BackupState::Off,
            _ if failures >= 3 => BackupState::Failing,
            (true, None) => {
                if failures > 0 {
                    BackupState::Failing
                } else {
                    BackupState::Stale
                }
            }
            (true, Some(at)) if now.saturating_sub(at) > 3 * DAY => BackupState::Failing,
            (true, Some(at)) if now.saturating_sub(at) > DAY => BackupState::Stale,
            (true, Some(_)) => BackupState::Ok,
        };
        BackupStatus {
            state,
            last_push,
            failures,
            last_error,
            behind: false,
            unpushed: 0,
            waiting: false,
            lost_history: false,
            recovered_branch: None,
            skipped: Vec::new(),
            warn: Vec::new(),
            repo_size: None,
            verified_at: None,
            notice: None,
        }
    }
}

impl History {
    /// A handle of its own for work on the network, so the shared one, which
    /// every commit needs, is never held while the network is slow.
    pub(super) fn own_repo(&self) -> Result<git2::Repository> {
        super::folder::has_git_folder(&self.root)?;
        let path = self.repo().path().to_owned();
        let repo = git2::Repository::open(path)?;
        // Neither helper programs nor TLS/proxy settings come from a vault.
        repo.set_config(&super::auth::machine_config()?)?;
        Ok(repo)
    }

    /// Checks the remote answers, without changing anything there.
    pub fn reach(&self, url: &str) -> Result<()> {
        self.reach_as(url, None)
    }

    /// `reach`, signing in with `token` where it is for that server.
    pub fn reach_as(&self, url: &str, token: Option<&GitToken>) -> Result<()> {
        check_remote(url)?;
        let repo = self.own_repo()?;
        let config = repo.config()?;
        let mut remote = repo.remote_anonymous(url)?;
        let mut callbacks = RemoteCallbacks::new();
        let mut attempts = 0;
        callbacks.credentials(move |url, username, allowed| {
            attempts += 1;
            credentials(&config, url, username, allowed, token, attempts)
        });
        let connection = remote.connect_auth(git2::Direction::Fetch, Some(callbacks), None)?;
        drop(connection);
        Ok(())
    }

    /// Pushes the current branch to `url`. A remote that has commits this
    /// vault lacks is left alone and the push fails.
    pub fn push(&self, url: &str) -> Result<Option<String>> {
        self.push_as(url, None)
    }

    /// `push`, signing in with `token` where it is for that server.
    pub fn push_as(&self, url: &str, token: Option<&GitToken>) -> Result<Option<String>> {
        let branch = self.branch()?;
        self.push_branch_to(url, token, &branch, &branch)
    }

    /// Pushes the local branch `local` to the branch `remote` on `url`. Never
    /// forced: a branch that holds other history is left alone and the push
    /// fails.
    pub(crate) fn push_branch_to(
        &self,
        url: &str,
        token: Option<&GitToken>,
        local: &str,
        remote: &str,
    ) -> Result<Option<String>> {
        check_remote(url)?;
        let repo = self.own_repo()?;
        let config = repo.config()?;
        let mut connection = repo.remote_anonymous(url)?;
        let mut attempts = 0;
        let mut rejected: Option<String> = None;
        // The commit that went, which a commit made during the upload is not.
        let mut sent = self.head();
        {
            let mut callbacks = RemoteCallbacks::new();
            callbacks.credentials(|url, username, allowed| {
                attempts += 1;
                credentials(&config, url, username, allowed, token, attempts)
            });
            callbacks.push_update_reference(|name, status| {
                if let Some(why) = status {
                    rejected = Some(format!("{name}: {why}"));
                }
                Ok(())
            });
            callbacks.push_negotiation(|updates| {
                if let Some(update) = updates.first() {
                    sent = Some(update.dst().to_string());
                }
                Ok(())
            });
            let mut options = PushOptions::new();
            options.remote_callbacks(callbacks);
            // No leading `+`: a non-fast-forward push is refused, never forced.
            let refspec = format!("refs/heads/{local}:refs/heads/{remote}");
            match connection.push(&[refspec.as_str()], Some(&mut options)) {
                Err(err) if err.code() == git2::ErrorCode::NotFastForward => {
                    return Err(Error::Git(BEHIND.into()));
                }
                pushed => pushed?,
            }
        }
        match rejected {
            Some(why) if why.contains("fast-forward") || why.contains("fetch first") => {
                Err(Error::Git(BEHIND.into()))
            }
            Some(why) => Err(Error::Git(format!("The remote refused the push ({why})"))),
            None => Ok(sent),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn judges_backup_age_and_failures() {
        let now = 10 * DAY;
        let judge =
            |remote, last, failures| BackupStatus::judge(remote, last, failures, None, now).state;
        assert_eq!(judge(false, None, 0), BackupState::Off);
        assert_eq!(judge(true, Some(now - 1000), 0), BackupState::Ok);
        assert_eq!(judge(true, Some(now - 2 * DAY), 0), BackupState::Stale);
        assert_eq!(judge(true, Some(now - 4 * DAY), 0), BackupState::Failing);
        assert_eq!(judge(true, Some(now - 1000), 3), BackupState::Failing);
        assert_eq!(judge(true, None, 0), BackupState::Stale);
    }
}
