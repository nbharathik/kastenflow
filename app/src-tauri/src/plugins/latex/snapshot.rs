//! The tree a build runs in: the document's folder mirrored into the vault's
//! cache, with the window's unsaved buffers laid over it, so a build never
//! waits for autosave and TeX never reads a person's folder directly. Only
//! files whose size or modified time changed are copied again. Nothing is
//! read from outside the folder (links are not followed, hidden entries and
//! programs are left out, a buffer may not name a path that leaves the
//! folder), and the only things ever removed are leftovers in the cache's own
//! tree. The file work is in `mirror`.

use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use kasten_core::latex::{MAX_SOURCE_BYTES, is_source_path};
use serde::Deserialize;

use super::mirror::{
    Entry, copy_entry, drop_leftovers, io_err, make_parents, same_as, scan, write_new,
};
use super::paths::{clean_rel, is_link, plain_folders_below};

/// Most unsaved buffers in one request.
pub const MAX_BUFFERS: usize = 200;
/// The vault's managed bibliography is copied in under this name.
pub const VAULT_BIB: &str = "references.bib";
const MAX_BIB_BYTES: u64 = 16 * 1024 * 1024;

/// An unsaved buffer: the vault path of a source file and its text.
#[derive(Debug, Clone, Deserialize)]
pub struct Buffer {
    pub path: String,
    pub text: String,
}

/// Why a tree could not be made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refused {
    /// A buffer's path is not a plain path inside the document's folder.
    Escape(String),
    /// A buffer is not a kind of file a document holds as text.
    NotSource(String),
    /// A buffer is bigger than a source file may be.
    TooBig(String),
    /// More buffers than a request may carry.
    TooMany,
    /// The folder is too big to mirror (a file, the count or the total).
    Folder(String),
    /// The document's folder or the cache could not be read or written.
    Io(String),
}

impl fmt::Display for Refused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Escape(p) => write!(f, "“{p}” is not a file inside the document's folder"),
            Self::NotSource(p) => write!(f, "“{p}” is not a file a LaTeX document holds as text"),
            Self::TooBig(p) => write!(f, "“{p}” is too big to build from"),
            Self::TooMany => write!(f, "Too many unsaved files to build from"),
            Self::Folder(why) | Self::Io(why) => f.write_str(why),
        }
    }
}

/// What a sync did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub copied: usize,
    pub unchanged: usize,
    pub removed: usize,
    pub overlaid: usize,
    /// Links, hidden entries and programs left out.
    pub skipped: usize,
}

/// The buffers as (path inside the folder, buffer), refusing any whose path
/// is not a plain source path below `folder` (a vault path such as
/// `projects/p/latex/a`). A path named twice keeps its last buffer.
pub fn check_buffers<'a>(
    folder: &str,
    buffers: &'a [Buffer],
) -> Result<BTreeMap<String, &'a Buffer>, Refused> {
    if buffers.len() > MAX_BUFFERS {
        return Err(Refused::TooMany);
    }
    let prefix = format!("{}/", folder.trim_end_matches('/'));
    let mut out = BTreeMap::new();
    for buffer in buffers {
        let inside = buffer
            .path
            .strip_prefix(&prefix)
            .and_then(clean_rel)
            .ok_or_else(|| Refused::Escape(buffer.path.clone()))?;
        if !is_source_path(&inside.to_ascii_lowercase()) {
            return Err(Refused::NotSource(buffer.path.clone()));
        }
        if buffer.text.len() > MAX_SOURCE_BYTES {
            return Err(Refused::TooBig(buffer.path.clone()));
        }
        out.insert(inside, buffer);
    }
    Ok(out)
}

/// Where a build is made: the paths of one document's build.
pub struct Places<'a> {
    /// The vault's folder; no part of `build` below it may be a link.
    pub root: &'a Path,
    /// The document's folder in the vault.
    pub src: &'a Path,
    /// This document's cache folder (the only place anything is removed).
    pub build: &'a Path,
    /// The mirror, inside `build`.
    pub tree: &'a Path,
    /// The document's folder as a vault path (`projects/p/latex/a`).
    pub folder: &'a str,
}

