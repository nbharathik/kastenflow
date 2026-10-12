//! The trash: what `trash_note` moved to `.trash/<time>/<path>`, notes,
//! boards and decks, listed and put back. Each trashing gets a folder of its own, so
//! a page and the sub-pages that went with it stay together: the list
//! shows the page, and putting it back brings them all. Nothing here
//! deletes anything.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::board::Canvas;
use crate::error::{Error, Result};
use crate::note::{NoteFile, NoteMeta, meta_for};
use crate::ops::{folder_of, free_file};
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::Vault;

/// What the trash holds: notes, boards, decks and diagrams (the source, and
/// the picture that goes with it).
const KINDS: [&str; 5] = [
    ".md",
    ".canvas",
    ".deck",
    crate::diagrams::EXT,
    crate::diagrams::SIDECAR_EXT,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trashed {
    /// Where the note is now, relative to the vault: `.trash/<time>/<path>`.
    pub trashed: String,
    /// Where it was.
    pub original: String,
    pub title: String,
    /// The trash folder's time stamp, such as `20260924T080000Z`.
    pub when: String,
    /// How many sub-pages went to the trash with it; they come back with it.
    pub inside: usize,
}

fn walk(dir: &Path, rel: &str, out: &mut Vec<String>) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = format!("{rel}/{name}");
        let kind = entry.file_type()?;
        if kind.is_dir() {
            walk(&entry.path(), &path, out)?;
        } else if kind.is_file() && KINDS.iter().any(|ext| name.ends_with(ext)) {
            out.push(path.trim_start_matches('/').to_owned());
        }
    }
    Ok(())
}

/// A trashed file's title: a note's, a board's, a deck's, a diagram's, or the file name.
fn title_of(original: &str, text: &str, meta: Option<&NoteMeta>) -> String {
    if original.ends_with(crate::diagrams::EXT) || original.ends_with(crate::diagrams::SIDECAR_EXT)
    {
        return crate::diagrams::title_of(original);
    }
    if original.ends_with(".deck") {
        let name = original.rsplit('/').next().unwrap_or(original);
        return crate::deck::head_of(text)
            .ok()
            .and_then(|head| head.title)
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| name.trim_end_matches(".deck").to_owned());
    }
    if original.ends_with(".canvas") {
        let name = original.rsplit('/').next().unwrap_or(original);
        let stem = name.trim_end_matches(".canvas");
        return Canvas::parse(text)
            .ok()
            .and_then(|c| c.title().map(str::to_owned))
            .unwrap_or_else(|| stem.to_owned());
    }
    meta.map(|m| m.title.clone())
        .unwrap_or_else(|| meta_for(original, text, 0).title)
}

/// One trash folder's files: each file's original path and its metadata
/// (None for a board).
fn folder_files(stamp_dir: &Path) -> Result<Vec<(String, String, Option<NoteMeta>)>> {
    let mut files = Vec::new();
    walk(stamp_dir, "", &mut files)?;
    Ok(files
        .into_iter()
        .map(|original| {
            let text = fs::read_to_string(stamp_dir.join(&original)).unwrap_or_default();
            let meta = original
                .ends_with(".md")
                .then(|| meta_for(&original, &text, 0));
            (original, text, meta)
        })
        .collect())
}

/// For each file of one trash folder, the files below it there: the
/// sub-pages whose parent, or parent's parent, went with it.
fn below(metas: &[Option<&NoteMeta>]) -> Vec<Vec<usize>> {
    let mut children: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, meta) in metas.iter().enumerate() {
        if let Some(parent) = meta.and_then(|m| m.parent.as_deref()) {
            children.entry(parent).or_default().push(i);
        }
    }
    (0..metas.len())
        .map(|top| {
            let mut seen = HashSet::from([top]);
            let mut out = Vec::new();
            let mut i = 0;
            let mut queue = vec![top];
            while i < queue.len() {
                let id = metas[queue[i]].and_then(|m| m.id.as_deref());
                for &child in id.and_then(|id| children.get(id)).into_iter().flatten() {
                    if seen.insert(child) {
                        out.push(child);
                        queue.push(child);
                    }
                }
                i += 1;
            }
            out
        })
        .collect()
}

