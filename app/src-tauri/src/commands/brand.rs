//! The brand kit of Slides: the logo, colours, fonts and default theme that new decks start from.
//! The text is the editor's own; the commands only carry it to and from the vault's ops.

use kasten_core::Instant;
use kasten_core::deck::{BrandFile, BrandSaved};
use tauri::State;

use super::notes::{HUMAN, OpenVault};

/// The brand kit decks of `project` start from: the project's own, else the vault's, else none.
#[tauri::command(async)]
pub fn read_brand_kit(
    state: State<'_, OpenVault>,
    project: Option<String>,
) -> Result<Option<BrandFile>, String> {
    state.run(|k| k.brand_kit(project.as_deref()))
}

/// Keeps a brand kit (the editor writes `text`) for `project`, or for the vault when none is named.
#[tauri::command(async)]
pub fn save_brand_kit(
    state: State<'_, OpenVault>,
    project: Option<String>,
    text: String,
) -> Result<BrandSaved, String> {
    state.run(|k| k.save_brand_kit(&HUMAN, project.as_deref(), &text, Instant::now()))
}
