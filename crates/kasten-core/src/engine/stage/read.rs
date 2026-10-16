//! Reading through a change set: what the chat sees is the vault with its own
//! staged changes on top, so a second step builds on the first and a note it
//! made can be read, named and changed again before anything is applied.

use super::super::DeckInfo;
use super::super::Kasten;
use crate::agent::{ChangeSet, FileKind};
use crate::board::{BoardView, Canvas};
use crate::deck::{self, DeckFile};
use crate::diagrams::{DiagramFile, Preview};
use crate::error::{Error, Result};
use crate::frontmatter::{Front, split};
use crate::note::{NoteFile, content_hash, meta_for};

/// A note's id and title as its staged text says.
fn front_of(text: &str) -> (Option<String>, Option<String>) {
    let front = Front::read(split(text).prefix);
    (Front::text(&front.id), Front::text(&front.title))
}

/// What a name comes to when the vault answered `found` and the set has the
/// paths in `same` by that name: the vault's, the set's, or an ambiguity.
fn pick(found: Result<String>, same: &[&str], noun: &str, wanted: &str) -> Result<String> {
    match (found, same) {
        (Ok(path), []) => Ok(path),
        (Err(err), []) => Err(err),
        (Err(Error::Invalid(why)), [one]) if why.starts_with("No ") => Ok((*one).to_owned()),
        (found, many) => {
            let mut paths: Vec<String> = many.iter().map(|p| (*p).to_owned()).collect();
            if let Ok(path) = found {
                paths.insert(0, path);
            }
            Err(Error::Invalid(format!(
                "Several {noun}s are called “{wanted}”; name one by path: {}",
                paths.join(", ")
            )))
        }
    }
}

impl Kasten {
    /// The note at `path` as the set leaves it; none when the set does not
    /// hold it (it is as the vault has it).
    pub fn staged_note(&self, set: &ChangeSet, path: &str) -> Option<NoteFile> {
        if !path.ends_with(".md") {
            return None;
        }
        let text = set.text_of(path)?;
        Some(NoteFile {
            meta: meta_for(path, text, set.created),
            hash: content_hash(text),
            text: text.to_owned(),
        })
    }

    /// `read`, through the set.
    pub fn read_in(&self, set: &ChangeSet, path: &str) -> Result<NoteFile> {
        match self.staged_note(set, path) {
            Some(note) => Ok(note),
            None => self.read(path),
        }
    }

    /// `resolve`, through the set: a note it makes is found by its path, its
    /// id or its title, as the vault's are.
    pub fn resolve_staged(&self, set: &ChangeSet, reference: &str) -> Result<String> {
        let wanted = reference.trim();
        let inner = wanted
            .strip_prefix("[[")
            .and_then(|x| x.strip_suffix("]]"))
            .map(|inner| crate::links::parts(inner).target)
            .unwrap_or(wanted);
        let as_path = if inner.ends_with(".md") {
            inner.to_owned()
        } else {
            format!("{inner}.md")
        };
        if set.is_new(&as_path) {
            return Ok(as_path);
        }
        let made: Vec<(&str, Option<String>, Option<String>)> = set
            .created_files
            .iter()
            .filter(|f| f.kind == FileKind::Note)
            .map(|f| {
                let (id, title) = front_of(&f.text);
                (f.provisional.as_str(), id, title)
            })
            .collect();
        if let Some((path, ..)) = made
            .iter()
            .find(|(_, id, _)| id.as_deref() == Some(inner) && !inner.is_empty())
        {
            return Ok((*path).to_owned());
        }
        let title = inner.to_lowercase();
        let same: Vec<&str> = made
            .iter()
            .filter(|(.., t)| t.as_ref().is_some_and(|t| t.trim().to_lowercase() == title))
            .map(|(p, ..)| *p)
            .collect();
        pick(self.resolve(inner), &same, "note", inner)
    }

