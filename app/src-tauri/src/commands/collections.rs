//! Tauri commands for collections: saved searches kept as views in the vault.
//! Each maps to one kasten-core op; the window never writes `views/` itself.

use kasten_core::collections::Collection;
use kasten_core::{Instant, NoteMeta, TagAdded};
use serde_json::{Map, Value};
use tauri::State;

use super::notes::{HUMAN, OpenVault};

/// Every saved collection, by name. One that cannot be used is listed with
/// the reason.
#[tauri::command(async)]
pub fn collections(state: State<'_, OpenVault>) -> Result<Vec<Collection>, String> {
    state.run(|k| k.collections())
}

/// The collection at `path` (`views/<name>.yaml`).
#[tauri::command(async)]
pub fn collection(state: State<'_, OpenVault>, path: String) -> Result<Collection, String> {
    state.run(|k| k.collection(&path))
}

/// Saves a new collection under `name`; `edits` set its keys.
#[tauri::command(async)]
pub fn create_collection(
    state: State<'_, OpenVault>,
    name: String,
    edits: Map<String, Value>,
) -> Result<Collection, String> {
    state.run(|k| k.create_collection(&HUMAN, &name, &edits, Instant::now()))
}

/// Changes the keys `edits` names (a key set to null goes), if the file is
/// still as `base_hash` says.
#[tauri::command(async)]
pub fn update_collection(
    state: State<'_, OpenVault>,
    path: String,
    edits: Map<String, Value>,
    base_hash: String,
) -> Result<Collection, String> {
    state.run(|k| k.update_collection(&HUMAN, &path, &edits, &base_hash, Instant::now()))
}

/// Gives a collection another name; its file moves to match.
#[tauri::command(async)]
pub fn rename_collection(
    state: State<'_, OpenVault>,
    path: String,
    name: String,
    base_hash: String,
) -> Result<Collection, String> {
    state.run(|k| k.rename_collection(&HUMAN, &path, &name, &base_hash, Instant::now()))
}

/// Moves a collection to the trash; gives where it went.
#[tauri::command(async)]
pub fn trash_collection(state: State<'_, OpenVault>, path: String) -> Result<String, String> {
    state.run(|k| k.trash_collection(&HUMAN, &path, Instant::now()))
}

/// Puts a trashed collection back.
#[tauri::command(async)]
pub fn restore_collection(
    state: State<'_, OpenVault>,
    trashed: String,
) -> Result<Collection, String> {
    state.run(|k| k.restore_collection(&HUMAN, &trashed))
}

/// Adds one tag to many pages as one change (a drop on a tag's gallery, or
/// "Add existing pages"); the pages stay where they are.
#[tauri::command(async)]
pub fn add_tag_to_many(
    state: State<'_, OpenVault>,
    paths: Vec<String>,
    tag: String,
) -> Result<TagAdded, String> {
    state.run(|k| k.add_tag_to_many(&HUMAN, &paths, &tag, Instant::now()))
}

/// The notes already kept from the page at `url`, the first saved first.
#[tauri::command(async)]
pub fn captured_from(state: State<'_, OpenVault>, url: String) -> Result<Vec<NoteMeta>, String> {
    state.run(|k| k.captured(&url))
}
