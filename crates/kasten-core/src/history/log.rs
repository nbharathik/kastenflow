//! Reading history: the commits that touched a note, and a file's text at
//! any commit.

use std::path::Path;

use git2::{Oid, Sort};
use serde::Serialize;

use super::History;
use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    /// The first line of the message.
    pub summary: String,
    pub message: String,
    pub author: String,
    /// Milliseconds since the Unix epoch.
    pub time: u64,
    pub agent: bool,
    /// The agent session, from the `Kasten-Session` trailer.
    pub session: Option<String>,
    /// The op, from the `Kasten-Op` trailer.
    pub op: Option<String>,
    /// Who accepted the agent's proposal, from `Approved-by`.
    pub approved_by: Option<String>,
    /// The agent mode the commit was made in, from `Kasten-Mode` (only
    /// `autonomous` is written; balanced commits carry none).
    pub mode: Option<String>,
    /// The commit this one undoes, from `Kasten-Undo`.
    pub undoes: Option<String>,
    /// It joins two lines of history, as getting the latest does.
    pub merge: bool,
}

/// A commit message's trailer lines: its last paragraph, when it has more
/// than one. Kasten writes a one-line summary, a blank line, then its
/// trailers, so a line of the summary, where titles go, never counts as
/// one.
pub(super) fn trailer_lines(message: &str) -> impl DoubleEndedIterator<Item = &str> {
    message
        .trim_end()
        .rsplit_once("\n\n")
        .map_or("", |(_, last)| last)
        .lines()
}

fn trailer(message: &str, key: &str) -> Option<String> {
    trailer_lines(message)
        .rev()
        .find_map(|line| line.strip_prefix(key).map(|v| v.trim().to_owned()))
}

pub(super) fn info(commit: &git2::Commit) -> CommitInfo {
    let message = commit.message().unwrap_or_default().to_owned();
    let author = commit.author().name().unwrap_or_default().to_owned();
    CommitInfo {
        id: commit.id().to_string(),
        summary: commit
            .summary()
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_owned(),
        agent: author.starts_with("agent:"),
        session: trailer(&message, "Kasten-Session:"),
        op: trailer(&message, "Kasten-Op:"),
        approved_by: trailer(&message, "Approved-by:"),
        mode: trailer(&message, "Kasten-Mode:"),
        undoes: trailer(&message, "Kasten-Undo:"),
        merge: commit.parent_count() > 1,
        message,
        author,
        time: u64::try_from(commit.time().seconds())
            .unwrap_or(0)
            .saturating_mul(1000),
    }
}

/// The trailer a copy of a note carries: the path of the note it was copied from.
pub(crate) const COPY_OF: &str = "Kasten-Copy-Of";

impl CommitInfo {
    /// The note this commit copied (a duplicate), from its `Kasten-Copy-Of` trailer.
    pub fn copy_of(&self) -> Option<String> {
        trailer(&self.message, "Kasten-Copy-Of:").filter(|path| !path.is_empty())
    }
}

/// The most commits (and changes to the file) `first_change` walks back.
const MAKING_WALK: usize = 50_000;

fn entry_id(tree: &git2::Tree, path: &str) -> Option<Oid> {
    tree.get_path(Path::new(path)).ok().map(|e| e.id())
}

impl History {
    /// Commits newest first; with a path, only those that changed it.
    pub fn log(&self, path: Option<&str>, limit: usize) -> Result<Vec<CommitInfo>> {
        let repo = self.repo();
        let mut walk = repo.revwalk()?;
        if walk.push_head().is_err() {
            return Ok(Vec::new());
        }
        // Commits in the same second keep their order: parents after children.
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
        let mut out = Vec::new();
        for id in walk {
            if out.len() >= limit {
                break;
            }
            let commit = repo.find_commit(id?)?;
            if let Some(path) = path {
                let now = entry_id(&commit.tree()?, path);
                let before = match commit.parent(0) {
                    Ok(parent) => entry_id(&parent.tree()?, path),
                    Err(_) => None,
                };
                if now == before {
                    continue;
                }
            }
            out.push(info(&commit));
        }
        Ok(out)
    }

    /// The commit that made the file or folder at `path` as it is now: its
    /// making, whatever was done to it since and wherever it was before a
    /// rename or move (a page a person renamed was still made by whoever made
    /// it). A path a person once used and left, and that someone made again,
    /// is the new making. None if it never was there.
    ///
    /// A file is followed back through renames. When that cannot say (the
    /// making came in with a merge, the walk was cut short, or `path` is a
    /// folder or not there now), the oldest commit that brought `path` in is
    /// the answer.
    pub fn first_change(&self, path: &str) -> Result<Option<CommitInfo>> {
        let want = [super::trail::Want { path, known: None }];
        if let Some(walk) = self.trails(&want, MAKING_WALK, MAKING_WALK)?
            && let Some(trail) = walk.trails.first()
            && trail.end == super::trail::End::Created
            && let Some(step) = trail.steps.last()
            && step.before.is_none()
            && !step.commit.merge
        {
            return Ok(Some(step.commit.clone()));
        }
        self.oldest_change(path)
    }

