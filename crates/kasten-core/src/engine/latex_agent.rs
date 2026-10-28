//! The LaTeX source ops of agents. A source is written whole against the text
//! the agent read; a file a person changed meanwhile is merged, or the
//! agent's version goes to a copy beside it. A locked document is read-only
//! for agents, a root file cannot be sent where no document is, and a rewrite
//! that takes much of a file out is a soft limit, like the same rewrite of a
//! page: in Balanced mode it waits for review, in Autonomous mode it goes through.

use serde_json::{Value, json};

use super::Kasten;
use super::review::Preview;
use crate::agent::{AgentOp, Session, Target};
use crate::diff::{removed_fraction, unified};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::latex::{self, MAX_SOURCE_BYTES, SOURCE_EXTENSIONS, SourceSaved};
use crate::note::content_hash;
use crate::policy::OpClass;
use crate::time::Instant;

fn percent(fraction: f64) -> String {
    format!("{:.0}%", fraction * 100.0)
}

fn name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

impl Kasten {
    /// A source file agents may change: in a LaTeX folder that is not
    /// locked, and there already.
    pub(super) fn latex_writable(&self, path: &str) -> Result<()> {
        let file = self.vault.file_of(path, &SOURCE_EXTENSIONS)?;
        super::latex_source::visible(path)?;
        if let Some(name) = self.latex_locked_above(path) {
            return Err(super::latex_source::locked_for_agents(&name));
        }
        if self.latex_doc_of(path)?.is_none() {
            return Err(super::latex_source::not_in_a_document(path));
        }
        if !file.is_file() {
            return Err(Error::NotFound(path.to_owned()));
        }
        Ok(())
    }

    /// What no trust or approval lifts, for the source op: a file that is not
    /// a source, an oversized one, a new file where it cannot go.
    pub(super) fn latex_refusals(&self, op: &AgentOp) -> Result<()> {
        let AgentOp::SaveSource {
            path, text, base, ..
        } = op
        else {
            return Ok(());
        };
        if !latex::is_source_path(path) {
            return Err(Error::Invalid(format!(
                "{path} is not a LaTeX source: save_source writes {} files",
                SOURCE_EXTENSIONS.join(", ")
            )));
        }
        if text.len() > MAX_SOURCE_BYTES {
            return Err(Error::Invalid(format!(
                "A source file may be at most {} KB; this one is {} KB",
                MAX_SOURCE_BYTES / 1024,
                text.len().div_ceil(1024)
            )));
        }
        // Another spelling of a folder names the same file on some disks, but History would
        // know it under the new spelling: refused before the change can wait for review (and
        // after the lock, so a locked folder spelled otherwise is still told as locked).
        if !base.is_empty() {
            self.check_spelling(path)?;
            // Its folder and lock were checked with the path (`writable`).
            return super::latex_source::check_stored_size(
                &self.vault.file_of(path, &SOURCE_EXTENSIONS)?,
            );
        }
        Self::writable_form(path)?;
        let file = self.vault.file_of(path, &SOURCE_EXTENSIONS)?;
        if file.exists() {
            return Err(Error::Invalid(format!(
                "{path} already exists; read it and send the change with the text you read as its base"
            )));
        }
        super::latex_source::visible(path)?;
        if let Some(name) = self.latex_locked_above(path) {
            return Err(super::latex_source::locked_for_agents(&name));
        }
        self.check_spelling(path)?;
        match self.latex_doc_of(path)? {
            Some(_) => Ok(()),
            None if path.ends_with(".tex")
                && path.contains('/')
                && latex::facts_of(text).documentclass =>
            {
                Ok(())
            }
            None => Err(super::latex_source::not_in_a_document(path)),
        }
    }

    /// A rewrite that takes a lot out of a file is over a soft limit, unless
    /// a person trusted the session.
    pub(super) fn latex_review_reason(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<OpClass> {
        let AgentOp::SaveSource {
            path, text, base, ..
        } = op
        else {
            return Ok(OpClass::Ordinary);
        };
        if base.is_empty() || self.trusted(&session.id, now) {
            return Ok(OpClass::Ordinary);
        }
        let current = std::fs::read_to_string(self.vault.file_of(path, &SOURCE_EXTENSIONS)?)?;
        let removed = removed_fraction(&current, text);
        let limit = self.config().guardrails.max_removed_fraction;
        Ok(if removed > limit {
            OpClass::Soft(format!(
                "Removes {} of {}'s text (the limit is {})",
                percent(removed),
                name_of(path),
                percent(limit)
            ))
        } else {
            OpClass::Ordinary
        })
    }

    /// What a reviewer sees of a source op: the file before and after.
    pub(super) fn latex_op_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        let AgentOp::SaveSource {
            path, text, base, ..
        } = op
        else {
            return Ok(None);
        };
        let before = if base.is_empty() {
            None
        } else {
            std::fs::read_to_string(self.vault.file_of(path, &SOURCE_EXTENSIONS)?).ok()
        };
        let words = if before.is_none() {
            format!("Make the file {}", name_of(path))
        } else {
            format!("Rewrite the file {}", name_of(path))
        };
        let diff = format!(
            "{words}\n\n{}",
            unified(path, before.as_deref().unwrap_or(""), text, 3)
        );
        Ok(Some(Preview {
            target: Some(Target {
                path: path.clone(),
                title: name_of(path).to_owned(),
            }),
            before,
            after: Some(text.clone()),
            diff,
        }))
    }

    /// Runs a source op as `actor`; what the agent is told comes back.
    pub(super) fn latex_execute(&self, actor: &Actor, op: &AgentOp, now: Instant) -> Result<Value> {
        let AgentOp::SaveSource {
            path, text, base, ..
        } = op
        else {
            return Err(Error::Invalid(format!("{} is not a source op", op.name())));
        };
        // Written against the text the agent read: a change made since is merged in.
        let base_hash = if base.is_empty() {
            String::new()
        } else {
            self.remember(&content_hash(base), base);
            content_hash(base)
        };
        Ok(
            match self.write_source(actor, path, &base_hash, text, now)? {
                SourceSaved::Written { file } => {
                    json!({ "path": path, "status": "saved", "hash": file.hash })
                }
                SourceSaved::Unchanged { file } => {
                    json!({ "path": path, "status": "unchanged", "hash": file.hash })
                }
                SourceSaved::Merged { file } => json!({
                    "path": path,
                    "status": "merged",
                    "hash": file.hash,
                    "note": "The file changed since it was read; both sets of changes were kept"
                }),
                SourceSaved::Conflict { copy, file } => json!({
                    "path": path,
                    "status": "conflict",
                    "copy": copy,
                    "hash": file.hash,
                    "note": "The file changed on the same lines since it was read, so it was left as it is and this version was kept in the copy"
                }),
            },
        )
    }
}