/// Makes the tree folder, refusing a cache path that has a link in it.
fn make_tree(places: &Places<'_>) -> Result<(), Refused> {
    let plain = || Refused::Io("The build folder is not a plain folder".to_owned());
    let cache_rel = places
        .build
        .strip_prefix(places.root)
        .ok()
        .and_then(|p| p.to_str())
        .map(|p| p.replace('\\', "/"));
    if !cache_rel.is_some_and(|p| plain_folders_below(places.root, &p)) {
        return Err(plain());
    }
    fs::create_dir_all(places.tree).map_err(|e| io_err("make the build folder", &e))?;
    let meta =
        fs::symlink_metadata(places.tree).map_err(|e| io_err("make the build folder", &e))?;
    if is_link(&meta) || !meta.is_dir() {
        return Err(plain());
    }
    Ok(())
}

/// Mirrors the document's folder into the tree and lays `buffers` (see
/// `check_buffers`) over it. With `vault_bib`, the vault's bibliography is
/// copied in as `references.bib` (instead of any `references.bib` of the
/// folder).
pub fn sync(
    places: &Places<'_>,
    buffers: &[Buffer],
    vault_bib: Option<&Path>,
) -> Result<Stats, Refused> {
    let Places {
        build, tree, src, ..
    } = *places;
    let overlay = check_buffers(places.folder, buffers)?;
    let mut stats = Stats::default();
    let sources = scan(src, &mut stats)?;
    make_tree(places)?;

    let bib = vault_bib.and_then(|path| {
        let meta = fs::symlink_metadata(path).ok()?;
        (!is_link(&meta) && meta.is_file() && meta.len() <= MAX_BIB_BYTES).then_some((path, meta))
    });
    // The vault's bibliography stands in for the folder's own `references.bib`.
    let is_bib = |rel: &str| bib.is_some() && rel == VAULT_BIB;
    let mut keep: HashSet<String> = HashSet::new();
    keep.extend(
        sources
            .iter()
            .filter(|e| !is_bib(&e.rel))
            .map(|e| e.rel.clone()),
    );
    keep.extend(overlay.keys().filter(|rel| !is_bib(rel)).cloned());
    if bib.is_some() {
        keep.insert(VAULT_BIB.to_owned());
    }
    // What the tree holds that the folder does not goes first (and the whole
    // tree, when it has grown past what is worth looking through).
    stats.removed = drop_leftovers(build, tree, &keep);
    make_tree(places)?;

    for entry in sources.iter().filter(|e| !is_bib(&e.rel)) {
        if overlay.contains_key(&entry.rel) {
            continue;
        }
        let dest = tree.join(&entry.rel);
        if same_as(&dest, entry.len, entry.modified) {
            stats.unchanged += 1;
            continue;
        }
        make_parents(build, tree, &dest)?;
        copy_entry(build, entry, &dest)?;
        stats.copied += 1;
    }
    for (rel, buffer) in overlay.iter().filter(|(rel, _)| !is_bib(rel)) {
        let dest = tree.join(rel);
        make_parents(build, tree, &dest)?;
        let bytes = buffer.text.as_bytes();
        let same = fs::symlink_metadata(&dest)
            .ok()
            .filter(|m| !is_link(m) && m.is_file() && m.len() == bytes.len() as u64)
            .and_then(|_| fs::read(&dest).ok())
            .is_some_and(|had| had == bytes);
        if same {
            stats.unchanged += 1;
        } else {
            write_new(build, &dest, bytes)?;
            stats.copied += 1;
        }
        stats.overlaid += 1;
    }
    if let Some((path, meta)) = bib {
        let dest = tree.join(VAULT_BIB);
        if same_as(&dest, meta.len(), meta.modified().ok()) {
            stats.unchanged += 1;
        } else {
            let entry = Entry {
                rel: VAULT_BIB.to_owned(),
                abs: path.to_path_buf(),
                len: meta.len(),
                modified: meta.modified().ok(),
            };
            copy_entry(build, &entry, &dest)?;
            stats.copied += 1;
        }
    }
    Ok(stats)
}

/// A sized read of a file the build wrote (a log, a SyncTeX file): at most
/// `limit` bytes of a plain file, none for a link or anything else.
pub fn read_plain(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let meta = fs::symlink_metadata(path).ok()?;
    if is_link(&meta) || !meta.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(bytes)
}
