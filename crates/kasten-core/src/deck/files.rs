//! Decks on disk: created where boards go, read with the hash a save must
//! bring back, and written atomically.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::head::{MAX_BYTES, head_of};
use crate::atomic::{create_atomic, write_atomic};
use crate::error::{Error, Result};
use crate::note::content_hash;
use crate::ops::{free_file_besides, kind_folder};
use crate::save::fitting;
use crate::slug::slugify;
use crate::time::Instant;
use crate::vault::Vault;

const EXT: &str = ".deck";

/// A deck as it is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckFile {
    pub path: String,
    pub text: String,
    /// What a save brings back to show it started from this version.
    pub hash: String,
    pub modified: u64,
}

/// The result of saving a deck.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DeckSaved {
    /// Written; `deck` is the file as it is now.
    Written { deck: DeckFile },
    /// The file already held this text; nothing was written.
    Unchanged { deck: DeckFile },
    /// The file changed on disk since it was read. The editor's version
    /// went to `copy`, and `deck` is the file, left as it was.
    Conflict { copy: String, deck: DeckFile },
}

/// Creates a deck holding `text` and titled `title` in `project` (a folder
/// under `projects/` with a `_project.md`) or, with None, in the library;
/// returns its path. The file is named by the title's slug, numbered when
/// taken; no existing file is ever replaced.
pub fn create_deck(
    vault: &Vault,
    title: &str,
    project: Option<&str>,
    text: &str,
) -> Result<String> {
    let path = plan_deck(vault, title, project, text, &HashSet::new())?;
    create_atomic(&vault.file_of(&path, &[EXT])?, text.as_bytes())?;
    Ok(path)
}

/// Where `create_deck` would put the deck (passing over `taken`, paths a
/// staged change means to use), with nothing written; refused for what it
/// would refuse. The pure step of `create_deck`, which a staged change shares.
pub fn plan_deck(
    vault: &Vault,
    title: &str,
    project: Option<&str>,
    text: &str,
    taken: &HashSet<String>,
) -> Result<String> {
    let (title, folder) = checked_new(vault, title, project, text)?;
    let path = free_file_besides(vault, &folder, &slugify(&title), EXT, taken);
    vault.file_of(&path, &[EXT])?;
    Ok(path)
}

/// The trimmed title of a new deck, or why it cannot be one.
pub(super) fn checked_title(title: &str) -> Result<String> {
    let title = title.trim();
    if title.is_empty() || title.contains(['[', ']', '|', '\n', '\r']) {
        return Err(Error::Invalid(
            "A title needs some text and no [ ] or | characters".to_owned(),
        ));
    }
    Ok(title.to_owned())
}

/// The trimmed title and the folder for a new deck, or why it cannot be made.
fn checked_new(
    vault: &Vault,
    title: &str,
    project: Option<&str>,
    text: &str,
) -> Result<(String, String)> {
    let title = checked_title(title)?;
    head_of(text)?;
    Ok((title, kind_folder(vault, project, "decks")?))
}

/// Whether `create_deck` would make a deck of these, so that a request that
/// cannot be met is refused before anything waits for review.
pub fn check_new_deck(vault: &Vault, title: &str, project: Option<&str>, text: &str) -> Result<()> {
    checked_new(vault, title, project, text).map(|_| ())
}

/// The deck at `path`, which must be a plain vault path ending in `.deck`.
pub fn read_deck(vault: &Vault, path: &str) -> Result<DeckFile> {
    let file = vault.file_of(path, &[EXT])?;
    let meta = fs::metadata(&file).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => Error::NotFound(path.to_owned()),
        _ => Error::Io(err),
    })?;
    if meta.len() > MAX_BYTES as u64 {
        return Err(Error::Invalid(format!("{path} is too large for a deck")));
    }
    let text = fs::read_to_string(&file).map_err(|err| match err.kind() {
        io::ErrorKind::InvalidData => Error::Invalid(format!("{path} is not UTF-8 text")),
        _ => Error::Io(err),
    })?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    Ok(DeckFile {
        path: path.to_owned(),
        hash: content_hash(&text),
        text,
        modified,
    })
}

/// Writes `text` over the deck at `path` if the file still has `base_hash`,
/// the hash it was read with. A file that changed since goes untouched, and
/// the text goes to `<name> (conflict <time>).deck` beside it.
pub fn write_deck(
    vault: &Vault,
    path: &str,
    text: &str,
    base_hash: &str,
    now: Instant,
) -> Result<DeckSaved> {
    head_of(text)?;
    let file = vault.file_of(path, &[EXT])?;
    let current = read_deck(vault, path)?;
    if current.text == text {
        return Ok(DeckSaved::Unchanged { deck: current });
    }
    if current.hash != base_hash {
        let copy = conflict_copy(vault, path, text, now)?;
        return Ok(DeckSaved::Conflict {
            copy,
            deck: current,
        });
    }
    write_atomic(&file, text.as_bytes())?;
    Ok(DeckSaved::Written {
        deck: read_deck(vault, path)?,
    })
}

fn conflict_copy(vault: &Vault, path: &str, text: &str, now: Instant) -> Result<String> {
    let label = format!("conflict {}", now.file_stamp());
    let stem = fitting(path.strip_suffix(EXT).unwrap_or(path), label.len());
    let taken = |rel: &str| {
        vault
            .file_of(rel, &[EXT])
            .is_ok_and(|p| fs::symlink_metadata(p).is_ok())
    };
    let mut copy = format!("{stem} ({label}){EXT}");
    let mut n = 2;
    while taken(&copy) {
        copy = format!("{stem} ({label} {n}){EXT}");
        n += 1;
    }
    create_atomic(&vault.file_of(&copy, &[EXT])?, text.as_bytes())?;
    Ok(copy)
}

/// What people call the deck at `path`: its title, or its file's name when
/// it has none or cannot be read.
pub fn title_at(vault: &Vault, path: &str) -> String {
    let named = read_deck(vault, path)
        .ok()
        .and_then(|deck| head_of(&deck.text).ok())
        .and_then(|head| head.title)
        .filter(|title| !title.trim().is_empty());
    named.unwrap_or_else(|| {
        let name = path.rsplit('/').next().unwrap_or(path);
        name.trim_end_matches(EXT).to_owned()
    })
}
