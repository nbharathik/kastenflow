//! What the backup's status adds to the record of the last push: the number
//! of local commits the backup lacks, backed-up files large enough for GitHub
//! to warn about, and how big the local history is. All three come from the
//! repository on this computer; nothing here uses the network.

use std::fs;
use std::path::Path;

use git2::Oid;

use super::skip::{LargeFile, WARN_LIMIT};
use crate::history::{History, local_only};

/// Counted from the repository, so the status keeps them while the newest
/// commit and the last commit pushed stay as they are.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BackupExtras {
    /// Local commits not in the backup's branch (as far as this computer
    /// last sent it).
    pub unpushed: u32,
    /// Files in history at 50 MiB or more.
    pub warn: Vec<LargeFile>,
    /// Bytes the history takes on this computer.
    pub repo_size: Option<u64>,
}

impl History {
    /// The commits reachable from the newest that none of `known` (commits
    /// the backup is known to hold: the last one sent, the last one fetched)
    /// reaches: every commit when none is in this history.
    pub fn unpushed_since(&self, known: &[&str]) -> u32 {
        match self.head() {
            Some(head) => self.commits_beyond(&head, known),
            None => 0,
        }
    }

    /// The commits `tip` reaches that none of `known` reaches. When they
    /// cannot be counted, everything counts as waiting (`u32::MAX`): a count
    /// that fails must never read as "nothing is waiting", which lets Get
    /// latest go ahead by itself.
    pub fn commits_beyond(&self, tip: &str, known: &[&str]) -> u32 {
        let Ok(tip) = Oid::from_str(tip) else {
            return u32::MAX;
        };
        let repo = self.repo();
        let Ok(mut walk) = repo.revwalk() else {
            return u32::MAX;
        };
        if walk.push(tip).is_err() {
            return u32::MAX;
        }
        for known in known.iter().filter_map(|k| Oid::from_str(k).ok()) {
            // An unknown commit hides nothing: all of it is waiting.
            let _ = walk.hide(known);
        }
        u32::try_from(walk.count()).unwrap_or(u32::MAX)
    }

    /// Files in the newest commit's index at 50 MiB or more, largest first.
    pub fn large_files(&self) -> Vec<LargeFile> {
        let repo = self.repo();
        let Ok(index) = repo.index() else {
            return Vec::new();
        };
        let mut found: Vec<LargeFile> = index
            .iter()
            .filter(|entry| u64::from(entry.file_size) >= WARN_LIMIT)
            .filter_map(|entry| {
                let path = String::from_utf8(entry.path).ok()?;
                (!local_only(&path)).then_some(LargeFile {
                    path,
                    size: u64::from(entry.file_size),
                })
            })
            .collect();
        found.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.path.cmp(&b.path)));
        found
    }

    /// Bytes of the history's objects on this computer, when they can be read.
    pub fn history_size(&self) -> Option<u64> {
        let objects = self.repo().path().join("objects");
        weigh(&objects)
    }

    /// All three counts, for a status.
    pub fn extras(&self, known: &[&str]) -> BackupExtras {
        BackupExtras {
            unpushed: self.unpushed_since(known),
            warn: self.large_files(),
            repo_size: self.history_size(),
        }
    }
}

/// The bytes of every file below `dir`; None when `dir` cannot be read.
fn weigh(dir: &Path) -> Option<u64> {
    let mut total = 0u64;
    let mut pending = vec![dir.to_owned()];
    let mut first = true;
    while let Some(next) = pending.pop() {
        let entries = match fs::read_dir(&next) {
            Ok(entries) => entries,
            Err(_) if first => return None,
            Err(_) => continue,
        };
        first = false;
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file()
                && let Ok(meta) = entry.metadata()
            {
                total = total.saturating_add(meta.len());
            }
        }
    }
    Some(total)
}
