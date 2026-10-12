//! Moving, renaming and copying a diagram: the source and its picture go
//! together, under one name, or not at all.

use std::fs;

use super::files::{picture_file, read_source, source_file};
use super::format::{EXT, sidecar_of};
use super::names::{checked_title, folder_of, free_pair, stem_of_path, stem_of_title};
use crate::atomic::read_if_there;
use crate::error::{Error, Result};
use crate::ops::kind_folder;
use crate::rollback::Rollback;
use crate::vault::Vault;

/// The new path of the source and every (from, to) move that was made.
pub type Moves = (String, Vec<(String, String)>);

/// The source's path and, when there is one, the picture's.
pub fn files_of(vault: &Vault, path: &str) -> Vec<String> {
    let mut out = vec![path.to_owned()];
    if picture_file(vault, path).is_ok_and(|file| fs::metadata(file).is_ok_and(|m| m.is_file())) {
        out.push(sidecar_of(path));
    }
    out
}

fn must_be_there(vault: &Vault, path: &str) -> Result<()> {
    if source_file(vault, path)?.is_file() {
        Ok(())
    } else {
        Err(Error::NotFound(path.to_owned()))
    }
}

/// Moves the source and its picture to `dir/stem.drawio`, or the next free
/// name, putting back what was moved if a step fails.
fn move_pair(vault: &Vault, path: &str, dir: &str, stem: &str) -> Result<Moves> {
    must_be_there(vault, path)?;
    let target = free_pair(vault, dir, stem);
    let mut done = Rollback::default();
    let mut moves = Vec::new();
    let result = (|| -> Result<()> {
        done.rename(&source_file(vault, path)?, &source_file(vault, &target)?)?;
        moves.push((path.to_owned(), target.clone()));
        let picture = picture_file(vault, path)?;
        if picture.is_file() {
            done.rename(&picture, &picture_file(vault, &target)?)?;
            moves.push((sidecar_of(path), sidecar_of(&target)));
        }
        Ok(())
    })();
    match result {
        Ok(()) => Ok((target, moves)),
        Err(err) => {
            done.put_back();
            Err(err)
        }
    }
}

/// Gives the diagram at `path` a new title: both files take the name the
/// title makes, in the same folder. The same name again moves nothing.
pub fn rename_diagram(vault: &Vault, path: &str, title: &str) -> Result<Moves> {
    let stem = stem_of_title(&checked_title(title)?);
    must_be_there(vault, path)?;
    if stem == stem_of_path(path) {
        return Ok((path.to_owned(), Vec::new()));
    }
    move_pair(vault, path, folder_of(path), &stem)
}

/// Moves the diagram at `path` into `project` (a folder under `projects/`)
/// or, with None, into the library, keeping its name where it is free.
pub fn move_diagram(vault: &Vault, path: &str, project: Option<&str>) -> Result<Moves> {
    let dir = kind_folder(vault, project, "diagrams")?;
    must_be_there(vault, path)?;
    if folder_of(path) == dir {
        return Ok((path.to_owned(), Vec::new()));
    }
    move_pair(vault, path, &dir, stem_of_path(path))
}

/// Copies the diagram at `path` beside itself as `<name>-copy`, with a copy
/// of its picture, which is as true of the copy as it was of the original.
pub fn duplicate_diagram(vault: &Vault, path: &str) -> Result<String> {
    let (xml, _) = read_source(vault, path)?;
    let target = free_pair(
        vault,
        folder_of(path),
        &format!("{}-copy", stem_of_path(path)),
    );
    let mut done = Rollback::default();
    let result = (|| -> Result<()> {
        done.create(&source_file(vault, &target)?, xml.as_bytes())?;
        if let Some(picture) = read_if_there(&picture_file(vault, path)?)? {
            done.create(&picture_file(vault, &target)?, &picture)?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => Ok(target),
        Err(err) => {
            done.put_back();
            Err(err)
        }
    }
}

/// Whether no other diagram has the file name of the one at `path`, so a
/// link that names it by its file name alone cannot mean another.
pub fn has_unique_name(vault: &Vault, path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    vault.files(EXT).is_ok_and(|all| {
        all.iter()
            .filter(|f| {
                f.path
                    .rsplit('/')
                    .next()
                    .is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
            .count()
            <= 1
    })
}
