//! LaTeX documents through the engine: the listing, the settings of one
//! document, and the words of `.tex` files for search. Nothing here depends
//! on the LaTeX plugin being on; the plugin decides what the app shows.

use std::collections::BTreeMap;
use std::fs;

use super::Kasten;
use crate::error::Result;
use crate::latex::{
    CONFIG_FILE, LatexConfig, LatexDoc, LatexFacts, MAX_SOURCE_BYTES, dir_of, doc_containing,
    find_docs, searchable, snippet_around,
};
use crate::search::Hit;

/// The documents, and every `.tex` file the walk found (path and size).
type Listing = (Vec<LatexDoc>, Vec<(String, u64)>);

impl Kasten {
    /// Every LaTeX document in the vault, by folder.
    pub fn latex_docs(&self) -> Result<Vec<LatexDoc>> {
        Ok(self.latex_listing()?.0)
    }

    /// `latex_docs` with the `.tex` files it walked.
    pub(super) fn latex_listing(&self) -> Result<Listing> {
        // The settings files ride along in the one walk (they are neither boards nor decks).
        let walked = self.walk_facts(&[".tex", CONFIG_FILE])?;
        let texs: Vec<(String, LatexFacts)> = walked
            .latex
            .iter()
            .map(|(stat, facts)| (stat.path.clone(), (**facts).clone()))
            .collect();
        let mut configs = BTreeMap::new();
        for stat in &walked.diagrams {
            let is_config =
                stat.path == CONFIG_FILE || stat.path.ends_with(&format!("/{CONFIG_FILE}"));
            if !is_config {
                continue;
            }
            configs.insert(dir_of(&stat.path).to_owned(), self.settings_at(&stat.path));
        }
        let sizes = walked
            .latex
            .iter()
            .map(|(stat, _)| (stat.path.clone(), stat.size))
            .collect();
        Ok((find_docs(&texs, &configs), sizes))
    }

    /// The settings file at `path`. One that cannot be read counts as locked:
    /// a flag meant to keep agents out must not come undone by a typo.
    fn settings_at(&self, path: &str) -> LatexConfig {
        let locked = || LatexConfig {
            locked: true,
            ..LatexConfig::default()
        };
        match fs::read_to_string(self.vault.root().join(path)) {
            Ok(text) => LatexConfig::try_parse(&text).unwrap_or_else(|_| locked()),
            Err(_) => locked(),
        }
    }

    /// The name of the first folder above the file at `path` whose settings
    /// lock it for agents, looking at every folder up to the vault's top (a
    /// document inside a locked one is locked too, and so is a folder whose
    /// settings name a root that is not there, or that differ in case on a
    /// vault that ignores case).
    pub(super) fn latex_locked_above(&self, path: &str) -> Option<String> {
        let mut dir = dir_of(path);
        while !dir.is_empty() {
            let settings = format!("{dir}/{CONFIG_FILE}");
            if fs::symlink_metadata(self.vault.root().join(&settings)).is_ok()
                && self.settings_at(&settings).locked
            {
                return Some(dir.rsplit('/').next().unwrap_or(dir).to_owned());
            }
            dir = dir_of(dir);
        }
        None
    }

    /// The document whose folder holds the file at `path`, if one does.
    pub fn latex_doc_of(&self, path: &str) -> Result<Option<LatexDoc>> {
        let docs = self.latex_docs()?;
        Ok(doc_containing(&docs, path).cloned())
    }

    /// The settings of the document in `folder` (the defaults for a folder
    /// without a settings file). A file that cannot be read is an error, not
    /// the defaults: the listing counts it as locked, and a screen must not
    /// show it as open.
    pub fn latex_config(&self, folder: &str) -> Result<LatexConfig> {
        let path = format!("{folder}/{CONFIG_FILE}");
        let file = self.vault.file_of(&path, &[".yaml"])?;
        match fs::read_to_string(file) {
            Ok(text) => LatexConfig::try_parse(&text),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(LatexConfig::default()),
            Err(_) => Err(crate::error::Error::Invalid(
                "kasten-latex.yaml could not be read; fix or remove it first".to_owned(),
            )),
        }
    }

    /// `.tex` files of documents that hold every word of `query`, as search
    /// hits; the index finds notes, so these are added after its hits. Only
    /// plain words count: filters (`tag:`, `before:`) are about notes.
    pub(super) fn latex_hits(&self, query: &str, limit: usize) -> Result<Vec<Hit>> {
        let (words, filters) = crate::index::parse_query(query);
        if words.is_empty() || filters != crate::index::Filters::default() || limit == 0 {
            return Ok(Vec::new());
        }
        let lowered: Vec<String> = words.iter().map(|w| w.to_lowercase()).collect();
        let (docs, texs) = self.latex_listing()?;
        let mut hits = Vec::new();
        for (path, size) in texs {
            if size as usize > MAX_SOURCE_BYTES || doc_containing(&docs, &path).is_none() {
                continue;
            }
            let Ok(text) = fs::read_to_string(self.vault.root().join(&path)) else {
                continue;
            };
            let plain = searchable(&text);
            let lower = plain.to_lowercase();
            if !lowered.iter().all(|w| lower.contains(w.as_str())) {
                continue;
            }
            hits.push(Hit {
                title: path.rsplit('/').next().unwrap_or(&path).to_owned(),
                snippet: snippet_around(&plain, &words[0], 90),
                path,
                icon: None,
                score: 0,
            });
            if hits.len() >= limit {
                break;
            }
        }
        Ok(hits)
    }
}
