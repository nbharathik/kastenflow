//! Sidecar files that travel with a page (comments and text highlights), so rename, move, duplicate, trash and restore carry them along.
//!
//! A page `a/b.md` may have `a/b.comments.json` (its comments) and
//! `a/b.highlights.json` (highlights on its text, for a captured web page).
//! They are plain JSON beside the page: whatever moves, copies or trashes
//! the page does the same to them, and both ends of each move are reported
//! so the commit and its undo hold them too. A PDF under `sources/` has a
//! highlights file of the same shape of name (`sources/x.highlights.json`);
//! that one belongs to the PDF, never to a note called `x.md`.

mod carry;
mod folder;
mod list;
#[cfg(test)]
mod tests;

use std::fs;

use crate::vault::Vault;

pub(crate) use carry::{carry, copy_for};
pub use folder::{FOLDER_SUFFIX, dir_of, in_folder, page_of_member};
pub(crate) use folder::{dir_taken, existing_dir, members, pairs};
pub(crate) use list::{ListDoc, plain_id};

/// The suffixes of the sidecar files that travel with a page.
pub const SUFFIXES: [&str; 2] = [".comments.json", ".highlights.json"];
/// A page's comments file ends so.
pub const COMMENTS: &str = SUFFIXES[0];
/// A captured page's text highlights file ends so.
pub const HIGHLIGHTS: &str = SUFFIXES[1];

/// Whether `path` names a sidecar file of a page: a comments or highlights
/// file, or a file in the page's `.smart` folder.
pub fn is_companion(path: &str) -> bool {
    SUFFIXES.iter().any(|suffix| path.ends_with(suffix)) || in_folder(path)
}

/// The sidecar of the page at `note` with this `suffix`: `a/b.md` has
/// `a/b.comments.json`. None when `note` is not a Markdown path.
pub fn of(note: &str, suffix: &str) -> Option<String> {
    note.strip_suffix(".md")
        .filter(|stem| !stem.is_empty() && !stem.ends_with('/'))
        .map(|stem| format!("{stem}{suffix}"))
}

/// The page a sidecar belongs to: `a/b.comments.json` is `a/b.md`.
pub fn note_of(companion: &str) -> Option<String> {
    SUFFIXES
        .iter()
        .find_map(|suffix| companion.strip_suffix(suffix))
        .filter(|stem| !stem.is_empty() && !stem.ends_with('/'))
        .map(|stem| format!("{stem}.md"))
}

/// Whether the highlights file beside the note at `note` is a PDF's: the
/// note is under `sources/` and a PDF of the same name is next to it.
pub fn pdf_owns_highlights(vault: &Vault, note: &str) -> bool {
    if !note.starts_with("sources/") {
        return false;
    }
    let Some(stem) = note.strip_suffix(".md") else {
        return false;
    };
    ["pdf", "PDF"].iter().any(|ext| {
        let pdf = format!("{stem}.{ext}");
        vault
            .file_of(&pdf, &[".pdf", ".PDF"])
            .is_ok_and(|file| file.is_file())
    })
}

/// The sidecar files of the note at `note` that exist: only the ones that
/// are the note's own. The note may be in the trash.
pub fn existing(vault: &Vault, note: &str) -> Vec<String> {
    SUFFIXES
        .iter()
        .filter(|suffix| **suffix != HIGHLIGHTS || !pdf_owns_highlights(vault, note))
        .filter_map(|suffix| of(note, suffix))
        .filter(|rel| vault.tracked_file(rel).is_ok_and(|file| file.is_file()))
        .collect()
}

/// Whether a sidecar file or folder stands at the name of the note at `note`
/// without being the note's own, as a stray one does (what a page deleted
/// outside KastenFlow leaves): a page is not given such a name, so it never
/// takes the file for its own. A PDF's highlights file is never a note's, so
/// it does not count.
pub fn name_taken(vault: &Vault, note: &str) -> bool {
    dir_taken(vault, note)
        || SUFFIXES
            .iter()
            .filter(|suffix| **suffix != HIGHLIGHTS || !pdf_owns_highlights(vault, note))
            .any(|suffix| {
                of(note, suffix).is_some_and(|rel| {
                    vault
                        .tracked_file(&rel)
                        .is_ok_and(|file| fs::symlink_metadata(file).is_ok())
                })
            })
}
