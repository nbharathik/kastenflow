//! Tauri commands for the bibliography and for citation keys. Each maps to one
//! kasten-core op; the window never writes a `.bib` file, a page or a deck itself.
//! Renaming a key is the one that takes three steps: the core plans it, the Slides
//! engine (through kasten-mcp's helper) makes each deck's new text, and the core
//! takes the lot as one commit or none of it.

use std::collections::BTreeMap;

use kasten_core::Instant;
use kasten_core::bib::{
    Adopted, Bibliography, KeyHints, NewReference, ReferenceMatch, ReferenceSaved,
};
use kasten_core::cite::{KeyRename, KeyRenamePlan, KeyRenamed, KeyUses};
use kasten_mcp::decks::cite_rename::deck_texts;
use tauri::State;

use super::notes::{HUMAN, OpenVault};

/// The managed file, the external files and the duplicates among them.
#[tauri::command(async)]
pub fn bibliography(state: State<'_, OpenVault>) -> Result<Bibliography, String> {
    state.run(|k| k.bibliography())
}

/// The entries a reference would repeat.
#[tauri::command(async)]
pub fn check_reference(
    state: State<'_, OpenVault>,
    reference: NewReference,
) -> Result<Vec<ReferenceMatch>, String> {
    state.run(|k| k.check_reference(&reference))
}

/// A key for a work that no `.bib` file uses.
#[tauri::command(async)]
pub fn suggest_key(state: State<'_, OpenVault>, hints: KeyHints) -> Result<String, String> {
    state.run(|k| k.suggest_key(&hints))
}

/// Adds a reference to the managed file.
#[tauri::command(async)]
pub fn add_reference(
    state: State<'_, OpenVault>,
    reference: NewReference,
    base_hash: String,
) -> Result<ReferenceSaved, String> {
    state.run(|k| k.add_reference(&HUMAN, &reference, &base_hash, Instant::now()))
}

/// Sets fields of a reference (a null value takes the field out).
#[tauri::command(async)]
pub fn update_reference(
    state: State<'_, OpenVault>,
    key: String,
    fields: BTreeMap<String, Option<String>>,
    base_hash: String,
) -> Result<ReferenceSaved, String> {
    state.run(|k| k.update_reference(&HUMAN, &key, &fields, &base_hash, Instant::now()))
}

/// Replaces a reference's text with one complete entry of the same key.
#[tauri::command(async)]
pub fn replace_reference(
    state: State<'_, OpenVault>,
    key: String,
    text: String,
    base_hash: String,
) -> Result<ReferenceSaved, String> {
    state.run(|k| k.replace_reference(&HUMAN, &key, &text, &base_hash, Instant::now()))
}

/// Makes a managed copy of an external `.bib` file's entries.
#[tauri::command(async)]
pub fn adopt_bib(
    state: State<'_, OpenVault>,
    path: String,
    keys: Option<Vec<String>>,
    base_hash: String,
) -> Result<Adopted, String> {
    state.run(|k| k.adopt_bib(&HUMAN, &path, keys.as_deref(), &base_hash, Instant::now()))
}

/// The pages, decks and pictures that cite a key.
#[tauri::command(async)]
pub fn reference_uses(state: State<'_, OpenVault>, key: String) -> Result<KeyUses, String> {
    state.run(|k| k.reference_uses(&key))
}

/// What renaming a key would change.
#[tauri::command(async)]
pub fn plan_key_rename(
    state: State<'_, OpenVault>,
    from: String,
    to: String,
) -> Result<KeyRenamePlan, String> {
    state.run(|k| k.plan_key_rename(&from, &to))
}

/// Renames a key in the bibliography, pages, pictures and decks, as one commit.
#[tauri::command(async)]
pub fn rename_citation_key(
    state: State<'_, OpenVault>,
    from: String,
    to: String,
    bib_hash: String,
) -> Result<KeyRenamed, String> {
    state.run(|k| {
        let plan = k.plan_key_rename(&from, &to)?;
        let decks = deck_texts(k, &plan, &from, &to)?;
        k.rename_citation_key(
            &HUMAN,
            &KeyRename {
                from,
                to,
                bib_hash,
                decks,
            },
            Instant::now(),
        )
    })
}
