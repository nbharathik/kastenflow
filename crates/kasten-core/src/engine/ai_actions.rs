//! AI actions the vault carries: the Markdown files in `templates/ai/`.
//! They are read from the folder itself, so a file just added is there
//! before the index has looked at it; the app parses them (its own concern)
//! and runs them on a page.

use super::Kasten;
use crate::error::Result;
use crate::note::NoteFile;

/// The folder the vault's own AI actions are kept in.
pub const FOLDER: &str = "templates/ai";

/// The most actions listed, and the longest one read: a folder of
/// thousands of files, or a huge file, is not a set of actions.
pub const MOST: usize = 100;
pub const MOST_BYTES: u64 = 64 * 1024;

impl Kasten {
    /// The vault's AI actions, sorted by path. Files that are not Markdown,
    /// or are larger than `MOST_BYTES`, are not among them.
    pub fn ai_actions(&self) -> Result<Vec<NoteFile>> {
        let mut out = Vec::new();
        for file in self.vault.files_in(FOLDER, ".md")? {
            if out.len() >= MOST {
                break;
            }
            if file.size > MOST_BYTES {
                continue;
            }
            if let Ok(note) = self.vault.read(&file.path)
                && note.meta.kind == crate::note::AI_ACTION
            {
                out.push(note);
            }
        }
        Ok(out)
    }
}
