//! The lock files git takes in `.git`, and the ones a killed process left.

use std::path::{Path, PathBuf};

use super::History;

/// How long after Kasten's mark a lock can have been taken by the write
/// the mark belongs to. A lock taken later is another program's.
const WRITE_SPAN: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// File times on some file systems are two seconds apart.
const COARSE: std::time::Duration = std::time::Duration::from_secs(2);

/// Kasten's mark while it writes to git, in its own cache: a lock file
/// found beside it was left by a Kasten process killed mid-write.
const WRITING_MARK: &str = ".kasten/cache/git-writing";

/// Marks Kasten writing to git until dropped; a killed process leaves it.
pub(super) struct Writing(PathBuf);

impl Writing {
    pub(super) fn start(root: &Path) -> Writing {
        let mark = root.join(WRITING_MARK);
        if let Some(dir) = mark.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&mark, "");
        Writing(mark)
    }
}

impl Drop for Writing {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

impl History {
    /// The lock files git takes while it writes the index and the branch.
    fn lock_files(&self) -> Vec<PathBuf> {
        let git = self.root.join(".git");
        let mut locks = vec![git.join("index.lock"), git.join("HEAD.lock")];
        if let Ok(branch) = self.branch() {
            locks.push(git.join("refs/heads").join(format!("{branch}.lock")));
        }
        locks
    }

    /// Removes the lock files a Kasten process killed mid-write left in
    /// `.git`, known by its mark: only those taken while that write was
    /// under way. Any other program's lock is left alone, however old: a
    /// git command run by hand holds its lock as long as it runs, `git
    /// commit` waiting on its editor or `git add -p`. Kasten writes to git
    /// only under the vault's write lock, so its mark is never a live
    /// process's.
    ///
    /// Only for code that holds the vault's write lock: the mark of a
    /// writer at work looks the same as one a killed process left, and the
    /// write lock is what tells them apart. A read (the health report) must
    /// never call this; it asks `held_by_readonly`.
    pub(super) fn clear_stale_locks(&self) {
        let mark = self.root.join(WRITING_MARK);
        let Some(marked) = modified(&mark) else {
            return;
        };
        for lock in self.lock_files() {
            if taken_in_the_write(&lock, marked) {
                let _ = std::fs::remove_file(&lock);
            }
        }
        let _ = std::fs::remove_file(&mark);
    }

    /// The first lock file in `.git` that a git command run by hand could
    /// hold: one that is there and was not taken by a Kasten write (by its
    /// mark). Changes nothing.
    fn foreign_lock(&self) -> Option<String> {
        let marked = modified(&self.root.join(WRITING_MARK));
        self.lock_files()
            .into_iter()
            .filter(|lock| lock.exists())
            .find(|lock| marked.is_none_or(|marked| !taken_in_the_write(lock, marked)))
            .and_then(|lock| {
                lock.strip_prefix(&self.root)
                    .ok()
                    .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            })
    }

    /// `held_by_readonly`'s wait: a lock that goes within a moment was a
    /// short command's.
    fn foreign_lock_after_a_moment(&self) -> Option<String> {
        for _ in 0..4 {
            self.foreign_lock()?;
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        self.foreign_lock()
    }

    /// The lock file a git command run by hand holds now, as the vault
    /// names it, after a moment's wait for a short one to finish. Removes
    /// nothing, so it is safe beside a writer at work: a lock Kasten took
    /// for its own write (its mark is there) is not reported, and one a
    /// killed process left is left for the next op to clear.
    pub fn held_by_readonly(&self) -> Option<String> {
        self.foreign_lock_after_a_moment()
    }

    /// `held_by_readonly` after clearing the locks a killed Kasten process
    /// left. For an op that holds the vault's write lock, before it writes.
    pub fn held_by(&self) -> Option<String> {
        self.clear_stale_locks();
        self.foreign_lock_after_a_moment()
    }

    /// The error for an op held back by a git command at work.
    pub(crate) fn busy_error(lock: &str) -> crate::error::Error {
        crate::error::Error::Git(format!(
            "A git command is working in this vault's history (it holds {lock}); try again when it is done. If no git command is running, delete {lock} and try again"
        ))
    }

    /// Whether a git command run by hand holds the history now. Changes
    /// nothing.
    pub fn busy(&self) -> bool {
        self.held_by_readonly().is_some()
    }
}

/// Whether `lock` was taken by the write whose mark was made at `marked`.
fn taken_in_the_write(lock: &Path, marked: std::time::SystemTime) -> bool {
    let from = marked.checked_sub(COARSE).unwrap_or(marked);
    let until = marked + WRITE_SPAN;
    modified(lock).is_some_and(|taken| taken >= from && taken <= until)
}

fn modified(path: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
}
