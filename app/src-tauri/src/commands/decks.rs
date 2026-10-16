//! Slide decks: listing, reading and the saves the Slides editor makes.
//! The deck's text is the editor's own; the commands only carry it to and
//! from the vault's ops.

use kasten_core::deck::{DeckFile, DeckSaved};
use kasten_core::{DeckInfo, DecksSaved, Instant, SaveDecksRequest};
use tauri::State;

use super::notes::{HUMAN, OpenVault};

#[tauri::command(async)]
pub fn list_decks(state: State<'_, OpenVault>) -> Result<Vec<DeckInfo>, String> {
    state.run(|k| k.decks())
}

/// The deck at `path` with the hash a save must bring back.
#[tauri::command(async)]
pub fn read_deck(state: State<'_, OpenVault>, path: String) -> Result<DeckFile, String> {
    state.run(|k| k.deck(&path))
}

/// The bibliography the citations of decks are looked up in: the text of
/// every `.bib` file in the vault, one after another.
#[tauri::command(async)]
pub fn references(state: State<'_, OpenVault>) -> Result<String, String> {
    state.run(|k| k.references())
}

/// Creates a deck holding `text` (made by the editor's engine) in `project`
/// or the library; returns its path.
#[tauri::command(async)]
pub fn create_deck(
    state: State<'_, OpenVault>,
    title: String,
    project: Option<String>,
    text: String,
) -> Result<String, String> {
    state.run(|k| k.create_deck(&HUMAN, &title, project.as_deref(), &text, Instant::now()))
}

/// Saves the editor's deck if the file is still the one it read; if not,
/// the text goes to a copy beside it and the file is left alone.
#[tauri::command(async)]
pub fn save_deck(
    state: State<'_, OpenVault>,
    path: String,
    text: String,
    base_hash: String,
) -> Result<DeckSaved, String> {
    state.run(|k| k.save_deck(&HUMAN, &path, &text, &base_hash, Instant::now()))
}

/// Saves several decks together: all or none, in one commit that Undo takes back whole. Every deck must
/// still be as it was when its new text was worked out (`base_hash`), or nothing is written.
#[tauri::command(async)]
pub fn save_decks(
    state: State<'_, OpenVault>,
    request: SaveDecksRequest,
) -> Result<DecksSaved, String> {
    state.run(|k| k.save_decks(&HUMAN, &request, Instant::now()))
}

/// The slide templates of the vault (`templates/slides/`), by title. They are decks to read and save
/// like any, and are not among `list_decks`.
#[tauri::command(async)]
pub fn list_deck_templates(state: State<'_, OpenVault>) -> Result<Vec<DeckInfo>, String> {
    state.run(|k| k.deck_templates())
}

/// Saves a deck's look as a template in `templates/slides/`, holding `text` (made by the editor's
/// engine); returns its path.
#[tauri::command(async)]
pub fn create_deck_template(
    state: State<'_, OpenVault>,
    title: String,
    text: String,
) -> Result<String, String> {
    state.run(|k| k.create_deck_template(&HUMAN, &title, &text, Instant::now()))
}

/// Puts a trashed deck back; returns where it went.
#[tauri::command(async)]
pub fn restore_deck(state: State<'_, OpenVault>, trashed: String) -> Result<String, String> {
    state.run(|k| k.restore_deck(&HUMAN, &trashed))
}
