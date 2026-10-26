//! Setups a person saved from a project: `templates/setups/<slug>.yaml` and,
//! beside it, a folder `templates/setups/<slug>/` of skeleton pages
//! (`pages/<name>.md`) and tag schemas (`vault/tags/<name>.yaml`). This file
//! reads them back: the list of saved setups, and a saved setup as the same
//! `Loaded` the built-in ones give, so applying one goes through the code a
//! built-in setup does. Everything a saved file names is checked here, since
//! a vault can come from anywhere: a file name that is not one plain
//! `pages/<name>.md` or `vault/tags/<name>.yaml` is refused and nothing is
//! read or written for it. How one is saved is in `setup_save`, how it is
//! renamed and deleted in `setup_manage`.

use std::fs;

use serde_json::{Map, Value};

use super::setups::{Manifest, SETUPS, SetupInfo, VAULT, manifest};
use crate::error::{Error, Result};
use crate::loose::Loose;
use crate::slug::{slugify, windows_device};
use crate::vault::Vault;

/// Where saved setups live.
pub(super) const DIR: &str = "templates/setups";
/// What an id of a saved setup starts with.
pub(super) const PREFIX: &str = "saved:";
/// The most skeleton pages a setup keeps.
pub(super) const MAX_PAGES: usize = 60;
/// The most one file of a setup may hold, in bytes.
pub(super) const MAX_FILE_BYTES: usize = 100 * 1024;
/// The most a whole setup may hold, in bytes.
pub(super) const MAX_TOTAL_BYTES: usize = 1024 * 1024;
/// The most a setup's name may be, in characters.
pub(super) const MAX_NAME_CHARS: usize = 100;
/// The longest page file name a setup may hold, in bytes (a disk's own limit is 255).
const MAX_PAGE_NAME_BYTES: usize = 200;
/// The largest manifest read.
const MAX_MANIFEST_BYTES: u64 = 200 * 1024;
/// The home of a setup with no pages: the project's own page.
pub(super) const PROJECT_PAGE: &str = "_project.md";

/// A setup's files as `plan_setup` takes them: its manifest, and each file
/// by its path relative to the project folder (`vault/…` for a file that
/// goes to the vault) with its raw text.
pub(super) struct Loaded {
    pub manifest: Manifest,
    pub files: Vec<(String, String)>,
}

pub(super) fn yaml_path(slug: &str) -> String {
    format!("{DIR}/{slug}.yaml")
}

pub(super) fn folder_path(slug: &str) -> String {
    format!("{DIR}/{slug}")
}

/// A name that is one plain file name: what `slugify` makes of itself.
pub(super) fn plain(name: &str) -> bool {
    !name.is_empty() && slugify(name) == name
}

/// The slug of a saved setup's id, if the id is one.
pub(super) fn slug_of(id: &str) -> Option<&str> {
    id.strip_prefix(PREFIX).filter(|slug| plain(slug))
}

pub(super) fn no_such(id: &str) -> Error {
    Error::Invalid(format!("There is no setup “{id}”"))
}

/// Whether `rel` is a skeleton page a setup may hold: `pages/<name>.md`.
pub(super) fn page_ok(rel: &str) -> bool {
    let Some(name) = rel.strip_prefix("pages/") else {
        return false;
    };
    let Some(stem) = name.strip_suffix(".md") else {
        return false;
    };
    !stem.is_empty()
        && name.len() <= MAX_PAGE_NAME_BYTES
        && !name.starts_with(['.', '_'])
        && !name.contains(['/', '\\', ':', '\0', '*', '?', '"', '<', '>', '|'])
        && !name.chars().any(char::is_control)
        && !windows_device(stem)
        && !name.ends_with([' ', '.'])
        && stem.trim() == stem
}

/// Whether `name` is a tag schema's file stem a setup may hold.
pub(super) fn tag_ok(name: &str) -> bool {
    plain(name) && !windows_device(name)
}

/// What a saved setup says of itself, read from its YAML. Keys it does not
/// know are ignored here and never touched.
pub(super) struct Saved {
    pub manifest: Manifest,
    /// The pages it names, those it may hold only.
    pub pages: Vec<String>,
    pub tags: Vec<String>,
    /// The first entry (a page, a tag or the home) it may not name.
    pub refused: Option<String>,
}

fn text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_owned()),
        _ => None,
    }
}

