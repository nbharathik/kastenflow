//! Tauri commands for annotations: comments on pages and highlights on captured web pages.
//! Each maps to one kasten-core op; the window never writes a sidecar file itself.

use kasten_core::Instant;
use kasten_core::comments::{Anchor, Comment, NewComment};
use kasten_core::text_highlights::{
    NewTextHighlight, TextAnchor, TextHighlight, TextHighlightEdit,
};
use tauri::State;

use super::notes::{HUMAN, OpenVault};

/// The comments on a page, in the order they were made, resolved ones included.
#[tauri::command(async)]
pub fn comments(state: State<'_, OpenVault>, page: String) -> Result<Vec<Comment>, String> {
    state.run(|k| k.comments(&page))
}

/// Adds a comment to a page.
#[tauri::command(async)]
pub fn add_comment(
    state: State<'_, OpenVault>,
    page: String,
    comment: NewComment,
) -> Result<Comment, String> {
    state.run(|k| k.add_comment(&HUMAN, &page, &comment, Instant::now()))
}

/// Resolves a comment, or with `resolved` false opens it again.
#[tauri::command(async)]
pub fn resolve_comment(
    state: State<'_, OpenVault>,
    page: String,
    id: String,
    resolved: bool,
) -> Result<Comment, String> {
    state.run(|k| k.resolve_comment(&HUMAN, &page, &id, resolved, Instant::now()))
}

/// Attaches a comment to another place on its page.
#[tauri::command(async)]
pub fn reanchor_comment(
    state: State<'_, OpenVault>,
    page: String,
    id: String,
    anchor: Anchor,
) -> Result<Comment, String> {
    state.run(|k| k.reanchor_comment(&HUMAN, &page, &id, &anchor, Instant::now()))
}

/// The highlights on a captured page, in the order they were made.
#[tauri::command(async)]
pub fn text_highlights(
    state: State<'_, OpenVault>,
    note: String,
) -> Result<Vec<TextHighlight>, String> {
    state.run(|k| k.text_highlights(&note))
}

/// Highlights words of a captured page.
#[tauri::command(async)]
pub fn add_text_highlight(
    state: State<'_, OpenVault>,
    note: String,
    highlight: NewTextHighlight,
) -> Result<TextHighlight, String> {
    state.run(|k| k.add_text_highlight(&HUMAN, &note, &highlight, Instant::now()))
}

/// Changes a highlight's colour or comment.
#[tauri::command(async)]
pub fn edit_text_highlight(
    state: State<'_, OpenVault>,
    note: String,
    id: String,
    edit: TextHighlightEdit,
) -> Result<TextHighlight, String> {
    state.run(|k| k.edit_text_highlight(&HUMAN, &note, &id, &edit, Instant::now()))
}

/// Gives a highlight a new place (its quote and what stands around it).
#[tauri::command(async)]
pub fn move_text_highlight(
    state: State<'_, OpenVault>,
    note: String,
    id: String,
    anchor: TextAnchor,
) -> Result<TextHighlight, String> {
    state.run(|k| k.move_text_highlight(&HUMAN, &note, &id, &anchor, Instant::now()))
}

/// Takes a highlight off the page; history keeps it.
#[tauri::command(async)]
pub fn remove_text_highlight(
    state: State<'_, OpenVault>,
    note: String,
    id: String,
) -> Result<(), String> {
    state.run(|k| k.remove_text_highlight(&HUMAN, &note, &id, Instant::now()))
}
