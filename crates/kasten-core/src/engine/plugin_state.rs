//! Turning a plugin on or off for this vault. Only a person does it (an
//! agent is refused, whatever it has been trusted with): the choice is
//! written to `.kasten/config.yaml` as one commit that Undo takes back.

use super::{Change, Kasten};
use crate::config::{CONFIG_PATH, Config};
use crate::config_keys::PluginsConfig;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;

/// The plugins whose choice lives in the vault. Others, such as the
/// browser, are the computer's own and are kept in the app's settings.
pub const VAULT_PLUGINS: [&str; 2] = ["diagrams", "latex"];

impl Config {
    /// Records that plugin `id` is on or off, keeping every other key.
    pub fn set_plugin_enabled(&mut self, id: &str, on: bool) {
        let plugins = self.plugins.get_or_insert_with(PluginsConfig::default);
        match id {
            "diagrams" => plugins.diagrams = Some(on),
            "latex" => plugins.latex = Some(on),
            other => {
                plugins.extra.insert(other.to_owned(), on.into());
            }
        }
    }
}

impl Kasten {
    /// Turns plugin `id` on or off. Answers whether anything changed: saying
    /// what is already so writes nothing and makes no commit.
    pub fn set_plugin_enabled(
        &self,
        actor: &Actor,
        id: &str,
        on: bool,
        now: Instant,
    ) -> Result<bool> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Only a person can turn a plugin on or off, in Settings → Plugins".to_owned(),
            ));
        }
        if !VAULT_PLUGINS.contains(&id) {
            return Err(Error::Invalid(format!("There is no plugin called “{id}”")));
        }
        // The file is the truth: another program may have changed it.
        if Config::load(self.root())?.plugin_enabled(id) == on {
            return Ok(false);
        }
        let word = if on { "on" } else { "off" };
        let config = self.apply(actor, "set_plugin_enabled", false, now.millis, |vault| {
            let mut config = Config::load(vault.root())?;
            config.set_plugin_enabled(id, on);
            config.save(vault.root())?;
            Ok(Change {
                message: format!("plugins: turn {id} {word}"),
                paths: vec![CONFIG_PATH.to_owned()],
                value: config,
            })
        })?;
        *self.config.write().unwrap_or_else(|p| p.into_inner()) = config;
        self.config_saved();
        Ok(true)
    }
}
