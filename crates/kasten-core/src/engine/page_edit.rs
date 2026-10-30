//! Block-level page edits for agents (`read_page_blocks`, `AgentOp::EditPage`).
//! The steps are made against the page as it is when the op runs, under the
//! write lock, so a page a person changed since the agent read it refuses the
//! steps that name a block that changed, and writes nothing. The guardrails are
//! those of any other write to a page: a locked page is refused, the size limit
//! counts what the agent sends, and a change that takes out more than the
//! limit (a deleted block counts) is a soft limit.

use serde_json::{Value, json};

use super::review::Preview;
use super::{Change, Kasten};
use crate::agent::{AgentOp, ChangeSet, Session, Target};
use crate::diff::unified;
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::history::Actor;
use crate::note::NoteFile;
use crate::ops::{self, Saved};
use crate::pages::{self, PageBlocks, PageStep};
use crate::policy::OpClass;
use crate::time::Instant;

fn percent(fraction: f64) -> String {
    format!("{:.0}%", fraction * 100.0)
}

/// Which text a page edit is tried against when the guardrails are weighed.
#[derive(Clone, Copy)]
pub(crate) enum PageText<'a> {
    /// The vault's page.
    Vault,
    /// The page as a chat's staged changes leave it (else the vault's).
    Staged(&'a ChangeSet),
    /// Not tried: the staged page was made by the set's own steps.
    Unchecked,
}

/// `limit` blocks of a note from block number `from` (counted from 1).
fn blocks_listed(note: &NoteFile, from: usize, limit: usize) -> PageBlocks {
    let all = pages::blocks_of(&note.text);
    let total = all.len();
    let skip = from.saturating_sub(1);
    let blocks: Vec<_> = all.into_iter().skip(skip).take(limit).collect();
    PageBlocks {
        path: note.meta.path.clone(),
        title: note.meta.title.clone(),
        hash: note.hash.clone(),
        total,
        truncated: skip + blocks.len() < total,
        blocks,
    }
}

/// The steps in a few words, for a review and the history.
fn words(steps: &[PageStep]) -> String {
    let mut names: Vec<&str> = steps.iter().map(PageStep::name).collect();
    names.dedup();
    format!(
        "Edit the page with {} step{}: {}",
        steps.len(),
        if steps.len() == 1 { "" } else { "s" },
        names.join(", ")
    )
}

impl Kasten {
    /// A page's blocks as `edit_page` names them: `limit` of them from block
    /// number `from` (counted from 1), the ids and hashes of this read.
    pub fn read_page_blocks(&self, path: &str, from: usize, limit: usize) -> Result<PageBlocks> {
        if !path.ends_with(".md") {
            return Err(Error::Invalid(format!(
                "{path} is not a page or card: read_page_blocks reads Markdown notes"
            )));
        }
        Ok(blocks_listed(&self.read(path)?, from, limit))
    }

    /// What no mode lifts for a page edit: it must be steps on a Markdown
    /// note, and they must be makeable now (a block that changed since it was
    /// read refuses the call here, before anything else is weighed).
    pub(super) fn page_refusals(&self, op: &AgentOp, pages: PageText) -> Result<()> {
        let AgentOp::EditPage { path, steps, .. } = op else {
            return Ok(());
        };
        if !path.ends_with(".md") {
            return Err(Error::Invalid(format!(
                "{path} is not a page or card: edit_page changes Markdown notes"
            )));
        }
        let text = match pages {
            PageText::Unchecked => return Ok(()),
            PageText::Staged(set) => match set.text_of(path) {
                Some(text) => text.to_owned(),
                None => self.vault.read(path)?.text,
            },
            PageText::Vault => self.vault.read(path)?.text,
        };
        pages::edit_note(&text, steps).map(|_| ())
    }