/// The entries of a list of names; one that is not text is refused as it reads.
fn entries(value: Option<&Value>, refused: &mut Option<String>) -> Vec<String> {
    let Some(Value::Array(list)) = value else {
        if let Some(other) = value.filter(|v| !v.is_null()) {
            refused.get_or_insert_with(|| other.to_string());
        }
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in list {
        match item {
            Value::String(s) => out.push(s.clone()),
            other => {
                refused.get_or_insert_with(|| other.to_string());
            }
        }
    }
    out
}

/// Reads the manifest text of the saved setup `slug`.
pub(super) fn parse(slug: &str, yaml: &str) -> Result<Saved> {
    let Loose(value) = serde_saphyr::from_str::<Loose>(yaml).map_err(|_| {
        Error::Invalid(format!(
            "The setup “{slug}” is not a YAML file KastenFlow can read"
        ))
    })?;
    let Value::Object(map) = value else {
        return Err(Error::Invalid(format!(
            "The setup “{slug}” is not a list of keys"
        )));
    };
    let mut refused = None;
    let mut pages = Vec::new();
    for rel in entries(map.get("pages"), &mut refused) {
        if page_ok(&rel) {
            if pages.contains(&rel) {
                continue;
            }
            // Two names a disk that ignores case reads as one file are refused:
            // the second would be taken for the first.
            if pages.iter().any(|p| p.to_lowercase() == rel.to_lowercase()) {
                refused.get_or_insert(rel);
            } else {
                pages.push(rel);
            }
        } else {
            refused.get_or_insert(rel);
        }
    }
    let mut tags = Vec::new();
    for name in entries(map.get("tags"), &mut refused) {
        if tag_ok(&name) {
            if !tags.contains(&name) {
                tags.push(name);
            }
        } else {
            refused.get_or_insert(name);
        }
    }
    let home = text(map.get("home")).unwrap_or_else(|| PROJECT_PAGE.to_owned());
    if home != PROJECT_PAGE && !page_ok(&home) {
        refused.get_or_insert(home.clone());
    }
    let props = match map.get("props") {
        Some(Value::Object(props)) => props.clone(),
        _ => Map::new(),
    };
    Ok(Saved {
        manifest: Manifest {
            icon: text(map.get("icon")).unwrap_or_else(|| "🗂️".to_owned()),
            name: text(map.get("name")).unwrap_or_else(|| slug.to_owned()),
            summary: text(map.get("summary")).unwrap_or_default(),
            home,
            props,
        },
        pages,
        tags,
        refused,
    })
}

/// The manifest file of `slug`, as text; none when there is none.
fn manifest_text(vault: &Vault, slug: &str) -> Result<Option<String>> {
    let file = vault.file_of(&yaml_path(slug), &[".yaml"])?;
    match fs::symlink_metadata(&file) {
        Ok(meta) if meta.is_file() => {
            if meta.len() > MAX_MANIFEST_BYTES {
                return Err(Error::Invalid(format!(
                    "The setup “{slug}” is too large to read"
                )));
            }
            Ok(Some(fs::read_to_string(&file).map_err(|_| {
                Error::Invalid(format!("The setup “{slug}” is not text"))
            })?))
        }
        _ => Ok(None),
    }
}

/// A file of a saved setup, read with the size limit.
fn read_file(vault: &Vault, slug: &str, rel: &str, exts: &[&str]) -> Result<String> {
    let path = format!("{DIR}/{slug}/{rel}");
    let file = vault.file_of(&path, exts)?;
    let meta = fs::symlink_metadata(&file).map_err(|_| {
        Error::Invalid(format!(
            "The setup “{slug}” lists {rel}, which is not there"
        ))
    })?;
    if !meta.is_file() {
        return Err(Error::Invalid(format!(
            "The setup “{slug}” lists {rel}, which is not a file"
        )));
    }
    if meta.len() as usize > MAX_FILE_BYTES {
        return Err(Error::Invalid(format!(
            "{rel} in the setup “{slug}” is too large to use (at most {} KB)",
            MAX_FILE_BYTES / 1024
        )));
    }
    fs::read_to_string(&file)
        .map_err(|_| Error::Invalid(format!("{rel} in the setup “{slug}” is not text")))
}

/// The setup `id`, built-in or saved, ready to plan.
pub(super) fn load(vault: &Vault, id: &str) -> Result<Loaded> {
    if id.starts_with(PREFIX) {
        let slug = slug_of(id).ok_or_else(|| no_such(id))?;
        return load_saved(vault, slug, id);
    }
    let setup = SETUPS
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| no_such(id))?;
    Ok(Loaded {
        manifest: manifest(setup),
        files: setup
            .files
            .iter()
            .map(|(path, raw)| ((*path).to_owned(), (*raw).to_owned()))
            .collect(),
    })
}

