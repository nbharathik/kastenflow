//! Renaming a note: its title, its file when the file name follows the title,
//! and every `[[link]]` to it, so no link breaks. Links to other notes that
//! share a title keep going where they went. Board references follow with the
//! board module.

use std::collections::HashMap;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::frontmatter::{join, set_key, split, still_readable};
use crate::links::keep::keep_in_vault_with;
use crate::note::{NoteFile, NoteMeta};
use crate::ops::{folder_of, free_path};
use crate::rollback::Rollback;
use crate::slug::slugify;
use crate::time::Instant;
use crate::vault::Vault;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Renamed {
    /// The note under its new title, and new path when the file moved.
    pub note: NoteFile,
    /// Other notes whose links now name the new title.
    pub relinked: Vec<String>,
}

fn eol_of(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

/// Whether a file name was made from the title (or is a fresh `untitled`),
/// so it should follow a new title.
fn follows_title(stem: &str, title: &str) -> bool {
    let numbered = |base: &str| {
        stem == base
            || stem
                .strip_prefix(base)
                .and_then(|r| r.strip_prefix('-'))
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    };
    numbered(&slugify(title)) || numbered("untitled")
}

/// Gives the note at `rel` a new title. The file moves to the new title's
/// name when its name followed the old one. Journal days cannot be renamed.
pub fn rename_note(vault: &Vault, rel: &str, title: &str, now: Instant) -> Result<Renamed> {
    let notes = vault.notes()?;
    let candidates: Vec<String> = notes.iter().map(|n| n.path.clone()).collect();
    rename_note_in(vault, rel, title, now, &notes, &candidates)
}

/// `rename_note` with every note's metadata before the rename (say from
/// the index), relinking only `candidates`: the notes that may link to the
/// old title, the new one or the old path.
pub fn rename_note_in(
    vault: &Vault,
    rel: &str,
    title: &str,
    now: Instant,
    before: &[NoteMeta],
    candidates: &[String],
) -> Result<Renamed> {
    let mut done = Rollback::default();
    match rename_note_with(vault, rel, title, now, before, candidates, &mut done) {
        Ok(renamed) => Ok(renamed),
        Err(err) => {
            done.put_back();
            Err(err)
        }
    }
}

/// `rename_note_in`, noting every write and move in `done` and leaving it to
/// the caller to put them back: a rename that fails part way must not leave
/// the new title, the moved file or the rewritten links behind. A caller
/// that goes on to more steps of its own puts all of them back together.
pub(crate) fn rename_note_with(
    vault: &Vault,
    rel: &str,
    title: &str,
    now: Instant,
    before: &[NoteMeta],
    candidates: &[String],
    done: &mut Rollback,
) -> Result<Renamed> {
    let title = title.trim();
    if title.is_empty() || title.contains(['[', ']', '|']) || title.chars().any(char::is_control) {
        return Err(Error::Invalid(
            "A title needs some text on one line, and no [ ] or | characters".to_owned(),
        ));
    }
    let current = vault.read(rel)?;
    if current.meta.kind == "journal" {
        return Err(Error::Invalid(
            "Journal days are named by their date".to_owned(),
        ));
    }
    if current.meta.title == title {
        return Ok(Renamed {
            note: current,
            relinked: Vec::new(),
        });
    }

    let parts = split(&current.text);
    let eol = eol_of(&current.text);
    let mut prefix = set_key(parts.prefix, "title", Some(title), eol);
    prefix = set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
    still_readable(parts.prefix, &prefix)?;
    let source = vault.path_of(rel)?;
    done.write(
        &source,
        join(&prefix, parts.body, eol).as_bytes(),
        Some(current.text.clone().into_bytes()),
    )?;

    let name = rel.rsplit('/').next().unwrap_or(rel);
    let stem = name.trim_end_matches(".md");
    let mut path = rel.to_owned();
    if name != "_project.md" && follows_title(stem, &current.meta.title) && slugify(title) != stem {
        let target = free_path(vault, folder_of(rel), &slugify(title));
        let destination = vault.path_of(&target)?;
        if !destination.exists() {
            done.rename(&source, &destination)?;
            path = target;
        }
    }

    // Every link that went to a note keeps going there: to this one under
    // its new title, and to others that share either title.
    let renamed = vault.read(&path)?.meta;
    let after: Vec<NoteMeta> = before
        .iter()
        .filter(|n| n.path != rel)
        .cloned()
        .chain(std::iter::once(renamed))
        .collect();
    let moved: HashMap<String, String> = if path == rel {
        HashMap::new()
    } else {
        HashMap::from([(rel.to_owned(), path.clone())])
    };
    let paths: Vec<String> = candidates
        .iter()
        .map(|p| if p == rel { path.clone() } else { p.clone() })
        .chain(std::iter::once(path.clone()))
        .collect();
    let relinked = keep_in_vault_with(vault, before, &after, &moved, &paths, done)?
        .into_iter()
        .filter(|p| *p != path)
        .collect();
    Ok(Renamed {
        note: vault.read(&path)?,
        relinked,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_follow_titles_they_were_made_from() {
        assert!(follows_title("reading-list", "Reading list"));
        assert!(follows_title("reading-list-2", "Reading list"));
        assert!(follows_title("untitled-3", "Anything"));
        assert!(!follows_title("reading-list-x", "Reading list"));
        assert!(!follows_title("notes", "Reading list"));
    }
}
