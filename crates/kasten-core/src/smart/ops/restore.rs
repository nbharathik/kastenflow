//! Putting a smart page's code folder back as an earlier version had it. The
//! files the version held that a folder may hold are written back (byte for
//! byte, through the same checks as any write), and the files the folder has
//! now that the version did not go to the trash, where they can be put back.
//! Nothing is deleted for good and no history is rewritten: the engine makes
//! the result one new commit.

use std::collections::HashSet;

use serde::Serialize;

use super::{check_delete, check_write, delete_file};
use crate::atomic::read_if_there;
use crate::error::{Error, Result};
use crate::history::History;
use crate::rollback::Rollback;
use crate::smart::check_path;
use crate::smart::files::{list_files, require_page};
use crate::smart::limits::{check_file_size, check_totals};
use crate::time::Instant;
use crate::vault::Vault;

/// What a restore changed, as paths in the vault.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    /// Files written back to the version's bytes.
    pub written: Vec<String>,
    /// Where the files the version did not have went, in the trash.
    pub trashed: Vec<String>,
    /// Where those files were.
    #[serde(skip)]
    pub removed: Vec<String>,
    /// The commit the restore made, which Undo takes back whole. None when
    /// the folder already was as the version had it.
    pub commit: Option<String>,
}

/// Refuses a version whose files could not live together on a Mac or in
/// Windows: two names that differ only in case, or a name that is a file and
/// also a folder holding files (git keeps both; a computer keeps one).
fn check_names(names: &[String]) -> Result<()> {
    let lower: Vec<String> = names.iter().map(|n| n.to_ascii_lowercase()).collect();
    let mut seen = HashSet::new();
    for (name, low) in names.iter().zip(&lower) {
        if !seen.insert(low.as_str()) {
            return Err(Error::Invalid(format!(
                "That version has {name} twice under names that differ only in case, and a Mac or Windows computer keeps just one of them"
            )));
        }
    }
    for (name, low) in names.iter().zip(&lower) {
        for (at, _) in low.match_indices('/') {
            if seen.contains(&low[..at]) {
                return Err(Error::Invalid(format!(
                    "In that version {} is a file, and {name} would need it to be a folder",
                    &name[..at]
                )));
            }
        }
    }
    Ok(())
}

/// Puts the folder of `page` back as it was at `rev`. Every check runs before
/// a byte is written; a failure part way puts back what was written.
pub fn restore_folder(
    vault: &Vault,
    history: &History,
    page: &str,
    rev: &str,
    now: Instant,
) -> Result<Restored> {
    let dir = require_page(vault, page)?;
    let prefix = format!("{dir}/");
    // What the version held that a folder may hold. A file it held that a
    // folder may not (a program put there by hand) is neither written nor missed.
    let mut then = Vec::new();
    for path in history.files_at(rev)? {
        if let Some(rel) = path.strip_prefix(&prefix)
            && check_path(rel).is_ok()
        {
            then.push(rel.to_owned());
        }
    }
    if then.is_empty() {
        return Err(Error::Invalid(
            "That version has none of the page's code files, so there is nothing to put back"
                .to_owned(),
        ));
    }

    check_names(&then)?;
    let mut writes = Vec::new();
    let (mut size, mut count) = (0u64, 0usize);
    for rel in &then {
        // The size is known from the object's header, so a huge file in a
        // hostile history is refused before it is read into memory.
        if let Some(len) = history.blob_len_at(rev, &format!("{prefix}{rel}"))? {
            let len = usize::try_from(len).unwrap_or(usize::MAX);
            check_file_size(len)?;
            check_totals((size, count), len, true)?;
        }
        let bytes = history
            .blob_at(rev, &format!("{prefix}{rel}"))?
            .ok_or_else(|| Error::NotFound(format!("{prefix}{rel} at {rev}")))?;
        // The folder as the version had it must itself fit the limits.
        check_totals((size, count), bytes.len(), true)?;
        size += bytes.len() as u64;
        count += 1;
        let prepared = check_write(vault, page, rel, &bytes, None)?;
        if prepared.current.as_deref() != Some(bytes.as_slice()) {
            writes.push((prepared.path, bytes));
        }
    }
    let mut out = Vec::new();
    for file in list_files(vault, &dir)? {
        if file.allowed && !then.contains(&file.path) {
            check_delete(vault, page, &file.path)?;
            out.push(file.path);
        }
    }

    let mut restored = Restored::default();
    let mut done = Rollback::default();
    let result = (|| -> Result<()> {
        for (path, bytes) in &writes {
            let file = vault.tracked_file(path)?;
            let before = read_if_there(&file)?;
            done.write(&file, bytes, before)?;
            restored.written.push(path.clone());
        }
        for rel in &out {
            let deleted = delete_file(vault, page, rel, now)?;
            restored.removed.push(deleted.from);
            restored.trashed.push(deleted.trashed);
        }
        Ok(())
    })();
    if let Err(err) = result {
        done.put_back();
        return Err(err);
    }
    Ok(restored)
}
