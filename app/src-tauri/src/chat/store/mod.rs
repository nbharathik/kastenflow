//! Saved threads. Each thread is a file in the app's data folder, not in the
//! vault, and one folder per vault: `<data>/chats/<first 16 hex of the SHA-256
//! of the vault's path>/<chat id>.json`, with a short `<chat id>.head.json`
//! beside it that the thread list reads. A file is written whole and put in
//! place in one step after every step of a turn, so the app closing or
//! crashing loses at most the step in flight.
//!
//! Nothing here holds a key or a token: a thread is its conversation, the
//! names of its provider and model, and the window's picture of it.
//!
//! Nothing is ever deleted on its own: a thread goes only when the person
//! deletes it (`delete`). How much room the threads take is reported
//! (`usage`), so the window can offer to delete old ones; it is never acted on.

pub mod disk;
mod record;
pub(crate) mod remove;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};

use disk::{Unread, read_json, write_atomic};
pub use record::{
    Head, MAX_UI_BYTES, Record, Status, ThreadSummary, VERSION, title_from, valid_id,
};

const HEAD: &str = ".head.json";

/// How much room the saved threads of a vault take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub threads: usize,
    /// The size of their files, in bytes.
    pub bytes: u64,
}

/// The saved threads of one vault.
pub struct Store {
    dir: PathBuf,
    /// The newest snapshot written of each thread: an older one that
    /// arrives later is dropped. Held while a file is written, so two
    /// writes of one thread never interleave.
    written: Mutex<HashMap<String, u64>>,
}

/// The hex of `bytes`.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A folder name for a vault: 16 hex characters of the SHA-256 of its path.
pub fn vault_hash(vault_root: &str) -> String {
    let digest = Sha256::digest(vault_root.as_bytes());
    hex(&digest[..8])
}

impl Store {
    /// The store of the vault at `vault_root`, under the app's `data` folder.
    pub fn open(data: &Path, vault_root: &str) -> Store {
        Store {
            dir: data.join("chats").join(vault_hash(vault_root)),
            written: Mutex::new(HashMap::new()),
        }
    }

    fn record_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    fn head_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}{HEAD}"))
    }

    /// Keeps `record`, unless a newer snapshot of the thread was kept already.
    pub fn save(&self, record: &Record) -> Result<(), String> {
        if !valid_id(&record.id) {
            return Err(format!(
                "“{}” cannot be the name of a saved chat",
                record.id
            ));
        }
        let mut written = self.written.lock().unwrap_or_else(|p| p.into_inner());
        if written.get(&record.id).is_some_and(|rev| *rev > record.rev) {
            return Ok(());
        }
        let path = self.record_path(&record.id);
        let bytes = serde_json::to_vec(record).map_err(|e| e.to_string())?;
        write_atomic(&path, &bytes).map_err(|e| format!("The chat could not be kept: {e}"))?;
        let head =
            serde_json::to_vec(&record.head(bytes.len() as u64)).map_err(|e| e.to_string())?;
        write_atomic(&self.head_path(&record.id), &head)
            .map_err(|e| format!("The chat could not be kept: {e}"))?;
        written.insert(record.id.clone(), record.rev);
        Ok(())
    }

    /// The saved thread, if there is one that reads and is of a version this
    /// program knows. A file that does not read is set aside as `.bad`.
    pub fn load(&self, id: &str) -> Option<Record> {
        if !valid_id(id) {
            return None;
        }
        match read_json::<Record>(&self.record_path(id)) {
            Ok(record) if record.version <= VERSION && record.id == id => Some(record),
            Ok(_) | Err(Unread::Missing | Unread::Damaged) => None,
        }
    }

    /// The head of every saved thread, newest first. A missing or damaged
    /// head is made again from the thread; a thread that does not read is
    /// set aside and left out.
    pub fn heads(&self) -> Vec<Head> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut heads = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".json") else {
                continue;
            };
            if id.ends_with(".head") || !valid_id(id) {
                continue;
            }
            match read_json::<Head>(&self.head_path(id)) {
                Ok(head) if head.summary.id == id => heads.push(head),
                _ => {
                    if let Some(record) = self.load(id) {
                        let bytes = entry.metadata().map_or(0, |m| m.len());
                        let head = record.head(bytes);
                        if let Ok(text) = serde_json::to_vec(&head) {
                            let _ = write_atomic(&self.head_path(id), &text);
                        }
                        heads.push(head);
                    }
                }
            }
        }
        heads.sort_by_key(|head| std::cmp::Reverse(head.summary.updated));
        heads
    }

    /// The thread list.
    pub fn list(&self) -> Vec<ThreadSummary> {
        self.heads().into_iter().map(|h| h.summary).collect()
    }

    /// Removes a thread's files. Whether there was a thread.
    pub fn delete(&self, id: &str) -> bool {
        if !valid_id(id) {
            return false;
        }
        let mut written = self.written.lock().unwrap_or_else(|p| p.into_inner());
        written.remove(id);
        let had = remove::file(&self.dir, &self.record_path(id));
        remove::file(&self.dir, &self.head_path(id));
        had
    }

    /// Every attachment a saved thread refers to.
    pub fn referenced_attachments(&self) -> HashSet<String> {
        self.heads()
            .into_iter()
            .flat_map(|h| h.attachments)
            .collect()
    }

    /// A thread that was working when the app closed is interrupted: nothing
    /// is working now. Run once when the vault opens.
    pub fn interrupt_the_working(&self) {
        for head in self.heads() {
            if head.summary.status != Status::Running {
                continue;
            }
            if let Some(mut record) = self.load(&head.summary.id) {
                record.status = Status::Interrupted;
                let _ = self.save(&record);
            }
        }
    }

    /// How many threads are saved and how much room they take. Only a report.
    pub fn usage(&self) -> Usage {
        let heads = self.heads();
        Usage {
            threads: heads.len(),
            bytes: heads.iter().map(|h| h.bytes).sum(),
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
