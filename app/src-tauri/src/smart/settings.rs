//! What a person decides about a smart page: the page may show pictures from
//! the web, and a page an agent made may run. (Whether smart pages are on at
//! all is the Smart pages plugin's, in the vault, with a switch for each
//! project.) Each is set by a window command nothing but the
//! window's own code can call; an agent cannot, and a page's folder cannot say
//! it for itself. They are kept in the app's data folder, not in the vault, so
//! a vault that comes from someone else never brings a permission with it.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    /// What a person allowed to run of the code pictures an agent wrote: a deck's vault path and the
    /// hash of the code they saw, as `<path>\n<hash>`. An allow given before it named the code (a
    /// deck's path alone) is not read: it let any later code run unseen.
    generator_code: BTreeSet<String>,
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

/// The hash of a code picture's code (SHA-256, in hex): what a person's "Allow to run" is kept for,
/// and what they are shown beside the code.
pub fn code_hash(code: &str) -> String {
    Sha256::digest(code.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The key an allow is kept under; none for a code picture in no deck, or a hash that is not one.
fn code_key(deck: &str, hash: &str) -> Result<String, String> {
    let deck = deck.trim();
    if deck.is_empty() {
        return Err("A code picture that is not in a deck is asked about every time, so this choice cannot be kept.".to_owned());
    }
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("The code could not be identified, so this choice cannot be kept.".to_owned());
    }
    Ok(format!("{deck}\n{}", hash.to_ascii_lowercase()))
}

/// Whether a person allowed this code (by its hash) to run in the deck at this vault path. Missing
/// or unread says no, and so does a code picture in no deck.
pub fn generator_allowed(dir: Option<&Path>, deck: &str, hash: &str) -> bool {
    let Ok(key) = code_key(deck, hash) else {
        return false;
    };
    read(dir, false, |stored| stored.generator_code.contains(&key))
}

/// A person's "Allow to run" for this code (by its hash) in the deck at this vault path. Nothing is
/// kept for a code picture in no deck.
pub fn set_generator_allowed(dir: &Path, deck: &str, hash: &str) -> Result<(), String> {
    let key = code_key(deck, hash)?;
    update(dir, |stored| stored.generator_code.insert(key))
}