    /// The oldest commit that brought `path` into the vault (a file, or a
    /// folder), or None if it never was there.
    fn oldest_change(&self, path: &str) -> Result<Option<CommitInfo>> {
        let repo = self.repo();
        let mut walk = repo.revwalk()?;
        if walk.push_head().is_err() {
            return Ok(None);
        }
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME | Sort::REVERSE)?;
        for id in walk {
            let commit = repo.find_commit(id?)?;
            let Some(now) = entry_id(&commit.tree()?, path) else {
                continue;
            };
            let before = match commit.parent(0) {
                Ok(parent) => entry_id(&parent.tree()?, path),
                Err(_) => None,
            };
            if Some(now) != before {
                return Ok(Some(info(&commit)));
            }
        }
        Ok(None)
    }

    /// A file's text at a commit (any revision git understands), or None if
    /// it did not exist there.
    pub fn file_at(&self, rev: &str, path: &str) -> Result<Option<String>> {
        let repo = self.repo();
        let commit = repo.revparse_single(rev)?.peel_to_commit()?;
        let Ok(entry) = commit.tree()?.get_path(Path::new(path)) else {
            return Ok(None);
        };
        let blob = repo.find_blob(entry.id())?;
        Ok(Some(String::from_utf8_lossy(blob.content()).into_owned()))
    }

    /// How many bytes a file held at a commit, read from the object's header
    /// without loading it; None if it did not exist there.
    pub fn blob_len_at(&self, rev: &str, path: &str) -> Result<Option<u64>> {
        let repo = self.repo();
        let commit = repo.revparse_single(rev)?.peel_to_commit()?;
        let Ok(entry) = commit.tree()?.get_path(Path::new(path)) else {
            return Ok(None);
        };
        let (len, _) = repo.odb()?.read_header(entry.id())?;
        Ok(Some(len as u64))
    }

    /// A file's bytes at a commit, or None if it did not exist there.
    pub fn blob_at(&self, rev: &str, path: &str) -> Result<Option<Vec<u8>>> {
        let repo = self.repo();
        let commit = repo.revparse_single(rev)?.peel_to_commit()?;
        let Ok(entry) = commit.tree()?.get_path(Path::new(path)) else {
            return Ok(None);
        };
        Ok(Some(repo.find_blob(entry.id())?.content().to_vec()))
    }

    /// Reads every object in the repository; returns how many there are and
    /// the ones that could not be read (a light `git fsck`).
    pub fn check_objects(&self) -> Result<(usize, Vec<String>)> {
        let repo = self.repo();
        let odb = repo.odb()?;
        let mut ids = Vec::new();
        odb.foreach(|id| {
            ids.push(*id);
            true
        })?;
        let broken = ids
            .iter()
            .filter(|id| odb.read(**id).is_err())
            .map(|id| format!("Object {id} cannot be read"))
            .collect();
        Ok((ids.len(), broken))
    }

    /// The newest commit's id.
    pub fn head(&self) -> Option<String> {
        let repo = self.repo();
        repo.head()
            .ok()
            .and_then(|h| h.target())
            .map(|id| id.to_string())
    }

    /// Every file in a commit, with forward-slash paths.
    pub fn files_at(&self, rev: &str) -> Result<Vec<String>> {
        let repo = self.repo();
        let tree = repo.revparse_single(rev)?.peel_to_commit()?.tree()?;
        let mut out = Vec::new();
        tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                out.push(format!("{dir}{}", entry.name().unwrap_or("")));
            }
            git2::TreeWalkResult::Ok
        })?;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::trailer;

    #[test]
    fn reads_trailers_only_from_the_last_paragraph() {
        let agent = "create: Plan\n\nKasten-Session: s-1\nKasten-Op: create\n";
        assert_eq!(trailer(agent, "Kasten-Session:").as_deref(), Some("s-1"));
        assert_eq!(trailer(agent, "Kasten-Op:").as_deref(), Some("create"));
        let forged = "edit: Seen\nKasten-Session: agent-x\n";
        assert_eq!(trailer(forged, "Kasten-Session:"), None);
        let later = "edit: Seen\n\nKasten-Session: agent-x\n\nMore words\n";
        assert_eq!(trailer(later, "Kasten-Session:"), None);
    }
}
