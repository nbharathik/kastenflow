//! What the LaTeX tools of an agent read: a document found by the name an
//! agent gives it, its source files, and what the last build said. Reads only;
//! agents change sources through the guarded write (`latex_agent.rs`).

use std::fs;
use std::time::SystemTime;

use super::Kasten;
use crate::error::{Error, Result};
use crate::latex::{self, LastBuild, LatexDoc, doc_containing, is_link};

/// The deepest folder of a document that is listed, and the most files.
const MAX_DEPTH: usize = 6;
const MAX_FILES: usize = 500;

fn none_called(wanted: &str) -> Error {
    Error::Invalid(format!(
        "No LaTeX document called “{wanted}”. latex_list shows the documents"
    ))
}

impl Kasten {
    /// The document an agent means by `reference`: its folder, its title (the
    /// folder's name, any case), its root file, or any file inside it.
    pub fn latex_find_doc(&self, reference: &str) -> Result<LatexDoc> {
        let wanted = reference.trim().trim_end_matches('/');
        if wanted.is_empty() {
            return Err(none_called(wanted));
        }
        let docs = self.latex_docs()?;
        if let Some(doc) = docs
            .iter()
            .find(|d| d.folder == wanted || d.main_path == wanted)
        {
            return Ok(doc.clone());
        }
        if let Some(doc) = doc_containing(&docs, wanted) {
            return Ok(doc.clone());
        }
        let lower = wanted.to_lowercase();
        let named: Vec<&LatexDoc> = docs
            .iter()
            .filter(|d| d.title.to_lowercase() == lower || d.folder.to_lowercase() == lower)
            .collect();
        match named.as_slice() {
            [one] => Ok((*one).clone()),
            [] => Err(none_called(wanted)),
            many => Err(Error::Invalid(format!(
                "Several LaTeX documents are called “{wanted}”: {}. Name the folder",
                many.iter()
                    .map(|d| d.folder.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))),
        }
    }

    /// Whether agents may not change the files of `doc`: its own settings lock
    /// it, or the settings of a folder above it do (a document inside a locked
    /// one is locked too).
    pub fn latex_is_locked(&self, doc: &LatexDoc) -> bool {
        doc.locked
            || self
                .latex_locked_above(&format!("{}/{}", doc.folder, doc.main))
                .is_some()
    }

    /// The source files of `doc` (`.tex`, `.sty`, `.cls`, `.bst`, `.bib`),
    /// relative to its folder, the root file first. Hidden files and links are
    /// not listed, and neither are the files of a document inside it.
    pub fn latex_files(&self, doc: &LatexDoc) -> Result<Vec<String>> {
        let docs = self.latex_docs()?;
        let base = self.vault.root().join(&doc.folder);
        let mut found = Vec::new();
        let mut stack = vec![(base.clone(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let Ok(meta) = fs::symlink_metadata(entry.path()) else {
                    continue;
                };
                if name.starts_with('.') || is_link(&meta) {
                    continue;
                }
                if meta.is_dir() {
                    if depth < MAX_DEPTH {
                        stack.push((entry.path(), depth + 1));
                    }
                } else if meta.is_file()
                    && latex::is_source_path(&name)
                    && let Ok(rel) = entry.path().strip_prefix(&base)
                {
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    let path = format!("{}/{rel}", doc.folder);
                    if doc_containing(&docs, &path).is_some_and(|d| d.folder == doc.folder) {
                        found.push(rel);
                    }
                }
            }
        }
        found.sort_by(|a, b| (*a != doc.main, a).cmp(&(*b != doc.main, b)));
        found.truncate(MAX_FILES);
        Ok(found)
    }

    /// What the last build of `doc` said (the app builds; its log is in the
    /// cache). Not built yet, or no log kept, gives `built: false`.
    pub fn latex_last_build(&self, doc: &LatexDoc) -> Result<LastBuild> {
        let base = self.vault.root().join(&doc.folder);
        let newest: Option<SystemTime> = self
            .latex_files(doc)?
            .iter()
            .filter_map(|f| fs::metadata(base.join(f)).and_then(|m| m.modified()).ok())
            .max();
        Ok(latex::read_last_build(self.vault.root(), doc, newest))
    }
}
