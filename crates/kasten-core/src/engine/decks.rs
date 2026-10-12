//! Slide decks through the engine, for the app and the MCP deck tools: a
//! person's saves are written at once and committed after a pause, like
//! typing; an agent's are committed at once.

use serde::Serialize;

use super::boards::project_of;
use super::{Change, Kasten};
use crate::deck::{self, DeckFile, DeckSaved};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;

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

fn stem_of(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.trim_end_matches(".deck").to_owned()
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
        for file in self.vault.files(".deck")? {
            if !wanted(&file.path) {
                continue;
            }
            let read =
                deck::read_deck(&self.vault, &file.path).and_then(|deck| deck::head_of(&deck.text));
            let (title, slides, problem) = match read {
                Ok(head) => {
                    let title = head.title.filter(|t| !t.trim().is_empty());
                    (
                        title.unwrap_or_else(|| stem_of(&file.path)),
                        head.slides,
                        None,
                    )
                }
                Err(err) => (stem_of(&file.path), 0, Some(err.to_string())),
            };
            out.push(DeckInfo {
                project: project_of(&file.path),
                modified: file.modified,
                size: file.size,
                path: file.path,
                title,
                slides,
                problem,
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
