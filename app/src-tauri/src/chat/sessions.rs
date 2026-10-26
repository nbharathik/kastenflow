//! The commands of chat sessions beyond sending: tying a thread to a page,
//! the archive at the end of the list, and the two counts (list size,
//! agents working at once). For the main window only.

use std::collections::HashMap;

use tauri::State;

use super::archive::Deleted;
use super::binding::{Binding, Imported, Move};
use super::limit::ChatLimits;
use super::state::ChatState;
use super::store::ThreadSummary;
use crate::commands::notes::OpenVault;

/// Ties `thread` to `target` (`{kind, path, id?}`): a page, deck, diagram or
/// LaTeX document. The thread that was tied to it loses the tie and stays in
/// the list; its name comes back. An archived thread comes back to the list.
#[tauri::command(async)]
pub fn chat_bind(
    state: State<'_, ChatState>,
    thread: String,
    target: Binding,
) -> Result<Vec<String>, String> {
    state.chats.bind(&thread, target)
}

/// Cuts a thread's tie. Whether it had one.
#[tauri::command(async)]
pub fn chat_unbind(state: State<'_, ChatState>, thread: String) -> Result<bool, String> {
    state.chats.unbind(&thread)
}

/// The thread tied to `target`, or none.
#[tauri::command(async)]
pub fn chat_thread_for(
    state: State<'_, ChatState>,
    target: Binding,
) -> Result<Option<ThreadSummary>, String> {
    state.chats.thread_for(&target)
}

/// Files were renamed or moved (`[{from, to}]`; a folder carries what is
/// under it): the threads tied to them follow. How many threads changed.
#[tauri::command(async)]
pub fn chat_rebind(state: State<'_, ChatState>, moves: Vec<Move>) -> Result<usize, String> {
    state.chats.rebind(&moves)
}

/// The one-time move of what the window kept in the browser
/// (`kasten.chat.decks`: `{ "<deck path>": "<thread id>" }`) into the threads.
/// `kind` is `deck` when not given. Never overwrites a tie; safe to repeat.
#[tauri::command(async)]
pub fn chat_import_bindings(
    state: State<'_, ChatState>,
    kind: Option<String>,
    map: HashMap<String, String>,
) -> Imported {
    state
        .chats
        .import_bindings(kind.as_deref().unwrap_or("deck"), &map)
}

/// Moves a chat to the Archived section (the thread header's "Archive"). It
/// stays saved and `chat_unarchive` brings it back; nothing is deleted. A chat
/// that is answering is refused. Whether there was such a chat.
#[tauri::command(async)]
pub fn chat_archive(state: State<'_, ChatState>, id: String) -> Result<bool, String> {
    state.chats.archive(&id)
}

/// Brings an archived thread back to the top of the list. Whether there was
/// such a thread.
#[tauri::command(async)]
pub fn chat_unarchive(state: State<'_, ChatState>, id: String) -> Result<bool, String> {
    state.chats.unarchive(&id)
}

/// Deletes the archived chats in `ids`, and only those: the person's own
/// action, after the window showed the count. A chat that is not archived, is
/// working or has changes waiting stays, and is listed with the reason.
#[tauri::command(async)]
pub fn chat_delete_archived(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    ids: Vec<String>,
) -> Result<Deleted, String> {
    let kasten = vault.require()?;
    Ok(state.chats.delete_archived(&ids, &kasten))
}

/// The list's size (`chat.list_size`) and how many chats work at once
/// (`chat.max_concurrent`).
#[tauri::command(async)]
pub fn chat_limits(state: State<'_, ChatState>) -> ChatLimits {
    state.chats.limits()
}

/// Sets them (Settings, AI); out of range is refused. A smaller list size
/// archives the oldest threads at once, and deletes none.
#[tauri::command(async)]
pub fn set_chat_limits(
    state: State<'_, ChatState>,
    limits: ChatLimits,
) -> Result<ChatLimits, String> {
    let limits = limits.checked()?;
    if let Some(dir) = state.config_dir() {
        limits.save(&dir)?;
    }
    state.chats.set_limits(limits);
    Ok(limits)
}
