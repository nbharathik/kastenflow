//! The only place a LaTeX build removes anything: files and folders it made
//! itself inside its own build folder in the vault's cache
//! (`.kasten/cache/latex/<hash>/`, never committed, rebuilt from the
//! document's folder at the next build). It refuses any path that is not
//! strictly below that folder, so a person's own files are out of its reach,
//! and it removes a link itself, never what the link points to.

use std::fs;
use std::path::{Component, Path};

use super::paths::is_link;

/// Whether `build` and every folder between it and `path` (not `path`
/// itself) are plain folders: a link on the way would carry a removal out of
/// the cache, so nothing is removed below one.
fn plain_way(build: &Path, path: &Path) -> bool {
    let plain = |at: &Path| fs::symlink_metadata(at).is_ok_and(|m| !is_link(&m) && m.is_dir());
    if !plain(build) {
        return false;
    }
    let Ok(rest) = path.strip_prefix(build) else {
        return false;
    };
    let mut at = build.to_path_buf();
    let parts: Vec<_> = rest.components().collect();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        at.push(part);
        if !plain(&at) {
            return false;
        }
    }
    true
}

/// Removes `path` (a file, a link, or a folder with what is in it) when it
/// lies strictly below `build`. Answers whether anything was removed.
pub fn forget(build: &Path, path: &Path) -> bool {
    let inside = path.starts_with(build)
        && path != build
        && !path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir));
    if !inside || !plain_way(build, path) {
        return false;
    }
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    if is_link(&meta) {
        // A link to a folder is a folder entry on Windows; either way only the link goes.
        return fs::remove_file(path).is_ok() || fs::remove_dir(path).is_ok();
    }
    if meta.is_dir() {
        fs::remove_dir_all(path).is_ok()
    } else {
        fs::remove_file(path).is_ok()
    }
}
