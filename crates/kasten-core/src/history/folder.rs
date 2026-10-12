//! Where history lives: a plain `.git` folder inside the vault whose files
//! all stay there, and which never takes in the files that belong to this
//! computer alone.

use std::path::Path;

use git2::Repository;

use crate::error::{Error, Result};

/// The ignore lines for the files that belong to this computer.
const LOCAL_FILES: &str = ".kasten/cache/\n.kasten/write.lock\n.kasten-*.tmp\n";

/// Kasten's files that belong to this computer, never to history: the
/// cache (the index, with every note's text, and the MCP token), the
/// write lock, and a temporary file a write stopped half way left.
pub(crate) fn local_only(path: &str) -> bool {
    path.starts_with(".kasten/cache/")
        || path == ".kasten/write.lock"
        || path
            .rsplit('/')
            .next()
            .is_some_and(crate::atomic::is_temp_name)
}

/// Whether the vault has a `.git` of its own. It must be a plain folder: a
/// link, or a file naming a repository elsewhere, would take Kasten's
/// commits, and its clean-up of stale locks, into that repository.
pub(super) fn has_git_folder(root: &Path) -> Result<bool> {
    // Git also writes metadata below .git (for example info/exclude).
    // A plain top-level folder alone does not contain those writes.
    let resolved = crate::local_paths::resolve_root(root)?;
    crate::local_paths::check_tree(&resolved.join(".git"))?;
    let refuse = |what: &str| {
        Err(Error::Invalid(format!(
            ".git in this vault is {what}. KastenFlow keeps history only in a plain .git folder inside the vault"
        )))
    };
    match std::fs::symlink_metadata(root.join(".git")) {
        Ok(meta) if meta.is_dir() => Ok(true),
        Ok(meta) if meta.file_type().is_symlink() => refuse("a link to somewhere else"),
        Ok(_) => refuse("a file that names a repository somewhere else"),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err.into()),
    }
}

/// Refuses a repository that works with files outside the vault: its
/// config can name another working folder (`core.worktree`), and a
/// `commondir` file another repository to commit into.
pub(super) fn stays_inside(repo: &Repository, root: &Path) -> Result<()> {
    let same = |a: &Path, b: &Path| match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    let git = root.join(".git");
    if repo.workdir().is_some_and(|dir| same(dir, root))
        && same(repo.path(), &git)
        && same(repo.commondir(), &git)
    {
        return Ok(());
    }
    Err(Error::Invalid(
        ".git in this vault works with files or a repository somewhere else. KastenFlow keeps history only in a plain .git folder inside the vault".into(),
    ))
}

/// Adds the local files to the vault's `.gitignore`, in a repository
/// Kasten starts.
pub(super) fn ignore_local(root: &Path) -> std::io::Result<()> {
    add_lines(&root.join(".gitignore"))
}

/// Adds the local files to the repository's own ignore list, which stays
/// on this computer, for a repository another tool made: its `.gitignore`
/// is the vault's, and left alone.
pub(super) fn exclude_local(root: &Path) -> std::io::Result<()> {
    add_lines(&root.join(".git/info/exclude"))
}

/// Adds the ignore lines `file` lacks, keeping what it holds.
fn add_lines(file: &Path) -> std::io::Result<()> {
    let existing = std::fs::read_to_string(file).unwrap_or_default();
    let missing: String = LOCAL_FILES
        .lines()
        .filter(|l| !existing.lines().any(|e| e.trim() == *l))
        .map(|l| format!("{l}\n"))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let sep = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    crate::atomic::write_atomic(file, format!("{existing}{sep}{missing}").as_bytes())
}
