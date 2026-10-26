//! What a person decides about smart pages, per page and for all of them: the
//! page may show pictures from the web, a page an agent made may run, and the
//! whole feature is on. Each is set by a window command nothing but the
//! window's own code can call; an agent cannot, and a page's folder cannot say
//! it for itself. They are kept in the app's data folder, not in the vault, so
//! a vault that comes from someone else never brings a permission with it.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const FILE: &str = "smart-pages.json";

/// Reads and writes of the file one at a time.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    /// Ids of the pages that may show pictures from the web.
    web_images: BTreeSet<String>,
    /// What each of those pages' files were when the leave was given (a
    /// fingerprint of the folder): once they differ the leave is over, so
    /// code written afterwards does not inherit it. A leave kept by an older
    /// version has none and stands.
    web_images_code: BTreeMap<String, String>,
    /// Ids of the pages a person allowed to run after an agent made them.
    allowed: BTreeSet<String>,
    /// Smart pages run at all (on unless a person turned it off).
    run: Option<bool>,
}

fn file(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

fn load(dir: &Path) -> Stored {
    fs::read_to_string(file(dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Reads the file, lets `change` edit it, and writes it only if it changed.
fn update(dir: &Path, change: impl FnOnce(&mut Stored) -> bool) -> Result<(), String> {
    let _held = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut stored = load(dir);
    if !change(&mut stored) {
        return Ok(());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    let target = file(dir);
    let temp = dir.join(format!("{FILE}.tmp"));
    // Flushed before the rename, so a power cut leaves the old file or the new one.
    let mut out = fs::File::create(&temp).map_err(|e| e.to_string())?;
    out.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    out.sync_all().map_err(|e| e.to_string())?;
    drop(out);
    fs::rename(&temp, &target).map_err(|e| e.to_string())
}

fn read<T>(dir: Option<&Path>, none: T, from: impl FnOnce(&Stored) -> T) -> T {
    let Some(dir) = dir else { return none };
    let _held = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    from(&load(dir))
}

/// Whether the page with this id may show pictures from the web: a person gave
/// the leave, and the page's files are still the ones they gave it for
/// (`current` makes the fingerprint of the folder as it is now, and is called
/// only when there is a leave). A file that is missing or does not read says no.
pub fn web_images(dir: Option<&Path>, id: &str, current: &dyn Fn() -> String) -> bool {
    let kept = read(dir, None, |stored| {
        stored
            .web_images
            .contains(id)
            .then(|| stored.web_images_code.get(id).cloned())
    });
    match kept {
        None => false,
        // An older leave, given before the files were noted.
        Some(None) => true,
        Some(Some(was)) => was == current(),
    }
}

/// Allows or forbids pictures from the web for the page with this id, as its
/// files are now (`fingerprint`).
pub fn set_web_images(dir: &Path, id: &str, allow: bool, fingerprint: &str) -> Result<(), String> {
    update(dir, |stored| {
        if allow {
            let new = stored.web_images.insert(id.to_owned());
            let old = stored
                .web_images_code
                .insert(id.to_owned(), fingerprint.to_owned());
            new || old.as_deref() != Some(fingerprint)
        } else {
            let was = stored.web_images.remove(id);
            let noted = stored.web_images_code.remove(id).is_some();
            was || noted
        }
    })
}

/// Whether a person allowed the page with this id to run. Missing or unread
/// says no.
pub fn allowed(dir: Option<&Path>, id: &str) -> bool {
    read(dir, false, |stored| stored.allowed.contains(id))
}

/// A person's "Allow to run" for the page with this id.
pub fn set_allowed(dir: &Path, id: &str) -> Result<(), String> {
    update(dir, |stored| stored.allowed.insert(id.to_owned()))
}

/// Whether smart pages run at all: yes, until a person turns them off.
pub fn run_enabled(dir: Option<&Path>) -> bool {
    read(dir, true, |stored| stored.run.unwrap_or(true))
}

/// Turns smart pages on or off for this computer.
pub fn set_run_enabled(dir: &Path, on: bool) -> Result<(), String> {
    update(dir, |stored| {
        let was = stored.run.unwrap_or(true);
        stored.run = Some(on);
        was != on
    })
}
