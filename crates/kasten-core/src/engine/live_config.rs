//! `.kasten/config.yaml` kept current while the engine runs: the app, the CLI
//! and a long-running MCP server all read it through `Kasten::config()`, which
//! looks at the file's size and modification time (one stat, at most every
//! 100 ms) and reads it again when either changed. A file that no longer
//! parses leaves the last good config in force and shows as a health issue
//! until it is fixed; one that turns empty or vanishes does the same for one
//! look (an editor may be between truncating and writing), so guardrails
//! that were tightened do not fall back to the defaults for a moment.

use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

use super::Kasten;
use crate::config::{CONFIG_PATH, Config, FORMAT};

/// The least time between two looks at the file.
const LOOK_EVERY: Duration = Duration::from_millis(100);

/// What a look at the file saw: its size and when it was last written;
/// none when it is not there.
type Stamp = Option<(u64, SystemTime)>;

fn stamp_of(root: &Path) -> Stamp {
    let meta = std::fs::metadata(root.join(CONFIG_PATH)).ok()?;
    Some((meta.len(), meta.modified().ok()?))
}

/// The engine's memory of the config file.
pub(super) struct ConfigWatch {
    seen: Stamp,
    looked: Instant,
    /// Why the file on disk is not in force, if it is not.
    problem: Option<String>,
    /// Counts the times the config in force changed because the file did.
    generation: u64,
    /// The last look found the file empty or gone, where it had content
    /// before; the next look decides.
    doubtful: bool,
}

impl ConfigWatch {
    pub(super) fn new(root: &Path) -> ConfigWatch {
        ConfigWatch {
            seen: stamp_of(root),
            looked: Instant::now(),
            problem: None,
            generation: 0,
            doubtful: false,
        }
    }
}

impl Kasten {
    /// The vault's config as it is now: what `.kasten/config.yaml` says,
    /// read again when it changed on disk since the last look.
    pub fn config(&self) -> Config {
        self.look_at_config_file();
        self.config
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Why the config file on disk is not in force (it does not parse, or
    /// is from a newer version), or none when it is.
    pub fn config_problem(&self) -> Option<String> {
        self.look_at_config_file();
        self.watch().problem.clone()
    }

    /// How many times the config in force has changed because the file
    /// did. A server that offers tools by the config (plugins) compares it
    /// with the number it saw to know when to tell its client the list
    /// changed.
    pub fn config_generation(&self) -> u64 {
        self.look_at_config_file();
        self.watch().generation
    }

    fn watch(&self) -> std::sync::MutexGuard<'_, ConfigWatch> {
        self.config_watch.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn look_at_config_file(&self) {
        let mut watch = self.watch();
        if watch.looked.elapsed() < LOOK_EVERY {
            return;
        }
        watch.looked = Instant::now();
        let now = stamp_of(self.vault.root());
        if now == watch.seen && !watch.doubtful {
            return;
        }
        // A file that turns empty or vanishes may be an editor between
        // truncating and writing: the config before stays in force for one
        // look, and only a file still empty at the next one means defaults.
        let empty = !matches!(now, Some((len, _)) if len > 0);
        let was_empty = !matches!(watch.seen, Some((len, _)) if len > 0);
        if empty && !was_empty && !watch.doubtful {
            watch.seen = now;
            watch.doubtful = true;
            return;
        }
        watch.doubtful = false;
        watch.seen = now;
        match Config::load(self.vault.root()) {
            Ok(config) if config.format > FORMAT => {
                watch.problem = Some(format!(
                    "{CONFIG_PATH} was made by a newer version of KastenFlow (format {}), so the settings from before stay in force",
                    config.format
                ));
            }
            Ok(config) => {
                watch.problem = None;
                let mut held = self.config.write().unwrap_or_else(|p| p.into_inner());
                if *held != config {
                    *held = config;
                    watch.generation += 1;
                }
            }
            Err(err) => {
                watch.problem = Some(format!(
                    "{err}. The settings from before stay in force until the file is fixed"
                ));
            }
        }
    }

    /// The file was just written by this engine: its new stamp is not a
    /// change made elsewhere.
    pub(super) fn config_saved(&self) {
        let mut watch = self.watch();
        watch.seen = stamp_of(self.vault.root());
        watch.looked = Instant::now();
        watch.problem = None;
        watch.doubtful = false;
        watch.generation += 1;
    }
}
