//! The generator library through the engine: code pictures kept for every deck in
//! `templates/generators/` (deck/generator_library.rs). Saving is one commit that Undo takes back.
//! An agent never writes here on its own: the folder is in `templates/`, which agents may not write.
//! Nothing is ever deleted; a person trashes an entry with the vault's own file tools.

use std::fs;

use super::{Change, Kasten};
use crate::bridge::MAX_INPUT_BYTES;
use crate::deck::{self, GeneratorFile, GeneratorInfo, GeneratorSaved};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;

/// The kinds of file in `assets/` a code picture may read as text.
pub const TEXT_ASSET_EXTENSIONS: [&str; 6] = ["csv", "tsv", "txt", "json", "md", "svg"];

impl Kasten {
    /// A text file of `assets/` (a CSV kept beside the pictures) for a code picture to read: a plain
    /// vault path under `assets/` ending in one of [`TEXT_ASSET_EXTENSIONS`], at most 1 MB, UTF-8.
    /// Read-only; it is how the editor and the agent tools hand a program its inputs.
    pub fn read_text_asset(&self, path: &str) -> Result<String> {
        let lower = path.to_ascii_lowercase();
        let plain = lower.starts_with("assets/")
            && TEXT_ASSET_EXTENSIONS
                .iter()
                .any(|ext| lower.ends_with(&format!(".{ext}")));
        if !plain {
            return Err(Error::Invalid(format!(
                "`{path}` is not a text file of assets/. An asset input is a .csv, .tsv, .txt, .json, .md or .svg file there."
            )));
        }
        let file = self.vault.file_of(path, &[""])?;
        let meta = fs::metadata(&file)
            .ok()
            .filter(fs::Metadata::is_file)
            .ok_or_else(|| Error::NotFound(path.to_owned()))?;
        if meta.len() > MAX_INPUT_BYTES as u64 {
            return Err(Error::Invalid(format!(
                "`{path}` is larger than {} MB.",
                MAX_INPUT_BYTES / 1024 / 1024
            )));
        }
        let bytes = fs::read(&file)?;
        String::from_utf8(bytes).map_err(|_| Error::Invalid(format!("`{path}` is not text.")))
    }

    /// The code pictures in the library, by name. A file that cannot be used is listed with its problem.
    pub fn generator_library(&self) -> Result<Vec<GeneratorInfo>> {
        deck::list_generators(&self.vault)
    }

    /// The library file at `path`, with the hash it has.
    pub fn library_generator(&self, path: &str) -> Result<GeneratorFile> {
        deck::read_generator(&self.vault, path)
    }

    /// Keeps `text` (the editor writes it: see deck/generator_library.rs) in the library. The file with
    /// its id is replaced by it, the old text staying in the history; a new id makes a new file. One commit.
    pub fn save_library_generator(
        &self,
        actor: &Actor,
        text: &str,
        now: Instant,
    ) -> Result<GeneratorSaved> {
        // Checked before the lock is taken, so a bad file waits for nothing.
        let head = deck::generator_head(text)?;
        self.apply(
            actor,
            "save_library_generator",
            false,
            now.millis,
            |vault| {
                let saved = deck::save_generator(vault, text)?;
                if saved.unchanged {
                    return Ok(Change {
                        message: String::new(),
                        paths: Vec::new(),
                        value: saved,
                    });
                }
                let verb = if saved.replaced { "update" } else { "save" };
                Ok(Change {
                    message: format!("code picture: {verb} {}", head.label),
                    paths: vec![saved.path.clone()],
                    value: saved,
                })
            },
        )
    }
}
