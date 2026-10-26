//! Putting trashed files back: a note with the sub-pages that went with it,
//! a board, a deck, or a diagram with its picture. Each file returns to its
//! original path, or beside it under a free name when that is taken.

use std::fs;
use std::path::{Path, PathBuf};

use super::{below, folder_files};
use crate::error::{Error, Result};
use crate::note::{NoteFile, NoteMeta};
use crate::ops::{folder_of, free_file};
use crate::rollback::Rollback;
use crate::vault::Vault;

/// A trashed path's time stamp and original path, checked: the original
/// must be a plain vault path of the kind `ext`.
fn parts<'a>(vault: &Vault, trashed: &'a str, ext: &str) -> Result<(&'a str, &'a str)> {
    let invalid = || Error::InvalidPath(trashed.to_owned());
    let rest = trashed.strip_prefix(".trash/").ok_or_else(invalid)?;
    let (when, original) = rest.split_once('/').ok_or_else(invalid)?;
    if when.is_empty() || when.contains(['.', '\\', ':']) {
        return Err(invalid());
    }
    vault.file_of(original, &[ext])?;
    Ok((when, original))
}

/// Puts a trashed note back where it was, or beside it under a free name,
/// with the sub-pages that went to the trash with it and each page's comments
/// and highlights files, which follow the page to its new name. Returns the
/// note and every (trashed, restored) path, a page's files after the page's.
pub fn restore_note_with_sub_pages(
    vault: &Vault,
    trashed: &str,
) -> Result<(NoteFile, Vec<(String, String)>)> {
    let (when, original) = parts(vault, trashed, ".md")?;
    let stamp_dir = vault.root().join(".trash").join(when);
    let files = folder_files(&stamp_dir)?;
    let metas: Vec<Option<&NoteMeta>> = files.iter().map(|(_, _, m)| m.as_ref()).collect();
    let top = files
        .iter()
        .position(|(path, _, _)| path == original)
        .ok_or_else(|| Error::NotFound(trashed.to_owned()))?;
    let mut going = vec![top];
    going.extend(below(&metas)[top].iter().copied().filter(|&i| i != top));

    let mut done = Rollback::default();
    let mut moves = Vec::with_capacity(going.len());
    let mut emptied = Vec::new();
    for i in going {
        let from = format!(".trash/{when}/{}", files[i].0);
        let placed = place_back(vault, &from, ".md", &mut done).and_then(|(to, source)| {
            // Its comments and highlights come back beside it, under its new
            // name when it has one.
            let own = [(from.clone(), to.clone())];
            let carried = crate::companions::carry(vault, &own, &mut done)?;
            Ok((to, source, carried))
        });
        match placed {
            Ok((to, source, carried)) => {
                emptied.push(source);
                emptied.extend(
                    carried
                        .iter()
                        .filter_map(|(f, _)| vault.tracked_file(f).ok()),
                );
                moves.push((from, to));
                moves.extend(carried);
            }
            Err(err) => {
                done.put_back();
                return Err(err);
            }
        }
    }
    tidy(&stamp_dir, &emptied);
    let note = vault.read(&moves[0].1)?;
    Ok((note, moves))
}

/// Puts a file of a smart page's folder back where it was, from the trash
/// (`.trash/<time>/<page>.smart/<file>`). It never replaces a file, and its
/// page has to be there. Returns the path it came back to.
pub fn restore_smart_file(vault: &Vault, trashed: &str) -> Result<String> {
    let invalid = || Error::InvalidPath(trashed.to_owned());
    let rest = trashed.strip_prefix(".trash/").ok_or_else(invalid)?;
    let (when, original) = rest.split_once('/').ok_or_else(invalid)?;
    if when.is_empty() || when.contains(['.', '\\', ':']) || !crate::companions::in_folder(original)
    {
        return Err(invalid());
    }
    // Where it was: below a folder named for a page that has to be there.
    let folder_end = original
        .match_indices('/')
        .map(|(at, _)| &original[..at])
        .find(|dir| crate::companions::in_folder(&format!("{dir}/x")))
        .ok_or_else(invalid)?;
    let page = format!(
        "{}.md",
        &folder_end[..folder_end.len() - crate::smart::SMART_DIR_SUFFIX.len()]
    );
    if !vault.exists(&page) {
        return Err(Error::Invalid(format!(
            "The page {page} is not in the vault, so the file cannot go back beside it. Restore the page first"
        )));
    }
    let source = vault.tracked_file(trashed)?;
    if !fs::symlink_metadata(&source).is_ok_and(|meta| meta.is_file()) {
        return Err(Error::NotFound(trashed.to_owned()));
    }
    crate::smart::check_path(&original[folder_end.len() + 1..])?;
    let destination = vault.tracked_file(original)?;
    if fs::symlink_metadata(&destination).is_ok() {
        return Err(Error::Invalid(format!(
            "{original} is already there, so the file from the trash cannot replace it"
        )));
    }
    let mut done = Rollback::default();
    if let Err(err) = done.rename(&source, &destination) {
        done.put_back();
        return Err(err.into());
    }
    tidy(&vault.root().join(".trash").join(when), &[source]);
    Ok(original.to_owned())
}

