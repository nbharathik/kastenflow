//! Find and replace across a page and its sub-pages: a preview that writes
//! nothing, then one replace that is one commit (see kasten-core's
//! `find_under` and `replace_under`, which keep every guardrail).

use kasten_core::{FindSpec, Instant, NoteMatches, ReplaceRequest, Replaced};
use tauri::State;

use super::notes::{HUMAN, OpenVault};

/// The pages under `root` (an id or a path) that hold the text, at most
/// `max_notes` (200 by default).
#[tauri::command(async)]
pub fn find_under(
    state: State<'_, OpenVault>,
    root: String,
    spec: FindSpec,
    max_notes: Option<usize>,
) -> Result<Vec<NoteMatches>, String> {
    state.run(|k| k.find_under(&root, &spec, max_notes.unwrap_or(200)))
}

/// Replaces in the pages the preview listed, as one commit that undo takes
/// back; nothing is written if any page changed since the preview.
#[tauri::command(async)]
pub fn replace_under(
    state: State<'_, OpenVault>,
    request: ReplaceRequest,
) -> Result<Replaced, String> {
    state.run(|k| k.replace_under(&HUMAN, &request, Instant::now()))
}
