//! How much agents may do, in the window: the vault's mode, until when it
//! holds, and the projects with a mode of their own; and the checkpoints that
//! "Restore to before this session" goes back to. Changing the mode is a
//! person's op: these commands run as the person, and no agent tool reaches
//! them.

use std::collections::BTreeMap;

use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::policy::{AgentPolicy, Checkpoint};
use kasten_core::{Instant, Kasten, VaultRestore};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::notes::OpenVault;

/// The mode as set, and the mode that holds now (a time box that has run out
/// is over: `active` is then balanced again, and so for a project).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyView {
    pub mode: AgentMode,
    pub until: Option<String>,
    pub projects: BTreeMap<String, AgentMode>,
    pub active: AgentMode,
    /// The projects (by folder name) that are autonomous now.
    pub autonomous_projects: Vec<String>,
}

/// The mode a person sets.
#[derive(Debug, Clone, Deserialize)]
pub struct PolicyInput {
    pub mode: AgentMode,
    pub until: Option<String>,
    #[serde(default)]
    pub projects: BTreeMap<String, AgentMode>,
}

/// What the vault's config says, and what holds at `now`.
pub(crate) fn view_of(kasten: &Kasten, now: Instant) -> PolicyView {
    let agents = kasten.config().agents.unwrap_or_default();
    let projects: BTreeMap<String, AgentMode> = agents
        .projects
        .into_iter()
        .filter_map(|(slug, project)| Some((slug, project.mode?)))
        .collect();
    let autonomous_projects = projects
        .keys()
        .filter(|slug| kasten.agent_mode(Some(slug.as_str()), now) == AgentMode::Autonomous)
        .cloned()
        .collect();
    PolicyView {
        mode: agents.mode.unwrap_or_default(),
        until: agents.until,
        projects,
        active: kasten.agent_mode(None, now),
        autonomous_projects,
    }
}

/// The mode as set.
#[tauri::command(async)]
pub fn agent_policy(state: State<'_, OpenVault>) -> Result<PolicyView, String> {
    state.run(|k| Ok(view_of(k, Instant::now())))
}

/// Sets the mode: one commit, by the person.
#[tauri::command(async)]
pub fn set_agent_policy(
    state: State<'_, OpenVault>,
    policy: PolicyInput,
) -> Result<PolicyView, String> {
    state.run(|k| {
        let now = Instant::now();
        k.commit_edits()?;
        k.set_agent_policy(
            &Actor::Human,
            AgentPolicy {
                mode: policy.mode,
                until: policy.until,
                projects: policy.projects,
            },
            now,
        )?;
        Ok(view_of(k, now))
    })
}

/// Where the vault can be put back to, newest first.
#[tauri::command(async)]
pub fn list_checkpoints(state: State<'_, OpenVault>) -> Result<Vec<Checkpoint>, String> {
    state.run(|k| k.list_checkpoints())
}

/// Puts the vault back as it was at a checkpoint, as new commits.
#[tauri::command(async)]
pub fn restore_to_checkpoint(
    state: State<'_, OpenVault>,
    id: String,
) -> Result<VaultRestore, String> {
    state.run(|k| {
        k.commit_edits()?;
        k.restore_to_checkpoint(&id, Instant::now())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_view_tells_what_is_set_and_what_holds() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-app-modes-{}",
            kasten_core::ulid_at(Instant::now().millis)
        ));
        let kasten = Kasten::init(&dir, "Modes").unwrap();
        let now = Instant::now();
        let view = view_of(&kasten, now);
        assert_eq!(view.mode, AgentMode::Balanced);
        assert_eq!(view.active, AgentMode::Balanced);
        assert!(view.until.is_none() && view.projects.is_empty());

        // Autonomous with an end that has passed: set, but not holding.
        kasten
            .set_agent_policy(
                &Actor::Human,
                AgentPolicy {
                    mode: AgentMode::Autonomous,
                    until: Some("2020-01-01".to_owned()),
                    projects: BTreeMap::from([("thesis".to_owned(), AgentMode::Review)]),
                },
                now,
            )
            .unwrap();
        let view = view_of(&kasten, now);
        assert_eq!(view.mode, AgentMode::Autonomous);
        assert_eq!(view.active, AgentMode::Balanced);
        assert_eq!(view.projects["thesis"], AgentMode::Review);
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(json["mode"], "autonomous");
        assert_eq!(json["projects"]["thesis"], "review");
        assert_eq!(json["autonomousProjects"], serde_json::json!([]));

        // A project on autonomous with no end holds, while the vault is balanced.
        kasten
            .set_agent_policy(
                &Actor::Human,
                AgentPolicy {
                    mode: AgentMode::Balanced,
                    until: None,
                    projects: BTreeMap::from([("talks".to_owned(), AgentMode::Autonomous)]),
                },
                now,
            )
            .unwrap();
        let view = view_of(&kasten, now);
        assert_eq!(view.active, AgentMode::Balanced);
        assert_eq!(view.autonomous_projects, ["talks"]);
        drop(kasten);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
