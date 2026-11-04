//! The layout library: layouts a person keeps for every deck, one small JSON file each in
//! `templates/layouts/` of the vault, where they can be seen, copied to another vault and trashed. The
//! editor writes the text (a layout as a deck's theme holds it, with the text styles its slots name and
//! the page size it was drawn for) and core keeps it as it was given: it reads only the envelope
//! (format, version, id, label), never rewrites a body, and so keeps every field it does not know. A
//! deck that uses a layout holds its own copy; nothing here is read when a deck is opened.

use std::fs;
use std::io;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::note::content_hash;
use crate::ops::free_file;
use crate::slug::slugify;
use crate::vault::Vault;

/// Where the library is kept.
pub const LAYOUT_FOLDER: &str = "templates/layouts";

/// The ending of a library file.
pub const LAYOUT_EXT: &str = ".layout";

/// The `format` every library file states.
pub const LAYOUT_FORMAT: &str = "kasten-layout";

/// The largest library file core reads or writes: a layout holds shapes and paths, its pictures are
/// separate files.
pub const MAX_LAYOUT_BYTES: usize = 1 << 20;

/// The longest id and label a library file may have.
const MAX_ID: usize = 80;
const MAX_LABEL: usize = 80;

/// What lists need to know about a library file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutHead {
    pub id: String,
    pub label: String,
    /// How many slots the layout has.
    pub slots: usize,
    pub version: u64,
}

/// A library layout in lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutInfo {
    pub path: String,
    /// The entry's own id, which a copy in a deck remembers it by.
    pub id: String,
    pub label: String,
    pub slots: usize,
    pub modified: u64,
    pub size: u64,
    /// Why the file cannot be used, when it cannot. It is still listed, to be looked at or trashed.
    pub problem: Option<String>,
}

/// A library file as it is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutFile {
    pub path: String,
    pub text: String,
    pub hash: String,
    pub modified: u64,
}

/// What saving a layout to the library did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSaved {
    pub path: String,
    pub id: String,
    /// The file was there already (same id) and now holds the new text.
    pub replaced: bool,
    /// Nothing was written: the file already held this text.
    pub unchanged: bool,
}

fn not_a_layout(why: &str) -> Error {
    Error::Invalid(format!("Not a KastenFlow layout: {why}"))
}

