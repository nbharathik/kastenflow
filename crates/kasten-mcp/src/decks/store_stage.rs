//! The deck store of a chat that previews its changes. Reads see the chat's
//! staged changes on top of the vault: a deck it made or edited a moment ago
//! is read as it will be saved. Writes go into the chat's change set, not the
//! vault, and pictures and PowerPoint files are held with them. What the core
//! cannot show in a set waits for review as a proposal, as it does elsewhere.

use std::sync::Mutex;

use kasten_core::agent::{AgentOp, ChangeSet};
use kasten_core::{Error, Instant, Outcome};
use slides_core::agent::{AssetInfo, DeckText, Imported, StoreError, StoreResult, Written};

use super::pptx;
use super::store::{KastenStore, Ran, Review, failed};
use crate::tools::locked;

/// A file's name without its folders or its `.deck`.
fn stem_of(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".deck").unwrap_or(name)
}

/// Whether a core error says several decks share a title.
fn ambiguous(error: &Error) -> bool {
    matches!(error, Error::Invalid(why) if why.starts_with("Several decks"))
}

impl<'a> KastenStore<'a> {
    /// The store of a chat that previews its changes: its writes go into
    /// `set`, and its reads see them.
    pub(super) fn staged(mut self, set: &'a Mutex<ChangeSet>) -> Self {
        self.stage = Some(set);
        self
    }

    /// The decks the chat has made and not yet applied, as lists show decks.
    pub(super) fn staged_decks(&self) -> Vec<kasten_core::DeckInfo> {
        match self.stage {
            Some(set) => self.kasten.staged_decks(&locked(set)),
            None => Vec::new(),
        }
    }

    /// The pictures the chat has staged, as lists show pictures.
    pub(super) fn staged_assets(&self) -> Vec<AssetInfo> {
        match self.stage {
            Some(set) => locked(set)
                .assets
                .iter()
                .map(|a| AssetInfo {
                    path: a.provisional.clone(),
                    bytes: a.bytes,
                })
                .collect(),
            None => Vec::new(),
        }
    }

    /// A picture the chat has staged, by its path.
    pub(super) fn staged_asset(&self, path: &str) -> StoreResult<Option<Vec<u8>>> {
        match self.stage {
            Some(set) => self
                .kasten
                .staged_asset_bytes(&locked(set), path)
                .map_err(failed),
            None => Ok(None),
        }
    }

    /// The path of the deck a tool names: a vault path as `list_decks` shows
    /// it, or the deck's title, or its file's name. The tools add `.deck` to
    /// what they are given, so a title arrives with it.
    pub(super) fn resolve(&self, name: &str) -> StoreResult<String> {
        let name = name.trim();
        let staged: Vec<String> = self
            .staged_decks()
            .into_iter()
            .filter(|d| {
                let wanted = name.strip_suffix(".deck").unwrap_or(name);
                d.path == name
                    || d.title.eq_ignore_ascii_case(wanted)
                    || stem_of(&d.path) == wanted && !name.contains('/')
            })
            .map(|d| d.path)
            .collect();
        if staged.iter().any(|p| p == name) {
            return Ok(name.to_owned());
        }
        match (self.resolve_saved(name), staged.as_slice()) {
            (Ok(path), []) => Ok(path),
            (Err(error), []) => Err(error),
            (Err(StoreError::NotFound(_)), [one]) => Ok(one.clone()),
            (found, many) => {
                let mut paths: Vec<String> = many.to_vec();
                if let Ok(path) = found {
                    paths.insert(0, path);
                }
                Err(StoreError::Invalid(format!(
                    "Several decks are called “{}”; name one by path: {}.",
                    name.trim_end_matches(".deck"),
                    paths.join(", ")
                )))
            }
        }
    }

