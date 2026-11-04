//! Renaming a note as one engine op: the title, the file's name, the links
//! in other notes, the page's comments and highlights files and the boards
//! that show it. If any step fails, every earlier step is put back.

use super::ops::title_of;
use super::{Change, Kasten};
use crate::companions;
use crate::error::Result;
use crate::history::Actor;
use crate::note::NoteMeta;
use crate::rename::{Renamed, rename_note_with};
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::Vault;

impl Kasten {
    pub fn rename(&self, actor: &Actor, path: &str, title: &str, now: Instant) -> Result<Renamed> {
        let renamed = self.apply(actor, "rename_note", false, now.millis, |vault| {
            let old = title_of(vault, path);
            let before = self.index().notes()?;
            let candidates = match before.iter().find(|n| n.path == path) {
                Some(note) => self.linking_any(&[note], &[title])?,
                None => Vec::new(),
            };
            let mut done = Rollback::default();
            match rename_steps(vault, path, title, now, &before, &candidates, &mut done) {
                Ok((renamed, paths)) => Ok(Change {
                    message: format!("rename: {old} → {}", renamed.note.meta.title),
                    paths,
                    value: renamed,
                }),
                Err(err) => {
                    // The page, its files, its title and every link go back
                    // as they were: nothing is left half renamed.
                    done.put_back();
                    Err(err)
                }
            }
        })?;
        // The editor goes on from this version, so a save can merge with it.
        self.remember(&renamed.note.hash, &renamed.note.text);
        Ok(renamed)
    }
}

/// The steps of a rename, each noted in `done`; the renamed note and every
/// path the change touched.
fn rename_steps(
    vault: &Vault,
    path: &str,
    title: &str,
    now: Instant,
    before: &[NoteMeta],
    candidates: &[String],
    done: &mut Rollback,
) -> Result<(Renamed, Vec<String>)> {
    let renamed = rename_note_with(vault, path, title, now, before, candidates, done)?;
    let mut paths = vec![path.to_owned(), renamed.note.meta.path.clone()];
    paths.extend(renamed.relinked.iter().cloned());
    if renamed.note.meta.path != path {
        let moved = [(path.to_owned(), renamed.note.meta.path.clone())];
        // Its comments and highlights files follow it to the new name.
        let carried = companions::carry(vault, &moved, done)?;
        paths.extend(carried.into_iter().flat_map(|(a, b)| [a, b]));
        paths.extend(crate::board::relink_boards_with(vault, &moved, done)?);
    }
    Ok((renamed, paths))
}
