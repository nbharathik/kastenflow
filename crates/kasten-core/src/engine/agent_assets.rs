//! What an agent may add to `assets/`, and a deck it imports with the
//! pictures that come with it. An agent's pictures are held to limits
//! (docs/vault-format.md, guardrails): a size for one picture, and how many
//! pictures and bytes of them a session may add in ten minutes. A picture
//! over a limit is refused, not held for review, since a proposal would have
//! to carry the picture; nothing is written for it, and an import that meets
//! a limit on the way leaves nothing behind.

use std::sync::PoisonError;

use super::agent::WINDOW_MS;
use super::asset_add::{keep, prepare};
use super::deck_agent::{one_line, op_name};
use super::{Change, Kasten};
use crate::agent::{AgentOp, DeckImport, ImportedDeck, Session};
use crate::assets::{AssetSource, NewAsset};
use crate::deck;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::policy::Decision;
use crate::rollback::Rollback;
use crate::time::Instant;

/// A size in words: `900 bytes`, `2.9 KB`, `12.0 MB`.
fn size(bytes: u64) -> String {
    match bytes {
        0..1024 => format!("{bytes} bytes"),
        1024..1_048_576 => format!("{:.1} KB", bytes as f64 / 1024.0),
        _ => format!("{:.1} MB", bytes as f64 / 1_048_576.0),
    }
}

/// The room a session has left for pictures, and what one call has taken of it.
pub(super) struct Allowance {
    each: u64,
    max_count: usize,
    max_bytes: u64,
    count: usize,
    bytes: u64,
    /// The sizes of the pictures taken in this call.
    taken: Vec<u64>,
}

impl Allowance {
    /// Takes room for a new picture of `len` bytes, or says which limit it is over.
    pub(super) fn take(&mut self, name: &str, len: u64) -> Result<()> {
        if len > self.each {
            return Err(Error::Invalid(format!(
                "“{name}” is {} and an agent may add at most {} in one picture",
                size(len),
                size(self.each)
            )));
        }
        if self.count + 1 > self.max_count {
            return Err(Error::Invalid(format!(
                "This session would have added {} pictures in the last 10 minutes (the limit is {})",
                self.count + 1,
                self.max_count
            )));
        }
        if self.bytes + len > self.max_bytes {
            return Err(Error::Invalid(format!(
                "This session would have added {} of pictures in the last 10 minutes (the limit is {})",
                size(self.bytes + len),
                size(self.max_bytes)
            )));
        }
        self.count += 1;
        self.bytes += len;
        self.taken.push(len);
        Ok(())
    }
}

impl Kasten {
    /// The room `actor` has for pictures: none is asked of a person, whose
    /// pictures are limited by the size of a file alone, and one a person
    /// accepted was looked at.
    pub(super) fn allowance(&self, actor: &Actor, now: Instant) -> Option<Allowance> {
        let Actor::Agent { session, .. } = actor else {
            return None;
        };
        let limits = self.config().guardrails;
        let (count, bytes) = self
            .state()
            .tallies
            .get(session)
            .map_or((0, 0), |tally| tally.pictures_added(now.millis, WINDOW_MS));
        Some(Allowance {
            each: limits.max_asset_bytes,
            max_count: limits.max_assets_per_session_10min as usize,
            max_bytes: limits.max_asset_bytes_per_session_10min,
            count,
            bytes,
            taken: Vec::new(),
        })
    }

    /// Counts the pictures a call added against its session.
    pub(super) fn count_pictures(&self, actor: &Actor, room: &Allowance, now: Instant) {
        if let Actor::Agent { session, .. } = actor {
            let mut state = self.state();
            let tally = state.tallies.entry(session.clone()).or_default();
            for len in &room.taken {
                tally.added_picture(*len, now.millis);
            }
        }
    }

    /// Makes a deck for an agent from a file it read, with the pictures the
    /// file came with: the pictures and the deck are one commit, so one undo
    /// takes them all out. Everything that can refuse the deck (its title, its
    /// project, its structure, the session's limit on notes) is weighed before
    /// the first picture is written, and a picture over a limit on pictures
    /// stops the import with every picture already written taken out again.
    /// `deck_text` is given where each picture is kept (a picture the vault
    /// holds already is named by its file) and gives the deck's text. It is
    /// asked once with the names the pictures were sent under, to weigh the
    /// deck, and once with the names they are kept under, to write it.
    pub fn agent_import_deck(
        &self,
        session: &Session,
        import: &DeckImport,
        mut deck_text: impl FnMut(&[String]) -> String,
        now: Instant,
    ) -> Result<ImportedDeck> {
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let actor = session.actor();
        let asked: Vec<String> = import
            .pictures
            .iter()
            .map(|(name, _)| format!("assets/{name}"))
            .collect();
        let op = AgentOp::CreateDeck {
            title: import.title.to_owned(),
            project: import.project.map(str::to_owned),
            tool: import.tool.to_owned(),
            text: deck_text(&asked),
            sent: import.sent,
            marked: None,
        };
        // An import cannot wait as a proposal (it carries pictures), so one that
        // would wait is not made; autonomous mode takes a checkpoint first.
        let how = match self.decide(session, &op, now)? {
            Decision::Refuse(err) => return Err(err),
            Decision::Propose(reason) => {
                return Err(Error::Invalid(format!(
                    "{reason}, so nothing was imported. Try again in a few minutes"
                )));
            }
            Decision::Commit(how) => how,
        };
        let _autonomous = self.autonomous_scope(session, how, now)?;
        let meta = NewAsset {
            source: Some(AssetSource::PptxImport),
            deck: Some(import.title.trim().to_owned()),
            ..NewAsset::default()
        };
        let pictures = import
            .pictures
            .iter()
            .map(|(name, bytes)| prepare(&actor, name, bytes, &meta))
            .collect::<Result<Vec<_>>>()?;
        let name = op_name(import.tool, "import_deck");
        self.apply(&actor, &name, false, now.millis, |vault| {
            let mut allowance = self.allowance(&actor, now);
            let mut undo = Rollback::default();
            let mut paths = Vec::new();
            let mut kept_at = Vec::new();
            let made = (|| -> Result<String> {
                for picture in &pictures {
                    let kept = keep(vault, picture, now, &mut |name, len| {
                        allowance
                            .as_mut()
                            .map_or(Ok(()), |room| room.take(name, len))
                    })?;
                    undo.append(kept.undo);
                    paths.extend(kept.paths);
                    kept_at.push(kept.added.path);
                }
                let text = deck_text(&kept_at);
                deck::check_structure(&text)?;
                deck::create_deck(vault, import.title, import.project, &text)
            })();
            match made {
                Ok(path) => {
                    if let Some(room) = &allowance {
                        self.count_pictures(&actor, room, now);
                    }
                    paths.push(path.clone());
                    Ok(Change {
                        message: format!("deck: import {}", one_line(import.title)),
                        paths,
                        value: ImportedDeck {
                            path,
                            pictures: kept_at,
                        },
                    })
                }
                Err(err) => {
                    undo.put_back();
                    Err(err)
                }
            }
        })
    }
}
