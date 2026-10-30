//! Smart pages are an optional plugin that is off until a person turns it on
//! (`plugins: smart` in `.kasten/config.yaml`, by `set_plugin_enabled`). A project can
//! say its own: `smart_pages: on` or `off` in its `_project.md` header, and
//! a project that says nothing follows the vault. A page outside any project
//! follows the vault. The setting that counts for a page is its project's
//! key when it has one, else the vault's plugin.
//!
//! Turning smart pages off deletes nothing: the pages keep their notes and
//! their code folders, and only the running (frames) and the agents' tools
//! stop. Only a person sets any of this; an agent can only ask
//! (`AgentOp::RequestSmartPages`), and the person's answer to that is the
//! only way an agent's wish reaches these switches.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::boards::project_of;
use super::projects::is_project_page;
use super::{Change, Kasten};
use crate::atomic::write_atomic;
use crate::config::{CONFIG_PATH, Config};
use crate::error::{Error, Result};
use crate::frontmatter::{join, read_map, set_key, set_key_raw, split, still_readable};
use crate::history::Actor;
use crate::ops::eol_of;
use crate::time::Instant;

/// The plugin's id.
pub const SMART_PLUGIN: &str = "smart";
/// The key of a project's header that says its own choice.
pub const PROJECT_KEY: &str = "smart_pages";

/// What a project says about smart pages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectSmart {
    /// The project says nothing: it follows the vault.
    Vault,
    On,
    Off,
}

impl ProjectSmart {
    fn word(self) -> Option<&'static str> {
        match self {
            ProjectSmart::Vault => None,
            ProjectSmart::On => Some("on"),
            ProjectSmart::Off => Some("off"),
        }
    }

    /// What a header key's value means: `on`, `off`, or a plain yes or no.
    fn of(value: Option<&Value>) -> ProjectSmart {
        match value {
            Some(Value::Bool(true)) => ProjectSmart::On,
            Some(Value::Bool(false)) => ProjectSmart::Off,
            Some(Value::String(text)) => match text.trim().to_ascii_lowercase().as_str() {
                "on" | "true" | "yes" => ProjectSmart::On,
                "off" | "false" | "no" => ProjectSmart::Off,
                _ => ProjectSmart::Vault,
            },
            _ => ProjectSmart::Vault,
        }
    }
}

/// The path of the page of the project in folder `folder`.
fn project_page(folder: &str) -> String {
    format!("projects/{folder}/_project.md")
}

impl Kasten {
    /// What the project in folder `folder` says. A project with no page, or
    /// one whose header cannot be read, says nothing and follows the vault.
    pub fn project_smart(&self, folder: &str) -> ProjectSmart {
        let Ok(note) = self.vault.read(&project_page(folder)) else {
            return ProjectSmart::Vault;
        };
        let keys = read_map(split(&note.text).prefix).unwrap_or_default();
        ProjectSmart::of(keys.get(PROJECT_KEY))
    }

    /// Whether smart pages are on for a page in the project in folder `folder`
    /// (none: the library or a place outside any project).
    pub fn smart_enabled_for_project(&self, folder: Option<&str>) -> bool {
        match folder.map(|f| self.project_smart(f)) {
            Some(ProjectSmart::On) => true,
            Some(ProjectSmart::Off) => false,
            _ => self.config().plugin_enabled(SMART_PLUGIN),
        }
    }

    /// Whether smart pages are on for the page at `page`: its project's key if
    /// set, else the vault's plugin.
    pub fn smart_enabled_for_page(&self, page: &str) -> bool {
        self.smart_enabled_for_project(project_of(page).as_deref())
    }

    /// The projects that say something of their own about smart pages, by
    /// folder name (the ones that follow the vault are left out).
    pub fn project_smart_settings(&self) -> std::collections::BTreeMap<String, ProjectSmart> {
        let Ok(folders) = std::fs::read_dir(self.vault.root().join("projects")) else {
            return Default::default();
        };
        folders
            .flatten()
            .filter_map(|entry| {
                let folder = entry.file_name().to_str()?.to_owned();
                let setting = self.project_smart(&folder);
                (setting != ProjectSmart::Vault).then_some((folder, setting))
            })
            .collect()
    }

    /// Whether anything in the vault may have smart pages on: the vault's
    /// plugin, or a project that says on. Agents are offered the smart tools
    /// while this holds (each call still asks about its page's own project).
    pub fn smart_enabled_anywhere(&self) -> bool {
        self.config().plugin_enabled(SMART_PLUGIN)
            || self
                .project_smart_settings()
                .values()
                .any(|setting| *setting == ProjectSmart::On)
    }