    /// `read_page_blocks`, through a chat's staged changes: a page the set
    /// holds is read as the set leaves it, with the ids and hashes the next
    /// `edit_page` in that chat must name.
    pub fn read_page_blocks_in(
        &self,
        set: &ChangeSet,
        path: &str,
        from: usize,
        limit: usize,
    ) -> Result<PageBlocks> {
        if !path.ends_with(".md") {
            return Err(Error::Invalid(format!(
                "{path} is not a page or card: read_page_blocks reads Markdown notes"
            )));
        }
        Ok(blocks_listed(&self.read_in(set, path)?, from, limit))
    }

    /// A change that takes out more of the page than the limit allows is a
    /// soft limit, unless a person trusted the session.
    pub(super) fn page_review_reason(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<OpClass> {
        let AgentOp::EditPage { path, steps, .. } = op else {
            return Ok(OpClass::Ordinary);
        };
        if self.trusted(&session.id, now) {
            return Ok(OpClass::Ordinary);
        }
        let note = self.vault.read(path)?;
        let removed = pages::edit_note(&note.text, steps)?.removed;
        let limit = self.config().guardrails.max_removed_fraction;
        Ok(if removed > limit {
            OpClass::Soft(format!(
                "Removes {} of “{}” (the limit is {})",
                percent(removed),
                note.meta.title,
                percent(limit)
            ))
        } else {
            OpClass::Ordinary
        })
    }

    /// What a reviewer sees of a page edit: the page before and after.
    pub(super) fn page_op_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        let AgentOp::EditPage { path, steps, .. } = op else {
            return Ok(None);
        };
        let note = self.vault.read(path)?;
        let before = split(&note.text).body.to_owned();
        let after = pages::edit_note(&note.text, steps)?.body;
        let diff = format!("{}\n\n{}", words(steps), unified(path, &before, &after, 3));
        Ok(Some(Preview {
            target: Some(Target {
                path: note.meta.path.clone(),
                title: note.meta.title.clone(),
            }),
            before: Some(before),
            after: Some(after),
            diff,
        }))
    }

    /// Makes a page edit as `actor`, in one commit; what the agent is told comes back.
    pub(super) fn page_execute(&self, actor: &Actor, op: &AgentOp, now: Instant) -> Result<Value> {
        let AgentOp::EditPage { path, steps, .. } = op else {
            return Err(Error::Invalid(format!("{} is not a page edit", op.name())));
        };
        let (note, changed, copy) = self.apply(actor, "edit_page", false, now.millis, |vault| {
            let current = vault.read(path)?;
            let edited = pages::edit_note(&current.text, steps)?;
            if !edited.changed {
                return Ok(Change {
                    message: String::new(),
                    paths: vec![],
                    value: (current, false, None),
                });
            }
            let saved = ops::save_body(vault, path, &edited.body, &current.hash, now)?;
            let changed = matches!(saved, Saved::Written { .. });
            let mut paths = if changed { vec![path.clone()] } else { vec![] };
            // The file changed under us between the two reads (another program
            // wrote it): the edit was not made, and the copy that was saved
            // beside the page is kept in the history rather than left loose.
            let copy = match &saved {
                Saved::Conflict { copy, .. } => Some(copy.clone()),
                _ => None,
            };
            paths.extend(copy.clone());
            let note = saved.note().clone();
            Ok(Change {
                message: format!("page edit: {}", note.meta.title),
                paths,
                value: (note, changed, copy),
            })
        })?;
        self.remember(&note.hash, &note.text);
        let blocks = pages::blocks_of(&note.text).len();
        let told = if copy.is_some() {
            "The page was changed by something else while this edit was made, so the edit was not made; it was saved as a copy beside the page. Read the page again with read_page_blocks"
        } else {
            "Block ids and hashes have changed: read_page_blocks again before the next edit_page"
        };
        Ok(json!({
            "path": note.meta.path,
            "id": note.meta.id,
            "title": note.meta.title,
            "steps": steps.len(),
            "changed": changed,
            "copy": copy,
            "hash": note.hash,
            "blocks": blocks,
            "note": told
        }))
    }
}
