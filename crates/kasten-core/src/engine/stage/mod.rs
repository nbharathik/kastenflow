//! Staged changes: an agent chat's writes held back as a change set for a
//! person to look at, then applied together or thrown away. Staging runs the
//! same pure steps the real ops run (`ops::plan_note`, `edit::tags_text`,
//! `save::saved_text`, `deck_agent::applied`), so what the set holds is what
//! the vault would hold. Nothing here writes to the vault until
//! `apply_changes`, and that is one commit.
//!
//! The set is kept in `.kasten/cache/changes/<id>/set.json`, with staged
//! pictures beside it; the cache is never committed, and `discard_changes`
//! removes that one folder and nothing else.

mod apply;
mod apply_diagrams;
mod merge;
mod plan;
mod plan_boards;
mod plan_files;
mod plan_notes;
mod read;

use std::path::PathBuf;

use super::Kasten;
use crate::agent::{
    ChangeSet, FileKind, MAX_STAGED_BYTES, MAX_STAGED_FILES, NewFile, Session, StagedFile,
};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::id::ulid_at;
use crate::note::content_hash;
use crate::time::Instant;

/// Where change sets are kept, under the vault.
const CHANGES: &str = ".kasten/cache/changes";
/// The set's own file in its folder.
const SET_FILE: &str = "set.json";
/// Staged pictures, in the set's folder.
pub(super) const ASSETS_FOLDER: &str = "assets";

/// A set's id as a name of a folder: what `ulid_at` makes, and nothing that
/// could point elsewhere.
fn plain_id(id: &str) -> bool {
    id.len() == 26 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// A file as the vault has it: the version a staged change starts from.
pub(super) struct Version {
    pub(super) text: String,
    pub(super) hash: String,
}

impl Kasten {
    /// An empty change set for a chat's session.
    pub fn begin_changes(&self, session: &Session, now: Instant) -> ChangeSet {
        ChangeSet::new(
            ulid_at(now.millis),
            &session.id,
            &session.client,
            now.millis,
        )
    }

    /// The folder of a set: refused for an id that is not one this makes.
    pub(super) fn changes_dir(&self, id: &str) -> Result<PathBuf> {
        if !plain_id(id) {
            return Err(Error::Invalid(format!("Not a change set: {id}")));
        }
        Ok(self.vault.root().join(CHANGES).join(id))
    }

    /// Keeps the set in the cache, so staged pictures never lack their record.
    pub(super) fn save_changes(&self, set: &ChangeSet) -> Result<()> {
        let file = self.changes_dir(&set.id)?.join(SET_FILE);
        let text = serde_json::to_string(set).map_err(|e| Error::Invalid(e.to_string()))?;
        write_atomic(&file, text.as_bytes())?;
        Ok(())
    }

    /// A set kept in the cache, such as one an earlier run of the app left.
    pub fn load_changes(&self, id: &str) -> Result<ChangeSet> {
        let file = self.changes_dir(id)?.join(SET_FILE);
        let text = std::fs::read_to_string(&file).map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => Error::NotFound(format!("change set {id}")),
            _ => Error::Io(err),
        })?;
        let set: ChangeSet =
            serde_json::from_str(&text).map_err(|e| Error::Invalid(e.to_string()))?;
        if set.id != id {
            return Err(Error::Invalid(format!("Not a change set: {id}")));
        }
        Ok(set)
    }

    /// Throws a set away: removes its folder in the cache. The vault is not
    /// touched, and nothing of the set was ever committed.
    pub fn discard_changes(&self, set: &ChangeSet) -> Result<()> {
        let dir = self.changes_dir(&set.id)?;
        match std::fs::symlink_metadata(&dir) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
                std::fs::remove_dir_all(&dir)?;
            }
            Ok(_) => return Err(Error::InvalidPath(set.id.clone())),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.into()),
        }
        Ok(())
    }

    /// The file at `path` as the vault has it now, by what it is.
    fn version_of(&self, path: &str, kind: FileKind) -> Result<Version> {
        match kind {
            FileKind::Note => {
                let note = self.vault.read(path)?;
                Ok(Version {
                    text: note.text,
                    hash: note.hash,
                })
            }
            FileKind::Deck => {
                let deck = crate::deck::read_deck(&self.vault, path)?;
                Ok(Version {
                    text: deck.text,
                    hash: deck.hash,
                })
            }
            FileKind::Diagram => {
                let diagram = crate::diagrams::read_diagram(&self.vault, path)?;
                Ok(Version {
                    hash: content_hash(&diagram.xml),
                    text: diagram.xml,
                })
            }
            FileKind::Board => {
                let file = self.vault.file_of(path, &[".canvas"])?;
                let text = std::fs::read_to_string(&file).map_err(|err| match err.kind() {
                    std::io::ErrorKind::NotFound => Error::NotFound(path.to_owned()),
                    _ => Error::Io(err),
                })?;
                Ok(Version {
                    hash: content_hash(&text),
                    text,
                })
            }
        }
    }

    /// The text of `path` as the set leaves it, else as the vault has it
    /// (then with the version the set would start from, read once, so the
    /// text planned from it and the version it is applied against agree).
    pub(super) fn starting_from(
        &self,
        set: &ChangeSet,
        path: &str,
        kind: FileKind,
    ) -> Result<(String, Option<Version>)> {
        match set.text_of(path) {
            Some(text) => Ok((text.to_owned(), None)),
            None => {
                let base = self.version_of(path, kind)?;
                Ok((base.text.clone(), Some(base)))
            }
        }
    }

    /// Makes `text` what the set holds for `path`: a file only the set has, a
    /// file it already changes, or (with `base`, from `starting_from`) a file
    /// of the vault.
    pub(super) fn put_text(
        &self,
        set: &mut ChangeSet,
        path: &str,
        kind: FileKind,
        base: Option<Version>,
        text: String,
    ) -> Result<()> {
        if let Some(file) = set.created_files.iter_mut().find(|f| f.provisional == path) {
            file.text = text;
        } else if let Some(file) = set.files.get_mut(path) {
            file.text = text;
        } else {
            let base = match base {
                Some(base) => base,
                None => self.version_of(path, kind)?,
            };
            set.files.insert(
                path.to_owned(),
                StagedFile {
                    base_hash: base.hash,
                    base: base.text,
                    text,
                    kind,
                },
            );
        }
        check_limits(set)
    }

    /// Adds a file only the set has.
    pub(super) fn put_new(&self, set: &mut ChangeSet, file: NewFile) -> Result<()> {
        set.created_files.push(file);
        check_limits(set)
    }
}

/// Refuses a set that has grown past its limits.
pub(super) fn check_limits(set: &ChangeSet) -> Result<()> {
    let files = set.files.len() + set.created_files.len();
    if files > MAX_STAGED_FILES {
        return Err(Error::Invalid(format!(
            "A chat may stage changes to at most {MAX_STAGED_FILES} files; apply or discard the ones staged so far first"
        )));
    }
    if set.staged_bytes() > MAX_STAGED_BYTES {
        return Err(Error::Invalid(format!(
            "A chat may stage at most {} MB of text; apply or discard the changes staged so far first",
            MAX_STAGED_BYTES / 1024 / 1024
        )));
    }
    Ok(())
}
