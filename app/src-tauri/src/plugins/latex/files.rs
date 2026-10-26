//! The files of a LaTeX document's folder, for the window's file tree. Only
//! plain files and folders are listed: links, hidden entries (the build keeps
//! its files in the vault's cache, not here) and anything past the limits are
//! left out. Reading only; nothing is written.

use std::fs;
use std::path::Path;

use kasten_core::latex::is_source_path;
use serde::Serialize;

use super::paths::{is_link, segment_ok};

/// Most files listed for one document, and how deep the folders go.
pub const MAX_FILES: usize = 500;
const MAX_DEPTH: usize = 6;

/// One file of a document's folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocFile {
    /// The vault path.
    pub path: String,
    /// The window can edit it as text (`.tex .sty .cls .bst .bib`).
    pub editable: bool,
    pub size: u64,
}

/// The files below `folder` (a vault path), by path.
pub fn list_files(root: &Path, folder: &str) -> Vec<DocFile> {
    let mut out = Vec::new();
    walk(&root.join(folder), folder, 0, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<DocFile>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !segment_ok(&name) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if is_link(&meta) {
            continue;
        }
        let path = format!("{rel}/{name}");
        if meta.is_dir() {
            walk(&entry.path(), &path, depth + 1, out);
        } else if meta.is_file() {
            out.push(DocFile {
                editable: is_source_path(&path),
                size: meta.len(),
                path,
            });
        }
    }
}
