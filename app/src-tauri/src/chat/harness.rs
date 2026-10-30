//! The commands of the saved-thread side of the chat: the thread list and a
//! thread brought back, the window's own copy of a thread, events a reloaded
//! window missed, continuing a paused thread, attachments, and the limits a
//! turn runs within. All for the main window only.

use serde_json::Value;
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

use super::AttachKind;
use super::attach::AttachmentInfo;
use super::budget::ChatBudgets;
use super::state::ChatState;
use super::store::ThreadSummary;
use super::threads::{AdoptFailed, ChatUsage, Loaded, StateOf};
use crate::commands::assets::percent_decode;
use crate::commands::notes::OpenVault;

/// The saved threads of the open vault, newest first. A thread that was
/// working when the app closed is listed as interrupted.
#[tauri::command(async)]
pub fn chat_threads(state: State<'_, ChatState>) -> Vec<ThreadSummary> {
    state.chats.list()
}

/// A saved thread, brought back so it can be read, sent to and continued.
/// When it cannot be, the error is an `AdoptFailed` object
/// (`{kind: "adoptFailed", reason: "missing" | "damaged" | "newer", message}`),
/// never an empty new thread; a vault that is not open is a plain sentence.
/// `gap` says which events after the saved screen are gone from `chat_state`.
#[tauri::command(async)]
pub fn chat_load(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    id: String,
) -> Result<Loaded, LoadError> {
    let kasten = vault.require().map_err(LoadError::Other)?;
    state.chats.loaded(&id, &kasten).map_err(LoadError::Adopt)
}

/// What `chat_load` fails with: the typed `AdoptFailed`, or a sentence.
#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
pub enum LoadError {
    Adopt(AdoptFailed),
    Other(String),
}

/// Keeps the window's own picture of a thread (at most 5 MB).
#[tauri::command(async)]
pub fn chat_save_ui(state: State<'_, ChatState>, id: String, ui: Value) -> Result<(), String> {
    state.chats.save_ui(&id, ui)
}

/// The events of a thread after number `since_seq`, for a window that was
/// reloaded while the thread worked.
#[tauri::command(async)]
pub fn chat_state(state: State<'_, ChatState>, id: String, since_seq: u64) -> StateOf {
    state.chats.state(&id, since_seq)
}

/// Removes a saved thread and the attachments nothing else uses.
#[tauri::command(async)]
pub fn chat_delete_thread(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    id: String,
) -> Result<(), String> {
    let kasten = vault.require()?;
    state.chats.delete_thread(&id, &kasten)
}

/// Keeps the request's body as an attachment: text, or a picture. The name
/// comes in the `x-name` header, percent-encoded, and what the window says it
/// is in `x-kind` (`text` or `image`).
#[tauri::command(async)]
pub fn chat_attach(
    state: State<'_, ChatState>,
    request: Request<'_>,
) -> Result<AttachmentInfo, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The file's bytes did not arrive".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|value| value.to_str().ok())
        .and_then(percent_decode)
        .ok_or("The file's name did not arrive")?;
    let kind = match request
        .headers()
        .get("x-kind")
        .and_then(|v| v.to_str().ok())
    {
        Some("text") => AttachKind::Text,
        Some("image") => AttachKind::Image,
        _ => return Err("Say whether the attachment is text or an image (x-kind)".into()),
    };
    state.attachments()?.put(&name, kind, bytes)
}

/// How much room the saved chats and their attachments take. Only a report,
/// for the window to offer to delete old chats with; nothing is removed
/// because of it.
#[tauri::command(async)]
pub fn chat_usage(state: State<'_, ChatState>) -> ChatUsage {
    state.chats.usage()
}

/// The stored bytes of an attachment: the text as the model reads it, or the
/// picture.
#[tauri::command(async)]
pub fn chat_attachment(state: State<'_, ChatState>, id: String) -> Result<Response, String> {
    state.attachments()?.bytes(&id).map(Response::new)
}

/// Forgets an attachment no saved chat refers to: a chip the person removed
/// before sending.
#[tauri::command(async)]
pub fn chat_attachment_drop(state: State<'_, ChatState>, id: String) -> Result<(), String> {
    let used = state
        .chats
        .store()
        .map(|store| store.referenced_attachments())
        .unwrap_or_default();
    state.attachments()?.drop_unused(&id, &used);
    Ok(())
}

/// The limits a turn runs within before it pauses.
#[tauri::command(async)]
pub fn chat_budgets(state: State<'_, ChatState>) -> ChatBudgets {
    state.chats.budgets()
}

/// Sets the limits (Settings, AI: "Agent limits"); out of range is refused.
#[tauri::command(async)]
pub fn set_chat_budgets(
    state: State<'_, ChatState>,
    budgets: ChatBudgets,
) -> Result<ChatBudgets, String> {
    let budgets = budgets.checked()?;
    if let Some(dir) = state.config_dir() {
        budgets.save(&dir)?;
    }
    state.chats.set_budgets(budgets);
    Ok(budgets)
}
