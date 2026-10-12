//! The browser extensions paired with this Kasten, kept in `extension.json`
//! in the app's config folder (never in a vault). A token is shown to the
//! extension once, when it pairs; only its SHA-256 is kept here, so the file
//! cannot be used to talk to Kasten, and a paired extension is revoked by
//! taking its line out.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(super) const FILE: &str = "extension.json";
/// The most extensions paired at once.
pub(super) const MOST: usize = 8;

/// One paired extension, as the file holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Paired {
    /// Names it in Settings (to revoke it); not secret.
    pub id: String,
    /// What the extension called itself ("Edge", "Chrome"), for the list.
    pub label: String,
    /// `chrome-extension://<id>`: the only origin its requests may come from.
    pub origin: String,
    /// The SHA-256 of its token, in hex.
    pub token_hash: String,
    /// When it paired, in milliseconds since the Unix epoch.
    pub paired_at: u64,
}

/// What Settings may show of a paired extension: never the hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedInfo {
    pub id: String,
    pub label: String,
    pub origin: String,
    pub paired_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct File {
    paired: Vec<Paired>,
}

/// The paired extensions, in memory and in `extension.json`.
pub(super) struct Store {
    /// The app's config folder; without one nothing is kept, and nothing pairs.
    dir: Option<PathBuf>,
    list: Vec<Paired>,
}

/// A fresh token: 32 random bytes as 43 base64url characters.
pub(super) fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| format!("No random numbers to make a token with: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// A fresh id for a paired extension: 8 hex digits.
pub(super) fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; 4];
    getrandom::fill(&mut bytes)
        .map_err(|e| format!("No random numbers to make an id with: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// The SHA-256 of `token`, in hex.
pub(super) fn hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

/// Compares without stopping at the first difference.
pub(super) fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Writes `bytes` to `path` in one step, flushed first: a power cut leaves
/// the old file or the new one, never half of one.
fn write_whole(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = format!(
        "{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or(FILE)
    );
    let temp = path.with_file_name(name);
    let mut file = fs::File::create(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp, path)
}

impl Store {
    /// The paired extensions kept in `dir`; a file that is missing or cannot
    /// be read means none are paired.
    pub fn load(dir: Option<PathBuf>) -> Store {
        let list = dir
            .as_deref()
            .and_then(|dir| fs::read_to_string(dir.join(FILE)).ok())
            .and_then(|text| serde_json::from_str::<File>(&text).ok())
            .map(|file| file.paired)
            .unwrap_or_default();
        Store { dir, list }
    }

    pub fn infos(&self) -> Vec<PairedInfo> {
        self.list
            .iter()
            .map(|p| PairedInfo {
                id: p.id.clone(),
                label: p.label.clone(),
                origin: p.origin.clone(),
                paired_at: p.paired_at,
            })
            .collect()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    /// Whether another extension may pair: not when `origin` is new and the
    /// list is full.
    pub fn has_room_for(&self, origin: &str) -> bool {
        self.list.len() < MOST || self.list.iter().any(|p| p.origin == origin)
    }

    /// The paired extension whose token is `token`, if any. Every hash is
    /// compared, so how long it takes does not say where a match was.
    pub fn find(&self, token: &str) -> Option<&Paired> {
        let wanted = hash(token);
        let mut found = None;
        for paired in &self.list {
            if same(paired.token_hash.as_bytes(), wanted.as_bytes()) {
                found = Some(paired);
            }
        }
        found
    }

    /// Pairs an extension, in place of one already paired from the same
    /// origin (a reinstall gets a fresh token and the old one stops working).
    pub fn add(&mut self, paired: Paired) -> Result<(), String> {
        if !self.has_room_for(&paired.origin) {
            return Err(format!(
                "{MOST} extensions are paired already. Revoke one in Settings first"
            ));
        }
        let before = self.list.clone();
        self.list.retain(|p| p.origin != paired.origin);
        self.list.push(paired);
        self.keep().inspect_err(|_| self.list = before)
    }

    /// Takes a paired extension's line out: its token never works again.
    pub fn revoke(&mut self, id: &str) -> Result<bool, String> {
        let before = self.list.clone();
        self.list.retain(|p| p.id != id);
        if self.list.len() == before.len() {
            return Ok(false);
        }
        self.keep().inspect_err(|_| self.list = before)?;
        Ok(true)
    }

    fn keep(&self) -> Result<(), String> {
        let Some(dir) = &self.dir else {
            return Err("KastenFlow has no settings folder to keep that in".to_owned());
        };
        let text = serde_json::to_string_pretty(&File {
            paired: self.list.clone(),
        })
        .map_err(|e| e.to_string())?;
        fs::create_dir_all(dir).map_err(|e| format!("The pairing could not be kept: {e}"))?;
        write_whole(&dir.join(FILE), text.as_bytes())
            .map_err(|e| format!("The pairing could not be kept: {e}"))
    }
}
