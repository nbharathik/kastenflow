//! Checkpoints: the vault's newest commit, noted before an autonomous
//! session writes for the first time and before a big batch, so the vault can
//! be put back as it was by a new commit (never by rewriting history). The
//! list is a cache file: losing it loses the shortcut, not the history.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::atomic::write_atomic;
use crate::error::Result;

pub const CHECKPOINTS_PATH: &str = ".kasten/cache/checkpoints.json";
/// The label of the checkpoint taken before a session's first autonomous write.
pub const SESSION_LABEL: &str = "Before this session";
/// How many checkpoints are kept; the oldest go first.
const KEEP: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub session: String,
    /// The commit the vault was at.
    pub head: String,
    /// Milliseconds since the Unix epoch.
    pub time: u64,
    pub label: String,
}

/// The checkpoints, oldest first. A missing or unreadable file is an empty list.
pub fn load(root: &Path) -> Vec<Checkpoint> {
    std::fs::read_to_string(root.join(CHECKPOINTS_PATH))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Adds `checkpoint` to the list, keeping the newest `KEEP`.
pub fn record(root: &Path, checkpoint: Checkpoint) -> Result<()> {
    let mut all = load(root);
    all.push(checkpoint);
    let extra = all.len().saturating_sub(KEEP);
    all.drain(..extra);
    save(root, &all)
}

/// Takes the checkpoint `id` out of the list again: the batch it was noted for
/// did not happen. Only the shortcut goes, never any history.
pub fn forget(root: &Path, id: &str) -> Result<()> {
    let mut all = load(root);
    let before = all.len();
    all.retain(|c| c.id != id);
    if all.len() == before {
        return Ok(());
    }
    save(root, &all)
}

fn save(root: &Path, all: &[Checkpoint]) -> Result<()> {
    let path = root.join(CHECKPOINTS_PATH);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(all).unwrap_or_else(|_| "[]".to_owned());
    write_atomic(&path, text.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(n: u64) -> Checkpoint {
        Checkpoint {
            id: format!("c{n}"),
            session: "s".into(),
            head: format!("{n:040}"),
            time: n,
            label: SESSION_LABEL.into(),
        }
    }

    #[test]
    fn records_in_order_and_keeps_the_newest() {
        let dir = std::env::temp_dir().join(format!("kasten-checkpoints-{}", std::process::id()));
        assert!(load(&dir).is_empty());
        for n in 0..(KEEP as u64 + 5) {
            record(&dir, at(n)).unwrap();
        }
        let all = load(&dir);
        assert_eq!(all.len(), KEEP);
        assert_eq!(all[0].id, "c5");
        assert_eq!(all[KEEP - 1].id, format!("c{}", KEEP + 4));
        forget(&dir, "c10").unwrap();
        forget(&dir, "nope").unwrap();
        let after = load(&dir);
        assert_eq!(after.len(), KEEP - 1);
        assert!(after.iter().all(|c| c.id != "c10"));
        std::fs::write(dir.join(CHECKPOINTS_PATH), "not json").unwrap();
        assert!(load(&dir).is_empty(), "a broken cache is only a cache");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
