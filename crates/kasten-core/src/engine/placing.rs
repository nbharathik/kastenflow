//! The ops that place a note somewhere else: moving it to a project or the
//! library, putting it inside a page and turning a card into a page. Each
//! takes the note's sub-pages along and says where every file went, so an
//! app can follow them all (tabs, favourites, open editors).

use serde::Serialize;

use super::ops::title_of;
use super::{Change, Kasten};
use crate::companions;
use crate::error::Result;
use crate::history::Actor;
use crate::note::NoteFile;
use crate::ops;
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::Vault;

/// A note after an op that can move files: every (from, to) move the op
/// made, its sub-pages' included, and the other notes whose links it
/// rewrote so they keep going where they went.
#[derive(Debug, Clone, Serialize)]
pub struct Placed {
    #[serde(flatten)]
    pub note: NoteFile,
    pub moves: Vec<(String, String)>,
    pub relinked: Vec<String>,
}

/// The paths a placing op touched: every move's two ends and the rest.
fn touched(moves: &[(String, String)], rest: impl IntoIterator<Item = String>) -> Vec<String> {
    moves
        .iter()
        .flat_map(|(from, to)| [from.clone(), to.clone()])
        .chain(rest)
        .collect()
}

/// Takes the comments and highlights files of the notes in `moves` along to
/// their new names, and gives the paths they touched (both ends of each). If
/// that fails, the notes are put back where they were, so a page and its
/// files are never parted.
fn carry_along(vault: &Vault, moves: &[(String, String)]) -> Result<Vec<String>> {
    let mut done = Rollback::default();
    match companions::carry(vault, moves, &mut done) {
        Ok(carried) => Ok(carried.into_iter().flat_map(|(a, b)| [a, b]).collect()),
        Err(err) => {
            done.put_back();
            for (from, to) in moves.iter().rev() {
                if let (Ok(back), Ok(was)) = (vault.path_of(to), vault.path_of(from)) {
                    let _ = std::fs::rename(back, was);
                }
            }
            Err(err)
        }
    }
}

impl Kasten {
    /// Moves a note, with its sub-pages, into `project` or the library.
    pub fn move_note(&self, actor: &Actor, path: &str, project: Option<&str>) -> Result<NoteFile> {
        self.move_placed(actor, path, project).map(|p| p.note)
    }

    /// `move_note`, saying where every file went.
    pub fn move_placed(&self, actor: &Actor, path: &str, project: Option<&str>) -> Result<Placed> {
        self.apply(actor, "move_note", false, Instant::now().millis, |vault| {
            let notes = self.index().notes()?;
            let (note, moves) = crate::moving::move_note_among(vault, path, project, &notes)?;
            let files = carry_along(vault, &moves)?;
            let relinked = self.keep_after(vault, &notes, &moves)?;
            let note = vault.read(&note.meta.path)?;
            let boards = crate::board::relink_boards(vault, &moves)?;
            Ok(Change {
                message: format!(
                    "move: {} to {}",
                    note.meta.title,
                    project.unwrap_or("library")
                ),
                paths: touched(
                    &moves,
                    boards.into_iter().chain(relinked.clone()).chain(files),
                ),
                value: Placed {
                    note,
                    moves,
                    relinked,
                },
            })
        })
    }

    /// Moves the note at `path`, with its sub-pages, back into the inbox;
    /// links keep going where they went. One commit.
    pub fn move_to_inbox(&self, actor: &Actor, path: &str) -> Result<Placed> {
        self.apply(actor, "move_note", false, Instant::now().millis, |vault| {
            let notes = self.index().notes()?;
            let (note, moves) = crate::moving::move_to_inbox_among(vault, path, &notes)?;
            let files = carry_along(vault, &moves)?;
            let relinked = self.keep_after(vault, &notes, &moves)?;
            let note = vault.read(&note.meta.path)?;
            let boards = crate::board::relink_boards(vault, &moves)?;
            Ok(Change {
                message: format!("move: {} to inbox", note.meta.title),
                paths: touched(
                    &moves,
                    boards.into_iter().chain(relinked.clone()).chain(files),
                ),
                value: Placed {
                    note,
                    moves,
                    relinked,
                },
            })
        })
    }

    /// Puts the page at `path` inside the page at `parent`, or with None
    /// makes it a page of its own; links keep going where they went.
    pub fn nest(
        &self,
        actor: &Actor,
        path: &str,
        parent: Option<&str>,
        now: Instant,
    ) -> Result<NoteFile> {
        self.nest_placed(actor, path, parent, now).map(|p| p.note)
    }

    /// `nest`, saying where every file went.
    pub fn nest_placed(
        &self,
        actor: &Actor,
        path: &str,
        parent: Option<&str>,
        now: Instant,
    ) -> Result<Placed> {
        self.apply(actor, "nest_note", false, now.millis, |vault| {
            let notes = self.index().notes()?;
            let crate::moving::Nested {
                note,
                moves,
                gave_id,
            } = crate::moving::nest_note_among(vault, path, parent, &notes, now)?;
            let files = carry_along(vault, &moves)?;
            let relinked = self.keep_after(vault, &notes, &moves)?;
            let note = vault.read(&note.meta.path)?;
            let boards = crate::board::relink_boards(vault, &moves)?;
            let message = match parent {
                Some(parent) => format!("nest: {} in {}", note.meta.title, title_of(vault, parent)),
                None => format!("unnest: {}", note.meta.title),
            };
            let rest = [path.to_owned(), note.meta.path.clone()]
                .into_iter()
                .chain(boards)
                .chain(relinked.clone())
                .chain(gave_id)
                .chain(files);
            Ok(Change {
                message,
                paths: touched(&moves, rest),
                value: Placed {
                    note,
                    moves,
                    relinked,
                },
            })
        })
    }

    /// Turns a card into a page or back, and files it where its new kind
    /// lives: its project's pages or cards, or the library for the inbox.
    /// Boards follow it; one commit.
    pub fn convert_note(
        &self,
        actor: &Actor,
        path: &str,
        kind: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        self.convert_placed(actor, path, kind, now).map(|p| p.note)
    }

    /// `convert_note`, saying where every file went.
    pub fn convert_placed(
        &self,
        actor: &Actor,
        path: &str,
        kind: &str,
        now: Instant,
    ) -> Result<Placed> {
        let current = self.vault.read(path)?;
        if current.meta.kind == kind {
            return Ok(Placed {
                note: current,
                moves: Vec::new(),
                relinked: Vec::new(),
            });
        }
        let notes = self.index().notes()?;
        self.apply(actor, "convert_note", false, now.millis, |vault| {
            let note = ops::set_kind(vault, path, kind, now)?;
            let project = note.meta.project.clone();
            let (note, moves) =
                crate::moving::file_note_among(vault, path, project.as_deref(), &notes)?;
            let files = carry_along(vault, &moves)?;
            let relinked = self.keep_after(vault, &notes, &moves)?;
            let note = vault.read(&note.meta.path)?;
            let boards = crate::board::relink_boards(vault, &moves)?;
            let rest = std::iter::once(path.to_owned())
                .chain(boards)
                .chain(relinked.clone())
                .chain(files);
            Ok(Change {
                message: format!("convert: {} to a {kind}", note.meta.title),
                paths: touched(&moves, rest),
                value: Placed {
                    note,
                    moves,
                    relinked,
                },
            })
        })
    }
}
