//! Where a picture is used, worked out by looking at every note, whiteboard
//! and deck, so it can never be out of date. One scan answers for all the
//! pictures at once; asking about one takes that scan too. A note, board or
//! deck that is as it was since the last scan is not read again (see
//! `file_cache`), so a repeat scan costs the walk of the vault.

use std::collections::{BTreeMap, BTreeSet};

use super::Kasten;
use super::asset_files::walk;
use crate::assets::refs::Ref;
use crate::assets::{AssetUsage, DeckUse, Place, SlideUse};
use crate::error::{Error, Result};

impl Kasten {
    /// Where the picture at `path` is used: the notes that show it, the
    /// boards with a card for it, and the slides of decks that place it.
    /// A picture that is not there (a broken link) is still reported where
    /// it is named.
    pub fn asset_usage(&self, path: &str) -> Result<AssetUsage> {
        if !path.starts_with("assets/") || path.ends_with('/') {
            return Err(Error::InvalidPath(path.to_owned()));
        }
        self.vault.file_of(path, &[""])?;
        Ok(self.assets_usage()?.remove(path).unwrap_or_default())
    }

    /// The use of every picture that is used, by path, from one look at the
    /// vault. A picture not in the map is not used anywhere.
    pub fn assets_usage(&self) -> Result<BTreeMap<String, AssetUsage>> {
        let mut out: BTreeMap<String, AssetUsage> = BTreeMap::new();
        let in_assets = |path: &str| path.starts_with("assets/");

        // Files in assets/ by name, for `![[name.png]]`.
        let mut by_name: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for found in walk(&self.vault) {
            let name = found
                .rel
                .rsplit('/')
                .next()
                .unwrap_or(&found.rel)
                .to_lowercase();
            by_name.entry(name).or_default().push(found.rel);
        }

        // Each note's references come from the cache while the file is as it was.
        for (file, note) in self.note_refs()? {
            if note.refs.is_empty() {
                continue;
            }
            // A note that names a picture twice, or by its name and its path, uses it once.
            let mut shown = BTreeSet::new();
            for found in &note.refs {
                shown.extend(match found {
                    Ref::Path(path) => vec![path.clone()],
                    Ref::Name(name) => by_name
                        .get(&name.to_lowercase())
                        .cloned()
                        .unwrap_or_default(),
                });
            }
            for path in shown.into_iter().filter(|p| in_assets(p)) {
                out.entry(path).or_default().notes.push(Place {
                    path: file.path.clone(),
                    title: note.title.clone(),
                });
            }
        }

        for (file, facts) in self.board_facts()? {
            // Its cards' files are sorted and without repeats already.
            for path in facts.files.iter().filter(|path| in_assets(path)) {
                out.entry(path.clone()).or_default().boards.push(Place {
                    path: file.path.clone(),
                    title: facts.title.clone(),
                });
            }
        }

        for (file, facts) in self.deck_facts()? {
            let Some(images) = &facts.images else {
                continue;
            };
            let title = &facts.title;
            let mut used: BTreeMap<&str, DeckUse> = BTreeMap::new();
            let fresh = || DeckUse {
                path: file.path.clone(),
                title: title.clone(),
                slides: Vec::new(),
                theme: false,
            };
            for (at, (id, paths)) in images.slides.iter().enumerate() {
                for path in paths.iter().filter(|p| in_assets(p)) {
                    used.entry(path.as_str())
                        .or_insert_with(&fresh)
                        .slides
                        .push(SlideUse {
                            number: at + 1,
                            id: id.clone(),
                        });
                }
            }
            for path in images.theme.iter().filter(|p| in_assets(p)) {
                used.entry(path.as_str()).or_insert_with(&fresh).theme = true;
            }
            for (path, deck_use) in used {
                out.entry(path.to_owned()).or_default().decks.push(deck_use);
            }
        }

        for usage in out.values_mut() {
            usage.notes.sort_by(|a, b| a.path.cmp(&b.path));
            usage.boards.sort_by(|a, b| {
                a.title
                    .to_lowercase()
                    .cmp(&b.title.to_lowercase())
                    .then_with(|| a.path.cmp(&b.path))
            });
            usage.decks.sort_by(|a, b| {
                a.title
                    .to_lowercase()
                    .cmp(&b.title.to_lowercase())
                    .then_with(|| a.path.cmp(&b.path))
            });
        }
        Ok(out)
    }
}
