//! The `plugins` and `agents` keys of `.kasten/config.yaml`. They are read
//! and kept, nothing more yet: no code enforces them. Keys this version does
//! not know stay in the file when it is written back.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::config::Config;

/// Keys a newer version wrote that this one does not read, kept as they were.
pub type Extra = BTreeMap<String, serde_json::Value>;

/// Which plugins are on. Diagrams default to on, LaTeX and smart pages to off
/// (smart pages are kept in `extra`, like any plugin this struct has no field for).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PluginsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagrams: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latex: Option<bool>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// How much an agent may change without asking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    Review,
    #[default]
    Balanced,
    Autonomous,
}

/// A project's own mode, over the vault's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProjectAgents {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<AgentMode>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// The vault's agent mode, until when it holds (an ISO time; none means
/// without end), and per-project modes by project slug.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AgentsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<AgentMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub projects: BTreeMap<String, ProjectAgents>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Config {
    /// Whether plugin `id` is on: diagrams unless turned off, LaTeX only
    /// when turned on, any other plugin only when turned on by name.
    pub fn plugin_enabled(&self, id: &str) -> bool {
        let plugins = self.plugins.as_ref();
        let chosen = match id {
            "diagrams" => plugins.and_then(|p| p.diagrams),
            "latex" => plugins.and_then(|p| p.latex),
            other => plugins
                .and_then(|p| p.extra.get(other))
                .and_then(|v| v.as_bool()),
        };
        chosen.unwrap_or(id == "diagrams")
    }

    /// The agent mode for `project`: its own, else the vault's, else balanced.
    pub fn agent_mode_for(&self, project: Option<&str>) -> AgentMode {
        let agents = self.agents.as_ref();
        // A disk that ignores case reaches the project folder however an agent
        // spells it, so the project's own mode holds for every spelling.
        project
            .and_then(|slug| {
                let projects = &agents?.projects;
                projects
                    .get(slug)
                    .or_else(|| {
                        projects
                            .iter()
                            .find(|(known, _)| known.eq_ignore_ascii_case(slug))
                            .map(|(_, project)| project)
                    })?
                    .mode
            })
            .or_else(|| agents.and_then(|a| a.mode))
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const FULL: &str = "name: X\nplugins:\n  diagrams: false\n  latex: true\n  future: 3\nagents:\n  mode: review\n  until: 2026-12-01T00:00:00Z\n  projects:\n    thesis:\n      mode: autonomous\n      note: kept\n  later: yes\n";

    fn parse(text: &str) -> Config {
        serde_saphyr::from_str(text).unwrap()
    }

    #[test]
    fn defaults_when_absent() {
        let config = parse("name: X\n");
        assert!(config.plugin_enabled("diagrams"));
        assert!(!config.plugin_enabled("latex"));
        assert!(!config.plugin_enabled("unknown"));
        assert_eq!(config.agent_mode_for(None), AgentMode::Balanced);
        assert_eq!(config.agent_mode_for(Some("thesis")), AgentMode::Balanced);
        assert_eq!(config.plugins, None);
        let text = serde_saphyr::to_string(&config).unwrap();
        assert!(!text.contains("plugins") && !text.contains("agents"));
    }

    #[test]
    fn reads_both_keys() {
        let config = parse(FULL);
        assert!(!config.plugin_enabled("diagrams"));
        assert!(config.plugin_enabled("latex"));
        assert_eq!(config.agent_mode_for(None), AgentMode::Review);
        assert_eq!(config.agent_mode_for(Some("thesis")), AgentMode::Autonomous);
        assert_eq!(config.agent_mode_for(Some("other")), AgentMode::Review);
        let agents = config.agents.unwrap();
        assert_eq!(agents.until.as_deref(), Some("2026-12-01T00:00:00Z"));
    }

    #[test]
    fn a_partial_plugins_key_keeps_the_other_default() {
        let config = parse("plugins:\n  latex: true\n");
        assert!(config.plugin_enabled("diagrams"));
        assert!(config.plugin_enabled("latex"));
    }

    #[test]
    fn unknown_keys_survive_a_round_trip_byte_stable() {
        let dir = std::env::temp_dir().join(format!("kasten-config-keys-{}", std::process::id()));
        let config = parse(FULL);
        config.save(&dir).unwrap();
        let first = fs::read(dir.join(".kasten/config.yaml")).unwrap();
        let text = String::from_utf8(first.clone()).unwrap();
        assert!(text.contains("future") && text.contains("later") && text.contains("note"));
        let again = Config::load(&dir).unwrap();
        assert_eq!(again, config);
        again.save(&dir).unwrap();
        assert_eq!(fs::read(dir.join(".kasten/config.yaml")).unwrap(), first);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_invalid_mode_is_an_error_not_a_panic() {
        let dir = std::env::temp_dir().join(format!("kasten-config-bad-{}", std::process::id()));
        fs::create_dir_all(dir.join(".kasten")).unwrap();
        fs::write(
            dir.join(".kasten/config.yaml"),
            "agents:\n  mode: reckless\n",
        )
        .unwrap();
        let err = Config::load(&dir).unwrap_err();
        assert!(err.to_string().contains(".kasten/config.yaml"), "{err}");
        fs::write(
            dir.join(".kasten/config.yaml"),
            "agents:\n  projects:\n    p:\n      mode: nope\n",
        )
        .unwrap();
        assert!(Config::load(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
