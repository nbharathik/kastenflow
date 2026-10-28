//! `app-alive.json`: the app says it is there. Whoever asks the app for
//! something reads it first, and calls the app closed when the file is
//! missing, unreadable, or older than 15 seconds.

use serde::{Deserialize, Serialize};

use super::files::{Found, Mailbox};
use super::{ALIVE_MAX_AGE_MS, MAX_ALIVE_BYTES};
use crate::error::{Error, Result};

/// What the app writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Alive {
    /// The app's time when it wrote this (milliseconds since the Unix epoch).
    pub time: u64,
    pub version: String,
    pub pid: u32,
}

impl Mailbox {
    /// The app says it is there at `now` (milliseconds since the Unix epoch).
    pub fn mark_alive(&self, version: &str, now: u64) -> Result<()> {
        let alive = Alive {
            time: now,
            version: version.to_owned(),
            pid: std::process::id(),
        };
        let bytes = serde_json::to_vec(&alive).map_err(|e| Error::Invalid(e.to_string()))?;
        self.ensure_dirs()?;
        self.write(&self.alive_path(), &bytes)
    }

    /// What the app said, when it said it lately (within 15 s of `now`, and
    /// not from the future); none when the app is closed.
    pub fn alive(&self, now: u64) -> Option<Alive> {
        let Found::Bytes(bytes) = self.read(&self.alive_path(), MAX_ALIVE_BYTES) else {
            return None;
        };
        let alive: Alive = serde_json::from_slice(&bytes).ok()?;
        let fresh = now.saturating_sub(alive.time) <= ALIVE_MAX_AGE_MS
            && alive.time <= now + ALIVE_MAX_AGE_MS;
        fresh.then_some(alive)
    }

    /// The app is closing: its file goes.
    pub fn clear_alive(&self) {
        self.forget(&self.alive_path());
    }
}
