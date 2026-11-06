//! The generator library: code pictures a person keeps for every deck, one small JSON file each in
//! `templates/generators/` of the vault (beside the layout library), where they can be seen, copied to
//! another vault and trashed. A file holds the code, the language, the inputs a picture declares and
//! the kind of picture it makes; the editor writes the text and core reads only the envelope (format,
//! version, id, label, language, output) and keeps the rest as it was given. A deck that uses one holds
//! its own copy of the code inside the picture; nothing here is read when a deck is opened.

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
pub const GENERATOR_FOLDER: &str = "templates/generators";
/// The ending of a library file.
pub const GENERATOR_EXT: &str = ".generator";
/// The `format` every library file states.
pub const GENERATOR_FORMAT: &str = "kasten-generator";
/// The largest library file core reads or writes: code, and the small data of its inputs.
pub const MAX_GENERATOR_BYTES: usize = 256 * 1024;

const MAX_ID: usize = 80;
const MAX_LABEL: usize = 80;

/// What lists need to know about a library file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratorHead {
    pub id: String,
    pub label: String,
    pub language: String,
    /// `svg` or `png`.
    pub output: String,
    pub version: u64,
}

/// A library file in lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorInfo {
    pub path: String,
    pub id: String,
    pub label: String,
    pub language: String,
    pub output: String,
    pub modified: u64,
    pub size: u64,
    /// Why the file cannot be used, when it cannot. It is still listed, to be looked at or trashed.
    pub problem: Option<String>,
}

/// A library file as it is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorFile {
    pub path: String,
    pub text: String,
    pub hash: String,
    pub modified: u64,
}

/// What saving a generator to the library did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorSaved {
    pub path: String,
    pub id: String,
    /// The file was there already (same id) and now holds the new text.
    pub replaced: bool,
    /// Nothing was written: the file already held this text.
    pub unchanged: bool,
}

fn not_a_generator(why: &str) -> Error {
    Error::Invalid(format!("Not a KastenFlow code picture: {why}"))
}

