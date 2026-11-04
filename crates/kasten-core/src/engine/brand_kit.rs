//! The brand kit through the engine: the logo, colours, fonts and default theme that decks start from,
//! kept in `templates/brand/` (deck/brand.rs). Saving is one commit, which Undo takes back. An agent
//! never writes here on its own: the folder is in `templates/`, which agents may not write, so an
//! agent's save is held for the person (agent policy).

use super::{Change, Kasten};
use crate::deck::{self, BrandFile, BrandSaved};
use crate::error::Result;
use crate::history::Actor;
use crate::time::Instant;

impl Kasten {
    /// The brand kit decks of `project` start from: the project's own, else the vault's, else none.
    pub fn brand_kit(&self, project: Option<&str>) -> Result<Option<BrandFile>> {
        deck::effective_brand(&self.vault, project)
    }

    /// Keeps `text` (the editor writes it: see deck/brand.rs) as the brand kit of `project`, or of the
    /// vault when none is named. The old text of a kit that is replaced stays in the history. One commit.
    pub fn save_brand_kit(
        &self,
        actor: &Actor,
        project: Option<&str>,
        text: &str,
        now: Instant,
    ) -> Result<BrandSaved> {
        // Checked before the lock is taken, so a bad file waits for nothing.
        deck::brand_head(text)?;
        let scope = project.map_or_else(|| "vault".to_owned(), |p| format!("project {}", p.trim()));
        self.apply(actor, "save_brand_kit", false, now.millis, |vault| {
            let saved = deck::save_brand(vault, project, text)?;
            if saved.unchanged {
                return Ok(Change {
                    message: String::new(),
                    paths: Vec::new(),
                    value: saved,
                });
            }
            let verb = if saved.replaced { "update" } else { "save" };
            Ok(Change {
                message: format!("brand: {verb} kit of {scope}"),
                paths: vec![saved.path.clone()],
                value: saved,
            })
        })
    }
}
