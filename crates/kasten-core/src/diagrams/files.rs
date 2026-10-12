//! Diagrams on disk: made where boards go, read with the hash a save must
//! bring back, and written together with their picture or not at all.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::format::{
    EXT, MAX_BYTES, SIDECAR_EXT, blank_xml, check_svg, check_xml, sidecar_of, stamp_in_tail,
    stamped,
};
use super::names::{checked_title, free_pair, stem_of_title};
use crate::atomic::{create_atomic, read_if_there, write_atomic};
use crate::error::{Error, Result};
use crate::note::content_hash;
use crate::ops::kind_folder;
use crate::rollback::Rollback;
use crate::save::fitting;
use crate::time::Instant;
use crate::vault::Vault;

/// Whether a diagram's picture shows what its source says now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Preview {
    /// The picture was drawn from this very source.
    Fresh,
    /// There is a picture, but it was drawn from other source (or by another
    /// program, which leaves no stamp). It is drawn again when the editor is
    /// next at hand.
    Stale,
    /// There is no picture.
    Missing,
}

/// A diagram as it is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramFile {
    pub path: String,
    pub xml: String,
    /// What a save brings back to show it started from this version.
    pub hash: String,
    pub modified: u64,
    pub preview: Preview,
}

/// The result of saving a diagram.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DiagramSaved {
    /// Written; `diagram` is the file as it is now.
    Written { diagram: DiagramFile },
    /// The file already held this source and nothing else was asked for.
    Unchanged { diagram: DiagramFile },
    /// The file changed on disk since it was read. The editor's version went
    /// to `copy`, and `diagram` is the file, left as it was.
    Conflict { copy: String, diagram: DiagramFile },
}

/// The source's file, after checking the path is a plain vault path ending
/// in `.drawio`.
pub(crate) fn source_file(vault: &Vault, path: &str) -> Result<PathBuf> {
    vault.file_of(path, &[EXT])
}

/// The picture's file.
pub(crate) fn picture_file(vault: &Vault, path: &str) -> Result<PathBuf> {
    vault.file_of(&sidecar_of(path), &[SIDECAR_EXT])
}

/// The source's text and its time.
pub(crate) fn read_source(vault: &Vault, path: &str) -> Result<(String, u64)> {
    let file = source_file(vault, path)?;
    let meta = fs::metadata(&file).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => Error::NotFound(path.to_owned()),
        _ => Error::Io(err),
    })?;
    if meta.len() > MAX_BYTES as u64 {
        return Err(Error::Invalid(format!("{path} is too large for a diagram")));
    }
    let text = fs::read_to_string(&file).map_err(|err| match err.kind() {
        io::ErrorKind::InvalidData => Error::Invalid(format!("{path} is not UTF-8 text")),
        _ => Error::Io(err),
    })?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    Ok((text, modified))
}

/// How the picture stands against a source with this hash, from the stamp
/// at its end: only its last bytes are read.
pub(crate) fn preview_of(vault: &Vault, path: &str, hash: &str) -> Preview {
    let Ok(file) = picture_file(vault, path) else {
        return Preview::Missing;
    };
    let Ok(mut handle) = File::open(file) else {
        return Preview::Missing;
    };
    let Ok(meta) = handle.metadata() else {
        return Preview::Missing;
    };
    if !meta.is_file() {
        return Preview::Missing;
    }
    let mut tail = Vec::new();
    let from = meta.len().saturating_sub(256);
    if handle.seek(SeekFrom::Start(from)).is_err() || handle.read_to_end(&mut tail).is_err() {
        return Preview::Stale;
    }
    match stamp_in_tail(&String::from_utf8_lossy(&tail)) {
        Some(stamp) if stamp == hash => Preview::Fresh,
        _ => Preview::Stale,
    }
}

/// The diagram at `path`, which must be a plain vault path ending in
/// `.drawio`.
pub fn read_diagram(vault: &Vault, path: &str) -> Result<DiagramFile> {
    let (xml, modified) = read_source(vault, path)?;
    let hash = content_hash(&xml);
    let preview = preview_of(vault, path, &hash);
    Ok(DiagramFile {
        path: path.to_owned(),
        xml,
        hash,
        modified,
        preview,
    })
}

/// The picture beside the diagram at `path`, as it is on disk, or None when
/// there is none. It may be out of date: see `DiagramFile::preview`.
pub fn read_preview(vault: &Vault, path: &str) -> Result<Option<String>> {
    source_file(vault, path)?;
    let file = picture_file(vault, path)?;
    match fs::metadata(&file) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.into()),
        Ok(meta) if !meta.is_file() => return Ok(None),
        Ok(meta) if meta.len() > MAX_BYTES as u64 + 1024 => {
            return Err(Error::Invalid(format!(
                "The picture of {path} is too large to show"
            )));
        }
        Ok(_) => {}
    }
    match fs::read_to_string(&file) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == io::ErrorKind::InvalidData => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// The trimmed title, the folder and the source for a new diagram, or why it
