//! Reading a smart page's code folder: what is in it, one file's bytes, and
//! the manifest. Nothing here writes; the write ops are in `ops`.

use std::fs;
use std::path::Path;

use serde::Serialize;

use super::{MANIFEST_FILE, MAX_FILE_BYTES, SmartManifest, check_path, is_allowed_path};
use crate::atomic::{is_temp_name, read_if_there};
use crate::error::{Error, Result};
use crate::vault::Vault;

/// The most files a listing walks before it gives up: a folder is held to
/// `MAX_FILES`, but one filled by hand may hold anything.
const WALK_LIMIT: usize = 5000;
/// The deepest folder a listing goes into.
const WALK_DEPTH: usize = 12;

/// One file of a smart page's folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFile {
    /// Its path inside the folder, with `/`.
    pub path: String,
    pub size: u64,
    /// Whether a folder may hold it. A file put there by hand that is not
    /// (a program, a hidden file) is listed and counted, and never served.
    pub allowed: bool,
}

/// What a smart page's folder holds.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartListing {
    /// The page's path.
    pub page: String,
    /// The folder's path in the vault.
    pub dir: String,
    /// Whether the folder is there yet.
    pub exists: bool,
    pub files: Vec<SmartFile>,
    pub total_bytes: u64,
    /// The manifest, when `smart.yaml` is there and reads.
    pub manifest: Option<SmartManifest>,
    /// What is wrong with the manifest or the folder, one plain sentence each.
    pub problems: Vec<String>,
}

/// One file's bytes and the hash a save of it is written against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmartBytes {
    pub path: String,
    pub bytes: Vec<u8>,
    pub hash: String,
}

impl SmartBytes {
    /// The file as text, when it is text.
    pub fn text(&self) -> Option<&str> {
        std::str::from_utf8(&self.bytes).ok()
    }
}

/// The hash of a file's bytes (the same as `content_hash` of its text).
pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The folder of the page at `page`, after checking the page's path: a plain
/// Markdown path, not in a private folder, and not itself inside a smart
/// page's folder (a lock on the outer page must cover everything in it).
pub(crate) fn dir_for(vault: &Vault, page: &str) -> Result<String> {
    vault.path_of(page)?;
    if crate::companions::in_folder(page) {
        return Err(Error::Invalid(format!(
            "{page} is inside a smart page's folder, so it cannot have a folder of its own"
        )));
    }
    super::sidecar_dir(page).ok_or_else(|| Error::InvalidPath(page.to_owned()))
}

/// `dir_for`, for a page that is there.
pub(crate) fn require_page(vault: &Vault, page: &str) -> Result<String> {
    let dir = dir_for(vault, page)?;
    if !vault.exists(page) {
        return Err(Error::NotFound(page.to_owned()));
    }
    Ok(dir)
}

/// Every file in the folder `dir`; none when it is not there yet. A link, or
/// a file where the folder should be, is an error: nothing reads through it.
pub(crate) fn list_files(vault: &Vault, dir: &str) -> Result<Vec<SmartFile>> {
    let path = vault.tracked_file(dir)?;
    match fs::symlink_metadata(&path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Err(Error::Invalid(format!("{dir} is not a folder"))),
    }
    let mut out = Vec::new();
    walk(&path, "", 0, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<SmartFile>) -> Result<()> {
    if depth > WALK_DEPTH {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // Links are not followed and not counted.
        let kind = entry.file_type()?;
        let path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        if kind.is_dir() {
            walk(&entry.path(), &path, depth + 1, out)?;
        } else if kind.is_file() && !is_temp_name(&name) {
            out.push(SmartFile {
                size: entry.metadata()?.len(),
                allowed: is_allowed_path(&path),
                path,
            });
            if out.len() > WALK_LIMIT {
                return Err(Error::Invalid(
                    "This smart page's folder holds far too many files".to_owned(),
                ));
            }
        }
    }
    Ok(())
}

/// One file of the page's folder, read whole. A file over the size one file
/// may be is not read.
pub(crate) fn read_file(vault: &Vault, page: &str, rel: &str) -> Result<SmartBytes> {
    let dir = require_page(vault, page)?;
    check_path(rel)?;
    let full = format!("{dir}/{rel}");
    let file = vault.tracked_file(&full)?;
    let meta = fs::symlink_metadata(&file).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => Error::NotFound(full.clone()),
        _ => Error::Io(err),
    })?;
    if !meta.is_file() {
        return Err(Error::NotFound(full));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(Error::Invalid(format!(
            "{full} is larger than a file of a smart page may be, so it is not read"
        )));
    }
    let bytes = fs::read(&file)?;
    Ok(SmartBytes {
        path: rel.to_owned(),
        hash: hash_bytes(&bytes),
        bytes,
    })
}

