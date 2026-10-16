//! Where the files of a bundle that are not the project's go in the vault, and what
//! that settles: a tag schema the vault has is kept; a picture, file or PDF the vault
//! has with the same bytes is used as it is, and one with the same name and other
//! bytes comes in under a free name.

use std::collections::HashSet;
use std::fs;

use slides_assets::{picture_path, sha256_hex, sidecar_path};

use super::manifest::ManifestFile;
use crate::engine::Kasten;
use crate::import::{ImportConflict, ImportConflictKind};
use crate::sources::sidecar_of;

/// How the text of a file is rewritten on its way in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum How {
    /// A page: ids, the project's folder, renamed files, renamed keys in its citations.
    Note,
    /// A whiteboard: ids, the project's folder, renamed files.
    Board,
    /// A deck: the same, and renamed keys in its citation elements.
    Deck,
    /// A picture's sidecar: a renamed key.
    Card,
    /// Another JSON file (comments, highlights): ids and files.
    Json,
    /// Written as it is.
    Plain,
}

/// One file to write: where it is in the bundle, where it goes, and the hash it must have.
#[derive(Debug, Clone)]
pub(crate) struct Move {
    pub from: String,
    pub to: String,
    pub sha256: String,
    pub how: How,
}

pub(super) fn conflict(
    kind: ImportConflictKind,
    what: impl Into<String>,
    resolution: impl Into<String>,
) -> ImportConflict {
    ImportConflict {
        kind,
        what: what.into(),
        resolution: resolution.into(),
    }
}

/// The first free `dir/stem-2.ext`, `-3`... in the vault and among the paths already given out.
fn free_path(kasten: &Kasten, path: &str, given: &HashSet<String>) -> String {
    let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
    let (stem, ext) = name
        .rsplit_once('.')
        .map_or((name, String::new()), |(s, e)| (s, format!(".{e}")));
    (2..)
        .map(|n| {
            let name = format!("{stem}-{n}{ext}");
            if dir.is_empty() {
                name
            } else {
                format!("{dir}/{name}")
            }
        })
        .find(|candidate| {
            !kasten.root().join(candidate).exists() && !given.contains(&candidate.to_lowercase())
        })
        .unwrap_or_else(|| path.to_owned())
}

/// The path of a sidecar's picture or PDF.
pub(super) fn owner_of(sidecar: &str, paths: &HashSet<&str>) -> Option<String> {
    if let Some(picture) = picture_path(sidecar) {
        return Some(picture);
    }
    let stem = sidecar.strip_suffix(".highlights.json")?;
    ["pdf", "PDF", "Pdf"]
        .iter()
        .map(|e| format!("{stem}.{e}"))
        .find(|candidate| paths.contains(candidate.as_str()))
}

/// Where the files outside the project go, and what that settles.
pub(super) struct Outside<'a> {
    pub kasten: &'a Kasten,
    pub given: HashSet<String>,
    pub moves: Vec<Move>,
    /// Files that came in under another name: the bundle's path, then the vault's.
    pub files: Vec<(String, String)>,
    pub conflicts: Vec<ImportConflict>,
    pub tags: usize,
    /// Pictures, files and PDFs written (their sidecars not counted).
    pub written: usize,
}

impl<'a> Outside<'a> {
    pub fn new(kasten: &'a Kasten) -> Outside<'a> {
        Outside {
            kasten,
            given: HashSet::new(),
            moves: Vec::new(),
            files: Vec::new(),
            conflicts: Vec::new(),
            tags: 0,
            written: 0,
        }
    }

    pub fn exists(&self, path: &str) -> bool {
        self.kasten.root().join(path).exists()
    }

    /// Whether the vault's file at `path` has the bytes the manifest says.
    fn same(&self, path: &str, file: &ManifestFile) -> bool {
        fs::read(self.kasten.root().join(path)).is_ok_and(|bytes| sha256_hex(&bytes) == file.sha256)
    }

    pub fn add(&mut self, file: &ManifestFile, to: String, how: How) {
        self.given.insert(to.to_lowercase());
        self.moves.push(Move {
            from: file.path.clone(),
            to,
            sha256: file.sha256.clone(),
            how,
        });
    }

    /// A tag's schema: the vault's is kept.
    pub fn tag(&mut self, file: &ManifestFile) {
        let path = file.path.clone();
        if !self.exists(&path) {
            self.add(file, path, How::Plain);
            self.tags += 1;
        } else if !self.same(&path, file) {
            let name = path
                .trim_start_matches("tags/")
                .trim_end_matches(".yaml")
                .to_owned();
            self.conflicts.push(conflict(
                ImportConflictKind::Tag,
                name,
                "Your schema for this tag differs from the bundle's, so yours was kept",
            ));
        }
    }

    /// A picture, file or PDF, and the sidecar that goes with it: used as it is when the
    /// vault has the same bytes under that name, renamed when it has others.
    pub fn owner(&mut self, file: &ManifestFile, card: Option<&ManifestFile>) {
        let path = file.path.clone();
        let source = path.starts_with("sources/");
        let to = if !self.exists(&path) && !self.given.contains(&path.to_lowercase()) {
            path.clone()
        } else if self.exists(&path) && self.same(&path, file) {
            return;
        } else {
            let new = free_path(self.kasten, &path, &self.given);
            self.files.push((path.clone(), new.clone()));
            self.conflicts.push(conflict(
                if source {
                    ImportConflictKind::Source
                } else {
                    ImportConflictKind::Asset
                },
                path.clone(),
                format!("Your {path} is a different file, so the bundle's was added as {new}"),
            ));
            new
        };
        self.add(file, to.clone(), How::Plain);
        self.written += 1;
        if let Some(card) = card {
            let new_card = if source {
                sidecar_of(&to).ok()
            } else {
                sidecar_path(&to)
            };
            if let Some(new_card) = new_card {
                self.add(card, new_card, if source { How::Json } else { How::Card });
            }
        }
    }
}
