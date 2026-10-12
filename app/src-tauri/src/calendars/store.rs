//! Where the calendar subscriptions are kept, all on this computer and none
//! in the vault (so subscribing writes nothing to the person's notes):
//!
//! - the list (name, colour, how often to refresh, shown or hidden, and the
//!   address's host) in the app's config folder, `calendars.json`;
//! - each feed's address, which is a secret, in the OS keychain under
//!   `calendar @ <id>`;
//! - each feed's last copy and what the server said about it in the OS cache
//!   folder, `calendars/<id>.ics` and `<id>.json`, which a sync tool does not
//!   copy.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::fetch::Validators;
use crate::secrets::KeyStore;

const LIST: &str = "calendars.json";
/// The most subscriptions.
pub const MAX_CALENDARS: usize = 20;
pub const DEFAULT_REFRESH: u32 = 30;
pub const MIN_REFRESH: u32 = 5;
pub const MAX_REFRESH: u32 = 24 * 60;

/// One subscription, as the list keeps it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub color: String,
    pub refresh_minutes: u32,
    pub shown: bool,
    /// The address's host, to show; the rest of the address is secret.
    pub host: String,
    /// The host and no more, to show where the address would be.
    pub masked: String,
}

impl Default for Entry {
    fn default() -> Entry {
        Entry {
            id: String::new(),
            name: String::new(),
            color: "blue".into(),
            refresh_minutes: DEFAULT_REFRESH,
            shown: true,
            host: String::new(),
            masked: String::new(),
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
struct List {
    calendars: Vec<Entry>,
}

/// What is known about a feed's last copy.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Meta {
    pub validators: Validators,
    /// When it was last asked for, success or not (seconds since 1970).
    pub checked: Option<i64>,
    /// When the copy was last known to be the current one.
    pub updated: Option<i64>,
    /// Why the last attempt failed, if it did.
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct Store {
    config: PathBuf,
    cache: PathBuf,
    keys: Arc<dyn KeyStore>,
}

/// Ids are made here, from letters and digits; anything else from outside is
/// not an id, so it can never lead to another file.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut name = path.file_name().map(|n| n.to_owned()).unwrap_or_default();
    name.push(".tmp");
    let temp = path.with_file_name(name);
    let mut file = fs::File::create(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp, path)
}

impl Store {
    pub fn new(config: PathBuf, cache: PathBuf, keys: Arc<dyn KeyStore>) -> Store {
        Store {
            config,
            cache: cache.join("calendars"),
            keys,
        }
    }

    fn list_path(&self) -> PathBuf {
        self.config.join(LIST)
    }

    /// The subscriptions. A list that cannot be read is an error, not an empty
    /// list, so the next change never writes over it.
    pub fn list(&self) -> Result<Vec<Entry>, String> {
        let text = match fs::read_to_string(self.list_path()) {
            Ok(text) => text,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(format!("Could not read the calendar list: {e}")),
        };
        if text.trim().is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str::<List>(&text)
            .map(|list| list.calendars)
            .map_err(|e| format!("The calendar list ({LIST}) is damaged: {e}"))
    }

    /// Changes the list, one change at a time so two at once cannot lose either.
    pub fn update<T>(
        &self,
        change: impl FnOnce(&mut Vec<Entry>) -> Result<T, String>,
    ) -> Result<T, String> {
        static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());
        let _held = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let mut calendars = self.list()?;
        let out = change(&mut calendars)?;
        let text = serde_json::to_string_pretty(&List { calendars })
            .map_err(|e| format!("Could not write the calendar list: {e}"))?;
        write_atomic(&self.list_path(), text.as_bytes())
            .map_err(|e| format!("Could not write the calendar list: {e}"))?;
        Ok(out)
    }

    pub fn entry(&self, id: &str) -> Result<Entry, String> {
        self.list()?
            .into_iter()
            .find(|e| e.id == id)
            .ok_or_else(|| "That calendar is not in the list".to_owned())
    }

    /// A new id that no subscription has.
    pub fn new_id(&self) -> Result<String, String> {
        let taken: Vec<String> = self.list()?.into_iter().map(|e| e.id).collect();
        for _ in 0..8 {
            let mut bytes = [0u8; 6];
            getrandom::fill(&mut bytes).map_err(|e| format!("No random numbers: {e}"))?;
            let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            if !taken.contains(&id) {
                return Ok(id);
            }
        }
        Err("Could not make a name for the calendar".into())
    }

    fn account(id: &str) -> String {
        format!("calendar @ {id}")
    }

    /// The feed's address, from the keychain.
    pub fn address(&self, id: &str) -> Result<String, String> {
        if !valid_id(id) {
            return Err("That calendar is not in the list".into());
        }
        self.keys.get(&Store::account(id))?.ok_or_else(|| {
            "The address of this calendar is no longer in the keychain. Subscribe again".to_owned()
        })
    }

    pub fn set_address(&self, id: &str, url: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("That calendar is not in the list".into());
        }
        self.keys.set(&Store::account(id), url)
    }

    pub fn forget_address(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Ok(());
        }
        self.keys.delete(&Store::account(id))
    }

    fn feed_path(&self, id: &str) -> PathBuf {
        self.cache.join(format!("{id}.ics"))
    }

    fn meta_path(&self, id: &str) -> PathBuf {
        self.cache.join(format!("{id}.json"))
    }

    /// The last copy of the feed, if there is one.
    pub fn read_feed(&self, id: &str) -> Option<String> {
        if !valid_id(id) {
            return None;
        }
        fs::read(self.feed_path(id))
            .ok()
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    }

    pub fn write_feed(&self, id: &str, text: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("That calendar is not in the list".into());
        }
        write_atomic(&self.feed_path(id), text.as_bytes())
            .map_err(|e| format!("Could not keep the calendar's copy: {e}"))
    }

    pub fn meta(&self, id: &str) -> Meta {
        if !valid_id(id) {
            return Meta::default();
        }
        fs::read_to_string(self.meta_path(id))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save_meta(&self, id: &str, meta: &Meta) -> Result<(), String> {
        if !valid_id(id) {
            return Err("That calendar is not in the list".into());
        }
        let text = serde_json::to_string(meta).map_err(|e| e.to_string())?;
        write_atomic(&self.meta_path(id), text.as_bytes())
            .map_err(|e| format!("Could not keep what the server said: {e}"))
    }

    /// Deletes the cached copy and what the server said about it.
    pub fn drop_cache(&self, id: &str) {
        if valid_id(id) {
            let _ = fs::remove_file(self.feed_path(id));
            let _ = fs::remove_file(self.meta_path(id));
        }
    }

    #[cfg(test)]
    pub fn cache_folder(&self) -> &Path {
        &self.cache
    }

    #[cfg(test)]
    pub fn keys(&self) -> &Arc<dyn KeyStore> {
        &self.keys
    }

    /// Every file the store has written, in the config and cache folders.
    #[cfg(test)]
    pub fn files_for_tests(&self) -> Vec<PathBuf> {
        fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
            if let Ok(read) = fs::read_dir(dir) {
                for entry in read.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        walk(&path, out);
                    } else {
                        out.push(path);
                    }
                }
            }
        }
        let mut out = Vec::new();
        walk(&self.config, &mut out);
        walk(&self.cache, &mut out);
        out
    }
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