/// Reads the envelope of the library file in `text`, or says why it is not one.
pub fn generator_head(text: &str) -> Result<GeneratorHead> {
    if text.len() > MAX_GENERATOR_BYTES {
        return Err(not_a_generator("it is too large"));
    }
    let value: Value = serde_json::from_str(text).map_err(|_| not_a_generator("not JSON"))?;
    let Some(file) = value.as_object() else {
        return Err(not_a_generator("not an object"));
    };
    if file.get("format").and_then(Value::as_str) != Some(GENERATOR_FORMAT) {
        return Err(not_a_generator("its format is not kasten-generator"));
    }
    let version = file
        .get("formatVersion")
        .and_then(Value::as_u64)
        .filter(|v| *v >= 1)
        .ok_or_else(|| not_a_generator("it has no format version"))?;
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
        .ok_or_else(|| not_a_generator("it needs an id of letters, digits, - and _"))?
        .to_owned();
    let label = file
        .get("label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|l| !l.is_empty() && l.chars().count() <= MAX_LABEL && !l.contains(['\n', '\r']))
        .ok_or_else(|| not_a_generator("it needs a name of one line, 80 characters at most"))?
        .to_owned();
    let generator = file
        .get("generator")
        .and_then(Value::as_object)
        .ok_or_else(|| not_a_generator("it has no generator"))?;
    let language = generator
        .get("language")
        .and_then(Value::as_str)
        .filter(|l| *l == "js")
        .ok_or_else(|| not_a_generator("its language is not js"))?
        .to_owned();
    if generator
        .get("code")
        .and_then(Value::as_str)
        .is_none_or(|code| code.trim().is_empty())
    {
        return Err(not_a_generator("it has no code"));
    }
    let output = generator
        .get("output")
        .and_then(Value::as_str)
        .filter(|o| matches!(*o, "svg" | "png"))
        .ok_or_else(|| not_a_generator("its output is not svg or png"))?
        .to_owned();
    Ok(GeneratorHead {
        id,
        label,
        language,
        output,
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
    path.strip_prefix(GENERATOR_FOLDER)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// The library file at `path`, which must be a plain vault path in the library ending in `.generator`.
pub fn read_generator(vault: &Vault, path: &str) -> Result<GeneratorFile> {
    if !in_library(path) {
        return Err(Error::InvalidPath(path.to_owned()));
    }
    let file = vault.file_of(path, &[GENERATOR_EXT])?;
    let meta = fs::metadata(&file).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => Error::NotFound(path.to_owned()),
        _ => Error::Io(err),
    })?;
    if meta.len() > MAX_GENERATOR_BYTES as u64 {
        return Err(Error::Invalid(format!(
            "{path} is too large for a code picture"
        )));
    }
    let text = fs::read_to_string(&file).map_err(|err| match err.kind() {
        io::ErrorKind::InvalidData => Error::Invalid(format!("{path} is not UTF-8 text")),
        _ => Error::Io(err),
    })?;
    Ok(GeneratorFile {
        path: path.to_owned(),
        hash: content_hash(&text),
        text,
        modified: modified_of(&meta),
    })
}

/// Every library file, by name. One that cannot be used is listed with its problem.
pub fn list_generators(vault: &Vault) -> Result<Vec<GeneratorInfo>> {
    let mut out = Vec::new();
    for stat in vault.files_in(GENERATOR_FOLDER, GENERATOR_EXT)? {
        let stem = stat
            .path
            .rsplit('/')
            .next()
            .unwrap_or(&stat.path)
            .trim_end_matches(GENERATOR_EXT)
            .to_owned();
        let read = read_generator(vault, &stat.path).and_then(|f| generator_head(&f.text));
        out.push(match read {
            Ok(head) => GeneratorInfo {
                path: stat.path,
                id: head.id,
                label: head.label,
                language: head.language,
                output: head.output,
                modified: stat.modified,
                size: stat.size,
                problem: None,
            },
            Err(err) => GeneratorInfo {
                path: stat.path,
                id: String::new(),
                label: stem,
                language: String::new(),
                output: String::new(),
                modified: stat.modified,
                size: stat.size,
                problem: Some(err.to_string()),
            },
        });
    }
    out.sort_by_cached_key(|g| (g.label.to_lowercase(), g.path.clone()));
    Ok(out)
}

/// The path of the library file whose id is `id`, if there is one.
pub fn generator_path_of_id(vault: &Vault, id: &str) -> Result<Option<String>> {
    Ok(list_generators(vault)?
        .into_iter()
        .find(|g| g.problem.is_none() && g.id == id)
        .map(|g| g.path))
}

/// Keeps `text` (the editor wrote it) in the library. A file with the same id is replaced by it (the
/// old text stays in the vault's history); a new id makes a new file named for the label, numbered
/// when taken, and no other file is ever replaced.
pub fn save_generator(vault: &Vault, text: &str) -> Result<GeneratorSaved> {
    let head = generator_head(text)?;
    if let Some(path) = generator_path_of_id(vault, &head.id)? {
        let file = vault.file_of(&path, &[GENERATOR_EXT])?;
        let current = read_generator(vault, &path)?;
        if current.text == text {
            return Ok(GeneratorSaved {
                path,
                id: head.id,
                replaced: true,
                unchanged: true,
            });
        }
        crate::atomic::write_atomic(&file, text.as_bytes())?;
        return Ok(GeneratorSaved {
            path,
            id: head.id,
            replaced: true,
            unchanged: false,
        });
    }
    let stem = match slugify(&head.label) {
        s if s.is_empty() => "code-picture".to_owned(),
        s => s,
    };
    let path = free_file(vault, GENERATOR_FOLDER, &stem, GENERATOR_EXT);
    crate::atomic::create_atomic(&vault.file_of(&path, &[GENERATOR_EXT])?, text.as_bytes())?;
    Ok(GeneratorSaved {
        path,
        id: head.id,
        replaced: false,
        unchanged: false,
    })
}
