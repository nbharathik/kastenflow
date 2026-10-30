//! What a project's bundle holds: its folder with every sidecar, the pictures,
//! files and PDFs its notes, boards and decks use (each with its sidecar), the
//! tag schemas its notes use, and the works it cites, copied as written into
//! one `references.bib`. Nothing else of the vault: no history, `.kasten/`,
//! trash, chats or settings. Links to notes outside the project are counted.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use slides_assets::{Sidecar, sidecar_path};

use super::super::Kasten;
use super::uses::{Found, board, lookup, note};
use crate::bib::{copy, edit};
use crate::bundle::{
    BundleFileKind, BundleProject, Collected, MOST_FILE_BYTES, Planned, Source, check_path,
    plain_folder,
};
use crate::deck;
use crate::error::{Error, Result};
use crate::sources::sidecar_of;
use crate::vault::Vault;

fn refuse(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// Every file under `dir`, hidden ones and links left out, as bundle files of the project.
fn tree(dir: &Path, prefix: &str, out: &mut BTreeMap<String, Planned>) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        let rel = format!("{prefix}/{name}");
        if kind.is_dir() {
            tree(&entry.path(), &rel, out)?;
        } else if kind.is_file() {
            let bytes = entry.metadata()?.len();
            if bytes > MOST_FILE_BYTES {
                return Err(refuse(format!(
                    "{rel} is bigger than a bundle may hold (100 MB)"
                )));
            }
            out.insert(
                rel.clone(),
                Planned {
                    path: rel,
                    kind: BundleFileKind::Project,
                    bytes,
                    source: Source::File(entry.path()),
                },
            );
        }
    }
    Ok(())
}

/// A file of the vault that exists, as a bundle file.
fn present(
    vault: &Vault,
    path: &str,
    kind: BundleFileKind,
    out: &mut BTreeMap<String, Planned>,
) -> bool {
    let Ok(file) = vault.file_of(path, &[""]) else {
        return false;
    };
    let Ok(meta) = fs::symlink_metadata(&file) else {
        return false;
    };
    if !meta.is_file() || meta.len() > MOST_FILE_BYTES {
        return false;
    }
    out.insert(
        path.to_owned(),
        Planned {
            path: path.to_owned(),
            kind,
            bytes: meta.len(),
            source: Source::File(file),
        },
    );
    true
}

fn outside_sentence(n: usize) -> Vec<String> {
    match n {
        0 => Vec::new(),
        1 => vec!["1 link leads to a note outside the project".to_owned()],
        n => vec![format!("{n} links lead to notes outside the project")],
    }
}

