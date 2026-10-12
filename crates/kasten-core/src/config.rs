//! `.kasten/config.yaml`: the vault's name, the format it is written in,
//! backup remote, agent guardrail limits, AI endpoints and the journal's
//! template
//! (docs/vault-format.md). Missing keys take their defaults;
//! unknown keys are ignored. API keys never live here.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::atomic::write_atomic;
use crate::error::{Error, Result};

/// The vault format this Kasten writes (docs/vault-format.md). A vault
/// written in a newer one is not opened, so an older app cannot damage it.
pub const FORMAT: u32 = 1;

/// Vaults from before formats were numbered.
fn first_format() -> u32 {
    1
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub name: String,
    /// The vault format the files follow.
    #[serde(default = "first_format")]
    pub format: u32,
    pub git: GitConfig,
    pub guardrails: Guardrails,
    pub ai: AiConfig,
    /// The template new journal days start from, by name
    /// (`templates/<name>.md`); none, or one that is not there, means
    /// `journal`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journal_template: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct GitConfig {
    /// URL of the private backup remote; none means no pushes.
    pub remote: Option<String>,
    /// Push this long after the last commit.
    pub push_delay_seconds: u64,
    /// And at least this often while there is something to push.
    pub push_interval_minutes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Guardrails {
    /// An agent edit removing more than this share of a note's text becomes a proposal.
    pub max_removed_fraction: f64,
    /// Notes one agent session may change in ten minutes before writes become proposals.
    pub max_notes_per_session_10min: u32,
    /// Trash ops per session before they become proposals.
    pub max_trash_per_session: u32,
    /// Board nodes one edit may remove before it becomes a proposal.
    pub max_board_nodes_removed: u32,
    /// Slides one agent session may take out of decks (remove, or leave with
    /// nothing on them) in ten minutes before its changes become proposals.
    /// A trusted session is held to this too; deleting a deck always waits.
    pub max_slides_removed: u32,
    /// Largest single agent write; larger ones are refused.
    pub max_write_bytes: u64,
    /// Largest picture or file an agent may add to `assets/`; a bigger one is refused.
    pub max_asset_bytes: u64,
    /// Pictures one agent session may add in ten minutes; past this they are refused.
    pub max_assets_per_session_10min: u32,
    /// Bytes of pictures one agent session may add in ten minutes; past this they are refused.
    pub max_asset_bytes_per_session_10min: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AiConfig {
    pub providers: Vec<Provider>,
    /// Search by meaning, once chosen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embeddings: Option<Embeddings>,
}

/// The provider (an OpenAI-compatible one) and model that turn notes into
/// vectors for search by meaning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Embeddings {
    pub provider: String,
    pub model: String,
}

/// An AI endpoint for chat. The key is in the OS keychain under `name`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Provider {
    pub name: String,
    /// `anthropic`, `openai` (any OpenAI-compatible endpoint, such as vLLM) or `chatgpt`
    /// (a ChatGPT sign-in: no address and no key, kept by the app).
    pub kind: String,
    pub base_url: String,
    pub model: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            name: "Kasten".to_owned(),
            format: FORMAT,
            git: GitConfig::default(),
            guardrails: Guardrails::default(),
            ai: AiConfig::default(),
            journal_template: None,
        }
    }
}

impl Default for GitConfig {
    fn default() -> Self {
        GitConfig {
            remote: None,
            push_delay_seconds: 120,
            push_interval_minutes: 60,
        }
    }
}

impl Default for Guardrails {
    fn default() -> Self {
        Guardrails {
            max_removed_fraction: 0.4,
            max_notes_per_session_10min: 25,
            max_trash_per_session: 5,
            max_board_nodes_removed: 10,
            max_slides_removed: 3,
            max_write_bytes: 204_800,
            max_asset_bytes: 10 * 1024 * 1024,
            max_assets_per_session_10min: 30,
            max_asset_bytes_per_session_10min: 50 * 1024 * 1024,
        }
    }
}

pub const CONFIG_PATH: &str = ".kasten/config.yaml";

impl Config {
    /// The vault's config, or the defaults when it has none.
    pub fn load(root: &Path) -> Result<Config> {
        match fs::read_to_string(root.join(CONFIG_PATH)) {
            Ok(text) if text.trim().is_empty() => Ok(Config::default()),
            Ok(text) => serde_saphyr::from_str(&text)
                .map_err(|e| Error::Invalid(format!("{CONFIG_PATH}: {e}"))),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(err) => Err(err.into()),
        }
    }

    /// Writes the config. Comments in the old file are not kept.
    pub fn save(&self, root: &Path) -> Result<()> {
        let yaml = serde_saphyr::to_string(self).map_err(|e| Error::Invalid(e.to_string()))?;
        let path = root.join(CONFIG_PATH);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        write_atomic(&path, yaml.as_bytes())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_dev_vault_config_and_fills_defaults() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/dev-vault");
        let config = Config::load(&root).unwrap();
        assert_eq!(config.name, "Dev vault");
        assert_eq!(config.git.remote, None);
        assert_eq!(config.guardrails, Guardrails::default());
        assert!(config.ai.providers.is_empty());
        assert_eq!(config.ai.embeddings, None);
        let partial: Config =
            serde_saphyr::from_str("name: X\nguardrails:\n  max_trash_per_session: 2\n").unwrap();
        assert_eq!(partial.guardrails.max_trash_per_session, 2);
        assert_eq!(partial.guardrails.max_write_bytes, 204_800);
        assert_eq!(partial.git.push_delay_seconds, 120);
    }

    #[test]
    fn writes_what_it_reads() {
        let dir = std::env::temp_dir().join(format!("kasten-config-{}", std::process::id()));
        let mut config = Config::default();
        config.git.remote = Some("git@example.org:me/notes.git".into());
        config.ai.providers.push(Provider {
            name: "claude".into(),
            kind: "anthropic".into(),
            base_url: "https://api.anthropic.com".into(),
            model: "model-small".into(),
        });
        config.save(&dir).unwrap();
        assert_eq!(Config::load(&dir).unwrap(), config);
        assert!(
            !fs::read_to_string(dir.join(".kasten/config.yaml"))
                .unwrap()
                .contains("embeddings"),
            "left out until chosen"
        );
        config.ai.embeddings = Some(Embeddings {
            provider: "openai".into(),
            model: "text-embedding-3-small".into(),
        });
        config.save(&dir).unwrap();
        assert_eq!(Config::load(&dir).unwrap(), config);
        let _ = fs::remove_dir_all(&dir);
    }
}
