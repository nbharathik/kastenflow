//! The layout library through the engine: layouts kept for every deck in `templates/layouts/`
//! (deck/library.rs). Saving and removing are one commit each, which Undo takes back. Removing moves
//! the file to the trash; nothing is deleted. An agent never writes here on its own: the folder is in
//! `templates/`, which agents may not write, so an agent's save is held for the person (agent
//! policy) and runs as a person's save when it is accepted.

use super::{Change, Kasten};
use crate::deck::{self, LayoutFile, LayoutInfo, LayoutSaved};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::rollback::Rollback;
use crate::time::Instant;

impl Kasten {
    /// The layouts in the library, by name. A file that cannot be used is listed with its problem.
    pub fn layout_library(&self) -> Result<Vec<LayoutInfo>> {
        deck::list_layouts(&self.vault)
    }

    /// The library file at `path`, with the hash it has.
    pub fn library_layout(&self, path: &str) -> Result<LayoutFile> {
        deck::read_layout(&self.vault, path)
    }

    /// Keeps `text` (the editor writes it: see deck/library.rs) in the library. The file with its id
    /// is replaced by it, the old text staying in the history; a new id makes a new file. One commit.
    pub fn save_library_layout(
        &self,
        actor: &Actor,
        text: &str,
        now: Instant,
    ) -> Result<LayoutSaved> {
        // Checked before the lock is taken, so a bad file waits for nothing.
        let head = deck::layout_head(text)?;
        self.apply(actor, "save_library_layout", false, now.millis, |vault| {
            let saved = deck::save_layout(vault, text)?;
            if saved.unchanged {
                return Ok(Change {
                    message: String::new(),
                    paths: Vec::new(),
                    value: saved,
                });
            }
            let verb = if saved.replaced { "update" } else { "save" };
            Ok(Change {
                message: format!("layout: {verb} {}", head.label),
                paths: vec![saved.path.clone()],
                value: saved,
            })
        })
    }

    /// Takes the layout at `path` out of the library by moving its file to the trash; returns where it
    /// went. Decks that hold a copy are not touched. One commit.
    pub fn remove_library_layout(&self, actor: &Actor, path: &str, now: Instant) -> Result<String> {
        self.apply(actor, "remove_library_layout", false, now.millis, |vault| {
            let current = deck::read_layout(vault, path)?;
            let label = deck::layout_head(&current.text)
                .map_or_else(|_| path.to_owned(), |head| head.label);
            let file = vault.file_of(path, &[deck::LAYOUT_EXT])?;
            let stamp = crate::trash::free_stamp(vault, now);
            let target = vault.root().join(".trash").join(&stamp).join(path);
            let mut done = Rollback::default();
            if let Err(err) = done.rename(&file, &target) {
                done.put_back();
                return Err(Error::from(err));
            }
            let trashed = format!(".trash/{stamp}/{path}");
            Ok(Change {
                message: format!("trash: layout {label}"),
                paths: vec![path.to_owned(), trashed.clone()],
                value: trashed,
            })
        })
    }
}
