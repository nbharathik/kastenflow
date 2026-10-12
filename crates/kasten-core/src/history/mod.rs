//! The vault's git history. Every op commits the
//! paths it touched; human edits are batched, agent ops commit at once with
//! their session in trailers. History is only ever added to: nothing here
//! amends, rebases, resets or force-pushes.

mod auth;
mod bundle;
mod changes;
mod fetch;
mod folder;
mod locks;
mod log;
pub(crate) mod merging;
mod push;
mod remote;
mod trail;
mod worktree;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use git2::{
    IndexAddOption, Repository, RepositoryInitOptions, RepositoryOpenFlags, Signature,
    StatusOptions,
};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub use auth::{GitToken, SignIn, choose, https_origin, redact, redacted};
pub use bundle::{BundleHeader, read_bundle_header, restore_from_bundle, verify_bundle};
pub use changes::FileChange;
pub use fetch::clone_backup;
pub(crate) use folder::local_only;
use folder::{exclude_local, has_git_folder, ignore_local, stays_inside};
use locks::Writing;
pub use log::CommitInfo;
pub(crate) use push::BEHIND;
pub use push::{BackupState, BackupStatus};
pub use remote::check_remote;
pub(crate) use trail::{End, Want};
pub(crate) use worktree::blob_id;

/// Who made a change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Actor {
    Human,
    /// An agent through MCP or the in-app chat, in one session.
    Agent {
        client: String,
        session: String,
    },
    /// An agent's proposal that a person accepted: committed as the agent's
    /// change, with an `Approved-by` trailer.
    Approved {
        client: String,
        session: String,
        by: String,
    },
}

impl Actor {
    pub fn is_agent(&self) -> bool {
        matches!(self, Actor::Agent { .. } | Actor::Approved { .. })
    }

    /// The agent session, for agents.
    pub fn session(&self) -> Option<&str> {
        match self {
            Actor::Human => None,
            Actor::Agent { session, .. } | Actor::Approved { session, .. } => Some(session),
        }
    }
}

impl From<git2::Error> for Error {
    fn from(err: git2::Error) -> Self {
        Error::Git(err.message().to_owned())
    }
}

pub struct History {
    repo: Mutex<Repository>,
    root: PathBuf,
}

impl std::fmt::Debug for History {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("History").field("root", &self.root).finish()
    }
}

impl History {
    /// The vault's own repository, if it has one. A repository further up
    /// (the vault inside another project) is never used, and neither is
    /// one whose files are anywhere but in the vault's plain `.git` folder.
    pub fn open(root: &Path) -> Result<Option<History>> {
        if !has_git_folder(root)? {
            return Ok(None);
        }
        let repo = open_here(root)?;
        stays_inside(&repo, root)?;
        // Best effort: `dirty` leaves the local files out regardless.
        let _ = exclude_local(root);
        let _ = keep_line_endings(&repo);
        Ok(Some(History {
            repo: Mutex::new(repo),
            root: root.to_owned(),
        }))
    }

    /// Starts history for a vault: a repository on `main`, the cache ignored,
    /// and a first commit of everything there.
    pub fn init(root: &Path, name: &str) -> Result<History> {
        // A repository made since the vault opened is checked before git
        // writes to it.
        if has_git_folder(root)?
            && let Ok(found) = open_here(root)
        {
            stays_inside(&found, root)?;
        }
        let repo = Repository::init_opts(root, RepositoryInitOptions::new().initial_head("main"))?;
        stays_inside(&repo, root)?;
        keep_line_endings(&repo)?;
        ignore_local(root)?;
        let history = History {
            repo: Mutex::new(repo),
            root: root.to_owned(),
        };
        {
            let repo = history.repo();
            let mut index = repo.index()?;
            index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
            index.write()?;
        }
        history.commit_index(&format!("init: {name}"), &Actor::Human, "init", &[])?;
        Ok(history)
    }

    fn repo(&self) -> MutexGuard<'_, Repository> {
        self.repo
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Commits the current state of `paths` (added, changed or gone).
    /// Returns the new commit's id, or None when nothing changed.
    pub fn commit(
        &self,
        paths: &[String],
        message: &str,
        actor: &Actor,
        op: &str,
    ) -> Result<Option<String>> {
        self.commit_with(paths, message, actor, op, &[])
    }

    /// `commit` with extra trailers, such as `Kasten-Undo`.
    pub fn commit_with(
        &self,
        paths: &[String],
        message: &str,
        actor: &Actor,
        op: &str,
        trailers: &[(&str, String)],
    ) -> Result<Option<String>> {
        self.clear_stale_locks();
        let _writing = Writing::start(&self.root);
        {
            let repo = self.repo();
            let mut index = repo.index()?;
            for path in paths.iter().filter(|p| !local_only(p)) {
                let rel = Path::new(path);
                if self.root.join(rel).is_file() {
                    index.add_path(rel)?;
                } else if index.get_path(rel, 0).is_some() {
                    index.remove_path(rel)?;
                }
            }
            index.write()?;
        }
        self.commit_index(message, actor, op, trailers)
    }

    /// A commit that changes no file, recording a decision in its trailers
    /// (an undo whose change was already reverted by hand).
    pub fn commit_marker(
        &self,
        message: &str,
        actor: &Actor,
        op: &str,
        trailers: &[(&str, String)],
    ) -> Result<Option<String>> {
        self.clear_stale_locks();
        let _writing = Writing::start(&self.root);
        self.write_commit(message, actor, op, trailers, true)
    }

