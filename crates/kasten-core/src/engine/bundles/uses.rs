//! What the files of a project refer to: pictures, files and PDFs, other notes (counted
//! when they are outside the project), the works their pages cite, and the tags their
//! notes carry. Read out of notes, whiteboards and decks the way the rest of the app
//! reads them (image references, links, board cards).

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;

use super::super::Kasten;
use super::super::asset_files;
use crate::assets::refs::{Ref, image_refs, resolve_link};
use crate::board::Canvas;
use crate::cite;
use crate::import::{Link, rewrite_links};
use crate::links::{Directory, Place, Resolution};
use crate::note::{NoteMeta, meta_for};

/// What the project's files refer to, found as they are read.
#[derive(Default)]
pub(super) struct Found {
    pub assets: BTreeSet<String>,
    pub sources: BTreeSet<String>,
    pub tags: BTreeSet<String>,
    pub keys: BTreeSet<String>,
    pub outside: usize,
}

/// The vault's files that a link can name by file name alone, and its notes.
pub(super) struct Lookup<'a> {
    /// `projects/<folder>/`.
    pub own: String,
    folder: &'a str,
    by_name: HashMap<String, Vec<String>>,
    directory: Directory<'a>,
}

impl Found {
    /// Notes a path that a file of the project refers to.
    pub fn path(&mut self, path: &str, own: &str) {
        let lower = path.to_ascii_lowercase();
        if path.starts_with("assets/") {
            self.assets.insert(path.to_owned());
        } else if path.starts_with("sources/") && lower.ends_with(".pdf") {
            self.sources.insert(path.to_owned());
        } else if !path.starts_with(own) && (lower.ends_with(".md") || lower.ends_with(".canvas")) {
            self.outside += 1;
        }
    }

    /// The PDFs a text names by their path in `sources/`, in links or in frontmatter.
    pub fn pdfs_in(&mut self, text: &str) {
        let lower = text.to_ascii_lowercase();
        let mut from = 0;
        while let Some(at) = lower[from..].find("sources/") {
            let start = from + at;
            from = start + "sources/".len();
            if lower[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '-' || c == '_')
            {
                continue;
            }
            let end = lower[start..]
                .find([
                    '"', '\'', '\n', '\r', ')', ']', '|', '#', '>', '<', ',', '}', '?',
                ])
                .map_or(lower.len(), |e| start + e);
            let path = text[start..end].replace("%20", " ");
            if path.to_ascii_lowercase().ends_with(".pdf") {
                self.sources.insert(path);
            }
        }
    }
}

/// What a note refers to: pictures, files, PDFs, other notes, works, tags.
pub(super) fn note(path: &str, text: &str, lookup: &Lookup, found: &mut Found) {
    found.keys.extend(cite::keys_in(text));
    found.tags.extend(meta_for(path, text, 0).tags);
    found.pdfs_in(text);
    for found_ref in image_refs(path, text) {
        match found_ref {
            Ref::Path(p) => found.path(&p, &lookup.own),
            Ref::Name(name) => {
                for p in lookup
                    .by_name
                    .get(&name.to_lowercase())
                    .into_iter()
                    .flatten()
                {
                    found.path(p, &lookup.own);
                }
            }
        }
    }
    let here = Place {
        path,
        project: Some(lookup.folder),
    };
    rewrite_links(text, |link| {
        match link {
            Link::Markdown { destination, .. } => {
                if let Some(p) = resolve_link(path, destination) {
                    found.path(&p, &lookup.own);
                }
            }
            Link::Wiki { target, .. } => {
                let target = target.trim();
                let lower = target.to_ascii_lowercase();
                let attachment = target.rsplit_once('.').is_some_and(|(_, ext)| {
                    !ext.is_empty()
                        && ext.len() <= 6
                        && ext.bytes().all(|b| b.is_ascii_alphanumeric())
                        && ext != "md"
                });
                if attachment && target.contains('/') {
                    if let Some(p) = resolve_link("", target) {
                        found.path(&p, &lookup.own);
                    }
                } else if attachment {
                    for p in lookup.by_name.get(&lower).into_iter().flatten() {
                        found.path(p, &lookup.own);
                    }
                } else {
                    match lookup.directory.resolve(target, here) {
                        Resolution::Note(meta) if !meta.path.starts_with(&lookup.own) => {
                            found.outside += 1;
                        }
                        Resolution::Ambiguous(all)
                            if all.iter().all(|m| !m.path.starts_with(&lookup.own)) =>
                        {
                            found.outside += 1;
                        }
                        _ => {}
                    }
                }
            }
        }
        None
    });
}

/// What a board's cards point at.
pub(super) fn board(text: &str, own: &str, found: &mut Found) {
    let Ok(canvas) = Canvas::parse(text) else {
        return;
    };
    found.pdfs_in(text);
    for node in canvas.nodes() {
        if let Some(file) = node.get("file").and_then(Value::as_str)
            && let Some(p) = resolve_link("", file)
        {
            found.path(&p, own);
        }
    }
}

/// The vault's notes and files, for resolving what a link names.
pub(super) fn lookup<'a>(kasten: &Kasten, metas: &'a [NoteMeta], folder: &'a str) -> Lookup<'a> {
    let mut by_name: HashMap<String, Vec<String>> = HashMap::new();
    for file in asset_files::walk(&kasten.vault) {
        let name = file
            .rel
            .rsplit('/')
            .next()
            .unwrap_or(&file.rel)
            .to_lowercase();
        by_name.entry(name).or_default().push(file.rel);
    }
    for file in kasten.vault.files(".pdf").unwrap_or_default() {
        if file.path.starts_with("sources/") {
            let name = file
                .path
                .rsplit('/')
                .next()
                .unwrap_or(&file.path)
                .to_lowercase();
            by_name.entry(name).or_default().push(file.path);
        }
    }
    Lookup {
        own: format!("projects/{folder}/"),
        folder,
        by_name,
        directory: Directory::new(metas),
    }
}
