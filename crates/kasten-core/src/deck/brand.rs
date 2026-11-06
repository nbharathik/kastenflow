//! The brand kit: the logo, colours, fonts and default theme a vault's decks start from, kept as one
//! small JSON file in `templates/brand/`, where it can be seen, copied to another vault and trashed.
//! A vault has one (`vault.brand`) and each project may have its own (`project-<name>.brand`), which
//! is used in place of the vault's for decks in that project. The editor writes the text and core
//! keeps it as it was given: it reads only the envelope (format and version), never rewrites a body,
//! and so keeps every field it does not know. A deck made from a kit holds its own colours and fonts;
//! nothing here is read when a deck is opened.

use std::fs;
use std::io;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::note::content_hash;
use crate::slug::slugify;
use crate::vault::Vault;

/// Where brand kits are kept.
pub const BRAND_FOLDER: &str = "templates/brand";

/// The ending of a brand file.
pub const BRAND_EXT: &str = ".brand";

/// The `format` every brand file states.
pub const BRAND_FORMAT: &str = "kasten-brand";

/// The largest brand file core reads or writes: a kit names a logo file, it does not hold one.
pub const MAX_BRAND_BYTES: usize = 256 * 1024;

/// A brand file as it is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandFile {
    pub path: String,
    /// The project it belongs to; none for the vault's own.
    pub project: Option<String>,
    pub text: String,
    pub hash: String,
    pub modified: u64,
}

/// What keeping a brand kit did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandSaved {
    pub path: String,
    /// The file was there already and now holds the new text.
    pub replaced: bool,
    /// Nothing was written: the file already held this text.
    pub unchanged: bool,
}

fn not_a_brand(why: &str) -> Error {
    Error::Invalid(format!("Not a KastenFlow brand kit: {why}"))
}

/// Checks the envelope of the brand file in `text`, or says why it is not one.
pub fn brand_head(text: &str) -> Result<()> {
    if text.len() > MAX_BRAND_BYTES {
        return Err(not_a_brand("it is too large"));
    }
    let value: Value = serde_json::from_str(text).map_err(|_| not_a_brand("not JSON"))?;
    let Some(file) = value.as_object() else {
        return Err(not_a_brand("not an object"));
    };
    if file.get("format").and_then(Value::as_str) != Some(BRAND_FORMAT) {
        return Err(not_a_brand("its format is not kasten-brand"));
    }
    file.get("formatVersion")
        .and_then(Value::as_u64)
        .filter(|v| *v >= 1)
        .ok_or_else(|| not_a_brand("it has no format version"))?;
    Ok(())
}

/// The vault path of the brand file for `project` (the vault's own when none).
pub fn brand_path(project: Option<&str>) -> Result<String> {
    let Some(name) = project.map(str::trim) else {
        return Ok(format!("{BRAND_FOLDER}/vault{BRAND_EXT}"));
    };
    // A blank name is refused before slugify, which gives every name some slug.
    let slug = if name.is_empty() {
        String::new()
    } else {
        slugify(name)
    };
    if slug.is_empty() {
        return Err(Error::Invalid(
            "A project's brand kit needs the project's name.".to_owned(),
        ));
    }
    Ok(format!("{BRAND_FOLDER}/project-{slug}{BRAND_EXT}"))
}

fn modified_of(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

/// The brand file of `project` (the vault's when none), or None when there is not one.
pub fn read_brand(vault: &Vault, project: Option<&str>) -> Result<Option<BrandFile>> {
    let path = brand_path(project)?;
    let file = vault.file_of(&path, &[BRAND_EXT])?;
    let meta = match fs::metadata(&file) {
        Ok(meta) => meta,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(Error::Io(err)),
    };
    if meta.len() > MAX_BRAND_BYTES as u64 {
        return Err(Error::Invalid(format!(
            "{path} is too large for a brand kit"
        )));
    }
    let text = fs::read_to_string(&file).map_err(|err| match err.kind() {
        io::ErrorKind::InvalidData => Error::Invalid(format!("{path} is not UTF-8 text")),
        _ => Error::Io(err),
    })?;
    Ok(Some(BrandFile {
        path,
        project: project.map(|p| p.trim().to_owned()),
        hash: content_hash(&text),
        text,
        modified: modified_of(&meta),
    }))
}

/// The brand kit decks of `project` start from: the project's own, else the vault's, else none.
pub fn effective_brand(vault: &Vault, project: Option<&str>) -> Result<Option<BrandFile>> {
    if project.is_some()
        && let Some(own) = read_brand(vault, project)?
    {
        return Ok(Some(own));
    }
    read_brand(vault, None)
}

/// Keeps `text` (the editor wrote it) as the brand kit of `project`, or of the vault. The old text of a file
/// that is replaced stays in the vault's history.
pub fn save_brand(vault: &Vault, project: Option<&str>, text: &str) -> Result<BrandSaved> {
    brand_head(text)?;
    let path = brand_path(project)?;
    let file = vault.file_of(&path, &[BRAND_EXT])?;
    if let Some(current) = read_brand(vault, project)? {
        if current.text == text {
            return Ok(BrandSaved {
                path,
                replaced: true,
                unchanged: true,
            });
        }
        crate::atomic::write_atomic(&file, text.as_bytes())?;
        return Ok(BrandSaved {
            path,
            replaced: true,
            unchanged: false,
        });
    }
    crate::atomic::create_atomic(&file, text.as_bytes())?;
    Ok(BrandSaved {
        path,
        replaced: false,
        unchanged: false,
    })
}