    fn commit_index(
        &self,
        message: &str,
        actor: &Actor,
        op: &str,
        trailers: &[(&str, String)],
    ) -> Result<Option<String>> {
        self.write_commit(message, actor, op, trailers, false)
    }

    fn write_commit(
        &self,
        message: &str,
        actor: &Actor,
        op: &str,
        trailers: &[(&str, String)],
        empty: bool,
    ) -> Result<Option<String>> {
        let repo = self.repo();
        let mut index = repo.index()?;
        let tree_id = index.write_tree()?;
        let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        if !empty && head.as_ref().is_some_and(|h| h.tree_id() == tree_id) {
            return Ok(None);
        }
        let tree = repo.find_tree(tree_id)?;
        let signature = signature(&repo, actor)?;
        let parents: Vec<&git2::Commit> = head.iter().collect();
        let id = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &full_message(message, actor, op, trailers),
            &tree,
            &parents,
        )?;
        Ok(Some(id.to_string()))
    }

    /// Paths that differ from the last commit, ignored files aside.
    pub fn dirty(&self) -> Result<Vec<String>> {
        let repo = self.repo();
        let mut options = StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);
        let statuses = repo.statuses(Some(&mut options))?;
        let mut out: Vec<String> = statuses
            .iter()
            .filter_map(|e| e.path().ok().map(str::to_owned))
            .filter(|p| !local_only(p))
            .collect();
        out.sort();
        out.dedup();
        Ok(out)
    }

    /// Stops tracking local files an earlier version committed, keeping
    /// them on disk: one commit, or None when none are tracked.
    pub fn untrack_local(&self) -> Result<Option<String>> {
        self.clear_stale_locks();
        let _writing = Writing::start(&self.root);
        {
            let repo = self.repo();
            let mut index = repo.index()?;
            let tracked: Vec<String> = index
                .iter()
                .filter_map(|e| String::from_utf8(e.path).ok())
                .filter(|p| local_only(p))
                .collect();
            if tracked.is_empty() {
                return Ok(None);
            }
            for path in &tracked {
                index.remove_path(Path::new(path))?;
            }
            index.write()?;
        }
        self.commit_index(
            "untrack: KastenFlow's cache, which belongs to this computer",
            &Actor::Human,
            "untrack",
            &[],
        )
    }

    /// The checked-out branch.
    pub fn branch(&self) -> Result<String> {
        let repo = self.repo();
        let head = repo.head()?;
        Ok(head.shorthand().unwrap_or("main").to_owned())
    }
}

/// Settings each vault's own git needs, whatever the computer's git says:
///
/// - line endings kept as they are written: Git for Windows converts them
///   for everyone by default, and a restore or a merge would then rewrite
///   every note's;
/// - commits and branches flushed to disk as they are written, so a power
///   cut can't leave history pointing at objects that never reached it;
/// - paths longer than Windows' old 260-character limit.
pub(crate) fn keep_line_endings(repo: &Repository) -> Result<()> {
    let mut local = repo.config()?.open_level(git2::ConfigLevel::Local)?;
    for (key, value) in [
        ("core.autocrlf", false),
        ("core.fsyncObjectFiles", true),
        ("core.longpaths", true),
    ] {
        if local.get_bool(key).ok() != Some(value) {
            local.set_bool(key, value)?;
        }
    }
    Ok(())
}

/// The repository at `root` itself, never one further up.
fn open_here(root: &Path) -> Result<Repository> {
    Ok(Repository::open_ext(
        root,
        RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&std::ffi::OsStr>(),
    )?)
}

fn signature(repo: &Repository, actor: &Actor) -> Result<Signature<'static>> {
    Ok(match actor {
        Actor::Agent { client, .. } | Actor::Approved { client, .. } => {
            Signature::now(&format!("agent:{client}"), "agent@kasten.local")?
        }
        Actor::Human => {
            let config = repo.config().ok();
            let get = |key: &str| {
                config
                    .as_ref()
                    .and_then(|c| c.get_string(key).ok())
                    .filter(|v: &String| !v.trim().is_empty())
            };
            let name = get("user.name").unwrap_or_else(|| "Kasten".to_owned());
            let email = get("user.email").unwrap_or_else(|| "kasten@localhost".to_owned());
            Signature::now(&name, &email)?
        }
    })
}

/// The commit message: agent commits carry their session and op as
/// trailers, accepted proposals who approved them, and undo commits what
/// they undo.
fn full_message(message: &str, actor: &Actor, op: &str, extra: &[(&str, String)]) -> String {
    // One line, whatever a title or path in it holds, so nothing in it can
    // pass for a trailer.
    let summary: String = message
        .trim()
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let mut trailers: Vec<(&str, String)> = match actor {
        Actor::Human => vec![],
        Actor::Agent { session, .. } => {
            vec![
                ("Kasten-Session", session.clone()),
                ("Kasten-Op", op.to_owned()),
            ]
        }
        Actor::Approved { session, by, .. } => vec![
            ("Kasten-Session", session.clone()),
            ("Kasten-Op", op.to_owned()),
            ("Approved-by", by.clone()),
        ],
    };
    trailers.extend(extra.iter().cloned());
    if trailers.is_empty() {
        return format!("{summary}\n");
    }
    let lines: String = trailers
        .iter()
        .map(|(k, v)| format!("{k}: {}\n", v.replace(['\n', '\r'], " ")))
        .collect();
    format!("{summary}\n\n{lines}")
}
