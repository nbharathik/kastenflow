//! Saving a note's body as the editor types: written under the note's own
//! frontmatter, left alone when unchanged, and never overwriting a change
//! made on disk since the editor loaded the note.

use serde::Serialize;

use crate::atomic::{create_atomic, write_atomic};
use crate::error::Result;
use crate::frontmatter::{Front, body_under, join, set_key, split, yaml_ok};
use crate::id::ulid_at;
use crate::note::NoteFile;
use crate::ops::eol_of;
use crate::time::Instant;
use crate::vault::Vault;

/// The result of saving a note's body.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Saved {
    /// Written; `note` is the file as it is now.
    Written { note: NoteFile },
    /// The body was already on disk; nothing was written.
    Unchanged { note: NoteFile },
    /// The file changed on disk since it was loaded. The editor's version
    /// went to `copy` and the file was left alone.
    Conflict { copy: String, note: NoteFile },
    /// The file changed on disk since it was loaded, on other lines: both
    /// sets of edits were merged and written.
    Merged { note: NoteFile },
}

/// The file text that saving `body` under the frontmatter of `current` makes,
/// with `updated` bumped; None when the file already holds that body. The
/// pure step of `save_body`, which a staged change shares so that what it
/// plans is what the real save writes.
pub(crate) fn saved_text(current: &str, body: &str, now: Instant) -> Option<String> {
    let parts = split(current);
    if parts.body == body_under(parts.prefix, body) {
        return None;
    }
    let eol = eol_of(current);
    // `updated` goes only into frontmatter that is there and reads: not
    // into a byte order mark alone, nor a note that opens with two rules.
    let fenced = !parts.prefix.trim_start_matches('\u{feff}').is_empty();
    let prefix = if fenced && yaml_ok(parts.prefix) {
        set_key(parts.prefix, "updated", Some(&now.rfc3339()), eol)
    } else {
        parts.prefix.to_owned()
    };
    Some(join(&prefix, body, eol))
}

/// Writes `body` under the note's current frontmatter if the file still has
/// `base_hash`; bumps `updated` when the body changes.
pub fn save_body(
    vault: &Vault,
    rel: &str,
    body: &str,
    base_hash: &str,
    now: Instant,
) -> Result<Saved> {
    let current = vault.read(rel)?;
    if current.hash != base_hash {
        let copy = conflict_copy(vault, &current, body, now)?;
        return Ok(Saved::Conflict {
            copy,
            note: current,
        });
    }
    let Some(text) = saved_text(&current.text, body, now) else {
        return Ok(Saved::Unchanged { note: current });
    };
    write_atomic(&vault.path_of(rel)?, text.as_bytes())?;
    Ok(Saved::Written {
        note: vault.read(rel)?,
    })
}

/// `stem` cut short so that ` (<label> NN).md` after its name still fits
/// in 255 bytes.
pub(crate) fn fitting(stem: &str, label: usize) -> &str {
    let name_at = stem.rfind('/').map_or(0, |i| i + 1);
    let mut end = stem
        .len()
        .min(name_at + 255usize.saturating_sub(label + 12));
    while !stem.is_char_boundary(end) {
        end -= 1;
    }
    &stem[..end]
}

/// Saves the editor's version beside the note as `<name> (conflict <time>).md`,
/// with a new id so both can live in the vault.
fn conflict_copy(vault: &Vault, current: &NoteFile, body: &str, now: Instant) -> Result<String> {
    let rel = &current.meta.path;
    let label = format!("conflict {}", now.file_stamp());
    let stem = fitting(rel.strip_suffix(".md").unwrap_or(rel), label.len());
    let mut path = format!("{stem} ({label}).md");
    let mut n = 2;
    while vault.exists(&path) {
        path = format!("{stem} ({label} {n}).md");
        n += 1;
    }
    let parts = split(&current.text);
    let eol = eol_of(&current.text);
    let mut prefix = parts.prefix.to_owned();
    if !prefix.is_empty() {
        let title = format!("{} ({label})", current.meta.title);
        prefix = set_key(&prefix, "title", Some(&title), eol);
        if Front::read(&prefix).id.is_some() {
            prefix = set_key(&prefix, "id", Some(&ulid_at(now.millis)), eol);
        }
    }
    create_atomic(&vault.path_of(&path)?, join(&prefix, body, eol).as_bytes())?;
    Ok(path)
}
