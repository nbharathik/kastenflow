//! The chat's Tauri commands and the
//! emitter that sends `chat-event`s to the window. Keychain and vault work
//! runs off the async threads.

use std::sync::Arc;

use kasten_core::{Instant, Kasten, NoteFile};
use tauri::{AppHandle, Emitter, Manager, State};

use super::capabilities;
use super::check::{self, ProviderCheck};
use super::http::HttpModel;
use super::providers::{self, ChatProvider, ProviderInput};
use super::state::blocking;
use super::threads::{self, Profile};
use super::{ChatEvent, ChatRequest, ChatTurn, EventKind, Events};
use crate::closing::MAIN;
use crate::commands::notes::{HUMAN, OpenVault};
use crate::notify::Notice;

pub use super::state::ChatState;

/// Sends a turn's events to the window, and tells the person of a turn that
/// ended while the window was not in front.
struct Window(AppHandle);

impl Events for Window {
    fn emit(&self, event: ChatEvent) {
        // To the main window only: the browser tab's webviews never hear a chat.
        let _ = self.0.emit_to(MAIN, "chat-event", &event);
        if let Some(notice) = notice_for(&event) {
            crate::notify::tell(&self.0, notice);
        }
    }
}

/// The system notice a turn's ending earns, in fixed words: never the
/// words of a note or of the answer.
pub(crate) fn notice_for(event: &ChatEvent) -> Option<Notice> {
    match event.kind {
        EventKind::Done if event.stopped != Some(true) => Some(Notice::ChatAnswered),
        EventKind::Paused => Some(Notice::ChatNeedsYou),
        EventKind::Error => Some(Notice::ChatFailed),
        _ => None,
    }
}

/// What the table knows of the model: its window, and whether it reads pictures.
fn profile_of(model: &HttpModel) -> Profile {
    let route = capabilities::route_of(model.kind(), model.url());
    Profile::of(&capabilities::lookup(route, model.model_name()))
}

/// The app is closing: every turn is stopped and its thread saved as
/// interrupted, so it can be picked up again.
pub fn interrupt_chats(app: &AppHandle) {
    if let Some(state) = app.try_state::<ChatState>() {
        state.chats.interrupt_all();
    }
}

/// The providers with whether each one's address is confirmed here.
fn marked(state: &ChatState, mut list: Vec<ChatProvider>) -> Vec<ChatProvider> {
    for provider in &mut list {
        provider.confirmed = state.confirmed(&provider.config());
    }
    list
}

#[tauri::command]
pub async fn chat_providers(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
) -> Result<Vec<ChatProvider>, String> {
    let kasten = vault.require()?;
    let keys = state.keys();
    let list = blocking(move || Ok(providers::list(&kasten, keys.as_ref()))).await?;
    Ok(marked(&state, list))
}

/// Saves a provider as Settings shows it, which confirms its address.
#[tauri::command]
pub async fn save_chat_provider(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    provider: ProviderInput,
    key: Option<String>,
) -> Result<Vec<ChatProvider>, String> {
    let kasten = vault.require()?;
    let keys = state.keys();
    let name = provider.name.trim().to_owned();
    let saved = Arc::clone(&kasten);
    let list = blocking(move || providers::save(&saved, keys.as_ref(), provider, key)).await?;
    state.confirm_origin(&providers::find(&kasten, &name)?)?;
    Ok(marked(&state, list))
}

/// Confirms the address a provider in the vault's config names.
#[tauri::command]
pub async fn confirm_chat_provider(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    name: String,
) -> Result<Vec<ChatProvider>, String> {
    let kasten = vault.require()?;
    state.confirm_origin(&providers::find(&kasten, &name)?)?;
    let keys = state.keys();
    let list = blocking(move || Ok(providers::list(&kasten, keys.as_ref()))).await?;
    Ok(marked(&state, list))
}

#[tauri::command]
pub async fn remove_chat_provider(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    name: String,
) -> Result<Vec<ChatProvider>, String> {
    let kasten = vault.require()?;
    let keys = state.keys();
    let list = blocking(move || providers::remove(&kasten, keys.as_ref(), &name)).await?;
    Ok(marked(&state, list))
}

/// "Test connection": one short request to `model` (else the provider's
/// own) with the saved key; says how it went.
#[tauri::command]
pub async fn test_chat_provider(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    name: String,
    model: Option<String>,
) -> Result<ProviderCheck, String> {
    let kasten = vault.require()?;
    let http = state
        .model(&kasten, &name, model.as_deref().unwrap_or(""))
        .await?;
    let asked = http.model_name().to_owned();
    Ok(check::check(&http, &asked).await)
}