    /// `resolve_board`, through the set.
    pub fn resolve_board_staged(&self, set: &ChangeSet, reference: &str) -> Result<String> {
        let wanted = reference.trim();
        if set.is_new(wanted) && wanted.ends_with(".canvas") {
            return Ok(wanted.to_owned());
        }
        let title = wanted.to_lowercase();
        let same: Vec<&str> = set
            .created_files
            .iter()
            .filter(|f| f.kind == FileKind::Board && f.title.trim().to_lowercase() == title)
            .map(|f| f.provisional.as_str())
            .collect();
        pick(self.resolve_board(wanted), &same, "board", wanted)
    }

    /// `resolve_diagram`, through the set.
    pub fn resolve_diagram_staged(&self, set: &ChangeSet, reference: &str) -> Result<String> {
        let wanted = reference.trim();
        if set.is_new(wanted) && wanted.ends_with(crate::diagrams::EXT) {
            return Ok(wanted.to_owned());
        }
        let title = wanted.to_lowercase();
        let same: Vec<&str> = set
            .created_files
            .iter()
            .filter(|f| f.kind == FileKind::Diagram && f.title.trim().to_lowercase() == title)
            .map(|f| f.provisional.as_str())
            .collect();
        pick(self.resolve_diagram(wanted), &same, "diagram", wanted)
    }

    /// `board`, through the set.
    pub fn board_in(&self, set: &ChangeSet, path: &str) -> Result<BoardView> {
        match set.text_of(path).filter(|_| path.ends_with(".canvas")) {
            Some(text) => {
                let canvas = Canvas::parse(text)?;
                Ok(BoardView::with_titles(path, &canvas, self.card_titles()?))
            }
            None => self.board(path),
        }
    }

    /// `diagram`, through the set.
    pub fn diagram_in(&self, set: &ChangeSet, path: &str) -> Result<DiagramFile> {
        match set
            .text_of(path)
            .filter(|_| path.ends_with(crate::diagrams::EXT))
        {
            Some(xml) => Ok(DiagramFile {
                path: path.to_owned(),
                xml: xml.to_owned(),
                hash: content_hash(xml),
                modified: set.created,
                preview: Preview::Missing,
            }),
            None => self.diagram(path),
        }
    }

    /// The deck at `path` as the set leaves it, if the set holds it.
    pub fn staged_deck(&self, set: &ChangeSet, path: &str) -> Option<DeckFile> {
        if !path.ends_with(".deck") {
            return None;
        }
        let text = set.text_of(path)?;
        Some(DeckFile {
            path: path.to_owned(),
            hash: content_hash(text),
            text: text.to_owned(),
            modified: set.created,
        })
    }

    /// `deck`, through the set.
    pub fn deck_in(&self, set: &ChangeSet, path: &str) -> Result<DeckFile> {
        match self.staged_deck(set, path) {
            Some(deck) => Ok(deck),
            None => self.deck(path),
        }
    }

    /// The decks the set makes, as lists show decks.
    pub fn staged_decks(&self, set: &ChangeSet) -> Vec<DeckInfo> {
        set.created_files
            .iter()
            .filter(|f| f.kind == FileKind::Deck)
            .map(|f| {
                let head = deck::head_of(&f.text).ok();
                DeckInfo {
                    path: f.provisional.clone(),
                    title: head
                        .as_ref()
                        .and_then(|h| h.title.clone())
                        .unwrap_or_else(|| f.title.clone()),
                    project: super::super::boards::project_of(&f.provisional),
                    slides: head.as_ref().map_or(0, |h| h.slides),
                    modified: set.created,
                    size: f.text.len() as u64,
                    problem: None,
                }
            })
            .collect()
    }

    /// The bytes of a picture the set holds, if it holds one at `path`.
    pub fn staged_asset_bytes(&self, set: &ChangeSet, path: &str) -> Result<Option<Vec<u8>>> {
        let Some(asset) = set.asset_at(path) else {
            return Ok(None);
        };
        let file = self
            .changes_dir(&set.id)?
            .join(super::ASSETS_FOLDER)
            .join(&asset.file);
        Ok(Some(std::fs::read(file)?))
    }
}
