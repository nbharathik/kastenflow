//! What one commit changed, file by file, for undoing an agent session.

use git2::{DiffOptions, Oid};

use super::History;
use super::log::{CommitInfo, info};
use crate::error::Result;

/// One file a commit changed: its bytes before and after (None when it did
/// not exist on that side).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    pub path: String,
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
}

impl History {
    /// The files `rev` changed against its first parent.
    pub fn changes(&self, rev: &str) -> Result<Vec<FileChange>> {
        let repo = self.repo();
        let commit = repo.revparse_single(rev)?.peel_to_commit()?;
        let tree = commit.tree()?;
        let parent = commit.parent(0).ok().map(|p| p.tree()).transpose()?;
        let mut options = DiffOptions::new();
        options.include_typechange(true);
        let diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), Some(&mut options))?;
        let blob = |id: Oid| -> Result<Option<Vec<u8>>> {
            if id.is_zero() {
                return Ok(None);
            }
            Ok(Some(repo.find_blob(id)?.content().to_vec()))
        };
        let mut out = Vec::new();
        for delta in diff.deltas() {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            out.push(FileChange {
                path,
                before: blob(delta.old_file().id())?,
                after: blob(delta.new_file().id())?,
            });
        }
        Ok(out)
    }

    /// The paths `rev` changed against its first parent, without reading any
    /// file (the digest only counts and names them).
    pub fn changed_paths(&self, rev: &str) -> Result<Vec<String>> {
        let repo = self.repo();
        let commit = repo.revparse_single(rev)?.peel_to_commit()?;
        let tree = commit.tree()?;
        let parent = commit.parent(0).ok().map(|p| p.tree()).transpose()?;
        let diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), None)?;
        Ok(diff
            .deltas()
            .filter_map(|delta| {
                delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
            })
            .collect())
    }

    /// The id of the tree at `rev`: equal trees mean equal vault contents.
    pub fn tree_id(&self, rev: &str) -> Result<String> {
        let repo = self.repo();
        let commit = repo.revparse_single(rev)?.peel_to_commit()?;
        Ok(commit.tree_id().to_string())
    }

    /// A commit's details.
    pub fn commit_info(&self, rev: &str) -> Result<CommitInfo> {
        let repo = self.repo();
        let commit = repo.revparse_single(rev)?.peel_to_commit()?;
        Ok(info(&commit))
    }
}