    /// `resolve`, among the decks the vault has.
    fn resolve_saved(&self, name: &str) -> StoreResult<String> {
        match self.kasten.resolve_deck(name) {
            Ok(path) => return Ok(path),
            Err(error) if ambiguous(&error) => return Err(failed(error)),
            Err(_) => {}
        }
        if let Some(stem) = name.strip_suffix(".deck") {
            match self.kasten.resolve_deck(stem) {
                Ok(path) => return Ok(path),
                Err(error) if ambiguous(&error) => return Err(failed(error)),
                Err(_) => {}
            }
            let decks = self.kasten.decks().map_err(failed)?;
            let same: Vec<&str> = decks
                .iter()
                .filter(|d| stem_of(&d.path) == stem)
                .map(|d| d.path.as_str())
                .collect();
            match same.as_slice() {
                [one] => return Ok((*one).to_owned()),
                [] => {}
                many => {
                    return Err(StoreError::Invalid(format!(
                        "Several decks have that file name; name one by path: {}.",
                        many.join(", ")
                    )));
                }
            }
        }
        Err(StoreError::NotFound(format!(
            "There is no deck called “{}”. list_decks shows the decks there are.",
            name.trim_end_matches(".deck")
        )))
    }

    /// The deck at `path` as it is now, with the chat's staged changes.
    pub(super) fn fetch(&self, path: &str) -> StoreResult<DeckText> {
        let file = match self.stage {
            Some(set) => self.kasten.deck_in(&locked(set), path),
            None => self.kasten.deck(path),
        }
        .map_err(failed)?;
        Ok(DeckText {
            name: file.path,
            text: file.text,
            hash: file.hash,
        })
    }

    /// Runs an op in the session: at once through the guardrails, or staged
    /// in the chat's set. A review is kept.
    pub(super) fn run(&mut self, op: &AgentOp) -> StoreResult<Ran> {
        let session = self.session()?;
        let outcome = match self.stage {
            Some(set) => self
                .kasten
                .stage(&mut locked(set), session, op, Instant::now()),
            None => self.kasten.agent_run(session, op, Instant::now()),
        };
        match outcome {
            Ok(Outcome::Done { result } | Outcome::Staged { result, .. }) => Ok(Ran::Done(result)),
            Ok(Outcome::PendingReview { proposal, reason }) => {
                self.review = Some(Review { proposal, reason });
                Ok(Ran::Waiting)
            }
            Err(error) => Err(failed(error)),
        }
    }

    /// Holds a picture for the chat's set; where it will be in `assets/`.
    pub(super) fn stage_picture(&mut self, name: &str, bytes: &[u8]) -> StoreResult<String> {
        let session = self.session()?;
        let Some(set) = self.stage else {
            return Err(StoreError::Unavailable(
                "This call keeps no staged changes.".to_owned(),
            ));
        };
        self.kasten
            .stage_asset(&mut locked(set), session, name, bytes, Instant::now())
            .map_err(failed)
    }

    /// A PowerPoint file made from a deck, held for the set.
    pub(super) fn stage_export(
        &mut self,
        deck: &str,
        extension: &str,
        bytes: &[u8],
    ) -> StoreResult<Written> {
        if extension != "pptx" {
            return Err(StoreError::Unavailable(format!(
                "A .{extension} file is not kept in a vault. get_outline gives a deck's outline as Markdown, and create_note keeps it as a note."
            )));
        }
        let name = deck.rsplit('/').next().unwrap_or(deck);
        let stem = name.strip_suffix(".deck").unwrap_or(name);
        let path = self.stage_picture(&format!("{stem}.{extension}"), bytes)?;
        Ok(Written {
            path,
            bytes: bytes.len() as u64,
        })
    }

    /// A PowerPoint file of the vault, read as a deck whose pictures and
    /// whose deck are held for the set, to be applied together.
    pub(super) fn stage_import(
        &mut self,
        path: &str,
        bytes: &[u8],
        title: Option<&str>,
        seed: u64,
    ) -> StoreResult<Imported> {
        let read = pptx::read(path, bytes, title, seed)?;
        let mut moved: Vec<(String, String)> = Vec::new();
        for picture in &read.pictures {
            let at = self.stage_picture(picture.name(), &picture.bytes)?;
            if at != picture.path {
                moved.push((picture.path.clone(), at));
            }
        }
        let text = pptx::renamed(read.text.clone(), &moved);
        let op = AgentOp::CreateDeck {
            title: read.title.clone(),
            project: self.request.project.clone(),
            tool: self.request.tool.clone(),
            text,
            sent: self.request.sent,
            marked: None,
        };
        match self.run(&op)? {
            Ran::Done(result) => {
                let made = result["path"].as_str().unwrap_or_default().to_owned();
                Ok(Imported {
                    deck: self.fetch(&made)?,
                    pictures: read.pictures.len(),
                    warnings: read.warnings,
                })
            }
            Ran::Waiting => Err(super::store::waiting()),
        }
    }
}