/// Puts a trashed note back where it was, or beside it under a free name.
pub fn restore_note(vault: &Vault, trashed: &str) -> Result<NoteFile> {
    restore_note_with_sub_pages(vault, trashed).map(|(note, _)| note)
}

/// Puts a trashed board back; returns where it went.
pub fn restore_board(vault: &Vault, trashed: &str) -> Result<String> {
    restore_file(vault, trashed, ".canvas")
}

/// Puts a trashed deck back; returns where it went.
pub fn restore_deck(vault: &Vault, trashed: &str) -> Result<String> {
    restore_file(vault, trashed, ".deck")
}

/// Puts a trashed saved collection back; returns where it went. Only a file
/// that was a collection's (`views/<name>.yaml`) is put back.
pub fn restore_collection(vault: &Vault, trashed: &str) -> Result<String> {
    let (_, original) = parts(vault, trashed, ".yaml")?;
    if !crate::collections::is_path(original) {
        return Err(Error::InvalidPath(trashed.to_owned()));
    }
    restore_file(vault, trashed, ".yaml")
}

/// Puts a trashed diagram back with its picture, under a name that is free
/// for both; returns where the source went and every (trashed, restored)
/// move. A picture trashed on its own comes back alone.
pub fn restore_diagram(vault: &Vault, trashed: &str) -> Result<(String, Vec<(String, String)>)> {
    use crate::diagrams::{EXT, SIDECAR_EXT, free_pair, sidecar_of, stem_of_path};
    if trashed.ends_with(SIDECAR_EXT) {
        let to = restore_file(vault, trashed, SIDECAR_EXT)?;
        return Ok((to.clone(), vec![(trashed.to_owned(), to)]));
    }
    let (when, original) = parts(vault, trashed, EXT)?;
    let source = vault.tracked_file(trashed)?;
    if !source.is_file() {
        return Err(Error::NotFound(trashed.to_owned()));
    }
    let picture_trashed = sidecar_of(trashed);
    let picture = vault
        .tracked_file(&picture_trashed)
        .ok()
        .filter(|p| p.is_file());
    let target = free_pair(vault, folder_of(original), stem_of_path(original));
    let mut done = Rollback::default();
    let mut moves = Vec::new();
    let moved = (|| -> Result<()> {
        done.rename(&source, &vault.file_of(&target, &[EXT])?)?;
        moves.push((trashed.to_owned(), target.clone()));
        if let Some(picture) = &picture {
            let to = sidecar_of(&target);
            done.rename(picture, &vault.file_of(&to, &[SIDECAR_EXT])?)?;
            moves.push((picture_trashed.clone(), to));
        }
        Ok(())
    })();
    if let Err(err) = moved {
        done.put_back();
        return Err(err);
    }
    let sources: Vec<PathBuf> = std::iter::once(source).chain(picture).collect();
    tidy(&vault.root().join(".trash").join(when), &sources);
    Ok((target, moves))
}

fn restore_file(vault: &Vault, trashed: &str, ext: &str) -> Result<String> {
    let mut done = Rollback::default();
    let (to, source) = place_back(vault, trashed, ext, &mut done)?;
    let (when, _) = parts(vault, trashed, ext)?;
    tidy(&vault.root().join(".trash").join(when), &[source]);
    Ok(to)
}

/// Moves a trashed file of the kind `ext` back; returns where it went and
/// the file it came from.
fn place_back(
    vault: &Vault,
    trashed: &str,
    ext: &str,
    done: &mut Rollback,
) -> Result<(String, PathBuf)> {
    let (_, original) = parts(vault, trashed, ext)?;
    // The trashed file is never reached through a link.
    let source = vault.tracked_file(trashed)?;
    if !source.is_file() {
        return Err(Error::NotFound(trashed.to_owned()));
    }
    // A page also keeps off the name of a comments or highlights file that is
    // there, so it never takes a stray one for its own.
    let taken = vault.file_of(original, &[ext])?.exists()
        || (ext == ".md" && crate::companions::name_taken(vault, original));
    let target = if taken {
        let stem = original
            .rsplit('/')
            .next()
            .unwrap_or(original)
            .trim_end_matches(ext);
        free_file(vault, folder_of(original), stem, ext)
    } else {
        original.to_owned()
    };
    let destination = vault.file_of(&target, &[ext])?;
    done.rename(&source, &destination)?;
    Ok((target, source))
}

/// Removes the folders in the trash folder `stamp_dir` that moving
/// `sources` out left empty, and it too once empty; `remove_dir` only
/// removes empty ones.
fn tidy(stamp_dir: &Path, sources: &[PathBuf]) {
    for source in sources {
        let mut dir = source.parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            if !d.starts_with(stamp_dir) || fs::remove_dir(&d).is_err() {
                break;
            }
            dir = d.parent().map(Path::to_path_buf);
        }
    }
}
