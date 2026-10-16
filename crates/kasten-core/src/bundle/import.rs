//! Planning the import of a bundle: everything the import will write, and what it
//! settled because the vault already has the same thing, worked out before anything
//! is written (`plan_import` shows it; `apply` writes it as one commit).
//!
//! - The project goes to a free folder (`free_project_slug`); path links into it are
//!   rewritten.
//! - A note whose id is taken in the vault gets a new id, and what refers to it follows.
//! - Pictures, PDFs and tag schemas the vault has are settled in `places`.
//! - The works the bundle cites are settled in `works`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use slides_assets::sha256_hex;

use super::manifest::{MANIFEST_FILE, Manifest};
use super::places::{How, Move, Outside, conflict, owner_of};
use super::works::{self, Bib};
use crate::engine::Kasten;
use crate::error::{Error, Result};
use crate::import::{ImportConflictKind, ImportKind, ImportSummary};
use crate::note::meta_for;
use crate::time::Instant;

fn refuse(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// An import worked out.
#[derive(Debug, Clone)]
pub(crate) struct Prepared {
    pub root: PathBuf,
    /// The project's folder in the bundle and in the vault.
    pub old_folder: String,
    pub slug: String,
    pub moves: Vec<Move>,
    /// Ids made new: the bundle's, then the vault's.
    pub ids: Vec<(String, String)>,
    /// Files that came in under another name: the bundle's path, then the vault's.
    pub files: Vec<(String, String)>,
    /// Keys that came in under another key.
    pub keys: Vec<(String, String)>,
    pub bib: Option<Bib>,
    pub summary: ImportSummary,
    pub message: String,
}

/// The extension of a path, lower case.
fn ext(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Checks the bundle's files are really there as the manifest says, and gives the texts of
/// the project's pages, whiteboards and decks. Anything missing, changed, linked or not a
/// file is refused, so nothing is imported from a bundle that was altered or damaged.
fn read_verified(root: &Path, manifest: &Manifest) -> Result<HashMap<String, String>> {
    let own = format!("projects/{}/", manifest.project.folder);
    let mut texts = HashMap::new();
    for file in &manifest.files {
        let changed = || {
            refuse(format!(
                "{} does not match the bundle's manifest: the bundle was changed or damaged after it was made. Nothing was imported",
                file.path
            ))
        };
        let abs = root.join(file.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let meta = fs::symlink_metadata(&abs).map_err(|_| {
            refuse(format!(
                "The bundle lists {} but it is not in the folder. Nothing was imported",
                file.path
            ))
        })?;
        if !meta.is_file() {
            return Err(refuse(format!(
                "{} in the bundle is not a plain file",
                file.path
            )));
        }
        if meta.len() != file.bytes {
            return Err(changed());
        }
        let bytes = fs::read(&abs)?;
        if sha256_hex(&bytes) != file.sha256 {
            return Err(changed());
        }
        if file.path.starts_with(&own)
            && matches!(ext(&file.path).as_str(), "md" | "canvas" | "deck")
            && let Ok(text) = String::from_utf8(bytes)
        {
            texts.insert(file.path.clone(), text);
        }
    }
    Ok(texts)
}

/// How many files in the folder are not in the manifest (hidden ones and the manifest aside).
fn unlisted(root: &Path, manifest: &Manifest) -> usize {
    fn walk(dir: &Path, prefix: &str, listed: &HashSet<&str>, count: &mut usize) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() && name != ".git" {
                walk(&entry.path(), &rel, listed, count);
            } else if kind.is_file()
                && !listed.contains(rel.as_str())
                && rel != MANIFEST_FILE
                && !name.starts_with('.')
            {
                *count += 1;
            }
        }
    }
    let listed: HashSet<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    let mut count = 0;
    walk(root, "", &listed, &mut count);
    count
}

/// "8 notes, 1 board, 3 files", leaving out what is none.
fn counts(summary: &ImportSummary) -> String {
    let parts: Vec<String> = [
        (summary.notes, "note", "notes"),
        (summary.boards, "board", "boards"),
        (summary.files, "file", "files"),
        (summary.tags, "tag", "tags"),
    ]
    .into_iter()
    .filter(|(n, _, _)| *n > 0)
    .map(|(n, one, many)| format!("{n} {}", if n == 1 { one } else { many }))
    .collect();
    if parts.is_empty() {
        "nothing".to_owned()
    } else {
        parts.join(", ")
    }
}

/// Works out the import of the bundle in `root`: it is verified, then planned.
pub(crate) fn prepare(kasten: &Kasten, root: &Path, now: Instant) -> Result<Prepared> {
    let text = fs::read_to_string(root.join(MANIFEST_FILE)).map_err(|_| {
        refuse(format!(
            "This folder is not a KastenFlow bundle: it has no {MANIFEST_FILE}"
        ))
    })?;
    let manifest = Manifest::parse(&text)?;
    let texts = read_verified(root, &manifest)?;
    let old = manifest.project.folder.clone();
    let own = format!("projects/{old}/");
    let slug = kasten.free_project_slug(&old);
    let mut conflicts = Vec::new();
    if slug != old {
        conflicts.push(conflict(
            ImportConflictKind::Project,
            format!("projects/{old}"),
            format!("Your vault has that project folder already, so this one was added as projects/{slug}"),
        ));
    }

    // Notes whose ids the vault has get new ones.
    let mut ids: Vec<(String, String)> = Vec::new();
    let mut pages: Vec<&String> = texts.keys().filter(|p| ext(p) == "md").collect();
    pages.sort();
    for path in pages {
        if let Some(id) = meta_for(path, &texts[path], 0).id
            && kasten.index().by_id(&id)?.is_some()
            && !ids.iter().any(|(known, _)| *known == id)
        {
            ids.push((id, crate::ulid_at(now.millis)));
        }
    }
    if !ids.is_empty() {
        conflicts.push(conflict(
            ImportConflictKind::Id,
            if ids.len() == 1 {
                "1 note".to_owned()
            } else {
                format!("{} notes", ids.len())
            },
            "Your vault has notes with these ids already, so they were given new ones",
        ));
    }

    // Files: the project's, then the others.
    let all: HashSet<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    let attached = |path: &str| path.starts_with("assets/") || path.starts_with("sources/");
    let mut cards = HashMap::new();
    for file in manifest.files.iter().filter(|f| attached(&f.path)) {
        if let Some(owner) = owner_of(&file.path, &all)
            && all.contains(owner.as_str())
        {
            cards.insert(owner, file);
        }
    }
    let card_paths: HashSet<&str> = cards.values().map(|f| f.path.as_str()).collect();
    let mut outside = Outside::new(kasten);
    let mut moves = Vec::new();
    let (mut notes, mut boards, mut other) = (0usize, 0usize, 0usize);
    for file in &manifest.files {
        let path = file.path.as_str();
        if let Some(rest) = path.strip_prefix(&own) {
            let how = match ext(path).as_str() {
                "md" => How::Note,
                "canvas" => How::Board,
                "deck" => How::Deck,
                "json" => How::Json,
                _ => How::Plain,
            };
            match how {
                How::Note if rest != "_project.md" => notes += 1,
                How::Note => {}
                How::Board => boards += 1,
                _ if rest.ends_with(".comments.json") || rest.ends_with(".highlights.json") => {}
                _ => other += 1,
            }
            moves.push(Move {
                from: file.path.clone(),
                to: format!("projects/{slug}/{rest}"),
                sha256: file.sha256.clone(),
                how,
            });
        } else if path.starts_with("tags/") {
            outside.tag(file);
        } else if attached(path) && !card_paths.contains(path) {
            if owner_of(path, &all).is_some() {
                // A sidecar whose picture is not in the bundle: written if the vault lacks it.
                if !outside.exists(path) {
                    let how = if path.starts_with("sources/") {
                        How::Json
                    } else {
                        How::Card
                    };
                    outside.add(file, path.to_owned(), how);
                }
            } else {
                outside.owner(file, cards.get(path).copied());
            }
        }
    }
    moves.extend(std::mem::take(&mut outside.moves));
    conflicts.extend(std::mem::take(&mut outside.conflicts));

    // The works.
    let works = if all.contains("references.bib") {
        let text = fs::read_to_string(root.join("references.bib"))
            .map_err(|_| refuse("references.bib in the bundle is not UTF-8 text"))?;
        works::plan(kasten, &text)?
    } else {
        works::Works {
            bib: None,
            keys: Vec::new(),
            conflicts: Vec::new(),
        }
    };
    conflicts.extend(works.conflicts);

    let mut warnings = manifest.outside.clone();
    let loose = unlisted(root, &manifest);
    if loose > 0 {
        warnings.push(format!(
            "{loose} file{} in the folder {} not part of the bundle and {} left out",
            if loose == 1 { "" } else { "s" },
            if loose == 1 { "is" } else { "are" },
            if loose == 1 { "was" } else { "were" },
        ));
    }
    let summary = ImportSummary {
        kind: ImportKind::Bundle,
        project: manifest.project.title.clone(),
        project_path: format!("projects/{slug}/_project.md"),
        notes,
        days: 0,
        days_appended: 0,
        boards,
        files: other + outside.written,
        tags: outside.tags,
        warnings,
        conflicts,
    };
    let message = format!(
        "import: KastenFlow bundle “{}” ({})",
        summary.project,
        counts(&summary)
    );
    Ok(Prepared {
        root: root.to_owned(),
        old_folder: old,
        slug,
        moves,
        ids,
        files: outside.files,
        keys: works.keys,
        bib: works.bib,
        summary,
        message,
    })
}