/// Works out the bundle of the project in `projects/<folder>/`.
pub(super) fn collect(kasten: &Kasten, folder: &str) -> Result<Collected> {
    let vault = &kasten.vault;
    if !plain_folder(folder) {
        return Err(refuse(format!("“{folder}” is not the folder of a project")));
    }
    let page = format!("projects/{folder}/_project.md");
    let project_note = vault
        .read(&page)
        .map_err(|_| refuse(format!("There is no project in projects/{folder}/")))?;
    let mut files: BTreeMap<String, Planned> = BTreeMap::new();
    tree(
        &vault.root().join("projects").join(folder),
        &format!("projects/{folder}"),
        &mut files,
    )?;

    let metas = kasten.list()?;
    let lookup = lookup(kasten, &metas, folder);
    let mut found = Found::default();
    let project_files: Vec<(String, PathBuf)> = files
        .values()
        .filter_map(|f| match &f.source {
            Source::File(p) => Some((f.path.clone(), p.clone())),
            Source::Text(_) => None,
        })
        .collect();
    for (path, file) in &project_files {
        let lower = path.to_ascii_lowercase();
        let Ok(text) = fs::read_to_string(file) else {
            continue;
        };
        if lower.ends_with(".md") {
            note(path, &text, &lookup, &mut found);
        } else if lower.ends_with(".canvas") {
            board(&text, &lookup.own, &mut found);
        } else if lower.ends_with(".deck") {
            for image in deck::images_of(&text) {
                found.path(&image, &lookup.own);
            }
            found.keys.extend(deck::cites::keys(&text));
        }
    }

    // Pictures and files, each with its sidecar; the sidecar can name a work and a paper.
    for path in std::mem::take(&mut found.assets) {
        if !present(vault, &path, BundleFileKind::Asset, &mut files) {
            continue;
        }
        let Some(card_path) = sidecar_path(&path) else {
            continue;
        };
        if present(vault, &card_path, BundleFileKind::Asset, &mut files)
            && let Ok(text) = fs::read_to_string(vault.root().join(&card_path))
            && let Ok(card) = Sidecar::parse(&text)
        {
            found.keys.extend(card.citation_key().map(str::to_owned));
            if let Some(clip) = card.clip() {
                found.path(&clip.pdf, &lookup.own);
            }
        }
    }
    for path in std::mem::take(&mut found.sources) {
        if present(vault, &path, BundleFileKind::Source, &mut files)
            && let Ok(card) = sidecar_of(&path)
        {
            present(vault, &card, BundleFileKind::Source, &mut files);
        }
    }
    for tag in &found.tags {
        let path = format!("tags/{tag}.yaml");
        present(vault, &path, BundleFileKind::Tag, &mut files);
    }

    // The cited works, as written, from the first file that has each.
    let wanted: Vec<String> = found.keys.iter().cloned().collect();
    let mut references = String::new();
    let mut have: HashSet<String> = HashSet::new();
    for file in kasten.read_bib_files()? {
        let remaining: Vec<String> = wanted
            .iter()
            .filter(|k| !have.contains(*k))
            .cloned()
            .collect();
        let Some(text) = file.text.filter(|_| !remaining.is_empty()) else {
            continue;
        };
        for (key, chunk) in copy::pick(&text, Some(&remaining), &references).chunks {
            references = edit::append(&references, &chunk);
            have.insert(key);
        }
    }
    if !references.is_empty() {
        files.insert(
            "references.bib".to_owned(),
            Planned {
                path: "references.bib".to_owned(),
                kind: BundleFileKind::References,
                bytes: references.len() as u64,
                source: Source::Text(references),
            },
        );
    }
    // A file placed by hand in a smart page's folder that the folder may not hold (a program, a hidden
    // file) stays home: the import would refuse the whole bundle for it.
    let before = files.len();
    files.retain(|path, _| !unfit_for_a_smart_folder(path));
    let left_out = before - files.len();
    for path in files.keys() {
        check_path(path, folder)?;
    }
    let mut outside = outside_sentence(found.outside);
    if left_out > 0 {
        outside.push(format!(
            "{left_out} file{} a smart page may not have {} left out",
            if left_out == 1 { "" } else { "s" },
            if left_out == 1 { "was" } else { "were" }
        ));
    }
    Ok(Collected {
        project: BundleProject {
            folder: folder.to_owned(),
            title: project_note.meta.title,
            id: project_note.meta.id,
        },
        files: files.into_values().collect(),
        references: wanted
            .iter()
            .filter(|k| have.contains(*k))
            .cloned()
            .collect(),
        missing_references: wanted
            .iter()
            .filter(|k| !have.contains(*k))
            .cloned()
            .collect(),
        outside,
    })
}

/// Whether `path` is inside a smart page's folder and is a file that folder may
/// not hold.
fn unfit_for_a_smart_folder(path: &str) -> bool {
    let suffix = crate::smart::SMART_DIR_SUFFIX;
    let parts: Vec<&str> = path.split('/').collect();
    let Some(end) = parts[..parts.len() - 1]
        .iter()
        .position(|part| part.len() > suffix.len() && part.to_ascii_lowercase().ends_with(suffix))
    else {
        return false;
    };
    crate::smart::check_path(&parts[end + 1..].join("/")).is_err()
}
