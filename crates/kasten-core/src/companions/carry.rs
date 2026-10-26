//! Taking the sidecars along when a page moves, and copying them when a page
//! is copied. A smart page's folder goes as a whole (one rename), and every
//! file in it is reported at both ends.

use std::fs;
use std::path::PathBuf;

use super::{SUFFIXES, dir_of, existing, existing_dir, members, of, pairs};
use crate::error::{Error, Result};
use crate::rollback::Rollback;
use crate::smart::MAX_TOTAL_BYTES;
use crate::vault::Vault;

/// The suffix a sidecar path ends with.
fn suffix_of(companion: &str) -> Option<&'static str> {
    SUFFIXES
        .iter()
        .find(|suffix| companion.ends_with(**suffix))
        .copied()
}

/// A folder to move: where it is and where it goes, and each file's path at
/// both ends.
struct FolderMove {
    from: PathBuf,
    to: PathBuf,
    files: Vec<(String, String)>,
}

/// Moves the sidecars of every page in `moves` (each a page's old and new
/// path) to the new page's name, and returns each sidecar's own (from, to);
/// for a smart page's folder, each of its files'. A sidecar never replaces a
/// file or a folder: if one is already at the new name the move is refused
/// before anything moves. Each move is noted in `done`, so the caller can put
/// them back if a later step fails; on an error here the caller does the same
/// for those made before it.
pub(crate) fn carry(
    vault: &Vault,
    moves: &[(String, String)],
    done: &mut Rollback,
) -> Result<Vec<(String, String)>> {
    let mut plan = Vec::new();
    let mut folders = Vec::new();
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
        if let (Some(source), Some(target)) = (existing_dir(vault, from), dir_of(to)) {
            let (dir, destination) = (vault.tracked_file(&source)?, vault.tracked_file(&target)?);
            if fs::symlink_metadata(&destination).is_ok() {
                return Err(Error::Invalid(format!(
                    "{target} is already there, so the folder {source} could not go with its page"
                )));
            }
            folders.push(FolderMove {
                files: pairs(vault, &source, &target),
                from: dir,
                to: destination,
            });
        }
    }
    let mut out = Vec::with_capacity(plan.len());
    for (source, target, file, destination) in plan {
        done.rename(&file, &destination)?;
        out.push((source, target));
    }
    for folder in folders {
        done.rename(&folder.from, &folder.to)?;
        out.extend(folder.files);
    }
    Ok(out)
}

/// Copies the sidecars of the page at `from` to the page copied from it at
/// `to`, and returns the paths made. Each is noted in `done`. A smart page's
/// folder is copied file by file; a folder over the size a page may hold is
/// not copied, and the copy is refused.
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
    if let (Some(source), Some(target)) = (existing_dir(vault, from), dir_of(to)) {
        if fs::symlink_metadata(vault.tracked_file(&target)?).is_ok() {
            return Err(Error::Invalid(format!(
                "{target} is already there, so the folder {source} could not be copied with its page"
            )));
        }
        let files = members(vault, &source);
        let mut total = 0u64;
        for file in &files {
            total += fs::metadata(vault.tracked_file(file)?)?.len();
        }
        if total > MAX_TOTAL_BYTES {
            return Err(Error::Invalid(format!(
                "The folder {source} holds more than a smart page may, so the page can't be copied"
            )));
        }
        for (file, copy) in pairs(vault, &source, &target) {
            let bytes = fs::read(vault.tracked_file(&file)?)?;
            done.create(&vault.tracked_file(&copy)?, &bytes)?;
            made.push(copy);
        }
    }
    Ok(made)
}