/// A manifest read from text; the words say what is wrong with it when it
/// does not read.
pub fn parse_manifest(text: &str) -> Result<SmartManifest> {
    serde_saphyr::from_str::<SmartManifest>(text)
        .map_err(|err| Error::Invalid(format!("{MANIFEST_FILE} can't be read: {err}")))
}

/// A manifest as the text of `smart.yaml`.
pub fn manifest_text(manifest: &SmartManifest) -> Result<String> {
    serde_saphyr::to_string(manifest)
        .map_err(|err| Error::Invalid(format!("{MANIFEST_FILE} can't be written: {err}")))
}

/// A manifest that reads and passes the checks (`SmartManifest::validate`).
pub fn check_manifest(text: &str) -> Result<SmartManifest> {
    let manifest = parse_manifest(text)?;
    let problems = manifest.validate();
    if problems.is_empty() {
        Ok(manifest)
    } else {
        Err(Error::Invalid(format!(
            "{MANIFEST_FILE} has a problem: {}",
            problems.join(" ")
        )))
    }
}

/// The page's manifest; none when it has no `smart.yaml`.
pub(crate) fn read_manifest(vault: &Vault, page: &str) -> Result<Option<SmartManifest>> {
    let dir = dir_for(vault, page)?;
    let file = vault.tracked_file(&format!("{dir}/{MANIFEST_FILE}"))?;
    if fs::metadata(&file).is_ok_and(|meta| meta.len() > MAX_FILE_BYTES) {
        return Err(Error::Invalid(format!("{MANIFEST_FILE} is too large")));
    }
    let Some(bytes) = read_if_there(&file)? else {
        return Ok(None);
    };
    let text = String::from_utf8(bytes)
        .map_err(|_| Error::Invalid(format!("{MANIFEST_FILE} is not text")))?;
    parse_manifest(&text).map(Some)
}

/// What the page's folder holds, with its manifest and what is wrong.
pub(crate) fn listing(vault: &Vault, page: &str) -> Result<SmartListing> {
    let dir = require_page(vault, page)?;
    let files = list_files(vault, &dir)?;
    let exists = vault
        .tracked_file(&dir)
        .is_ok_and(|path| fs::symlink_metadata(path).is_ok());
    let mut problems = Vec::new();
    let manifest = match read_manifest(vault, page) {
        Ok(manifest) => {
            if let Some(manifest) = &manifest {
                problems.extend(manifest.validate());
            }
            manifest
        }
        Err(err) => {
            problems.push(err.to_string());
            None
        }
    };
    if exists && !files.iter().any(|f| f.path == super::INDEX_FILE) {
        problems.push("The folder has no index.html, so there is nothing to show.".to_owned());
    }
    for file in files.iter().filter(|f| !f.allowed) {
        problems.push(format!(
            "{} is not a file a smart page may have.",
            file.path
        ));
    }
    Ok(SmartListing {
        page: page.to_owned(),
        dir,
        exists,
        total_bytes: files.iter().map(|f| f.size).sum(),
        files,
        manifest,
        problems,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hash_of_bytes_is_the_hash_of_the_same_text() {
        let text = "console.log('hi');\r\n";
        assert_eq!(hash_bytes(text.as_bytes()), crate::note::content_hash(text));
        assert_ne!(hash_bytes(b"a"), hash_bytes(b"b"));
    }

    #[test]
    fn a_manifest_that_reads_but_is_wrong_names_the_problem() {
        assert!(check_manifest("title: Fine\n").is_ok());
        let err = check_manifest("title: ''\n").unwrap_err().to_string();
        assert!(err.contains("needs a title"), "{err}");
        let err = check_manifest("title: [unclosed\n")
            .unwrap_err()
            .to_string();
        assert!(err.contains("can't be read"), "{err}");
        assert!(check_manifest("").is_err());
    }
}
