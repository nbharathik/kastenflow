//! The code folder of a smart page, a sidecar like the files beside a page: a
//! page `a/b.md` may have the folder `a/b.smart/`. It is one thing to move,
//! copy and trash (the folder as a whole), and every file in it, at both ends
//! of a move, is named in the change so the commit, Undo and session undo hold
//! them all.

use std::fs;
use std::path::Path;

use crate::vault::Vault;

/// The ending of a smart page's folder (`b.smart`).
pub const FOLDER_SUFFIX: &str = crate::smart::SMART_DIR_SUFFIX;

/// The folder beside the page at `note`: `a/b.md` has `a/b.smart`. None when
/// `note` is not a Markdown path.
pub fn dir_of(note: &str) -> Option<String> {
    crate::smart::sidecar_dir(note)
}

/// Whether `path` is inside a smart page's folder: a folder on the way to it
/// ends in `.smart`, however it is spelled.
pub fn in_folder(path: &str) -> bool {
    let mut parts: Vec<&str> = path.split('/').collect();
    parts.pop();
    parts.into_iter().any(|part| {
        part.len() > FOLDER_SUFFIX.len() && part.to_ascii_lowercase().ends_with(FOLDER_SUFFIX)
    })
}

/// The page whose folder holds the file at `path`: `a/b.smart/x/y.js` is the
/// folder of `a/b.md`. None for a path outside any such folder.
pub fn page_of_member(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split('/').collect();
    let end = parts[..parts.len() - 1].iter().position(|part| {
        part.len() > FOLDER_SUFFIX.len() && part.to_ascii_lowercase().ends_with(FOLDER_SUFFIX)
    })?;
    let folder = parts[..=end].join("/");
    Some(format!(
        "{}.md",
        &folder[..folder.len() - FOLDER_SUFFIX.len()]
    ))
}

/// The folder of the page at `note` when there is one: a real folder, not a
/// link to one and not a file of that name.
pub(crate) fn existing_dir(vault: &Vault, note: &str) -> Option<String> {
    let dir = dir_of(note)?;
    let path = vault.tracked_file(&dir).ok()?;
    fs::symlink_metadata(path)
        .is_ok_and(|meta| meta.is_dir())
        .then_some(dir)
}

/// Whether anything stands at the folder name of the page at `note` (a stray
/// folder a deleted page left, or a link): such a name is not given to a page.
pub(crate) fn dir_taken(vault: &Vault, note: &str) -> bool {
    vault
        .path_of(note)
        .is_ok_and(|page| fs::symlink_metadata(page.with_extension("smart")).is_ok())
}

/// Every file in the folder `dir` (a vault path), sorted. Links are not
/// followed and not listed, and the temporary files of a write that was
/// interrupted are left out. Hidden files are in: they move with the folder.
pub(crate) fn members(vault: &Vault, dir: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(path) = vault.tracked_file(dir) {
        walk(&path, dir, &mut out);
    }
    out.sort();
    out
}

fn walk(dir: &Path, rel: &str, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = format!("{rel}/{name}");
        if kind.is_dir() {
            walk(&entry.path(), &path, out);
        } else if kind.is_file() && !crate::atomic::is_temp_name(&name) {
            out.push(path);
        }
    }
}

/// Each file of the folder `from` with the path it has at the same place in
/// the folder `to`.
pub(crate) fn pairs(vault: &Vault, from: &str, to: &str) -> Vec<(String, String)> {
    members(vault, from)
        .into_iter()
        .map(|file| {
            let target = format!("{to}{}", &file[from.len()..]);
            (file, target)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_folder_of_a_page_and_what_is_inside_one() {
        assert_eq!(dir_of("a/b.md").as_deref(), Some("a/b.smart"));
        assert_eq!(dir_of("a/b.txt"), None);
        assert!(in_folder("a/b.smart/app.js"));
        assert!(in_folder(".trash/20261023T080000Z/a/b.smart/data/x.json"));
        assert!(in_folder("a/B.SMART/app.js"));
        assert!(!in_folder("a/b.smart"));
        assert!(!in_folder("a/b.md"));
        assert!(!in_folder("a/.smart/app.js"));
        assert!(!in_folder("a/smart/app.js"));
    }

    #[test]
    fn names_the_page_a_file_of_the_folder_belongs_to() {
        assert_eq!(
            page_of_member("a/b.smart/x/y.js").as_deref(),
            Some("a/b.md")
        );
        assert_eq!(
            page_of_member(".trash/2026/a/B.SMART/y.js").as_deref(),
            Some(".trash/2026/a/B.md")
        );
        assert_eq!(page_of_member("a/b.md"), None);
        assert_eq!(page_of_member("a/b.smart"), None);
        assert_eq!(page_of_member("b.js"), None);
    }
}
