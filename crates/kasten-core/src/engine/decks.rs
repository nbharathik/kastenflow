//! Slide decks through the engine, for the app and the MCP deck tools: a
//! person's saves are written at once and committed after a pause, like
//! typing; an agent's are committed at once.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::boards::project_of;
use super::{Change, Kasten};
use crate::deck::{self, DeckFile, DeckSaved};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::rollback::Rollback;
use crate::time::Instant;

/// Decks one `save_decks` may change.
pub const MAX_SAVE_DECKS: usize = 500;

/// One deck of a save of several: the text it is to hold, and the hash of the text the person looked at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckEdit {
    pub path: String,
    /// The hash `deck` gave for the file when the new text was worked out.
    pub base_hash: String,
    pub text: String,
}

/// Several decks to save together, with the one line that says why in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDecksRequest {
    pub message: String,
    pub edits: Vec<DeckEdit>,
}

/// What a save of several decks did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecksSaved {
    /// The commit it made, to undo it with; None if nothing changed or the vault keeps no history.
    pub commit: Option<String>,
    /// The decks that were written (the ones whose text was already as asked are not among them).
    pub paths: Vec<String>,
}

/// A deck in lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckInfo {
    pub path: String,
    pub title: String,
    /// The project folder it is in, if any.
    pub project: Option<String>,
    pub slides: usize,
    pub modified: u64,
    pub size: u64,
    /// Why the deck cannot be read, when it cannot. It is still listed, to
    /// be looked at or trashed.
    pub problem: Option<String>,
}

impl Kasten {
    /// Every deck, by title. The slide templates in `templates/slides/` are not among them
    /// (`deck_templates` lists those): they are not the person's decks to open, count or present.
    pub fn decks(&self) -> Result<Vec<DeckInfo>> {
        self.decks_where(|path| !deck::is_template(path))
    }

    /// Every slide template, by title.
    pub fn deck_templates(&self) -> Result<Vec<DeckInfo>> {
        self.decks_where(deck::is_template)
    }

    fn decks_where(&self, wanted: impl Fn(&str) -> bool) -> Result<Vec<DeckInfo>> {
        let mut out = Vec::new();
        for (file, facts) in self.deck_facts()? {
            if !wanted(&file.path) {
                continue;
            }
            out.push(DeckInfo {
                project: project_of(&file.path),
                modified: file.modified,
                size: file.size,
                path: file.path,
                title: facts.title.clone(),
                slides: facts.slides,
                problem: facts.problem.clone(),
            });
        }
        out.sort_by_cached_key(|d| (d.title.to_lowercase(), d.path.clone()));
        Ok(out)
    }