/// cannot be made.
fn checked_new(
    vault: &Vault,
    title: &str,
    project: Option<&str>,
    xml: Option<&str>,
) -> Result<(String, String, String)> {
    let title = checked_title(title)?;
    let xml = xml.map_or_else(blank_xml, str::to_owned);
    check_xml(&xml)?;
    Ok((title, kind_folder(vault, project, "diagrams")?, xml))
}

/// Whether `create_diagram` would make a diagram of these, so that a request
/// that cannot be met is refused before anything waits for review.
pub fn check_new_diagram(
    vault: &Vault,
    title: &str,
    project: Option<&str>,
    xml: Option<&str>,
) -> Result<()> {
    checked_new(vault, title, project, xml).map(|_| ())
}

/// Creates a diagram titled `title` in `project` (a folder under `projects/`
/// with a `_project.md`) or, with None, in the library; returns its path.
/// `xml` is the source (an empty page when None). The file is named by the
/// title, numbered when taken; no existing file is ever replaced.
pub fn create_diagram(
    vault: &Vault,
    title: &str,
    project: Option<&str>,
    xml: Option<&str>,
) -> Result<String> {
    let (title, folder, xml) = checked_new(vault, title, project, xml)?;
    let path = free_pair(vault, &folder, &stem_of_title(&title));
    create_atomic(&source_file(vault, &path)?, xml.as_bytes())?;
    Ok(path)
}

/// Writes `xml` over the diagram at `path`, and with it `svg` as its picture,
/// if the file still has `base_hash`, the hash it was read with. Both files
/// are written, or neither. A file that changed since goes untouched, and
/// the source (with its picture) goes to `<name> (conflict <time>).drawio`
/// beside it. With no `svg` the old picture stays, and is known to be out of
/// date until a new one comes.
pub fn write_diagram(
    vault: &Vault,
    path: &str,
    xml: &str,
    svg: Option<&str>,
    base_hash: &str,
    now: Instant,
) -> Result<DiagramSaved> {
    check_xml(xml)?;
    if let Some(svg) = svg {
        check_svg(svg)?;
    }
    let file = source_file(vault, path)?;
    let current = read_diagram(vault, path)?;
    if current.xml != xml && current.hash != base_hash {
        let copy = conflict_copy(vault, path, xml, svg, now)?;
        return Ok(DiagramSaved::Conflict {
            copy,
            diagram: current,
        });
    }
    let mut done = Rollback::default();
    let written = (|| -> Result<bool> {
        let mut wrote = false;
        if current.xml != xml {
            done.write(
                &file,
                xml.as_bytes(),
                Some(current.xml.clone().into_bytes()),
            )?;
            wrote = true;
        }
        if let Some(svg) = svg {
            let target = picture_file(vault, path)?;
            let text = stamped(svg, &content_hash(xml));
            let before = read_if_there(&target)?;
            if before.as_deref() != Some(text.as_bytes()) {
                done.write(&target, text.as_bytes(), before)?;
                wrote = true;
            }
        }
        Ok(wrote)
    })();
    match written {
        Ok(true) => Ok(DiagramSaved::Written {
            diagram: read_diagram(vault, path)?,
        }),
        Ok(false) => Ok(DiagramSaved::Unchanged { diagram: current }),
        Err(err) => {
            done.put_back();
            Err(err)
        }
    }
}

/// Writes `svg` as the picture of the diagram at `path`, only if the source
/// still has `source_hash`: the one it was drawn from.
pub fn write_preview(
    vault: &Vault,
    path: &str,
    svg: &str,
    source_hash: &str,
) -> Result<DiagramFile> {
    check_svg(svg)?;
    let current = read_diagram(vault, path)?;
    if current.hash != source_hash {
        return Err(Error::Invalid(
            "The diagram changed since this picture was drawn".to_owned(),
        ));
    }
    write_atomic(
        &picture_file(vault, path)?,
        stamped(svg, &current.hash).as_bytes(),
    )?;
    read_diagram(vault, path)
}

/// `<name> (conflict <time>).drawio` beside `path`, with its picture, under
/// a name no source or picture has.
fn conflict_copy(
    vault: &Vault,
    path: &str,
    xml: &str,
    svg: Option<&str>,
    now: Instant,
) -> Result<String> {
    let label = format!("conflict {}", now.file_stamp());
    let stem = fitting(path.strip_suffix(EXT).unwrap_or(path), label.len());
    let present = |file: Result<PathBuf>| file.is_ok_and(|p| fs::symlink_metadata(p).is_ok());
    let taken = |rel: &str| present(source_file(vault, rel)) || present(picture_file(vault, rel));
    let mut copy = format!("{stem} ({label}){EXT}");
    let mut n = 2;
    while taken(&copy) {
        copy = format!("{stem} ({label} {n}){EXT}");
        n += 1;
    }
    let mut done = Rollback::default();
    let made = (|| -> Result<()> {
        done.create(&source_file(vault, &copy)?, xml.as_bytes())?;
        if let Some(svg) = svg {
            let text = stamped(svg, &content_hash(xml));
            done.create(&picture_file(vault, &copy)?, text.as_bytes())?;
        }
        Ok(())
    })();
    match made {
        Ok(()) => Ok(copy),
        Err(err) => {
            done.put_back();
            Err(err)
        }
    }
}
