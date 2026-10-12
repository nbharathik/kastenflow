//! Reading from a backup: fetching its newest history into a ref of
//! Kasten's own, which only Get latest reads, never the person's branch;
//! a cheap look at where the backup stands; and cloning a backup into an
//! empty folder on a new computer.

use std::fs;
use std::path::Path;

use git2::build::CheckoutBuilder;
use git2::{AutotagOption, Direction, FetchOptions, Oid, RemoteCallbacks, Repository};

use super::auth::{GitToken, credentials};
use super::{BundleHeader, History, check_remote, keep_line_endings};
use crate::error::{Error, Result};
use crate::id::ulid_at;
use crate::time::Instant;

/// Where a fetched backup's history waits for Get latest.
pub(crate) const LATEST_REF: &str = "refs/kasten/latest";

fn callbacks<'a>(config: &'a git2::Config, token: Option<&'a GitToken>) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    let mut attempts = 0;
    callbacks.credentials(move |url, username, allowed| {
        attempts += 1;
        credentials(config, url, username, allowed, token, attempts)
    });
    callbacks
}

/// The id `name` has on the remote, from the list of its refs.
fn listed(heads: &[git2::RemoteHead<'_>], name: &str) -> Option<Oid> {
    heads
        .iter()
        .find(|head| head.name() == name)
        .map(|head| head.oid())
}

/// The branch a new computer takes from a backup: the one its HEAD names,
/// else `main`, else the first there is.
fn branch_to_take(heads: &[git2::RemoteHead<'_>], default: Option<String>) -> Option<String> {
    default
        .into_iter()
        .chain(["refs/heads/main".to_owned()])
        .find(|name| listed(heads, name).is_some())
        .or_else(|| {
            heads
                .iter()
                .map(|head| head.name())
                .find(|name| name.starts_with("refs/heads/"))
                .map(str::to_owned)
        })
}

impl History {
    /// Where the backup's copy of this vault's branch stands, without
    /// fetching anything: None when the backup has no such branch yet.
    pub fn remote_head(&self, url: &str, token: Option<&GitToken>) -> Result<Option<String>> {
        check_remote(url)?;
        let branch = format!("refs/heads/{}", self.branch()?);
        let repo = self.own_repo()?;
        let config = super::auth::machine_config()?;
        let mut remote = repo.remote_anonymous(url)?;
        let connection =
            remote.connect_auth(Direction::Fetch, Some(callbacks(&config, token)), None)?;
        Ok(listed(connection.list()?, &branch).map(|id| id.to_string()))
    }

    /// Fetches the backup's copy of this vault's branch into Kasten's own
    /// ref, never the person's branch. Answers what it fetched, or None
    /// when the backup has no such branch yet.
    pub fn fetch_latest(&self, url: &str, token: Option<&GitToken>) -> Result<Option<String>> {
        check_remote(url)?;
        let branch = format!("refs/heads/{}", self.branch()?);
        let repo = self.own_repo()?;
        let config = super::auth::machine_config()?;
        let mut remote = repo.remote_anonymous(url)?;
        let there = {
            let connection =
                remote.connect_auth(Direction::Fetch, Some(callbacks(&config, token)), None)?;
            listed(connection.list()?, &branch)
        };
        let Some(there) = there else {
            return Ok(None);
        };
        let mut options = FetchOptions::new();
        options.remote_callbacks(callbacks(&config, token));
        options.download_tags(AutotagOption::None);
        // Kasten's own ref, which only Get latest reads: a fetch may move
        // it any way, as git moves a remote-tracking branch.
        let refspec = format!("+{branch}:{LATEST_REF}");
        remote.fetch(&[refspec.as_str()], Some(&mut options), None)?;
        let fetched = repo.refname_to_id(LATEST_REF)?;
        if fetched != there {
            return Err(Error::Git(
                "The backup changed while it was read; try again".into(),
            ));
        }
        Ok(Some(fetched.to_string()))
    }

    /// Puts a backup file's history into Kasten's own ref, as a fetch
    /// would, for getting the latest from a file.
    pub fn fetch_bundle(&self, path: &Path) -> Result<String> {
        let repo = self.own_repo()?;
        let header = super::bundle::index_into(&repo, path)?;
        let head = Oid::from_str(&header.head)?;
        super::bundle::read_all(&repo, head)?;
        repo.reference(LATEST_REF, head, true, "latest: from a backup file")?;
        Ok(header.head)
    }
}

/// Clones a backup remote into `target`, which must be missing or an
/// empty folder, for a new computer. The vault is built in a hidden
/// folder beside it and moved into place only when whole.
pub fn clone_backup(url: &str, token: Option<&GitToken>, target: &Path) -> Result<BundleHeader> {
    check_remote(url)?;
    if target.exists() && fs::read_dir(target)?.next().is_some() {
        return Err(Error::Invalid(format!(
            "{} has files in it. Restore into an empty folder, so nothing there is overwritten",
            target.display()
        )));
    }
    let parent = target
        .parent()
        .ok_or_else(|| Error::Invalid("Restore into a folder inside another one".into()))?;
    fs::create_dir_all(parent)?;
    let work = parent.join(format!(
        ".kasten-restore-{}",
        ulid_at(Instant::now().millis)
    ));
    let built = (|| {
        let repo = Repository::init(&work)?;
        keep_line_endings(&repo)?;
        // A link in the backup is written as a plain file: it never points
        // outside the vault.
        repo.config()?.set_bool("core.symlinks", false)?;
        let config = super::auth::machine_config()?;
        let mut remote = repo.remote_anonymous(url)?;
        let branch = {
            let connection =
                remote.connect_auth(Direction::Fetch, Some(callbacks(&config, token)), None)?;
            let default = connection
                .default_branch()
                .ok()
                .and_then(|name| name.as_str().ok().map(str::to_owned));
            branch_to_take(connection.list()?, default)
                .ok_or_else(|| Error::Invalid("This backup holds no notes yet".into()))?
        };
        let short = branch
            .strip_prefix("refs/heads/")
            .filter(|b| git2::Reference::is_valid_name(&format!("refs/heads/{b}")))
            .ok_or_else(|| {
                Error::Invalid("The backup's branch has a name KastenFlow can't use".into())
            })?
            .to_owned();
        let mut options = FetchOptions::new();
        options.remote_callbacks(callbacks(&config, token));
        options.download_tags(AutotagOption::None);
        // Into a branch that does not exist yet: nothing to overwrite.
        let refspec = format!("{branch}:{branch}");
        remote.fetch(&[refspec.as_str()], Some(&mut options), None)?;
        let head = repo.refname_to_id(&branch)?;
        repo.set_head(&branch)?;
        // The folder is new and empty: nothing there to keep.
        repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
        Ok(BundleHeader {
            head: head.to_string(),
            branch: short,
        })
    })();
    let header = match built {
        Ok(header) => header,
        Err(err) => {
            // Only the hidden folder this restore made.
            let _ = fs::remove_dir_all(&work);
            return Err(err);
        }
    };
    if target.exists() {
        // Checked empty above; remove_dir removes only an empty folder.
        fs::remove_dir(target)?;
    }
    fs::rename(&work, target)?;
    Ok(header)
}
