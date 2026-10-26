//! The smart page ops of agents: a text file of a page's code folder written
//! whole, or taken out (to the trash). They go through `decide` like every
//! agent op: the page's lock keeps agents out of its folder, Review holds them,
//! Balanced and Autonomous let them through as ordinary writes (code edits
//! are undone with Undo; they have no approval step of their own). The limits
//! and path rules are the write ops' own (`smart::ops`), tried here first so
//! an op that can never run is refused and never kept for review.

use serde_json::{Value, json};

use super::Kasten;
use super::agent_refusals::locked_for_agents;
use super::review::Preview;
use crate::agent::{AgentOp, Target};
use crate::diff::unified;
use crate::error::{Error, Result};
use crate::frontmatter::{read_map, split, yaml_ok};
use crate::history::Actor;
use crate::smart::ops;
use crate::smart::{SMART_LAYOUT, check_path, is_text_file};
use crate::time::Instant;

impl Kasten {
    /// What no mode or approval lifts for a smart op: a page that is not a
    /// smart page, a locked one (a header that cannot be read counts as
    /// locked), a file an agent may not send, and everything the write ops
    /// refuse (paths, sizes, links, a changed file).
    pub(super) fn smart_refusals(&self, op: &AgentOp) -> Result<()> {
        let (page, path) = match op {
            AgentOp::SmartWrite { page, path, .. } | AgentOp::SmartDelete { page, path, .. } => {
                (page, path)
            }
            _ => return Ok(()),
        };
        let note = self.vault.read(page)?;
        // The lock of a page covers its whole folder; a page that sits inside
        // another page's folder would escape the outer page's lock.
        crate::smart::dir_for(&self.vault, page)?;
        let header = split(&note.text).prefix;
        if locked_for_agents(&note) || !yaml_ok(header) {
            return Err(Error::Invalid(format!(
                "“{}” is locked (or its header cannot be read): its folder is read-only for agents. Ask the owner to unlock it",
                note.meta.title
            )));
        }
        let layout = read_map(header).ok().and_then(|keys| {
            keys.get("layout")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
        if layout.as_deref() != Some(SMART_LAYOUT) {
            return Err(Error::Invalid(format!(
                "“{}” is not a smart page: its layout is not “{SMART_LAYOUT}”. smart_create makes a smart page; a person turns an existing page into one",
                note.meta.title
            )));
        }
        match op {
            AgentOp::SmartWrite {
                path: rel,
                content,
                base,
                ..
            } => {
                check_path(rel)?;
                if !is_text_file(rel) {
                    return Err(Error::Invalid(format!(
                        "{rel} is not a text file: agents write html, js, css, json, svg and txt files and smart.yaml; a person adds pictures"
                    )));
                }
                ops::check_write(&self.vault, page, rel, content.as_bytes(), Some(base))?;
            }
            _ => {
                ops::check_delete(&self.vault, page, path)?;
            }
        }
        Ok(())
    }

    /// What a reviewer sees of a smart op: the file before and after.
    pub(super) fn smart_op_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        if matches!(op, AgentOp::SmartCreate { .. }) {
            return Ok(Some(self.smart_create_preview(op)));
        }
        let (page, path, after) = match op {
            AgentOp::SmartWrite {
                page,
                path,
                content,
                ..
            } => (page, path, Some(content)),
            AgentOp::SmartDelete { page, path, .. } => (page, path, None),
            _ => return Ok(None),
        };
        let title = self.vault.read(page)?.meta.title;
        let before = self
            .smart_file(page, path)
            .ok()
            .and_then(|file| file.text().map(str::to_owned));
        let words = match (&before, after) {
            (_, None) => format!("Move the file {path} of “{title}” to the trash"),
            (None, Some(_)) => format!("Make the file {path} of “{title}”"),
            (Some(_), Some(_)) => format!("Rewrite the file {path} of “{title}”"),
        };
        let name = format!("{page}:{path}");
        let diff = format!(
            "{words}\n\n{}",
            unified(
                &name,
                before.as_deref().unwrap_or(""),
                after.map_or("", String::as_str),
                3
            )
        );
        Ok(Some(Preview {
            target: Some(Target {
                path: page.clone(),
                title,
            }),
            before,
            after: after.cloned(),
            diff,
        }))
    }

    /// Runs a smart op as `actor`; what the agent is told comes back.
    pub(super) fn smart_execute(&self, actor: &Actor, op: &AgentOp, now: Instant) -> Result<Value> {
        match op {
            AgentOp::SmartWrite {
                page,
                path,
                content,
                base,
                ..
            } => {
                let written =
                    self.smart_write_as(actor, page, path, content.as_bytes(), Some(base), now)?;
                let status = if !written.changed {
                    "unchanged"
                } else if written.created {
                    "created"
                } else {
                    "saved"
                };
                Ok(json!({
                    "page": page,
                    "path": path,
                    "status": status,
                    "hash": written.hash,
                }))
            }
            AgentOp::SmartDelete { page, path, .. } => {
                let deleted = self.smart_delete_as(actor, page, path, now)?;
                Ok(json!({
                    "page": page,
                    "path": path,
                    "status": "trashed",
                    "trashed": deleted.trashed,
                }))
            }
            _ => Err(Error::Invalid(format!(
                "{} is not a smart page op",
                op.name()
            ))),
        }
    }
}
