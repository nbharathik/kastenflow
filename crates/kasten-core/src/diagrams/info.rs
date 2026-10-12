//! Diagrams in lists, and what a rename or a move did.

use serde::Serialize;

use super::files::{Preview, preview_of, read_source};
use super::format::check_xml;
use super::names::title_of;
use crate::error::Result;
use crate::note::content_hash;
use crate::vault::Vault;

/// A diagram in lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramInfo {
    pub path: String,
    pub title: String,
    /// The project folder it is in, if any.
    pub project: Option<String>,
    pub pages: usize,
    pub modified: u64,
    pub size: u64,
    pub preview: Preview,
    /// Why the source cannot be read, when it cannot. It is still listed, to
    /// be looked at or trashed.
    pub problem: Option<String>,
}

/// What a rename or a move did: where the source is now, every (from, to)
/// move of its files, and the pages and boards whose links were rewritten to
/// keep going to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramMoved {
    pub path: String,
    pub moves: Vec<(String, String)>,
    pub relinked: Vec<String>,
}

fn project_of(path: &str) -> Option<String> {
    let mut parts = path.split('/');
    (parts.next() == Some("projects"))
        .then(|| parts.next().map(str::to_owned))
        .flatten()
}

/// Every diagram, by title.
pub fn list(vault: &Vault) -> Result<Vec<DiagramInfo>> {
    let mut out = Vec::new();
    for file in vault.files(super::EXT)? {
        let (pages, preview, problem) = match read_source(vault, &file.path) {
            Ok((xml, _)) => match check_xml(&xml) {
                Ok(pages) => (
                    pages,
                    preview_of(vault, &file.path, &content_hash(&xml)),
                    None,
                ),
                Err(err) => (0, Preview::Missing, Some(err.to_string())),
            },
            Err(err) => (0, Preview::Missing, Some(err.to_string())),
        };
        out.push(DiagramInfo {
            title: title_of(&file.path),
            project: project_of(&file.path),
            modified: file.modified,
            size: file.size,
            path: file.path,
            pages,
            preview,
            problem,
        });
    }
    out.sort_by_cached_key(|d| (d.title.to_lowercase(), d.path.clone()));
    Ok(out)
}
