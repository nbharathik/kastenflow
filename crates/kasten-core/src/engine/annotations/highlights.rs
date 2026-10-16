//! Highlights on a captured web page: adding, changing, moving and removing
//! them in the page's `.highlights.json`. Each is one commit that Undo takes
//! back, and history keeps a highlight that was removed. The card's text is
//! never touched.

use super::{author_of, read_sidecar};
use crate::atomic::write_atomic;
use crate::companions::{self, HIGHLIGHTS};
use crate::engine::{Change, Kasten};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::id::ulid_at;
use crate::sources::shortened;
use crate::text_highlights::{
    self, NewTextHighlight, TextAnchor, TextHighlight, TextHighlightEdit, TextHighlights,
};
use crate::time::Instant;
use crate::vault::Vault;

fn read_highlights(vault: &Vault, note: &str) -> Result<TextHighlights> {
    let rel = text_highlights::sidecar_of(note)?;
    read_sidecar(vault, &rel, HIGHLIGHTS)?
        .map_or_else(|| Ok(TextHighlights::new()), |t| TextHighlights::parse(&t))
}

impl Kasten {
    /// The highlights on the page at `note`, in the order they were made. A
    /// note beside a PDF of the same name has none: that file is the PDF's.
    pub fn text_highlights(&self, note: &str) -> Result<Vec<TextHighlight>> {
        self.vault.read(note)?;
        if companions::pdf_owns_highlights(&self.vault, note) {
            return Ok(Vec::new());
        }
        Ok(read_highlights(&self.vault, note)?.highlights())
    }

    /// Changes the highlights file of `note` in one commit: `change` edits it
    /// and gives its result with the commit message, or None for the message
    /// when nothing changed (then nothing is written).
    fn edit_highlights<T>(
        &self,
        actor: &Actor,
        op: &str,
        note: &str,
        now: Instant,
        change: impl FnOnce(&mut TextHighlights, &str) -> Result<(T, Option<String>)>,
    ) -> Result<T> {
        self.apply(actor, op, false, now.millis, |vault| {
            let page = self.annotated(actor, note)?;
            if companions::pdf_owns_highlights(vault, note) {
                return Err(Error::Invalid(format!(
                    "“{}” has the name of a PDF in sources, whose highlights are kept under that name, so this page cannot be highlighted. Rename the page or the PDF",
                    page.meta.title
                )));
            }
            let mut file = read_highlights(vault, note)?;
            let (value, message) = change(&mut file, &page.meta.title)?;
            let Some(message) = message else {
                return Ok(Change {
                    value,
                    paths: Vec::new(),
                    message: String::new(),
                });
            };
            let rel = text_highlights::sidecar_of(note)?;
            write_atomic(&vault.file_of(&rel, &[HIGHLIGHTS])?, file.to_text().as_bytes())?;
            Ok(Change {
                value,
                paths: vec![rel],
                message,
            })
        })
    }

    /// Highlights words of the page at `note`.
    pub fn add_text_highlight(
        &self,
        actor: &Actor,
        note: &str,
        new: &NewTextHighlight,
        now: Instant,
    ) -> Result<TextHighlight> {
        new.check()?;
        self.edit_highlights(actor, "add_text_highlight", note, now, |file, title| {
            let id = format!("h-{}", ulid_at(now.millis));
            let added = file.add(&id, new, &now.rfc3339())?;
            let quote = shortened(&new.anchor.quote, 60, 50);
            Ok((added, Some(format!("highlight: “{quote}” on {title}"))))
        })
    }

    /// Changes the colour or comment of highlight `id`.
    pub fn edit_text_highlight(
        &self,
        actor: &Actor,
        note: &str,
        id: &str,
        edit: &TextHighlightEdit,
        now: Instant,
    ) -> Result<TextHighlight> {
        self.edit_highlights(actor, "edit_text_highlight", note, now, |file, title| {
            let (edited, changed) = file.edit(id, edit)?;
            Ok((
                edited,
                changed.then(|| format!("highlight: edit on {title}")),
            ))
        })
    }

    /// Gives highlight `id` a new place (its quote and what stands around it),
    /// as when the page it was made on has changed.
    pub fn move_text_highlight(
        &self,
        actor: &Actor,
        note: &str,
        id: &str,
        anchor: &TextAnchor,
        now: Instant,
    ) -> Result<TextHighlight> {
        self.edit_highlights(actor, "move_text_highlight", note, now, |file, title| {
            let (moved, changed) = file.relocate(id, anchor)?;
            Ok((
                moved,
                changed.then(|| format!("highlight: move on {title}")),
            ))
        })
    }

    /// Takes highlight `id` off the page. Only a person does; history keeps it.
    pub fn remove_text_highlight(
        &self,
        actor: &Actor,
        note: &str,
        id: &str,
        now: Instant,
    ) -> Result<()> {
        if actor.is_agent() {
            return Err(Error::Invalid(format!(
                "Only a person removes highlights; {} cannot",
                author_of(actor)
            )));
        }
        self.edit_highlights(actor, "remove_text_highlight", note, now, |file, title| {
            file.remove(id)?;
            Ok(((), Some(format!("highlight: remove from {title}"))))
        })
    }
}
