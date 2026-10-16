//! Boards on disk: creating them where they belong, reading and writing
//! them in house style, and keeping their cards on notes that move: a
//! move rewrites every board reference.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::PathBuf;

use super::{Canvas, field, invalid};
use crate::atomic::{create_atomic, write_atomic};
use crate::error::{Error, Result};
use crate::ops::kind_folder;
use crate::slug::slugify;
use crate::vault::Vault;

/// Whether `rel` is a plain vault path, checked as `Vault::path_of` checks
/// note paths: forward slashes, no empty, `.` or `..` parts, and not in a
/// private folder such as `.git`, `.kasten` or `.trash`.
pub(super) fn plain(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.starts_with('/')
        && !rel.contains(['\\', ':', '\0'])
        && rel.split('/').enumerate().all(|(i, part)| {
            let private = i == 0 && (part.starts_with('.') || part == "node_modules");
            !(part.is_empty() || part == "." || part == ".." || private)
        })
}

/// The file for a board's vault path, which must be plain and end in `.canvas`.
fn board_file(vault: &Vault, rel: &str) -> Result<PathBuf> {
    vault.file_of(rel, &[".canvas"])
}

/// The first free `folder/name.canvas`, `folder/name-2.canvas`, …, passing
/// over `taken`, paths a staged change means to use.
fn free_path(vault: &Vault, folder: &str, name: &str, taken: &HashSet<String>) -> String {
    let mut n = 1;
    loop {
        let path = if n == 1 {
            format!("{folder}/{name}.canvas")
        } else {
            format!("{folder}/{name}-{n}.canvas")
        };
        // Anything already there, even a broken link, takes the name.
        if !taken.contains(&path) && fs::symlink_metadata(vault.root().join(&path)).is_err() {
            return path;
        }
        n += 1;
    }
}

/// Creates an empty board titled `title` in `project` (a folder under
/// `projects/` with a `_project.md`) or, with None, in the library, and
/// returns its path. The file is named by the title's slug, numbered when
/// taken; no existing file is ever replaced.
pub fn create_board(vault: &Vault, title: &str, project: Option<&str>) -> Result<String> {
    let (path, text) = plan_board(vault, title, project, &HashSet::new())?;
    create_atomic(&board_file(vault, &path)?, text.as_bytes())?;
    Ok(path)
}

/// Where `create_board` would put the board and what it would hold, with
/// nothing written; `taken` are paths a staged change means to use. The pure
/// step of `create_board`, which a staged change shares.
pub fn plan_board(
    vault: &Vault,
    title: &str,
    project: Option<&str>,
    taken: &HashSet<String>,
) -> Result<(String, String)> {
    let title = title.trim();
    if title.is_empty() || title.contains(['[', ']', '|', '\n', '\r']) {
        return Err(Error::Invalid(
            "A title needs some text and no [ ] or | characters".to_owned(),
        ));
    }
    let path = free_path(
        vault,
        &kind_folder(vault, project, "boards")?,
        &slugify(title),
        taken,
    );
    board_file(vault, &path)?;
    Ok((path, Canvas::new(title).to_text()))
}

/// The text of the board at `path`.
pub fn board_text(vault: &Vault, path: &str) -> Result<String> {
    let file = board_file(vault, path)?;
    fs::read_to_string(&file).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => Error::NotFound(path.to_owned()),
        io::ErrorKind::InvalidData => invalid("not UTF-8 text"),
        _ => Error::Io(err),
    })
}

/// The board at `path`.
pub fn read_board(vault: &Vault, path: &str) -> Result<Canvas> {
    Canvas::parse(&board_text(vault, path)?)
}

/// Writes `canvas` to `path` in house style, atomically, replacing the
/// board there or creating it.
pub fn write_board(vault: &Vault, path: &str, canvas: &Canvas) -> Result<()> {
    write_atomic(&board_file(vault, path)?, canvas.to_text().as_bytes())?;
    Ok(())
}

/// Points every board's cards at files that moved. `moves` holds
/// `(old, new)` vault paths, as a move or rename reports them. Only boards
/// that change are written, in house style; their paths come back sorted.
/// Boards that cannot be read are skipped.
pub fn relink_boards(vault: &Vault, moves: &[(String, String)]) -> Result<Vec<String>> {
    let mut changed = Vec::new();
    if moves.is_empty() {
        return Ok(changed);
    }
    for board in vault.files(".canvas")? {
        let Ok(mut canvas) = read_board(vault, &board.path) else {
            continue;
        };
        if canvas.relink(moves) > 0 {
            write_board(vault, &board.path, &canvas)?;
            changed.push(board.path);
        }
    }
    Ok(changed)
}

/// Every board with a card for the file at `path`, sorted. Boards that
/// cannot be read are skipped.
pub fn boards_referencing(vault: &Vault, path: &str) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for board in vault.files(".canvas")? {
        let Ok(canvas) = read_board(vault, &board.path) else {
            continue;
        };
        let shows = |node: &serde_json::Value| {
            field(node, "type") == Some("file") && field(node, "file") == Some(path)
        };
        if canvas.nodes().iter().any(shows) {
            out.push(board.path);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_paths_stay_inside_the_vault() {
        for ok in [
            "a.md",
            "library/x.canvas",
            "projects/p/boards/b.canvas",
            "a/.b",
        ] {
            assert!(plain(ok), "{ok}");
        }
        for bad in [
            "",
            "/a",
            "../a",
            "a/../b",
            "a//b",
            "./a",
            "a/",
            ".git/x",
            ".kasten/x",
            "node_modules/x",
            "a\\b",
            "c:x",
            "a\0",
        ] {
            assert!(!plain(bad), "{bad:?}");
        }
    }
}
