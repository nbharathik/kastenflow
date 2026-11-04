//! Tells a connected client when the tools it can call change because the
//! vault's config did (a plugin turned on or off in the app while this server
//! runs). The config itself is read live by the engine; this only notices
//! that what the tools depend on moved.

use std::sync::Arc;
use std::time::Duration;

use kasten_core::{Config, Kasten};
use rmcp::service::{Peer, RoleServer};

use crate::tools::plugins;

/// How often the config is looked at. The engine reads the file at most
/// every 100 ms; a client does not need to hear sooner than this.
const EVERY: Duration = Duration::from_secs(2);

/// What the offered tools depend on, as text: equal text, same tools.
/// Plugins gate their tools, so the plugins' state is the whole of it.
pub(crate) fn signature(config: &Config) -> String {
    plugins(config).to_string()
}

/// How often the vault is looked at for its first deck (the deck tools that edit are listed once it has one).
const DECKS_EVERY: Duration = Duration::from_secs(4);

/// Remembers what the tools depended on when last asked.
pub(crate) struct ToolsWatch {
    kasten: Arc<Kasten>,
    generation: u64,
    signature: String,
    /// Whether the vault had a deck when last looked, and when that was.
    decks: bool,
    looked: std::time::Instant,
}

impl ToolsWatch {
    pub(crate) fn new(kasten: Arc<Kasten>) -> ToolsWatch {
        ToolsWatch {
            generation: kasten.config_generation(),
            signature: signature(&kasten.config()),
            decks: crate::slides_group::has_decks_now(&kasten),
            looked: std::time::Instant::now(),
            kasten,
        }
    }

    /// Whether the set of tools changed since the last call: a plugin came on or went off, or the vault got its first
    /// deck (or lost its last). Costs a stat at most, unless the config changed or it is time to look for decks.
    pub(crate) fn changed(&mut self) -> bool {
        let config = self.config_changed();
        if self.looked.elapsed() < DECKS_EVERY {
            return config;
        }
        self.looked = std::time::Instant::now();
        let decks = crate::slides_group::has_decks_now(&self.kasten);
        let moved = decks != self.decks;
        self.decks = decks;
        config || moved
    }

    fn config_changed(&mut self) -> bool {
        let generation = self.kasten.config_generation();
        if generation == self.generation {
            return false;
        }
        self.generation = generation;
        let signature = signature(&self.kasten.config());
        if signature == self.signature {
            return false;
        }
        self.signature = signature;
        true
    }
}

/// Looks at the config for as long as the client is connected, and sends it
/// `notifications/tools/list_changed` when the tools changed.
pub(crate) async fn watch(kasten: Arc<Kasten>, peer: Peer<RoleServer>) {
    let mut tools = ToolsWatch::new(kasten);
    loop {
        tokio::time::sleep(EVERY).await;
        if tools.changed() && peer.notify_tool_list_changed().await.is_err() {
            // The client went away.
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notices_a_plugin_turned_on_and_not_a_change_that_leaves_the_tools_alone() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-mcp-watch-{}",
            kasten_core::ulid_at(kasten_core::Instant::now().millis)
        ));
        std::fs::create_dir_all(dir.join(".kasten")).unwrap();
        let kasten = Arc::new(Kasten::open(&dir).unwrap());
        let mut tools = ToolsWatch::new(Arc::clone(&kasten));
        assert!(!tools.changed());

        let pause = Duration::from_millis(200);
        std::thread::sleep(pause);
        std::fs::write(dir.join(".kasten/config.yaml"), "plugins:\n  latex: true\n").unwrap();
        std::thread::sleep(pause);
        assert!(tools.changed(), "a plugin came on");
        assert!(!tools.changed(), "told once");

        std::thread::sleep(pause);
        std::fs::write(
            dir.join(".kasten/config.yaml"),
            "plugins:\n  latex: true\nguardrails:\n  max_trash_per_session: 2\n",
        )
        .unwrap();
        std::thread::sleep(pause);
        assert!(!tools.changed(), "a limit is not a tool");

        std::thread::sleep(pause);
        std::fs::write(
            dir.join(".kasten/config.yaml"),
            "plugins:\n  latex: false\n",
        )
        .unwrap();
        std::thread::sleep(pause);
        assert!(tools.changed(), "the plugin went off");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
