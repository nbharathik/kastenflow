//! A LaTeX source file taken out of its document: it moves to
//! `.trash/<time>/<path>`, keeping its place, where history sees it and a
//! person can move it back. Nothing here deletes anything.

use std::fs;

use crate::error::{Error, Result};
use crate::latex::SOURCE_EXTENSIONS;
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::Vault;

use super::free_stamp;

/// Moves the source file `rel` (a plain file, not reached through a link) into
/// a new trash folder; returns where it went.
pub(crate) fn trash_source_file(vault: &Vault, rel: &str, now: Instant) -> Result<String> {
    let source = vault.file_of(rel, &SOURCE_EXTENSIONS)?;
    if !fs::symlink_metadata(&source).is_ok_and(|meta| meta.is_file()) {
        return Err(Error::NotFound(rel.to_owned()));
    }
    let stamp = free_stamp(vault, now);
    let target = vault.root().join(".trash").join(&stamp).join(rel);
    let mut done = Rollback::default();
    if let Err(err) = done.rename(&source, &target) {
        done.put_back();
        return Err(err.into());
    }
    Ok(format!(".trash/{stamp}/{rel}"))
}