/// Whether file `i` of a trash folder is listed: unless it is below one
/// that is listed itself. Parents that loop, which only hand edits make,
/// are all listed, so nothing in the trash is ever out of sight.
fn shown(below: &[Vec<usize>], i: usize) -> bool {
    let above: Vec<usize> = (0..below.len())
        .filter(|&j| j != i && below[j].contains(&i))
        .collect();
    above.is_empty() || above.iter().all(|&j| below[i].contains(&j))
}

/// The text of a note, board or deck in the trash, to look at before it comes
/// back. Only a file inside `.trash/`, of the kinds the trash holds.
pub fn read_trashed(vault: &Vault, trashed: &str) -> Result<String> {
    let inside = trashed
        .strip_prefix(".trash/")
        .and_then(|rest| rest.split_once('/'))
        .is_some_and(|(stamp, rel)| {
            !stamp.is_empty() && KINDS.iter().any(|ext| rel.ends_with(ext))
        });
    if !inside {
        return Err(Error::InvalidPath(trashed.to_owned()));
    }
    let path = vault.tracked_file(trashed)?;
    if !path.is_file() {
        return Err(Error::NotFound(trashed.to_owned()));
    }
    Ok(fs::read_to_string(path)?)
}

/// Every note, board and deck in the trash, most recently trashed first. A
/// sub-page that went with its parent is not listed apart: it is counted
/// in its parent's `inside`.
pub fn list_trash(vault: &Vault) -> Result<Vec<Trashed>> {
    let root = vault.root().join(".trash");
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for stamp in fs::read_dir(&root)? {
        let stamp = stamp?;
        if !stamp.file_type()?.is_dir() {
            continue;
        }
        let when = stamp.file_name().to_string_lossy().into_owned();
        let files = folder_files(&stamp.path())?;
        let metas: Vec<Option<&NoteMeta>> = files.iter().map(|(_, _, m)| m.as_ref()).collect();
        let below = below(&metas);
        for (i, (original, text, meta)) in files.iter().enumerate() {
            if !shown(&below, i) {
                continue;
            }
            // A diagram's picture goes and comes back with its source: it is
            // not a thing of its own while the source is in the same folder.
            if original.strip_suffix(".svg").is_some_and(|source| {
                source.ends_with(crate::diagrams::EXT) && files.iter().any(|(o, _, _)| o == source)
            }) {
                continue;
            }
            out.push(Trashed {
                trashed: format!(".trash/{when}/{original}"),
                original: original.clone(),
                title: title_of(original, text, meta.as_ref()),
                when: when.clone(),
                inside: below[i].len(),
            });
        }
    }
    out.sort_by(|a, b| {
        b.when
            .cmp(&a.when)
            .then_with(|| a.original.cmp(&b.original))
    });
    Ok(out)
}

/// Moves the notes, boards and decks at `rels` into one new trash folder, each
/// keeping its path inside it; returns where each went. All go, or none:
/// a move that fails puts back the ones before it.
pub(crate) fn trash_all(vault: &Vault, rels: &[String], now: Instant) -> Result<Vec<String>> {
    let mut sources = Vec::with_capacity(rels.len());
    for rel in rels {
        let source = vault.file_of(rel, &KINDS)?;
        if !source.is_file() {
            return Err(Error::NotFound(rel.clone()));
        }
        sources.push(source);
    }
    // A folder of its own, so what went together comes back together.
    let mut stamp = now.compact();
    let mut n = 2;
    while vault.root().join(".trash").join(&stamp).exists() {
        stamp = format!("{}-{n}", now.compact());
        n += 1;
    }
    let mut done = Rollback::default();
    let mut out = Vec::with_capacity(rels.len());
    for (rel, source) in rels.iter().zip(&sources) {
        let target = vault.root().join(".trash").join(&stamp).join(rel);
        if let Err(err) = done.rename(source, &target) {
            done.put_back();
            return Err(err.into());
        }
        out.push(format!(".trash/{stamp}/{rel}"));
    }
    Ok(out)
}

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
/// with the sub-pages that went to the trash with it. Returns the note and
/// every (trashed, restored) path.
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
        match place_back(vault, &from, ".md", &mut done) {
            Ok((to, source)) => {
                emptied.push(source);
                moves.push((from, to));
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
    let target = if vault.file_of(original, &[ext])?.exists() {
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
