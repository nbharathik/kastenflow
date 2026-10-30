//! Project setups: a way of starting a project (Research, Writing,
//! Presentation) as a few pages, a whiteboard and sometimes a deck, added to a
//! new project or to one that exists. Each setup is a folder in
//! `defaults/setups/` laid out as it lands in the project's folder, with a
//! `setup.json` (icon, name, summary, the page to open, the properties the
//! project page gains) and optionally vault-level files under `vault/` (tag
//! schemas). Placeholders in a file: `{{project}}` (the project's title),
//! `{{slug}}` (its folder), `{{date}}`, `{{id:name}}` (a fresh id, the same
//! wherever the name recurs) and `{{id8:name}}` (eight characters of it, for a
//! deck's id). Applying is one commit that undo takes back; a file that is
//! there already is never touched; an agent cannot apply one. What an apply
//! would do is worked out in `setup_plan`. Setups a person saved from a
//! project (`saved:<slug>`, kept in `templates/setups/`) are read by
//! `setup_saved` into the same shape and applied the same way.

use std::collections::HashMap;
use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::setup_plan::{add_props, fill, plan_setup};
use super::{Change, Kasten};
use crate::atomic::create_atomic;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::ops::{self, Kind, NewNote};
use crate::time::Instant;

pub(super) struct Setup {
    pub id: &'static str,
    manifest: &'static str,
    pub files: &'static [(&'static str, &'static str)],
}

macro_rules! setup {
    ($id:literal: $($path:literal),* $(,)?) => {
        Setup {
            id: $id,
            manifest: include_str!(concat!("../../defaults/setups/", $id, "/setup.json")),
            files: &[$(($path, include_str!(concat!("../../defaults/setups/", $id, "/", $path)))),*],
        }
    };
}

/// In the order they are offered; each one's files sorted by path.
pub(super) const SETUPS: [Setup; 3] = [
    setup!("research":
        "boards/literature-map.canvas", "pages/literature-review.md",
        "pages/research-questions.md", "vault/tags/experiment.yaml", "vault/tags/reading.yaml",
    ),
    setup!("writing":
        "boards/structure.canvas", "pages/draft.md", "pages/outline.md", "pages/style-sheet.md",
    ),
    setup!("presentation":
        "boards/storyboard.canvas", "decks/talk.deck", "pages/talk-notes.md",
    ),
];

/// Where a file of a setup goes outside the project's folder.
pub(super) const VAULT: &str = "vault/";

#[derive(Deserialize)]
pub(super) struct Manifest {
    pub icon: String,
    pub name: String,
    pub summary: String,
    /// The page to open once it is applied, relative to the project folder.
    pub home: String,
    /// Properties the project page gains, if it lacks them.
    #[serde(default)]
    pub props: Map<String, Value>,
}

/// A setup as the app offers it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupInfo {
    pub id: String,
    /// An emoji.
    pub icon: String,
    pub name: String,
    pub summary: String,
    /// Where its files go, relative to the project folder.
    pub files: Vec<String>,
    /// The tags it brings schemas for; a schema the vault has is kept.
    pub tags: Vec<String>,
    /// One the person saved from a project (`templates/setups/`), not a built-in one.
    pub saved: bool,
}

/// Where a setup goes.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SetupTarget {
    /// A project made for it, called `title`.
    New { title: String },
    /// The project in this folder under `projects/`.
    Existing { folder: String },
}

/// What applying a setup would do, worked out without writing anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupPlan {
    /// The project page.
    pub project_path: String,
    /// The page to open afterwards.
    pub home: String,
    /// Every path it would write: the project page when it is made or gains
    /// properties, and each file the vault lacks.
    pub create: Vec<String>,
    /// Files the vault has, which stay as they are.
    pub keep: Vec<String>,
    /// The properties the project page would gain.
    pub props: Vec<String>,
}

/// What applying a setup did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedSetup {
    pub project_path: String,
    pub home: String,
    pub written: Vec<String>,
    pub kept: Vec<String>,
    /// The commit, for undoing it; none when there was nothing to write or the
    /// vault keeps no history.
    pub commit: Option<String>,
}

pub(super) fn manifest(setup: &Setup) -> Manifest {
    // The manifests ship with the app, and a test reads every one.
    serde_json::from_str(setup.manifest).unwrap_or_else(|_| Manifest {
        icon: String::new(),
        name: setup.id.to_owned(),
        summary: String::new(),
        home: String::new(),
        props: Map::new(),
    })
}

