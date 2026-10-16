//! The trash: what `trash_note` moved to `.trash/<time>/<path>`, notes,
//! boards and decks, listed and put back. Each trashing gets a folder of its own, so
//! a page and the sub-pages that went with it stay together: the list
//! shows the page, and putting it back brings them all. Nothing here
//! deletes anything.

mod restore;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::board::Canvas;
use crate::error::{Error, Result};
use crate::note::{NoteMeta, meta_for};
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::Vault;

pub use restore::{
    restore_board, restore_collection, restore_deck, restore_diagram, restore_note,
    restore_note_with_sub_pages,
};

/// What the trash holds: notes, boards, decks and diagrams (the source, and
/// the picture that goes with it). Saved collections (`views/*.yaml`) go to
/// it too, by their own path check, not by the ending alone: no other
/// `.yaml` file can be trashed.
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
        } else if kind.is_file()
            && (KINDS.iter().any(|ext| name.ends_with(ext))
                || crate::collections::is_path(path.trim_start_matches('/')))
        {
            out.push(path.trim_start_matches('/').to_owned());
        }
    }
    Ok(())
}

/// A trashed file's title: a note's, a board's, a deck's, a diagram's, a
/// collection's name, or the file name.
fn title_of(original: &str, text: &str, meta: Option<&NoteMeta>) -> String {
    if crate::collections::is_path(original) {
        return crate::collections::name_of(original, text);
    }
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
            !stamp.is_empty()
                && (KINDS.iter().any(|ext| rel.ends_with(ext)) || crate::collections::is_path(rel))
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

/// What `trash_all` moves: what the trash lists, and the comments and
/// highlights files that go to it with their page (and are not listed apart).
const MOVABLE: [&str; 7] = [
    ".md",
    ".canvas",
    ".deck",
    crate::diagrams::EXT,
    crate::diagrams::SIDECAR_EXT,
    crate::companions::COMMENTS,
    crate::companions::HIGHLIGHTS,
];

/// Moves the notes, boards and decks at `rels` into one new trash folder, each
/// keeping its path inside it; returns where each went. All go, or none:
/// a move that fails puts back the ones before it. A page's comments and
/// highlights files may be among `rels`, and go with it.
pub(crate) fn trash_all(vault: &Vault, rels: &[String], now: Instant) -> Result<Vec<String>> {
    trash_kinds(vault, rels, now, &MOVABLE)
}

/// Moves a saved collection (`views/<name>.yaml`, and no other file) into a
/// new trash folder; returns where it went.
pub(crate) fn trash_collection(vault: &Vault, rel: &str, now: Instant) -> Result<String> {
    if !crate::collections::is_path(rel) {
        return Err(Error::InvalidPath(rel.to_owned()));
    }
    let mut went = trash_kinds(vault, &[rel.to_owned()], now, &[".yaml"])?;
    Ok(went.remove(0))
}

fn trash_kinds(
    vault: &Vault,
    rels: &[String],
    now: Instant,
    kinds: &[&str],
) -> Result<Vec<String>> {
    let mut sources = Vec::with_capacity(rels.len());
    for rel in rels {
        let source = vault.file_of(rel, kinds)?;
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
