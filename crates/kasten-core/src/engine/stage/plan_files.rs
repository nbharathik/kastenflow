//! Staging the ops on decks, and pictures. A deck op arrives with the deck as
//! the tool read it (`base`) and as the tool leaves it (`text`); like a
//! change made directly, it is applied to the deck as it is now, so a person's
//! edit made meanwhile is kept.

use std::collections::HashSet;

use serde_json::json;

use super::super::Kasten;
use super::super::asset_add::prepare;
use super::super::deck_agent::{applied, one_line, title_or_name};
use super::plan::Planned;
use crate::agent::{AgentOp, ChangeSet, FileKind, NewFile, Session, StagedAsset, Step};
use crate::assets::NewAsset;
use crate::atomic::write_atomic;
use crate::deck;
use crate::error::Result;
use crate::note::content_hash;
use crate::time::Instant;

fn quoted(title: &str) -> String {
    format!("“{}”", title.trim())
}

impl Kasten {
    /// Stages an op on a deck or a diagram, or None for an op that is not one.
    pub(super) fn plan_file_op(
        &self,
        set: &mut ChangeSet,
        op: &AgentOp,
        _now: Instant,
    ) -> Result<Option<Planned>> {
        Ok(Some(match op {
            AgentOp::EditDeck {
                path,
                summary,
                base,
                text,
                ..
            } => {
                let (current, vault_base) = self.starting_from(set, path, FileKind::Deck)?;
                // What was made from `base` applies to the deck as it is now.
                let merged = applied(base, text, &current)?;
                deck::head_of(&merged)?;
                deck::check_structure(&merged)?;
                let title = title_or_name(&merged, path);
                let what = one_line(summary);
                let summary = if what.is_empty() {
                    format!("Edit the deck {}", quoted(&title))
                } else {
                    format!("Edit the deck {}: {what}", quoted(&title))
                };
                let changed = merged != current;
                let hash = content_hash(&merged);
                if changed {
                    self.put_text(set, path, FileKind::Deck, vault_base, merged)?;
                }
                Planned::Staged {
                    paths: if changed { vec![path.clone()] } else { vec![] },
                    result: json!({ "path": path, "hash": hash, "changed": changed }),
                    summary,
                }
            }
            AgentOp::CreateDeck {
                title,
                project,
                text,
                ..
            } => {
                let taken: HashSet<String> = set
                    .created_files
                    .iter()
                    .map(|f| f.provisional.clone())
                    .collect();
                let path = deck::plan_deck(&self.vault, title, project.as_deref(), text, &taken)?;
                deck::check_structure(text)?;
                self.put_new(
                    set,
                    NewFile {
                        provisional: path.clone(),
                        title: one_line(title),
                        op: "create_deck".to_owned(),
                        text: text.clone(),
                        kind: FileKind::Deck,
                    },
                )?;
                Planned::Staged {
                    summary: format!("Create the deck {}", quoted(&one_line(title))),
                    result: json!({ "path": path }),
                    paths: vec![path],
                }
            }
            _ => return Ok(None),
        }))
    }

    /// Holds a picture for the set and says where it will be in `assets/`.
    /// The same bytes already in `assets/` or in the set are the same asset.
    /// An agent's pictures are held to the same limits as when they are added
    /// at once; nothing is written to the vault.
    pub fn stage_asset(
        &self,
        set: &mut ChangeSet,
        session: &Session,
        name: &str,
        bytes: &[u8],
        now: Instant,
    ) -> Result<String> {
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let actor = session.actor();
        let picture = prepare(&actor, name, bytes, &NewAsset::default())?;
        if let Some(path) = picture.already_in(&self.vault) {
            return Ok(path);
        }
        if let Some(held) = set.assets.iter().find(|a| a.sha256 == picture.sha256()) {
            return Ok(held.provisional.clone());
        }
        if let Some(mut room) = self.allowance(&actor, now) {
            for held in &set.assets {
                room.take(&held.name, held.bytes)?;
            }
            room.take(picture.name(), bytes.len() as u64)?;
        }
        let besides: HashSet<String> = set.assets.iter().map(|a| a.provisional.clone()).collect();
        let provisional = picture.planned_path(&self.vault, &besides)?;
        let file = format!(
            "{}.{}",
            &picture.sha256()[..picture.sha256().len().min(32)],
            picture.extension()
        );
        let mut work = set.clone();
        work.assets.push(StagedAsset {
            provisional: provisional.clone(),
            name: picture.name().to_owned(),
            file: file.clone(),
            sha256: picture.sha256().to_owned(),
            bytes: bytes.len() as u64,
        });
        work.steps.push(Step {
            op: None,
            name: "add_asset".to_owned(),
            summary: format!("Add the picture {}", quoted(picture.name())),
            paths: vec![provisional.clone()],
        });
        super::check_limits(&work)?;
        let target = self
            .changes_dir(&set.id)?
            .join(super::ASSETS_FOLDER)
            .join(&file);
        write_atomic(&target, bytes)?;
        self.save_changes(&work)?;
        *set = work;
        Ok(provisional)
    }
}
