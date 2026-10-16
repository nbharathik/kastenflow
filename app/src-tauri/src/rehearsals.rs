//! The store of a deck's rehearsals, kept in the app's data folder, not in the vault: a
//! rehearsal is a timing of a person's practice, worth keeping on this computer and not
//! worth a commit or a sync. One file for each deck of each vault:
//! `<app data>/rehearsals/<first 16 hex digits of the SHA-256 of the vault's folder>/<deck id>.json`,
//! a list of the last runs (the newest last): `{at, totalMs, slides: [{id, ms}], targetMs?}`.
//! A deck id that is not a plain name is stored under a name made from its hash, so no id
//! can reach outside the folder. Clearing writes an empty list, and nothing is ever deleted.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use crate::commands::notes::OpenVault;

/// How many runs of a deck are kept; older ones drop off.
pub const KEPT: usize = 50;
/// The most slides one run times, and the longest time kept for a run or a slide (a day).
const MOST_SLIDES: usize = 10_000;
const MOST_MS: u64 = 24 * 60 * 60 * 1000;
/// The longest deck id or slide id taken.
const MOST_ID: usize = 200;

/// The time spent on one slide.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideTime {
    pub id: String,
    pub ms: u64,
}

/// One run of a deck.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    /// When it was, as the window wrote it: milliseconds since the epoch, or a time as text.
    pub at: Value,
    pub total_ms: u64,
    pub slides: Vec<SlideTime>,
    /// The time the person aimed for, if they set one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_ms: Option<u64>,
}

impl Run {
    /// Why the window's record cannot be kept, if it cannot.
    fn check(&self) -> Result<(), String> {
        let at_fits = match &self.at {
            Value::Number(_) => true,
            Value::String(text) => !text.is_empty() && text.len() <= 64,
            _ => false,
        };
        if !at_fits {
            return Err("A rehearsal needs the time it was made".to_owned());
        }
        if self.total_ms > MOST_MS || self.target_ms.is_some_and(|t| t > MOST_MS) {
            return Err("A rehearsal is at most a day long".to_owned());
        }
        if self.slides.len() > MOST_SLIDES {
            return Err(format!("A rehearsal times at most {MOST_SLIDES} slides"));
        }
        for slide in &self.slides {
            if slide.id.is_empty() || slide.id.len() > MOST_ID || slide.ms > MOST_MS {
                return Err("A slide's time needs its id and at most a day".to_owned());
            }
        }
        Ok(())
    }
}

/// The folder of a vault's rehearsals under `base`.
fn folder(base: &Path, vault: &Path) -> PathBuf {
    let hash = Sha256::digest(vault.to_string_lossy().as_bytes());
    let hex: String = hash.iter().take(8).map(|b| format!("{b:02x}")).collect();
    base.join("rehearsals").join(hex)
}

/// The file name of a deck: its id when that is a plain name, else a name made from its hash.
fn name(deck: &str) -> String {
    let plain = !deck.is_empty()
        && deck.len() <= MOST_ID
        && !deck.starts_with('.')
        && deck
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if plain {
        return format!("{deck}.json");
    }
    let hash = Sha256::digest(deck.as_bytes());
    let hex: String = hash.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("h-{hex}.json")
}

fn file(base: &Path, vault: &Path, deck: &str) -> PathBuf {
    folder(base, vault).join(name(deck))
}

/// The runs of a deck, oldest first. A deck with none, and a file that cannot be read, have none.
pub fn read(base: &Path, vault: &Path, deck: &str) -> Vec<Run> {
    fs::read_to_string(file(base, vault, deck))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write(base: &Path, vault: &Path, deck: &str, runs: &[Run]) -> Result<(), String> {
    let target = file(base, vault, deck);
    let dir = target.parent().map(Path::to_owned).unwrap_or_default();
    fs::create_dir_all(&dir).map_err(|err| format!("The rehearsals could not be kept: {err}"))?;
    let text = serde_json::to_string_pretty(runs).map_err(|err| err.to_string())?;
    // Written whole beside the file and moved over it, so a crash leaves the old list or the new.
    let temp = dir.join(format!(".{}.tmp", name(deck)));
    fs::write(&temp, text).map_err(|err| format!("The rehearsals could not be kept: {err}"))?;
    fs::rename(&temp, &target).map_err(|err| format!("The rehearsals could not be kept: {err}"))
}

/// Adds a run to a deck's list, keeping the last `KEPT`; gives the list.
pub fn add(base: &Path, vault: &Path, deck: &str, run: Run) -> Result<Vec<Run>, String> {
    if deck.is_empty() || deck.len() > MOST_ID {
        return Err("A rehearsal belongs to a deck".to_owned());
    }
    run.check()?;
    let mut runs = read(base, vault, deck);
    runs.push(run);
    if runs.len() > KEPT {
        runs.drain(..runs.len() - KEPT);
    }
    write(base, vault, deck, &runs)?;
    Ok(runs)
}

/// Empties a deck's list. The file is written with an empty list, not removed.
pub fn clear(base: &Path, vault: &Path, deck: &str) -> Result<(), String> {
    write(base, vault, deck, &[])
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())
}

/// The runs of a deck in the open vault, oldest first.
#[tauri::command(async)]
pub fn rehearsals(
    app: AppHandle,
    state: State<'_, OpenVault>,
    deck_id: String,
) -> Result<Vec<Run>, String> {
    let kasten = state.require()?;
    Ok(read(&data_dir(&app)?, kasten.root(), &deck_id))
}

/// Keeps a run of a deck; gives the deck's runs, the newest last.
#[tauri::command(async)]
pub fn add_rehearsal(
    app: AppHandle,
    state: State<'_, OpenVault>,
    deck_id: String,
    record: Run,
) -> Result<Vec<Run>, String> {
    let kasten = state.require()?;
    add(&data_dir(&app)?, kasten.root(), &deck_id, record)
}

/// Forgets a deck's runs.
#[tauri::command(async)]
pub fn clear_rehearsals(
    app: AppHandle,
    state: State<'_, OpenVault>,
    deck_id: String,
) -> Result<(), String> {
    let kasten = state.require()?;
    clear(&data_dir(&app)?, kasten.root(), &deck_id)
}

#[cfg(test)]
mod tests;
