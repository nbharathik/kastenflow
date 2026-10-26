//! latexmk writes the files of an `\include`d chapter (`chapters/one.aux`)
//! into the same folder below its output folder and fails when that folder is
//! not there. The folders of the tree are made in the output folder before the
//! run. Only plain folders with plain names are made, and only so many.

use std::fs;
use std::path::Path;

use super::paths::{is_link, plain_folders_below, segment_ok};

/// How deep and how many folders are mirrored.
const MAX_DEPTH: usize = 12;
const MAX_FOLDERS: usize = 500;

/// Makes the folders of `tree` in `out`; answers how many it looked at.
pub fn mirror_folders(tree: &Path, out: &Path) -> usize {
    let mut seen = 0;
    walk(tree, out, "", 0, &mut seen);
    seen
}

fn walk(tree: &Path, out: &Path, rel: &str, depth: usize, seen: &mut usize) {
    if depth >= MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(tree.join(rel)) else {
        return;
    };
    for entry in entries.flatten() {
        if *seen >= MAX_FOLDERS {
            return;
        }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_link(&meta) || !meta.is_dir() || !segment_ok(&name) {
            continue;
        }
        *seen += 1;
        let child = if rel.is_empty() {
            name
        } else {
            format!("{rel}/{name}")
        };
        // Nothing on the way may be a link; a folder that cannot be made is left (the engine says so).
        if plain_folders_below(out, &child) {
            let _ = fs::create_dir_all(out.join(&child));
        }
        walk(tree, out, &child, depth + 1, seen);
    }
}