/// Starts a turn and answers at once; the reply streams as `chat-event`s.
#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    request: ChatRequest,
) -> Result<ChatTurn, String> {
    let kasten = vault.require()?;
    let model = state
        .model(&kasten, &request.provider, &request.model)
        .await?;
    // What the person set is checked against what this model takes; a
    // setting it does not take is said in words, and nothing is sent.
    let refused = state.chatgpt().effort_refused(model.model_name());
    let model = capabilities::apply(model, request.settings.as_ref(), refused)?;
    let profile = profile_of(&model);
    let events: Arc<dyn Events> = Arc::new(Window(app));
    // A message sent while the chat works is composed here, which reads the vault.
    let chats = state.chats.clone();
    let (turn, work) =
        blocking(move || threads::send_with(&chats, kasten, events, model, request, profile))
            .await?;
    tauri::async_runtime::spawn(work);
    Ok(turn)
}

/// Lets a paused, interrupted or failed chat go on from where it is, with a
/// fresh budget; the same model and settings as its last message.
#[tauri::command]
pub async fn chat_continue(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    id: String,
) -> Result<ChatTurn, String> {
    let kasten = vault.require()?;
    let chats = state.chats.clone();
    let facts = {
        let (chats, kasten, id) = (chats.clone(), Arc::clone(&kasten), id.clone());
        blocking(move || {
            chats
                .resume_facts(&id, &kasten)
                .ok_or_else(|| "There is no saved chat with that name".to_owned())
        })
        .await?
    };
    let model = state.model(&kasten, &facts.provider, &facts.model).await?;
    let refused = state.chatgpt().effort_refused(model.model_name());
    let model = capabilities::apply(model, facts.settings.as_ref(), refused)?;
    let profile = profile_of(&model);
    let events: Arc<dyn Events> = Arc::new(Window(app));
    let (turn, work) =
        blocking(move || threads::resume_with(&chats, kasten, events, model, &id, profile)).await?;
    tauri::async_runtime::spawn(work);
    Ok(turn)
}

/// Stops the chat's running turn; its `done` event says `stopped`.
#[tauri::command(async)]
pub fn chat_stop(state: State<'_, ChatState>, chat: String) {
    state.chats.stop(&chat);
}

/// Forgets the chat's conversation; its next turn starts a new session. What
/// the chat staged and the person never applied goes with it.
#[tauri::command(async)]
pub fn chat_reset(vault: State<'_, OpenVault>, state: State<'_, ChatState>, chat: String) {
    let kasten = vault.require().ok();
    // A saved chat that was not opened this run has its staged changes to throw away too.
    if let Some(kasten) = &kasten {
        state.chats.ensure_loaded(&chat, kasten);
    }
    if let Some(changes) = state.chats.reset(&chat)
        && let Some(kasten) = &kasten
    {
        let set = changes.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let _ = kasten.discard_changes(&set);
    }
    // Its saved copy goes with it, or the next window would bring it back.
    state.chats.forget_saved(&chat);
}

/// Takes the chat back to its first `keep` questions, for asking the last
/// one again or asking it another way. How many questions it has now.
#[tauri::command(async)]
pub fn chat_rewind(
    state: State<'_, ChatState>,
    chat: String,
    keep: usize,
) -> Result<usize, String> {
    state.chats.rewind(&chat, keep)
}

/// Saves a chat's transcript to `chats/` as the person. `date` (an addition
/// to the contract) is their day, YYYY-MM-DD; UTC's day when not given.
#[tauri::command]
pub async fn save_chat(
    vault: State<'_, OpenVault>,
    title: String,
    markdown: String,
    date: Option<String>,
) -> Result<NoteFile, String> {
    let kasten = vault.require()?;
    blocking(move || save_transcript(&kasten, &title, &markdown, date.as_deref())).await
}

/// What `save_chat` does, without the window.
pub(crate) fn save_transcript(
    kasten: &Kasten,
    title: &str,
    markdown: &str,
    date: Option<&str>,
) -> Result<NoteFile, String> {
    let day = threads::day(date);
    kasten
        .save_chat(&HUMAN, title, markdown, &day, Instant::now())
        .map_err(|e| e.to_string())
}
