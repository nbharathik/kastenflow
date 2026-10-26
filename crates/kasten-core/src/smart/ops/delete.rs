//! Taking a file out of a smart page's folder: it goes to the trash, keeping
//! its place, and can be put back. Nothing here deletes anything for good.

use std::fs;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::smart::check_path;
use crate::smart::files::{list_files, require_page};
use crate::time::Instant;
use crate::vault::Vault;

/// A file taken out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deleted {
    /// Its path inside the page's folder.
    pub rel: String,
    /// Where it was, in the vault.
    pub from: String,
    /// Where it is now, in the trash.
    pub trashed: String,
}

/// A file of a page's folder that is in the trash and can come back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedFile {
    /// Where it is, `.trash/<time>/<page>.smart/<file>`.
    pub trashed: String,
    /// Its path inside the page's folder.
    pub path: String,
    /// The trash folder's time stamp, such as `20261023T080000Z`.
    pub when: String,
}

/// Checks that the file `rel` of the page's folder can be taken out: it is
/// there, a plain file, and not reached through a link. Returns its path in
/// the vault.
pub fn check_delete(vault: &Vault, page: &str, rel: &str) -> Result<String> {
    let dir = require_page(vault, page)?;
    check_path(rel)?;
    let full = format!("{dir}/{rel}");
    let file = vault.tracked_file(&full)?;
    // The name as it is on disk: a disk that ignores case would find the file
    // by another spelling, and the commit would then name a path history
    // does not have, so Undo could not bring the file back.
    let spelled_so = list_files(vault, &dir)?.iter().any(|f| f.path == rel);
    if spelled_so && fs::symlink_metadata(&file).is_ok_and(|meta| meta.is_file()) {
        Ok(full)
    } else {
        Err(Error::NotFound(full))
    }
}

/// Moves the file `rel` of the page's folder to the trash.
pub fn delete_file(vault: &Vault, page: &str, rel: &str, now: Instant) -> Result<Deleted> {
    let from = check_delete(vault, page, rel)?;
    let trashed = crate::trash::trash_smart_file(vault, &from, now)?;
    Ok(Deleted {
        rel: rel.to_owned(),
        from,
        trashed,
    })
}

/// Puts a file back from the trash; returns where it went. It never replaces
/// a file, and its page has to be there.
pub fn restore_file(vault: &Vault, trashed: &str) -> Result<String> {
    crate::trash::restore_smart_file(vault, trashed)
}

/// The files of the page's folder in the trash, newest first. Files that went
/// with their page (the page is in the same trash folder) come back with it
/// and are not listed.
pub fn trashed_files(vault: &Vault, page: &str) -> Result<Vec<TrashedFile>> {
    let dir = require_page(vault, page)?;
    let root = vault.root().join(".trash");
    let mut out = Vec::new();
    if !root.is_dir() {
        return Ok(out);
    }
    for stamp in fs::read_dir(&root)? {
        let stamp = stamp?;
        if !stamp.file_type()?.is_dir() {
            continue;
        }
        let when = stamp.file_name().to_string_lossy().into_owned();
        let with_page = vault
            .tracked_file(&format!(".trash/{when}/{page}"))
            .is_ok_and(|path| path.is_file());
        if with_page {
            continue;
        }
        let folder = format!(".trash/{when}/{dir}");
        for member in crate::companions::members(vault, &folder) {
            out.push(TrashedFile {
                path: member[folder.len() + 1..].to_owned(),
                trashed: member,
                when: when.clone(),
            });
        }
    }
    out.sort_by(|a, b| b.when.cmp(&a.when).then_with(|| a.path.cmp(&b.path)));
    Ok(out)
}
