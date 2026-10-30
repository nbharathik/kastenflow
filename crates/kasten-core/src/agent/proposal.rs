//! Proposals: agent ops waiting for a person's review, one JSON file each
//! in `.kasten/proposals/`. Decided ones
//! move to `.kasten/proposals/archive/`, so nothing is ever deleted.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::AgentOp;
use crate::atomic::write_atomic;
use crate::error::{Error, Result};

pub const PROPOSALS: &str = ".kasten/proposals";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Pending,
    Accepted,
    Rejected,
}

/// The note a proposal is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Target {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: String,
    /// RFC 3339.
    pub created: String,
    pub session: String,
    pub client: String,
    pub status: ProposalStatus,
    pub op: AgentOp,
    pub target: Option<Target>,
    /// Why it waits for review: the guardrail it met.
    pub reason: String,
    /// The agent's own reason, when it gave one.
    #[serde(default)]
    pub note: Option<String>,
    /// A unified diff of the change, or a description when there is no text.
    pub diff: String,
    #[serde(default)]
    pub before: Option<String>,
    #[serde(default)]
    pub after: Option<String>,
    #[serde(default)]
    pub decided: Option<String>,
    #[serde(default)]
    pub decided_by: Option<String>,
}

impl Proposal {
    /// Vault-relative path of a pending proposal.
    pub fn pending_path(id: &str) -> String {
        format!("{PROPOSALS}/{id}.json")
    }

    /// Vault-relative path of a decided one.
    pub fn archive_path(id: &str) -> String {
        format!("{PROPOSALS}/archive/{id}.json")
    }

    /// One line for lists and commit messages.
    pub fn summary(&self) -> String {
        if let AgentOp::Batch { ops, .. } = &self.op {
            return format!("batch of {} changes", ops.len());
        }
        let what = self.op.name().replace('_', " ");
        match &self.target {
            Some(t) => format!("{what} {}", t.title),
            None => what,
        }
    }

    pub fn write(&self, root: &Path, rel: &str) -> Result<()> {
        let path = root.join(rel);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut text = serde_json::to_string_pretty(self)
            .map_err(|e| Error::Invalid(format!("Proposal: {e}")))?;
        text.push('\n');
        write_atomic(&path, text.as_bytes())?;
        Ok(())
    }

    /// A pending proposal by id.
    pub fn read(root: &Path, id: &str) -> Result<Proposal> {
        if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return Err(Error::Invalid(format!("Not a proposal id: {id}")));
        }
        let rel = Proposal::pending_path(id);
        let text = fs::read_to_string(root.join(&rel)).map_err(|_| Error::NotFound(rel.clone()))?;
        let proposal: Proposal =
            serde_json::from_str(&text).map_err(|e| Error::Invalid(format!("{rel}: {e}")))?;
        // Deciding moves the file by the id inside it, so it must be the
        // checked one it was found by.
        if proposal.id != id {
            return Err(Error::Invalid(format!(
                "{rel} holds a proposal with another id, so it is left as it is"
            )));
        }
        Ok(proposal)
    }

    /// Every pending proposal, oldest first. Files that do not parse are skipped.
    pub fn pending(root: &Path) -> Result<Vec<Proposal>> {
        let dir = root.join(PROPOSALS);
        let Ok(entries) = fs::read_dir(&dir) else {
            return Ok(Vec::new());
        };
        let mut out: Vec<Proposal> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
            .filter_map(|e| fs::read_to_string(e.path()).ok())
            .filter_map(|t| serde_json::from_str::<Proposal>(&t).ok())
            .filter(|p| p.status == ProposalStatus::Pending)
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }
}