/// Reads the envelope of the library file in `text`, or says why it is not one.
pub fn layout_head(text: &str) -> Result<LayoutHead> {
    if text.len() > MAX_LAYOUT_BYTES {
        return Err(not_a_layout("it is too large"));
    }
    let value: Value = serde_json::from_str(text).map_err(|_| not_a_layout("not JSON"))?;
    let Some(file) = value.as_object() else {
        return Err(not_a_layout("not an object"));
    };
    if file.get("format").and_then(Value::as_str) != Some(LAYOUT_FORMAT) {
        return Err(not_a_layout("its format is not kasten-layout"));
    }
    let version = file
        .get("formatVersion")
        .and_then(Value::as_u64)
        .filter(|v| *v >= 1)
        .ok_or_else(|| not_a_layout("it has no format version"))?;
    let id = file
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| {
            !id.is_empty()
                && id.chars().count() <= MAX_ID
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
        .ok_or_else(|| not_a_layout("it needs an id of letters, digits, - and _"))?
        .to_owned();
    let label = file
        .get("label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|l| !l.is_empty() && l.chars().count() <= MAX_LABEL && !l.contains(['\n', '\r']))
        .ok_or_else(|| not_a_layout("it needs a name of one line, 80 characters at most"))?
        .to_owned();
    let layout = file
        .get("layout")
        .and_then(Value::as_object)
        .ok_or_else(|| not_a_layout("it has no layout"))?;
    let slots = layout
        .get("placeholders")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    Ok(LayoutHead {
        id,
        label,
        slots,
        version,
    })
}

fn modified_of(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

fn in_library(path: &str) -> bool {
    path.strip_prefix(LAYOUT_FOLDER)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// The library file at `path`, which must be a plain vault path in the library ending in `.layout`.
pub fn read_layout(vault: &Vault, path: &str) -> Result<LayoutFile> {
    if !in_library(path) {
        return Err(Error::InvalidPath(path.to_owned()));
    }
    let file = vault.file_of(path, &[LAYOUT_EXT])?;
    let meta = fs::metadata(&file).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => Error::NotFound(path.to_owned()),
        _ => Error::Io(err),
    })?;
    if meta.len() > MAX_LAYOUT_BYTES as u64 {
        return Err(Error::Invalid(format!("{path} is too large for a layout")));
    }
    let text = fs::read_to_string(&file).map_err(|err| match err.kind() {
        io::ErrorKind::InvalidData => Error::Invalid(format!("{path} is not UTF-8 text")),
        _ => Error::Io(err),
    })?;
    Ok(LayoutFile {
        path: path.to_owned(),
        hash: content_hash(&text),
        text,
        modified: modified_of(&meta),
    })
}

/// Every library file, by name. One that cannot be used is listed with its problem.
pub fn list_layouts(vault: &Vault) -> Result<Vec<LayoutInfo>> {
    let mut out = Vec::new();
    for stat in vault.files_in(LAYOUT_FOLDER, LAYOUT_EXT)? {
        let stem = stat
            .path
            .rsplit('/')
            .next()
            .unwrap_or(&stat.path)
            .trim_end_matches(LAYOUT_EXT)
            .to_owned();
        let read = read_layout(vault, &stat.path).and_then(|f| layout_head(&f.text));
        out.push(match read {
            Ok(head) => LayoutInfo {
                path: stat.path,
                id: head.id,
                label: head.label,
                slots: head.slots,
                modified: stat.modified,
                size: stat.size,
                problem: None,
            },
            Err(err) => LayoutInfo {
                path: stat.path,
                id: String::new(),
                label: stem,
                slots: 0,
                modified: stat.modified,
                size: stat.size,
                problem: Some(err.to_string()),
            },
        });
    }
    out.sort_by_cached_key(|l| (l.label.to_lowercase(), l.path.clone()));
    Ok(out)
}

/// The path of the library file whose id is `id`, if there is one.
pub fn path_of_id(vault: &Vault, id: &str) -> Result<Option<String>> {
    Ok(list_layouts(vault)?
        .into_iter()
        .find(|l| l.problem.is_none() && l.id == id)
        .map(|l| l.path))
}

/// Keeps `text` (the editor wrote it) in the library. A file with the same id is replaced by it (the
/// old text stays in the vault's history); a new id makes a new file named for the label, numbered
/// when taken, and no other file is ever replaced.
pub fn save_layout(vault: &Vault, text: &str) -> Result<LayoutSaved> {
    let head = layout_head(text)?;
    if let Some(path) = path_of_id(vault, &head.id)? {
        let file = vault.file_of(&path, &[LAYOUT_EXT])?;
        let current = read_layout(vault, &path)?;
        if current.text == text {
            return Ok(LayoutSaved {
                path,
                id: head.id,
                replaced: true,
                unchanged: true,
            });
        }
        crate::atomic::write_atomic(&file, text.as_bytes())?;
        return Ok(LayoutSaved {
            path,
            id: head.id,
            replaced: true,
            unchanged: false,
        });
    }
    let stem = match slugify(&head.label) {
        s if s.is_empty() => "layout".to_owned(),
        s => s,
    };
    let path = free_file(vault, LAYOUT_FOLDER, &stem, LAYOUT_EXT);
    crate::atomic::create_atomic(&vault.file_of(&path, &[LAYOUT_EXT])?, text.as_bytes())?;
    Ok(LayoutSaved {
        path,
        id: head.id,
        replaced: false,
        unchanged: false,
    })
}
