//! The file work behind a build's tree (`snapshot`): reading the document's
//! folder without following a link, copying a file only when it changed, and
//! removing what the tree holds that the folder no longer does. Every removal
//! goes through `cache::forget`, which only reaches below the build folder.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::cache::forget;
use super::paths::{is_link, segment_ok};
use super::snapshot::{Refused, Stats};

/// Most files mirrored, most bytes in one file and in all, deepest folder.
const MAX_FILES: usize = 5000;
const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_DEPTH: usize = 24;
/// Most entries looked at in the tree when removing leftovers.
const MAX_TREE_ENTRIES: usize = 100_000;

/// Kinds of file that are programs or scripts to the system. A build never
/// runs anything from the document, and an engine started from the tree
/// would find one by name first on Windows, so none are mirrored.
const PROGRAMS: &[&str] = &[
    "exe", "com", "bat", "cmd", "dll", "scr", "pif", "msi", "lnk", "ps1", "vbs", "vbe", "wsf",
    "wsh", "cpl",
];

/// A file of the document's folder.
pub struct Entry {
    pub rel: String,
    pub abs: PathBuf,
    pub len: u64,
    pub modified: Option<SystemTime>,
}

pub fn io_err(what: &str, err: &io::Error) -> Refused {
    Refused::Io(format!("Could not {what}: {err}"))
}

/// The files of `src`, sorted by path. Links, hidden entries, programs and
/// `latexmkrc` are left out (and counted in `stats.skipped`).
pub fn scan(src: &Path, stats: &mut Stats) -> Result<Vec<Entry>, Refused> {
    let meta = fs::symlink_metadata(src).map_err(|e| io_err("read the document's folder", &e))?;
    if is_link(&meta) || !meta.is_dir() {
        return Err(Refused::Folder(
            "The document's folder is not a plain folder".to_owned(),
        ));
    }
    let (mut found, mut total) = (Vec::new(), 0u64);
    let mut todo = vec![(src.to_path_buf(), String::new(), 0usize)];
    while let Some((dir, rel, depth)) = todo.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| io_err("read the document's folder", &e))?;
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                stats.skipped += 1;
                continue;
            };
            let Ok(meta) = entry.metadata() else {
                stats.skipped += 1;
                continue;
            };
            if is_link(&meta) || !segment_ok(name) {
                stats.skipped += 1;
                continue;
            }
            let child = if rel.is_empty() {
                name.to_owned()
            } else {
                format!("{rel}/{name}")
            };
            if meta.is_dir() {
                if depth + 1 > MAX_DEPTH {
                    return Err(Refused::Folder(
                        "The document's folder is nested too deeply to build".to_owned(),
                    ));
                }
                todo.push((entry.path(), child, depth + 1));
            } else if meta.is_file() {
                let program = name
                    .rsplit_once('.')
                    .is_some_and(|(_, ext)| PROGRAMS.contains(&ext.to_ascii_lowercase().as_str()));
                if program || name.eq_ignore_ascii_case("latexmkrc") {
                    stats.skipped += 1;
                    continue;
                }
                if meta.len() > MAX_FILE_BYTES {
                    return Err(Refused::Folder(format!(
                        "“{child}” is too big to build from"
                    )));
                }
                total += meta.len();
                if found.len() >= MAX_FILES || total > MAX_TOTAL_BYTES {
                    return Err(Refused::Folder(
                        "The document's folder is too big to build".to_owned(),
                    ));
                }
                found.push(Entry {
                    rel: child,
                    abs: entry.path(),
                    len: meta.len(),
                    modified: meta.modified().ok(),
                });
            } else {
                stats.skipped += 1;
            }
        }
    }
    found.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(found)
}

/// Makes the folders for `dest`'s parent inside `tree`, replacing a file or
/// link that is in the way of a folder.
pub fn make_parents(build: &Path, tree: &Path, dest: &Path) -> Result<(), Refused> {
    let Some(parent) = dest.parent() else {
        return Ok(());
    };
    let rel = parent.strip_prefix(tree).unwrap_or(Path::new(""));
    let mut at = tree.to_path_buf();
    for part in rel.components() {
        at.push(part);
        match fs::symlink_metadata(&at) {
            Ok(meta) if meta.is_dir() && !is_link(&meta) => {}
            Ok(_) => {
                forget(build, &at);
                fs::create_dir(&at).map_err(|e| io_err("prepare the build", &e))?;
            }
            Err(_) => fs::create_dir(&at).map_err(|e| io_err("prepare the build", &e))?,
        }
    }
    Ok(())
}

/// Whether the plain file at `dest` already has this size and modified time.
pub fn same_as(dest: &Path, len: u64, modified: Option<SystemTime>) -> bool {
    let Ok(meta) = fs::symlink_metadata(dest) else {
        return false;
    };
    !is_link(&meta)
        && meta.is_file()
        && meta.len() == len
        && modified.is_some()
        && meta.modified().ok() == modified
}

/// Removes what is at `dest` so a new file can be made there: a read-only
/// copy, a folder or a link in the way goes too.
fn clear_for_file(build: &Path, dest: &Path) {
    if fs::symlink_metadata(dest).is_ok() {
        forget(build, dest);
    }
}

/// Writes `bytes` to a new plain file at `dest`, replacing what is there.
pub fn write_new(build: &Path, dest: &Path, bytes: &[u8]) -> Result<(), Refused> {
    clear_for_file(build, dest);
    let mut out = File::create_new(dest).map_err(|e| io_err("write into the build", &e))?;
    out.write_all(bytes)
        .map_err(|e| io_err("write into the build", &e))
}

/// Copies the plain file `entry` to `dest` with the same modified time.
pub fn copy_entry(build: &Path, entry: &Entry, dest: &Path) -> Result<(), Refused> {
    clear_for_file(build, dest);
    let mut from = File::open(&entry.abs).map_err(|e| io_err("read a file of the document", &e))?;
    let opened = from
        .metadata()
        .map_err(|e| io_err("read a file of the document", &e))?;
    if !opened.is_file() {
        return Err(Refused::Folder(format!(
            "“{}” is not a plain file",
            entry.rel
        )));
    }
    let mut to = File::create_new(dest).map_err(|e| io_err("write into the build", &e))?;
    // Copied by hand, not with `fs::copy`, so the copy has an ordinary file's rights.
    let copied = io::copy(&mut (&mut from).take(MAX_FILE_BYTES + 1), &mut to)
        .map_err(|e| io_err("copy a file into the build", &e))?;
    if copied > MAX_FILE_BYTES {
        return Err(Refused::Folder(format!(
            "“{}” is too big to build from",
            entry.rel
        )));
    }
    if let Some(modified) = entry.modified {
        let _ = to.set_modified(modified);
    }
    Ok(())
}

/// The files and links in `tree` that are not in `keep`, removed.
pub fn drop_leftovers(build: &Path, tree: &Path, keep: &HashSet<String>) -> usize {
    let (mut removed, mut seen) = (0, 0usize);
    let mut todo = vec![(tree.to_path_buf(), String::new())];
    while let Some((dir, rel)) = todo.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_TREE_ENTRIES {
                // Too much to look through: start the tree again.
                return removed + usize::from(forget(build, tree));
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let child = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if is_link(&meta) {
                removed += usize::from(forget(build, &entry.path()));
            } else if meta.is_dir() {
                todo.push((entry.path(), child));
            } else if !keep.contains(&child) {
                removed += usize::from(forget(build, &entry.path()));
            }
        }
    }
    removed
}
