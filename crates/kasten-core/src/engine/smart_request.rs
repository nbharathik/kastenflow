//! An agent asking a person to turn smart pages on (`AgentOp::RequestSmartPages`).
//! The request is always kept in the proposals list, in every agent mode,
//! Autonomous included: no mode and no trust turns a plugin on. Accepting it
//! is the person's act and turns on the vault's plugin, or the named project's
//! key; rejecting it changes nothing.

use serde_json::{Value, json};

use super::Kasten;
use crate::agent::{AgentOp, Proposal};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::policy::Decision;
use crate::time::Instant;

/// The most a request's reason may say.
const MAX_REASON: usize = 500;

impl Kasten {
    /// The folder of the project an agent names (its folder name or its title).
    fn requested_project(&self, name: &str) -> Result<String> {
        let name = name.trim();
        let folders = [name.to_owned(), crate::slug::slugify(name)];
        folders
            .into_iter()
            .find(|folder| {
                !folder.is_empty()
                    && !folder.contains(['/', '\\'])
                    && self.vault.exists(&format!("projects/{folder}/_project.md"))
            })
            .ok_or_else(|| {
                Error::Invalid(format!(
                    "There is no project called “{name}”; list_projects names them"
                ))
            })
    }

    /// What no mode lifts for a request: it needs a reason, and a project that is there.
    pub(super) fn smart_request_refusals(&self, op: &AgentOp) -> Result<()> {
        let AgentOp::RequestSmartPages { reason, project } = op else {
            return Ok(());
        };
        if reason.trim().is_empty() {
            return Err(Error::Invalid(
                "Say why you want smart pages, in a sentence: the person reads it".to_owned(),
            ));
        }
        if reason.chars().count() > MAX_REASON {
            return Err(Error::Invalid(format!(
                "Keep the reason to {MAX_REASON} characters; the person reads it"
            )));
        }
        if let Some(project) = project.as_deref().filter(|p| !p.trim().is_empty()) {
            self.requested_project(project)?;
        }
        Ok(())
    }

    /// The decision for a request: refused when smart pages are on already or
    /// the same ask is still waiting, else always kept for the person.
    pub(super) fn decide_smart_request(&self, op: &AgentOp) -> Result<Decision> {
        if let Err(err) = self.smart_request_refusals(op) {
            return Ok(Decision::Refuse(err));
        }
        let AgentOp::RequestSmartPages { project, .. } = op else {
            return Ok(Decision::Refuse(Error::Invalid(
                "Not a request for smart pages".to_owned(),
            )));
        };
        let folder = self.target_folder(project.as_deref())?;
        if self.smart_enabled_for_project(folder.as_deref()) {
            return Ok(Decision::Refuse(Error::Invalid(
                "Smart pages are already on there; there is nothing to ask for".to_owned(),
            )));
        }
        let waiting = Proposal::pending(self.vault.root())?
            .into_iter()
            .filter_map(|p| match p.op {
                AgentOp::RequestSmartPages { project, .. } => Some(project),
                _ => None,
            })
            .any(|other| self.target_folder(other.as_deref()).ok() == Some(folder.clone()));
        if waiting {
            return Ok(Decision::Refuse(Error::Invalid(
                "That has been asked already and the person has not answered yet. Go on without smart pages for now"
                    .to_owned(),
            )));
        }
        Ok(Decision::Propose(
            "Turning on smart pages is always the person's choice, in every mode".to_owned(),
        ))
    }

    /// The project folder a request names, none for the whole vault.
    fn target_folder(&self, project: Option<&str>) -> Result<Option<String>> {
        match project.map(str::trim).filter(|p| !p.is_empty()) {
            Some(name) => self.requested_project(name).map(Some),
            None => Ok(None),
        }
    }

    /// What a reviewer reads in the proposals list.
    pub(super) fn smart_request_words(&self, op: &AgentOp) -> String {
        let AgentOp::RequestSmartPages { reason, project } = op else {
            return String::new();
        };
        match project.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(project) => format!(
                "An agent asks to turn on smart pages for the project “{project}”: {}",
                reason.trim()
            ),
            None => format!("An agent asks to turn on smart pages: {}", reason.trim()),
        }
    }

    /// Runs an accepted request: only the person's accepting reaches this.
    pub(super) fn smart_request_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let AgentOp::RequestSmartPages { project, .. } = op else {
            return Err(Error::Invalid(format!(
                "{} is not a request for smart pages",
                op.name()
            )));
        };
        // A request never runs on an agent's own word.
        if !matches!(actor, Actor::Approved { .. }) {
            return Err(Error::Invalid(
                "Only a person can turn smart pages on".to_owned(),
            ));
        }
        match self.target_folder(project.as_deref())? {
            Some(folder) => {
                let page = format!("projects/{folder}/_project.md");
                let changed =
                    self.write_project_smart(actor, &page, super::ProjectSmart::On, now)?;
                Ok(json!({ "status": "turned_on", "project": folder, "changed": changed }))
            }
            None => {
                let changed = self.write_smart_plugin(actor, true, now)?;
                Ok(json!({ "status": "turned_on", "changed": changed }))
            }
        }
    }
}
