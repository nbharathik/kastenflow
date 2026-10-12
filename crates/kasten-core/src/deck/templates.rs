//! Slide templates: decks whose look is the point, kept as plain `.deck` files in
//! `templates/slides/` of the vault, where the person can see them, copy them to another vault
//! and trash them. They are decks in every way that matters to core: they are read, saved,
//! trashed and restored by the same ops. They are not listed with the person's decks, and only a
//! person writes one (the whole `templates/` folder is read-only for agents).

use super::files::checked_title;
use super::head::head_of;
use crate::atomic::create_atomic;
use crate::error::Result;
use crate::ops::free_file;
use crate::slug::slugify;
use crate::vault::{Vault, in_templates};

/// Where the templates of the Slides editor are kept.
pub const TEMPLATE_FOLDER: &str = "templates/slides";

/// Whether `path` is a deck in the vault's `templates/` folder: a template, not one of the
/// person's decks.
pub fn is_template(path: &str) -> bool {
    path.ends_with(".deck") && in_templates(path)
}

/// Creates a template holding `text` (the editor's engine makes it) and titled `title`; returns
/// its path. The file is named by the title's slug, numbered when taken; no existing file is ever
/// replaced.
pub fn create_template(vault: &Vault, title: &str, text: &str) -> Result<String> {
    let title = checked_title(title)?;
    head_of(text)?;
    let path = free_file(vault, TEMPLATE_FOLDER, &slugify(&title), ".deck");
    create_atomic(&vault.file_of(&path, &[".deck"])?, text.as_bytes())?;
    Ok(path)
}
