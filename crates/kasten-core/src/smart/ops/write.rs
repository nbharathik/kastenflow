//! Writing a file of a smart page's folder, and setting its manifest. Every
//! check runs before a byte is written (`check_write`), and the same check is
//! what an agent's op is refused or proposed by.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::atomic::{create_atomic, read_if_there, write_atomic};
use crate::error::{Error, Result};
use crate::smart::files::{hash_bytes, list_files, require_page};
use crate::smart::limits::{check_file_size, check_totals};
use crate::smart::{MANIFEST_FILE, SmartManifest, check_path};
use crate::vault::Vault;

/// A file written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Written {
    /// Its path in the vault.
    pub path: String,
    /// Its path inside the page's folder.
    pub rel: String,
    /// The hash of what it holds now: the base of the next write.
    pub hash: String,
    /// The file was not there before.
    pub created: bool,
    /// Something was written. False when the file already held these bytes.
    pub changed: bool,
}

/// A write that passed every check and has not been made yet.
#[derive(Debug)]
pub struct Prepared {
    /// The file's path in the vault.
    pub path: String,
    file: PathBuf,
    /// What the file holds now, when it is there.
    pub current: Option<Vec<u8>>,
}

/// Checks a write of `bytes` to `rel` in the folder of `page` without making
/// it: the page, the form of the path, the sizes, the manifest when it is
/// one, links and clashes of case, and `base_hash`. `base_hash` is the hash
/// of the file as the writer read it: `Some("")` says the file must not be
/// there yet, `Some(hash)` that it must still be what was read, and `None`
/// that the writer does not care.
pub fn check_write(
    vault: &Vault,
    page: &str,
    rel: &str,
    bytes: &[u8],
    base_hash: Option<&str>,
) -> Result<Prepared> {
    let dir = require_page(vault, page)?;
    check_path(rel)?;
    check_file_size(bytes.len())?;
    if rel == MANIFEST_FILE {
        let text = std::str::from_utf8(bytes)
            .map_err(|_| Error::Invalid(format!("{MANIFEST_FILE} must be text")))?;
        crate::smart::check_manifest(text)?;
    }
    let path = format!("{dir}/{rel}");
    // Never through a link, and never into a private place.
    let file = vault.tracked_file(&path)?;
    let existing = list_files(vault, &dir)?;
    // Two names that differ in case are one file on a Mac or in Windows.
    if let Some(twin) = existing
        .iter()
        .find(|f| f.path != rel && f.path.eq_ignore_ascii_case(rel))
    {
        return Err(Error::Invalid(format!(
            "{rel} differs from {} only in case, and a Mac or Windows computer keeps just one of them",
            twin.path
        )));
    }
    let meta = fs::symlink_metadata(&file).ok();
    if meta.as_ref().is_some_and(|meta| !meta.is_file()) {
        return Err(Error::Invalid(format!("{path} is not a file")));
    }
    let current = match &meta {
        Some(meta) if meta.len() <= crate::smart::MAX_FILE_BYTES => read_if_there(&file)?,
        _ => None,
    };
    match (base_hash, &meta) {
        (Some(""), Some(_)) => {
            return Err(Error::Invalid(format!(
                "{rel} is already there; read it and write it against the hash you read"
            )));
        }
        (Some(base), Some(_)) if !base.is_empty() => {
            if current.as_deref().map(hash_bytes).as_deref() != Some(base) {
                return Err(Error::Invalid(format!(
                    "{rel} changed since it was read, so it was not written over"
                )));
            }
        }
        (Some(base), None) if !base.is_empty() => {
            return Err(Error::NotFound(path));
        }
        _ => {}
    }
    let others = existing.iter().filter(|f| f.path != rel);
    check_totals(
        (others.clone().map(|f| f.size).sum(), others.count()),
        bytes.len(),
        meta.is_none(),
    )?;
    Ok(Prepared {
        path,
        file,
        current,
    })
}

/// Writes `bytes` to `rel` in the folder of `page`, atomically: the file is
/// whole before and whole after. See `check_write` for `base_hash`.
pub fn write_file(
    vault: &Vault,
    page: &str,
    rel: &str,
    bytes: &[u8],
    base_hash: Option<&str>,
) -> Result<Written> {
    let prepared = check_write(vault, page, rel, bytes, base_hash)?;
    let created = prepared.current.is_none() && !prepared.file.exists();
    let changed = prepared.current.as_deref() != Some(bytes);
    if changed {
        if created {
            create_atomic(&prepared.file, bytes).map_err(|err| match err.kind() {
                std::io::ErrorKind::AlreadyExists => Error::Invalid(format!(
                    "{rel} was made by someone else just now, so it was not written over"
                )),
                _ => Error::Io(err),
            })?;
        } else {
            write_atomic(&prepared.file, bytes)?;
        }
    }
    Ok(Written {
        path: prepared.path,
        rel: rel.to_owned(),
        hash: hash_bytes(bytes),
        created: created && changed,
        changed,
    })
}

/// Sets the page's manifest from `manifest`, which has to pass its checks;
/// keys this version does not know stay in it. See `check_write` for
/// `base_hash`.
pub fn set_manifest(
    vault: &Vault,
    page: &str,
    manifest: &SmartManifest,
    base_hash: Option<&str>,
) -> Result<Written> {
    let problems = manifest.validate();
    if !problems.is_empty() {
        return Err(Error::Invalid(format!(
            "{MANIFEST_FILE} has a problem: {}",
            problems.join(" ")
        )));
    }
    let dir = require_page(vault, page)?;
    let file = vault.tracked_file(&format!("{dir}/{MANIFEST_FILE}"))?;
    let existing = match fs::symlink_metadata(&file) {
        Ok(meta) if meta.is_file() && meta.len() <= crate::smart::MAX_FILE_BYTES => {
            read_if_there(&file)?.and_then(|bytes| String::from_utf8(bytes).ok())
        }
        _ => None,
    };
    // What the person wrote stays as written, down to the comments: only the
    // keys that changed are touched. Failing that, the manifest is written out.
    if let Some(existing) = &existing
        && let Some(text) = super::patch::patched(existing, manifest)
    {
        let base = base_hash
            .map(str::to_owned)
            .unwrap_or_else(|| hash_bytes(existing.as_bytes()));
        return write_file(vault, page, MANIFEST_FILE, text.as_bytes(), Some(&base));
    }
    let text = serde_saphyr::to_string(manifest)
        .map_err(|err| Error::Invalid(format!("{MANIFEST_FILE} can't be written: {err}")))?;
    write_file(vault, page, MANIFEST_FILE, text.as_bytes(), base_hash)
}