/// Every setup on offer.
pub fn setups() -> Vec<SetupInfo> {
    SETUPS
        .iter()
        .map(|setup| {
            let m = manifest(setup);
            let mut files = Vec::new();
            let mut tags = Vec::new();
            for (path, _) in setup.files {
                match path.strip_prefix(VAULT) {
                    Some(vault_file) => tags.extend(
                        vault_file
                            .strip_prefix("tags/")
                            .and_then(|t| t.strip_suffix(".yaml"))
                            .map(str::to_owned),
                    ),
                    None => files.push((*path).to_owned()),
                }
            }
            SetupInfo {
                id: setup.id.to_owned(),
                icon: m.icon,
                name: m.name,
                summary: m.summary,
                files,
                tags,
                saved: false,
            }
        })
        .collect()
}

impl Kasten {
    /// What applying setup `id` to `target` would write and keep. Writes nothing.
    pub fn preview_setup(&self, id: &str, target: &SetupTarget) -> Result<SetupPlan> {
        Ok(plan_setup(&self.vault, id, target)?.plan())
    }

    /// Adds setup `id` to a new project or to an existing one, in one commit
    /// trailered `Kasten-Setup`. A file the vault has is never replaced, and
    /// an existing project page only gains the properties it lacks. The person
    /// applies a setup; an agent is refused.
    pub fn apply_setup(
        &self,
        actor: &Actor,
        id: &str,
        target: &SetupTarget,
        now: Instant,
    ) -> Result<AppliedSetup> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Project setups are applied by the person, not by an agent".to_owned(),
            ));
        }
        self.apply_setup_as(actor, id, target, now)
    }

    /// `apply_setup` for whoever asks. Only `create_project` calls it for an
    /// agent, and only for a project that agent is making: an agent never
    /// adds a setup to a project that is there.
    pub(super) fn apply_setup_as(
        &self,
        actor: &Actor,
        id: &str,
        target: &SetupTarget,
        now: Instant,
    ) -> Result<AppliedSetup> {
        if actor.is_agent() && !matches!(target, SetupTarget::New { .. }) {
            return Err(Error::Invalid(
                "An agent starts a setup only on a project it is making".to_owned(),
            ));
        }
        // Checked before the lock is taken, so a bad request waits for nothing.
        plan_setup(&self.vault, id, target)?;
        let trailers = [("Kasten-Setup", id.to_owned())];
        let (applied, commit) = self.apply_committing(
            actor,
            "apply_setup",
            false,
            now.millis,
            &trailers,
            |vault| {
                // Planned again under the lock: what is there now decides.
                let planned = plan_setup(vault, id, target)?;
                let plan = planned.plan();
                let mut paths = Vec::new();
                let mut ids = HashMap::new();
                let mut written = Vec::new();
                let mut kept = plan.keep.clone();

                if planned.new_project {
                    let page = ops::create_note(
                        vault,
                        &NewNote {
                            kind: Kind::Project,
                            title: planned.title.clone(),
                            date: now.rfc3339()[..10].to_owned(),
                            project: None,
                            parent: None,
                            template: None,
                            icon: None,
                        },
                        now,
                    )?;
                    if page.meta.path != plan.project_path {
                        return Err(Error::Invalid(format!(
                            "{} was made meanwhile; try again",
                            plan.project_path
                        )));
                    }
                }
                if planned.page_written() {
                    add_props(vault, &plan.project_path, &planned.add, now)?;
                    paths.push(plan.project_path.clone());
                    written.push(plan.project_path.clone());
                }
                for ((path, raw), exists) in planned.files.iter().zip(&planned.exists) {
                    if *exists {
                        continue;
                    }
                    let text = fill(raw, path, &planned, &mut ids, now);
                    let file = vault.file_of(path, &[".md", ".yaml", ".canvas", ".deck"])?;
                    if let Some(dir) = file.parent() {
                        fs::create_dir_all(dir)?;
                    }
                    match create_atomic(&file, text.as_bytes()) {
                        Ok(()) => {
                            paths.push(path.clone());
                            written.push(path.clone());
                        }
                        // Made meanwhile: it is theirs.
                        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                            kept.push(path.clone());
                        }
                        Err(err) => return Err(err.into()),
                    }
                }
                kept.sort();
                Ok(Change {
                    message: format!("setup: add {} to {}", planned.manifest.name, planned.title),
                    paths,
                    value: AppliedSetup {
                        project_path: plan.project_path,
                        home: plan.home,
                        written,
                        kept,
                        commit: None,
                    },
                })
            },
        )?;
        Ok(AppliedSetup { commit, ..applied })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_manifest_reads() {
        for setup in &SETUPS {
            let m: Manifest = serde_json::from_str(setup.manifest).unwrap();
            assert!(!m.name.is_empty() && !m.icon.is_empty(), "{}", setup.id);
            assert!(
                setup.files.iter().any(|(p, _)| *p == m.home),
                "{} home {}",
                setup.id,
                m.home
            );
        }
    }
}
