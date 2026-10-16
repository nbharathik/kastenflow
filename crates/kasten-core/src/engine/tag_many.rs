//! One tag onto many notes as one change: what dropping pages on a tag's
//! gallery, or "Add existing pages", does. The notes stay where they are and
//! nothing but their tags (and the day they were updated) changes; a note that
//! has the tag already is left as it is; if one cannot be tagged none is, and
//! one commit holds the lot, so Undo takes it all back.

use serde::Serialize;

use super::edit::tags_text;
use super::{Change, Kasten};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::note::NoteMeta;
use crate::rollback::Rollback;
use crate::time::Instant;

/// The most notes one request names.
pub const MAX_TAGGED: usize = 500;
/// The longest tag, in characters.
const MAX_TAG: usize = 40;

/// What adding a tag to many notes did.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAdded {
    /// The tag, as it was written to the notes.
    pub tag: String,
    /// The notes that carry it now and did not before.
    pub changed: Vec<NoteMeta>,
    /// The paths that carried it already (in any case) and were left alone.
    pub already: Vec<String>,
    /// The one commit, for Undo; none when nothing changed or the vault has no history.
    pub commit: Option<String>,
}

/// `tag` as the tag a note takes: no `#`, letters, digits, `-`, `_` and `/`.
fn clean(tag: &str) -> Result<String> {
    let tag = tag.trim().trim_start_matches('#').trim();
    let fine = !tag.is_empty()
        && tag.chars().count() <= MAX_TAG
        && tag
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '/'));
    if !fine {
        return Err(Error::Invalid(format!(
            "“{}” cannot be a tag: tags are letters, digits, dashes, underscores and slashes, up to {MAX_TAG} characters",
            tag.chars().take(MAX_TAG).collect::<String>()
        )));
    }
    Ok(tag.to_owned())
}

impl Kasten {
    /// Adds `tag` to the notes at `paths` in one commit. A path named twice
    /// counts once. Every note is read before any is written, so a path that
    /// is no note, or one an agent may not write, refuses the whole.
    pub fn add_tag_to_many(
        &self,
        actor: &Actor,
        paths: &[String],
        tag: &str,
        now: Instant,
    ) -> Result<TagAdded> {
        let tag = clean(tag)?;
        if paths.is_empty() {
            return Err(Error::Invalid("Name at least one page to tag".to_owned()));
        }
        if paths.len() > MAX_TAGGED {
            return Err(Error::Invalid(format!(
                "Tag at most {MAX_TAGGED} pages at a time"
            )));
        }
        let mut unique: Vec<&str> = Vec::new();
        for path in paths {
            if !unique.contains(&path.as_str()) {
                unique.push(path);
            }
        }
        if actor.is_agent() {
            for path in &unique {
                self.writable(path)?;
            }
        }
        let ((changed, already), commit) =
            self.apply_committing(actor, "add_tag_to_many", false, now.millis, &[], |vault| {
                let mut already: Vec<String> = Vec::new();
                let mut plan: Vec<(String, String, String)> = Vec::new();
                for path in &unique {
                    let current = vault.read(path)?;
                    match tags_text(&current.text, std::slice::from_ref(&tag), &[], now)? {
                        None => already.push((*path).to_owned()),
                        Some(text) => plan.push(((*path).to_owned(), current.text, text)),
                    }
                }
                let mut undo = Rollback::default();
                let written = (|| -> Result<()> {
                    for (path, before, after) in &plan {
                        undo.write(
                            &vault.path_of(path)?,
                            after.as_bytes(),
                            Some(before.clone().into_bytes()),
                        )?;
                    }
                    Ok(())
                })();
                if let Err(err) = written {
                    undo.put_back();
                    return Err(err);
                }
                let changed: Vec<NoteMeta> = plan
                    .iter()
                    .map(|(path, _, _)| vault.read(path).map(|note| note.meta))
                    .collect::<Result<_>>()?;
                let message = match changed.as_slice() {
                    [] => String::new(),
                    [one] => format!("tags: {}", one.title),
                    many => format!("tags: add #{tag} to {} notes", many.len()),
                };
                Ok(Change {
                    message,
                    paths: plan.into_iter().map(|(path, _, _)| path).collect(),
                    value: (changed, already),
                })
            })?;
        Ok(TagAdded {
            tag,
            changed,
            already,
            commit,
        })
    }
}
