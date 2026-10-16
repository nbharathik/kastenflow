//! Watching the vault for changes made outside Kasten: the app and the MCP
//! server both watch the vault and refresh on change. Events
//! are gathered until the folder is quiet for a moment, then reported as
//! vault-relative paths: files, and folders that appeared, went or were
//! renamed as a whole. Git's folder, the cache, the lock and temporary
//! files are left out.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use notify::event::ModifyKind;
use notify::{EventKind, RecursiveMode, Watcher};

use crate::error::{Error, Result};

/// How long the folder must be quiet before changes are reported.
const SETTLE: Duration = Duration::from_millis(250);

/// Stops watching when dropped.
pub struct VaultWatcher {
    _watcher: notify::RecommendedWatcher,
}

impl std::fmt::Debug for VaultWatcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("VaultWatcher")
    }
}

/// The vault-relative path Kasten cares about, or None for its own
/// bookkeeping and temporary files.
pub fn relevant(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let rel = rel.to_string_lossy().replace('\\', "/");
    let name = rel.rsplit('/').next().unwrap_or(&rel);
    let skip = rel.is_empty()
        || rel == ".git"
        || rel.starts_with(".git/")
        || rel.starts_with(".kasten/cache")
        || rel == ".kasten/write.lock"
        || rel.starts_with(".trash/")
        || (name.starts_with('.') && name != ".gitignore")
        || name.ends_with('~');
    (!skip).then_some(rel)
}

/// Calls `on_change` with the paths that changed, after each quiet spell.
pub fn watch(
    root: &Path,
    on_change: impl Fn(Vec<String>) + Send + 'static,
) -> Result<VaultWatcher> {
    let root: PathBuf = root.canonicalize().unwrap_or_else(|_| root.to_owned());
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| Error::Invalid(format!("Cannot watch the vault: {e}")))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| Error::Invalid(format!("Cannot watch the vault: {e}")))?;
    let started = std::thread::Builder::new()
        .name("kasten-watch".into())
        .spawn(move || {
            let mut pending: Vec<String> = Vec::new();
            loop {
                let received = if pending.is_empty() {
                    match rx.recv() {
                        Ok(event) => Some(event),
                        // The watcher was dropped.
                        Err(_) => return,
                    }
                } else {
                    match rx.recv_timeout(SETTLE) {
                        Ok(event) => Some(event),
                        Err(mpsc::RecvTimeoutError::Timeout) => None,
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            on_change(std::mem::take(&mut pending));
                            return;
                        }
                    }
                };
                match received {
                    Some(Ok(event)) => {
                        // A folder changes whenever a file in it does, and the
                        // file is what matters; but one that appears or is
                        // renamed comes without its files, so it is reported
                        // for the index to read what is in it.
                        let whole = matches!(
                            event.kind,
                            EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_))
                        );
                        for path in event.paths {
                            if path.is_dir() && !whole {
                                continue;
                            }
                            let path = path.canonicalize().unwrap_or(path);
                            if let Some(rel) = relevant(&root, &path)
                                && !pending.contains(&rel)
                            {
                                pending.push(rel);
                            }
                        }
                    }
                    Some(Err(_)) => {}
                    // Quiet for a moment: report what changed.
                    None => on_change(std::mem::take(&mut pending)),
                }
            }
        });
    started.map_err(|e| Error::Invalid(format!("Cannot watch the vault: {e}")))?;
    Ok(VaultWatcher { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_git_the_cache_and_temporary_files() {
        let root = Path::new("/v");
        let rel = |p: &str| relevant(root, &root.join(p));
        assert_eq!(rel("inbox/a.md").as_deref(), Some("inbox/a.md"));
        assert_eq!(
            rel(".kasten/config.yaml").as_deref(),
            Some(".kasten/config.yaml")
        );
        assert_eq!(rel(".gitignore").as_deref(), Some(".gitignore"));
        for skipped in [
            ".git/index",
            ".kasten/cache/index.sqlite",
            ".kasten/write.lock",
            "inbox/.a.md.tmp123",
            ".trash/x/inbox/a.md",
            "inbox/a.md~",
        ] {
            assert_eq!(rel(skipped), None, "{skipped}");
        }
    }

    #[test]
    fn reports_changes_after_a_quiet_moment() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-watch-{}",
            crate::ulid_at(crate::Instant::now().millis)
        ));
        std::fs::create_dir_all(dir.join("inbox")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        let (tx, rx) = mpsc::channel();
        let watcher = watch(&dir, move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(dir.join(".git/noise"), "x").unwrap();
        std::fs::write(dir.join("inbox/a.md"), "hello").unwrap();
        std::fs::write(dir.join("inbox/a.md"), "hello again").unwrap();
        let mut seen: Vec<String> = Vec::new();
        let until = std::time::Instant::now() + Duration::from_secs(5);
        while !seen.iter().any(|p| p == "inbox/a.md") {
            let left = until.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(left) {
                Ok(paths) => seen.extend(paths),
                Err(_) => break,
            }
        }
        // macOS can also report the folder made a moment before watching began; a folder reported is only read
        // again. The file is reported once, and Git's noise not at all.
        seen.retain(|p| p != "inbox");
        assert_eq!(seen, ["inbox/a.md"]);
        drop(watcher);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_a_folder_renamed_as_a_whole_by_its_new_name() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-watch-{}",
            crate::ulid_at(crate::Instant::now().millis)
        ));
        std::fs::create_dir_all(dir.join("library/trips")).unwrap();
        std::fs::write(dir.join("library/trips/a.md"), "hello").unwrap();
        let (tx, rx) = mpsc::channel();
        let watcher = watch(&dir, move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        std::fs::rename(dir.join("library/trips"), dir.join("library/travel")).unwrap();
        let mut seen: Vec<String> = Vec::new();
        let until = std::time::Instant::now() + Duration::from_secs(5);
        while !seen.iter().any(|p| p == "library/travel") {
            let left = until.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(left) {
                Ok(paths) => seen.extend(paths),
                Err(_) => break,
            }
        }
        assert!(seen.iter().any(|p| p == "library/travel"), "{seen:?}");
        drop(watcher);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