fn load_saved(vault: &Vault, slug: &str, id: &str) -> Result<Loaded> {
    let yaml = manifest_text(vault, slug)?.ok_or_else(|| no_such(id))?;
    let saved = parse(slug, &yaml)?;
    if let Some(entry) = saved.refused {
        return Err(Error::Invalid(format!(
            "The setup “{slug}” names a file it may not use: {entry}"
        )));
    }
    if saved.pages.len() > MAX_PAGES {
        return Err(Error::Invalid(format!(
            "The setup “{slug}” names more than {MAX_PAGES} pages"
        )));
    }
    let mut files = Vec::new();
    let mut total = 0;
    for rel in &saved.pages {
        let raw = read_file(vault, slug, rel, &[".md"])?;
        total += raw.len();
        files.push((rel.clone(), raw));
    }
    for name in &saved.tags {
        let rel = format!("{VAULT}tags/{name}.yaml");
        let raw = read_file(vault, slug, &rel, &[".yaml"])?;
        // The file is named for the tag it makes; a schema that says it is
        // another tag would take that tag's name once applied.
        let declared = serde_saphyr::from_str::<crate::loose::Loose>(&raw)
            .ok()
            .and_then(|loose| {
                loose
                    .0
                    .get("name")
                    .and_then(|v| v.as_str().map(str::to_owned))
            });
        if let Some(declared) = declared
            && !declared.trim().eq_ignore_ascii_case(name)
        {
            return Err(Error::Invalid(format!(
                "The setup “{slug}” holds the tag file {name}.yaml, which says it is the tag “{}”",
                declared.trim()
            )));
        }
        total += raw.len();
        files.push((rel, raw));
    }
    if total > MAX_TOTAL_BYTES {
        return Err(Error::Invalid(format!(
            "The setup “{slug}” is too large to use"
        )));
    }
    Ok(Loaded {
        manifest: saved.manifest,
        files,
    })
}

/// How many files the setup `id` writes, for the limit on notes an agent
/// changes in ten minutes; none for a setup that cannot be read.
pub(super) fn file_count(vault: &Vault, id: &str) -> usize {
    load(vault, id).map_or(0, |loaded| loaded.files.len())
}

fn info_of(slug: &str, saved: Saved) -> SetupInfo {
    SetupInfo {
        id: format!("{PREFIX}{slug}"),
        icon: saved.manifest.icon,
        name: saved.manifest.name,
        summary: saved.manifest.summary,
        files: {
            let mut pages = saved.pages;
            pages.sort();
            pages
        },
        tags: {
            let mut tags = saved.tags;
            tags.sort();
            tags
        },
        saved: true,
    }
}

/// One saved setup as the app lists it, from the file as it is now.
pub(super) fn info(vault: &Vault, slug: &str) -> Result<SetupInfo> {
    let id = format!("{PREFIX}{slug}");
    let yaml = manifest_text(vault, slug)?.ok_or_else(|| no_such(&id))?;
    Ok(info_of(slug, parse(slug, &yaml)?))
}

/// Every saved setup, by name. A file that is no setup is left out; one
/// that names a file it may not is listed, without that file, and refused
/// when it is used.
pub(super) fn saved_infos(vault: &Vault) -> Result<Vec<SetupInfo>> {
    // A folder that is a link is not followed.
    let Ok(dir) = vault.file_of(DIR, &[""]) else {
        return Ok(Vec::new());
    };
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let mut slugs = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(slug) = name.strip_suffix(".yaml").filter(|s| plain(s))
            && entry.file_type()?.is_file()
        {
            slugs.push(slug.to_owned());
        }
    }
    slugs.sort();
    let mut out: Vec<SetupInfo> = slugs
        .iter()
        .filter_map(|slug| info(vault, slug).ok())
        .collect();
    out.sort_by_cached_key(|s| (s.name.to_lowercase(), s.id.clone()));
    Ok(out)
}