    /// Saves a deck's look as a template in `templates/slides/`, holding `text` (the editor's
    /// engine makes it); returns its path. Only a person makes one: the folder is read-only for
    /// agents, which may read a template and start a deck from it.
    pub fn create_deck_template(
        &self,
        actor: &Actor,
        title: &str,
        text: &str,
        now: Instant,
    ) -> Result<String> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "A template is saved by a person only: templates are read-only for agents".into(),
            ));
        }
        self.apply(actor, "create_template", false, now.millis, |vault| {
            let path = deck::create_template(vault, title, text)?;
            Ok(Change {
                message: format!("template: create {}", title.trim()),
                paths: vec![path.clone()],
                value: path,
            })
        })
    }

    /// The deck at `path`, with the hash a save brings back.
    pub fn deck(&self, path: &str) -> Result<DeckFile> {
        deck::read_deck(&self.vault, path)
    }

    /// A deck's path from its path or title.
    pub fn resolve_deck(&self, reference: &str) -> Result<String> {
        let r = reference.trim();
        if r.ends_with(".deck") && self.vault.file_of(r, &[".deck"]).is_ok_and(|p| p.is_file()) {
            return Ok(r.to_owned());
        }
        let found: Vec<DeckInfo> = self
            .decks()?
            .into_iter()
            .filter(|d| d.title.eq_ignore_ascii_case(r))
            .collect();
        match found.as_slice() {
            [one] => Ok(one.path.clone()),
            [] => Err(Error::Invalid(format!("No deck called “{r}”"))),
            many => Err(Error::Invalid(format!(
                "Several decks are called “{r}”; name one by path: {}",
                many.iter()
                    .map(|d| d.path.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))),
        }
    }

    /// Creates a deck holding `text` (the editor's engine makes it) in
    /// `project` or the library; returns its path.
    pub fn create_deck(
        &self,
        actor: &Actor,
        title: &str,
        project: Option<&str>,
        text: &str,
        now: Instant,
    ) -> Result<String> {
        self.apply(actor, "create_deck", false, now.millis, |vault| {
            let path = deck::create_deck(vault, title, project, text)?;
            Ok(Change {
                message: format!("deck: create {}", title.trim()),
                paths: vec![path.clone()],
                value: path,
            })
        })
    }

    /// Saves a deck's text if the file still has `base_hash`; if it
    /// changed since, the text goes to a copy and the file is left alone.
    pub fn save_deck(
        &self,
        actor: &Actor,
        path: &str,
        text: &str,
        base_hash: &str,
        now: Instant,
    ) -> Result<DeckSaved> {
        self.apply(actor, "save_deck", true, now.millis, |vault| {
            let saved = deck::write_deck(vault, path, text, base_hash, now)?;
            let mut paths = vec![path.to_owned()];
            if let DeckSaved::Conflict { copy, .. } = &saved {
                paths.push(copy.clone());
            }
            Ok(Change {
                message: format!("deck: edit {}", deck::title_at(vault, path)),
                paths,
                value: saved,
            })
        })
    }

    /// Saves several decks together, in one commit, so one undo takes them all back. For a person only. Every deck must
    /// be exactly as it was when the new texts were worked out (same hash) and every new text must be a deck: if
    /// any is not, nothing is written and the person is asked to look again. A deck that already holds the text it
    /// is given is left alone. Nothing is rewritten on the person's behalf: the texts are the editor's own.
    pub fn save_decks(
        &self,
        actor: &Actor,
        req: &SaveDecksRequest,
        now: Instant,
    ) -> Result<DecksSaved> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Saving several decks at once is for a person, not an agent".to_owned(),
            ));
        }
        let message = req.message.trim();
        if message.is_empty() || message.contains(['\n', '\r']) || message.chars().count() > 200 {
            return Err(Error::Invalid(
                "A save of several decks needs a message of one line, up to 200 characters"
                    .to_owned(),
            ));
        }
        if req.edits.is_empty() {
            return Err(Error::Invalid(
                "Nothing to save: no deck was given".to_owned(),
            ));
        }
        if req.edits.len() > MAX_SAVE_DECKS {
            return Err(Error::Invalid(format!(
                "At most {MAX_SAVE_DECKS} decks can be saved at once"
            )));
        }
        let mut seen = HashSet::new();
        for edit in &req.edits {
            if !seen.insert(edit.path.as_str()) {
                return Err(Error::Invalid(format!("{} is listed twice", edit.path)));
            }
        }
        let (mut saved, commit) =
            self.apply_committing(actor, "save_decks", false, now.millis, &[], |vault| {
                // Every deck is read and every text checked before the first write.
                let mut work = Vec::with_capacity(req.edits.len());
                for edit in &req.edits {
                    let current = deck::read_deck(vault, &edit.path)?;
                    if current.hash != edit.base_hash {
                        return Err(Error::Invalid(
                            "Some decks changed since you looked, so nothing was saved. Look again."
                                .to_owned(),
                        ));
                    }
                    deck::head_of(&edit.text)?;
                    work.push((vault.file_of(&edit.path, &[".deck"])?, current.text, edit));
                }
                let mut done = Rollback::default();
                let mut paths = Vec::new();
                for (file, old, edit) in work.iter().filter(|(_, old, edit)| *old != edit.text) {
                    let before = Some(old.clone().into_bytes());
                    if let Err(err) = done.write(file, edit.text.as_bytes(), before) {
                        done.put_back();
                        return Err(err.into());
                    }
                    paths.push(edit.path.clone());
                }
                Ok(Change {
                    message: message.to_owned(),
                    paths: paths.clone(),
                    value: DecksSaved {
                        commit: None,
                        paths,
                    },
                })
            })?;
        saved.commit = commit;
        Ok(saved)
    }

    /// Puts a trashed deck back; returns its path.
    pub fn restore_deck(&self, actor: &Actor, trashed: &str) -> Result<String> {
        self.apply(
            actor,
            "restore_deck",
            false,
            Instant::now().millis,
            |vault| {
                let path = crate::trash::restore_deck(vault, trashed)?;
                Ok(Change {
                    message: format!("restore: {}", deck::title_at(vault, &path)),
                    paths: vec![trashed.to_owned(), path.clone()],
                    value: path,
                })
            },
        )
    }
}
