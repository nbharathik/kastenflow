//! The bibliography of the vault: what the citations of pages and decks are
//! looked up in. It is the `.bib` files in the vault, read as they are, the
//! managed one first so its keys win; reading them into works is the citation
//! code's (slides-core), not the vault's. Also where a key is cited (pages,
//! decks, pictures), and, in `rename`, renaming a key everywhere in one commit.

mod rename;

use std::collections::{HashMap, HashSet};
use std::fs;

use slides_assets::Sidecar;

use super::Kasten;
use super::asset_files::{Card, read_card, walk};
use crate::bib::MANAGED;
use crate::cite::{self, CitingDeck, CitingPage, KeyUses};
use crate::deck::{self, cites::Cited};
use crate::error::Result;
use crate::note::meta_for;
use crate::vault::FileStat;

/// The most bibliography files read, the most bytes of one, and of all of them.
/// A file over the limit is left out whole, not cut in the middle of an entry.
pub const MAX_BIB_FILES: usize = 64;
pub const MAX_BIB_BYTES: u64 = 4 * 1024 * 1024;
const MAX_BIB_TOTAL: usize = 8 * 1024 * 1024;

/// One `.bib` file as read: its text, or why there is none.
pub(super) struct BibText {
    pub path: String,
    pub bytes: u64,
    pub text: Option<String>,
    /// Why the text is left out or only partly right.
    pub problem: Option<String>,
}

/// Whether a key can be handed to the search index as one phrase.
fn searchable(key: &str) -> bool {
    key.chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | ':' | '.' | '/' | '+'))
}

impl Kasten {
    /// The `.bib` files of the vault with their text, the managed file first and
    /// the rest in the order of their paths. Files in private or hidden folders,
    /// hidden files and links are not read; a file that is too big is listed
    /// without text.
    pub(super) fn read_bib_files(&self) -> Result<Vec<BibText>> {
        let mut files = self.vault.files(".bib")?;
        // The managed file first; the sort is stable, so the others keep their order.
        files.sort_by_key(|f| f.path != MANAGED);
        let mut out = Vec::new();
        let mut total = 0usize;
        for file in files.into_iter().take(MAX_BIB_FILES) {
            let Ok(path) = self.vault.file_of(&file.path, &[".bib"]) else {
                continue;
            };
            let listed = |text: Option<String>, problem: Option<&str>| BibText {
                path: file.path.clone(),
                bytes: file.size,
                text,
                problem: problem.map(str::to_owned),
            };
            if file.size > MAX_BIB_BYTES {
                out.push(listed(
                    None,
                    Some("It is over 4 MB, which is too big to read"),
                ));
                continue;
            }
            let Ok(bytes) = fs::read(path) else {
                continue;
            };
            if total + bytes.len() > MAX_BIB_TOTAL {
                out.push(listed(
                    None,
                    Some("The bibliography files together are too big to read"),
                ));
                break;
            }
            total += bytes.len();
            out.push(match String::from_utf8(bytes) {
                Ok(text) => listed(Some(text), None),
                Err(err) => listed(
                    Some(String::from_utf8_lossy(err.as_bytes()).into_owned()),
                    Some("It is not UTF-8 text, so it is read as far as it makes sense and is not edited"),
                ),
            });
        }
        Ok(out)
    }

    /// The text of every `.bib` file in the vault, one after another, a line
    /// between them: the managed file first, then the rest in the order of their
    /// paths. A key that is in two files is the first file's, since readers take
    /// the first. A vault with no `.bib` file has an empty bibliography.
    pub fn references(&self) -> Result<String> {
        let mut text = String::new();
        for file in self.read_bib_files()? {
            if let Some(found) = file.text {
                text.push_str(&found);
                text.push('\n');
            }
        }
        Ok(text)
    }

    /// Whether the index holds every page as it is on disk, so that it can narrow a search.
    fn index_is_current(&self, files: &[FileStat]) -> bool {
        let Ok(rows) = self.index().notes() else {
            return false;
        };
        if rows.len() != files.len() {
            return false;
        }
        let known: HashMap<&str, u64> =
            rows.iter().map(|n| (n.path.as_str(), n.modified)).collect();
        files
            .iter()
            .all(|f| known.get(f.path.as_str()) == Some(&f.modified))
    }

    /// The pages that cite `key`, with their text. The index narrows the pages
    /// looked at when it is up to date (templates are always looked at); each
    /// candidate is then read and scanned exactly.
    pub(super) fn pages_citing(&self, key: &str) -> Result<Vec<(String, String)>> {
        let files = self.vault.files(".md")?;
        let narrowed: Option<HashSet<String>> = (searchable(key) && self.index_is_current(&files))
            .then(|| self.index().search(&format!("\"{key}\""), 1_000_000))
            .transpose()?
            .map(|hits| hits.into_iter().map(|h| h.path).collect());
        let mut found = Vec::new();
        for file in &files {
            if let Some(hits) = &narrowed
                && !hits.contains(&file.path)
                && !file.path.starts_with("templates/")
            {
                continue;
            }
            let Ok(text) = fs::read_to_string(self.vault.root().join(&file.path)) else {
                continue;
            };
            if cite::count_of(&text, key) > 0 {
                found.push((file.path.clone(), text));
            }
        }
        Ok(found)
    }

    /// The decks that cite `key`, with their file and how.
    pub(super) fn decks_citing(&self, key: &str) -> Result<Vec<(deck::DeckFile, Cited)>> {
        let mut found = Vec::new();
        for file in self.vault.files(".deck")? {
            let Ok(deck) = deck::read_deck(&self.vault, &file.path) else {
                continue;
            };
            // A deck written by hand may spell a key with escapes; only plain keys are filtered by text.
            if key.is_ascii() && !deck.text.contains(key) {
                continue;
            }
            let cited = deck::cites::cited(&deck.text, key);
            if cited.slides + cited.layouts > 0 {
                found.push((deck, cited));
            }
        }
        Ok(found)
    }

    /// The pictures whose sidecar names `key` as their citation key: the picture's
    /// path, its sidecar's path and the sidecar.
    pub(super) fn assets_citing(&self, key: &str) -> Vec<(String, String, Sidecar)> {
        let mut found = Vec::new();
        for file in walk(&self.vault) {
            if let Ok(Card::Fine(card)) = read_card(&self.vault, &file.rel)
                && card.citation_key() == Some(key)
                && let Some(sidecar) = slides_assets::sidecar_path(&file.rel)
            {
                found.push((file.rel, sidecar, card));
            }
        }
        found
    }

    /// The pages, decks and pictures that cite `key`.
    pub fn reference_uses(&self, key: &str) -> Result<KeyUses> {
        let pages = self
            .pages_citing(key)?
            .into_iter()
            .map(|(path, text)| CitingPage {
                title: meta_for(&path, &text, 0).title,
                count: cite::count_of(&text, key),
                path,
            })
            .collect();
        let decks = self
            .decks_citing(key)?
            .into_iter()
            .map(|(file, cited)| CitingDeck {
                title: deck::title_at(&self.vault, &file.path),
                path: file.path,
                count: cited.slides,
                in_layouts: cited.layouts,
            })
            .collect();
        let assets = self
            .assets_citing(key)
            .into_iter()
            .map(|(path, ..)| path)
            .collect();
        Ok(KeyUses {
            key: key.to_owned(),
            pages,
            decks,
            assets,
        })
    }
}
