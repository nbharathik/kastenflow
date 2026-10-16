//! The pictures a drawn deck names, read from the vault. The browser is never
//! on a network and never on the disk: it is given the bytes of the pictures
//! the deck's own text names and nothing else, each from `assets/`, a few
//! megabytes at a time, however the deck spells a path.

use std::collections::HashMap;
use std::sync::Mutex;

use kasten_core::Kasten;
use kasten_core::agent::ChangeSet;
use slides_core::Deck;
use slides_render::Media;
use slides_render::media::inside;

use crate::tools::locked;

/// The most picture bytes one drawing is given, in all.
pub(super) const MOST_BYTES: usize = 64 * 1024 * 1024;

/// The pictures of one deck, as the vault holds them (and, in a chat that
/// previews its changes, as the chat has staged them).
pub(super) struct VaultPictures {
    files: HashMap<String, Vec<u8>>,
    /// Pictures the deck names that were left out for want of room, with the sentence for each.
    pub left_out: Vec<String>,
}

/// Whether a deck may name `path`: a plain path under `assets/`.
fn in_assets(path: &str) -> bool {
    path.strip_prefix("assets/")
        .is_some_and(|name| !name.is_empty())
        && inside(path).is_some()
}

impl VaultPictures {
    /// Reads the pictures `deck` names, up to `MOST_BYTES` in all. A picture
    /// that is not in `assets/`, is not there, or does not fit is not given:
    /// the render host reports each as a picture it could not find.
    pub(super) fn load(
        kasten: &Kasten,
        stage: Option<&Mutex<ChangeSet>>,
        deck: &Deck,
    ) -> VaultPictures {
        let named = slides_core::canonical::write(deck)
            .map(|text| kasten_core::deck::images_of(&text))
            .unwrap_or_default();
        VaultPictures::of(named, |path| read(kasten, stage, path))
    }

    /// The same with the way to read a picture given, which is how it is tested.
    pub(super) fn of(
        named: Vec<String>,
        mut read: impl FnMut(&str) -> Option<Vec<u8>>,
    ) -> VaultPictures {
        let mut files = HashMap::new();
        let mut left_out = Vec::new();
        let mut total = 0usize;
        for path in named {
            if !in_assets(&path) {
                continue;
            }
            let Some(bytes) = read(&path) else {
                continue;
            };
            if total + bytes.len() > MOST_BYTES {
                left_out.push(format!(
                    "{path} was left out: a slide is drawn with at most {} MB of pictures in all.",
                    MOST_BYTES / 1024 / 1024
                ));
                continue;
            }
            total += bytes.len();
            files.insert(path, bytes);
        }
        VaultPictures { files, left_out }
    }

    #[cfg(test)]
    pub(super) fn paths(&self) -> Vec<&str> {
        let mut all: Vec<&str> = self.files.keys().map(String::as_str).collect();
        all.sort_unstable();
        all
    }
}

fn read(kasten: &Kasten, stage: Option<&Mutex<ChangeSet>>, path: &str) -> Option<Vec<u8>> {
    if let Some(set) = stage
        && let Ok(Some(bytes)) = kasten.staged_asset_bytes(&locked(set), path)
    {
        return Some(bytes);
    }
    kasten.read_asset(path).ok()
}

impl Media for VaultPictures {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        // The page can ask for any path; only what was loaded, under assets/, is answered.
        if !in_assets(path) {
            return None;
        }
        self.files.get(path).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(len: usize) -> Vec<u8> {
        vec![7; len]
    }

    #[test]
    fn only_plain_paths_under_assets_are_read_and_never_a_way_out_of_it() {
        let mut asked = Vec::new();
        let pictures = VaultPictures::of(
            [
                "assets/figure.png",
                "assets/deep/er/chart.svg",
                "../secret.png",
                "assets/../secret.png",
                "/etc/passwd",
                "C:/Users/me/photo.png",
                "assets\\back.png",
                "library/note.md",
                "assets/",
                "",
            ]
            .map(str::to_owned)
            .to_vec(),
            |path| {
                asked.push(path.to_owned());
                Some(bytes(3))
            },
        );
        assert_eq!(asked, ["assets/figure.png", "assets/deep/er/chart.svg"]);
        assert_eq!(
            pictures.paths(),
            ["assets/deep/er/chart.svg", "assets/figure.png"]
        );
        // The page cannot reach past what was loaded either.
        assert_eq!(pictures.read("assets/figure.png"), Some(bytes(3)));
        for path in [
            "../secret.png",
            "assets/../figure.png",
            "assets/other.png",
            "/assets/figure.png",
        ] {
            assert_eq!(pictures.read(path), None, "{path}");
        }
    }

    #[test]
    fn a_picture_that_is_missing_is_not_given_and_one_that_does_not_fit_is_said_to_be_left_out() {
        let mib = 1024 * 1024;
        let pictures = VaultPictures::of(
            vec![
                "assets/a.png".to_owned(),
                "assets/missing.png".to_owned(),
                "assets/b.png".to_owned(),
                "assets/c.png".to_owned(),
            ],
            |path| match path {
                "assets/a.png" => Some(bytes(40 * mib)),
                "assets/missing.png" => None,
                "assets/b.png" => Some(bytes(30 * mib)),
                _ => Some(bytes(24 * mib)),
            },
        );
        // 40 + 30 would pass 64, so the second is out; 40 + 24 is exactly 64, which fits.
        assert_eq!(pictures.paths(), ["assets/a.png", "assets/c.png"]);
        assert_eq!(pictures.left_out.len(), 1);
        assert!(
            pictures.left_out[0].starts_with("assets/b.png was left out")
                && pictures.left_out[0].contains("64 MB"),
            "{:?}",
            pictures.left_out
        );
        assert_eq!(pictures.read("assets/missing.png"), None);
    }
}