    /// The sentence an agent is told when smart pages are off where it works.
    pub fn smart_off_sentence(&self, project: Option<&str>) -> String {
        match project {
            Some(folder) if self.config().plugin_enabled(SMART_PLUGIN) => format!(
                "Smart pages are off for the project “{folder}”. Do not try again; ask the person with request_smart_pages (give a reason and project: “{folder}”)"
            ),
            Some(folder) => format!(
                "Smart pages are off in this vault. Do not try again; ask the person with request_smart_pages (give a reason, and project: “{folder}” to ask for that project only)"
            ),
            None => "Smart pages are off in this vault. Do not try again; ask the person with request_smart_pages (give a reason)".to_owned(),
        }
    }

    /// Lets a smart op for the project in `folder` through, or says in a
    /// sentence to ask the person.
    pub(super) fn smart_gate_project(&self, folder: Option<&str>) -> Result<()> {
        if self.smart_enabled_for_project(folder) {
            Ok(())
        } else {
            Err(Error::Invalid(self.smart_off_sentence(folder)))
        }
    }

    /// `smart_gate_project` for the project the page at `page` is in.
    pub fn smart_gate_page(&self, page: &str) -> Result<()> {
        self.smart_gate_project(project_of(page).as_deref())
    }

    /// Sets what a project says about smart pages: on, off, or (`Vault`) the
    /// key taken away so the project follows the vault. Only a person does
    /// it. One commit that Undo takes back; saying what is already so writes
    /// and commits nothing. Answers whether anything changed.
    pub fn set_project_smart_pages(
        &self,
        actor: &Actor,
        page: &str,
        setting: ProjectSmart,
        now: Instant,
    ) -> Result<bool> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Only a person can turn smart pages on or off for a project".to_owned(),
            ));
        }
        self.write_project_smart(actor, page, setting, now)
    }

    /// The write behind `set_project_smart_pages`, for the person's accepted
    /// request too (the actor is then the agent, approved by the person).
    pub(super) fn write_project_smart(
        &self,
        actor: &Actor,
        page: &str,
        setting: ProjectSmart,
        now: Instant,
    ) -> Result<bool> {
        if !is_project_page(page) {
            return Err(Error::Invalid(format!(
                "Only a project page (projects/<name>/_project.md) says whether its pages are smart, not {page}"
            )));
        }
        let note = self.vault.read(page)?;
        let folder = project_of(page).unwrap_or_default();
        if self.project_smart(&folder) == setting {
            return Ok(false);
        }
        let title = note.meta.title;
        let word = match setting {
            ProjectSmart::Vault => "the vault's choice",
            ProjectSmart::On => "on",
            ProjectSmart::Off => "off",
        };
        self.apply(
            actor,
            "set_project_smart_pages",
            false,
            now.millis,
            |vault| {
                let current = vault.read(page)?;
                let parts = split(&current.text);
                let eol = eol_of(&current.text);
                let prefix = match setting.word() {
                    Some(word) => set_key_raw(parts.prefix, PROJECT_KEY, Some(word), eol),
                    None => set_key(parts.prefix, PROJECT_KEY, None, eol),
                };
                let prefix = set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
                still_readable(parts.prefix, &prefix)?;
                write_atomic(
                    &vault.path_of(page)?,
                    join(&prefix, parts.body, eol).as_bytes(),
                )?;
                Ok(Change {
                    message: format!("project: {title} — smart pages {word}"),
                    paths: vec![page.to_owned()],
                    value: true,
                })
            },
        )
    }

    /// Turns the smart pages plugin on or off for the vault, for the person's
    /// accepted request (the actor is the agent, approved by the person).
    pub(super) fn write_smart_plugin(&self, actor: &Actor, on: bool, now: Instant) -> Result<bool> {
        if Config::load(self.root())?.plugin_enabled(SMART_PLUGIN) == on {
            return Ok(false);
        }
        let word = if on { "on" } else { "off" };
        let config = self.apply(actor, "set_plugin_enabled", false, now.millis, |vault| {
            let mut config = Config::load(vault.root())?;
            config.set_plugin_enabled(SMART_PLUGIN, on);
            config.save(vault.root())?;
            Ok(Change {
                message: format!("plugins: turn {SMART_PLUGIN} {word}"),
                paths: vec![CONFIG_PATH.to_owned()],
                value: config,
            })
        })?;
        *self.config.write().unwrap_or_else(|p| p.into_inner()) = config;
        self.config_saved();
        Ok(true)
    }
}
