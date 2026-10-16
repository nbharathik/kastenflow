//! Taking the sidecars along when a page moves, and copying them when a page
//! is copied.

use std::fs;

use super::{SUFFIXES, existing, of};
use crate::error::{Error, Result};
use crate::rollback::Rollback;
use crate::vault::Vault;

/// The suffix a sidecar path ends with.
fn suffix_of(companion: &str) -> Option<&'static str> {
    SUFFIXES
        .iter()
        .find(|suffix| companion.ends_with(**suffix))
        .copied()
}

/// Moves the sidecars of every page in `moves` (each a page's old and new
/// path) to the new page's name, and returns each sidecar's own (from, to).
/// A sidecar never replaces a file: if one is already at the new name the
/// move is refused before anything moves. Each move is noted in `done`, so
/// the caller can put them back if a later step fails; on an error here the
/// caller does the same for those made before it.
pub(crate) fn carry(
    vault: &Vault,
    moves: &[(String, String)],
    done: &mut Rollback,
) -> Result<Vec<(String, String)>> {
    let mut plan = Vec::new();
    for (from, to) in moves {
        if from == to {
            continue;
        }
        for source in existing(vault, from) {
            let Some(suffix) = suffix_of(&source) else {
                continue;
            };
            let Some(target) = of(to, suffix) else {
                continue;
            };
            let (file, destination) = (vault.tracked_file(&source)?, vault.tracked_file(&target)?);
            if fs::symlink_metadata(&destination).is_ok() {
                return Err(Error::Invalid(format!(
                    "{target} is already there, so the file {source} could not go with its page"
                )));
            }
            plan.push((source, target, file, destination));
        }
    }
    let mut out = Vec::with_capacity(plan.len());
    for (source, target, file, destination) in plan {
        done.rename(&file, &destination)?;
        out.push((source, target));
    }
    Ok(out)
}

/// Copies the sidecars of the page at `from` to the page copied from it at
/// `to`, and returns the paths made. Each is noted in `done`.
pub(crate) fn copy_for(
    vault: &Vault,
    from: &str,
    to: &str,
    done: &mut Rollback,
) -> Result<Vec<String>> {
    let mut made = Vec::new();
    for source in existing(vault, from) {
        let Some(target) = suffix_of(&source).and_then(|suffix| of(to, suffix)) else {
            continue;
        };
        let bytes = fs::read(vault.tracked_file(&source)?)?;
        done.create(&vault.tracked_file(&target)?, &bytes)?;
        made.push(target);
    }
    Ok(made)
}
