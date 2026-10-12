//! The chat's Tauri commands and the
//! emitter that sends `chat-event`s to the window. Keychain and vault work
//! runs off the async threads.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use kasten_core::config::Provider;
use kasten_core::{Instant, Kasten, NoteFile};
use tauri::{AppHandle, Emitter, State};

use super::address;
use super::chatgpt::{self, SIGN_IN_FIRST};
use super::check::{self, ProviderCheck};
use super::clients;
use super::http::{HttpModel, Kind};
use super::providers::{self, ChatProvider, ProviderInput};
use super::threads::{self, Chats};
use super::write::Writes;
use super::{ChatEvent, ChatRequest, ChatTurn, Events};
use crate::app_settings::AppSettings;
use crate::closing::MAIN;
use crate::commands::notes::{HUMAN, OpenVault};
use crate::secrets::KeyStore;

/// The chat's part of the app's state.
pub struct ChatState {
    pub chats: Chats,
    keys: Arc<dyn KeyStore>,
    /// Made on first use, so starting the app loads no TLS.
    http: OnceLock<Result<reqwest::Client, String>>,
    /// The client for web pages, which follows redirects (clients::web_client).
    web: OnceLock<Result<reqwest::Client, String>>,
    /// The one for a page asked for on the local network.
    local_web: OnceLock<Result<reqwest::Client, String>>,
    /// The AI providers' addresses confirmed for the open vault.
    origins: Mutex<Origins>,
    /// The editor's AI answers under way.
    pub writes: Writes,
    /// The ChatGPT account on this computer, whatever vault is open.
    chatgpt: Arc<chatgpt::Account>,
}

/// The AI providers' addresses confirmed for the open vault on this
/// computer, and where that is recorded.
#[derive(Default)]
struct Origins {
    settings: Option<PathBuf>,
    folder: String,
    confirmed: BTreeSet<String>,
}

impl ChatState {
    pub fn new(keys: Arc<dyn KeyStore>) -> ChatState {
        ChatState {
            chats: Chats::default(),
            chatgpt: Arc::new(chatgpt::Account::new(Arc::clone(&keys))),
            keys,
            http: OnceLock::new(),
            web: OnceLock::new(),
            local_web: OnceLock::new(),
            origins: Mutex::new(Origins::default()),
            writes: Writes::default(),
        }
    }

    /// The ChatGPT account, which signs its provider's requests.
    pub(crate) fn chatgpt(&self) -> Arc<chatgpt::Account> {
        Arc::clone(&self.chatgpt)
    }

    fn origins(&self) -> MutexGuard<'_, Origins> {
        self.origins.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Reads the addresses confirmed for the vault in `folder` from the
    /// app's settings in `settings`, as the vault opens.
    pub fn know_vault(&self, settings: Option<PathBuf>, folder: String) {
        let confirmed = settings
            .as_deref()
            .map(|dir| AppSettings::load(dir).confirmed_origins(&folder))
            .unwrap_or_default();
        *self.origins() = Origins {
            settings,
            folder,
            confirmed,
        };
    }

    /// Whether notes may go where `provider`'s requests go.
    pub(crate) fn confirmed(&self, provider: &Provider) -> bool {
        address::known_address(provider).unwrap_or(false)
            || address::origin_of(provider)
                .is_ok_and(|origin| self.origins().confirmed.contains(&origin))
    }

    /// Refuses a provider whose address the person has not confirmed on
    /// this computer: the vault's config names it, and a vault someone
    /// shares could name any server.
    pub(crate) fn check_origin(&self, provider: &Provider) -> Result<(), String> {
        if self.confirmed(provider) {
            return Ok(());
        }
        Err(format!(
            "This vault's settings send “{}” to {}. KastenFlow sends notes there only once you confirm it: open Settings, AI providers, and choose Confirm.",
            provider.name,
            address::origin_of(provider)?
        ))
    }

    /// Confirms `provider`'s address for the open vault, and records it in
    /// the app's settings.
    pub(crate) fn confirm_origin(&self, provider: &Provider) -> Result<(), String> {
        let origin = address::origin_of(provider)?;
        let mut origins = self.origins();
        if !origins.confirmed.insert(origin.clone()) {
            return Ok(());
        }
        if let Some(dir) = origins.settings.clone() {
            AppSettings::update(&dir, |settings| {
                settings.confirm_origin(&origins.folder, &origin)
            })
            .map_err(|e| format!("Could not keep the provider's address: {e}"))?;
        }
        Ok(())
    }

    /// The system keychain (or, in tests, memory).
    pub(crate) fn keys(&self) -> Arc<dyn KeyStore> {
        Arc::clone(&self.keys)
    }

    /// The client for providers' APIs.
    pub(crate) fn http(&self) -> Result<reqwest::Client, String> {
        self.http.get_or_init(clients::client).clone()
    }

    /// The client for web pages: the clipper and the update check.
    pub(crate) fn web(&self) -> Result<reqwest::Client, String> {
        self.web.get_or_init(clients::web_client).clone()
    }

    /// The client for a page the person asked for on this computer or the
    /// local network.
    pub(crate) fn local_web(&self) -> Result<reqwest::Client, String> {
        self.local_web
            .get_or_init(clients::local_web_client)
            .clone()
    }

    /// The key kept for `provider` at the address its requests go to.
    pub(crate) async fn key(&self, provider: &Provider) -> Result<Option<String>, String> {
        let keys = Arc::clone(&self.keys);
        let provider = provider.clone();
        blocking(move || address::key_for(keys.as_ref(), &provider)).await
    }

    /// `model` (else the provider's own) of the provider called `provider`,
    /// with its key from the keychain: what a turn, or any one-off request
    /// such as a brainstorm, asks.
    pub(crate) async fn model(
        &self,
        kasten: &Kasten,
        provider: &str,
        model: &str,
    ) -> Result<HttpModel, String> {
        let provider = providers::find(kasten, provider)?;
        self.check_origin(&provider)?;
        self.model_of(&provider, model).await
    }

    /// The model of `provider` (its address already confirmed): a key
    /// from the keychain, or for ChatGPT the signed-in account, whose
    /// token each request asks for afresh.
    pub(crate) async fn model_of(
        &self,
        provider: &Provider,
        model: &str,
    ) -> Result<HttpModel, String> {
        let kind = Kind::of(&provider.kind)?;
        if kind == Kind::ChatGpt {
            let account = self.chatgpt();
            if !account.status().await.signed_in {
                return Err(SIGN_IN_FIRST.to_owned());
            }
            return Ok(HttpModel::new(self.http()?, provider, None, model)?.with_account(account));
        }
        let key = match (kind, self.key(provider).await) {
            (_, Ok(key)) => key,
            // A local server may need no key; the Anthropic API always does.
            (Kind::OpenAi, Err(_)) => None,
            (_, Err(err)) => return Err(err),
        };
        HttpModel::new(self.http()?, provider, key, model)
    }
}

/// Sends a turn's events to the window.
struct Window(AppHandle);

impl Events for Window {
    fn emit(&self, event: ChatEvent) {
        // To the main window only: the browser tab's webviews never hear a chat.
        let _ = self.0.emit_to(MAIN, "chat-event", &event);
    }
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(crate::crash::joined)?
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
    let keys = Arc::clone(&state.keys);
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
    let keys = Arc::clone(&state.keys);
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
    let keys = Arc::clone(&state.keys);
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
    let keys = Arc::clone(&state.keys);
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
    let events: Arc<dyn Events> = Arc::new(Window(app));
    let (turn, work) = threads::send(&state.chats, kasten, events, model, request)?;
    tauri::async_runtime::spawn(work);
    Ok(turn)
}

/// Stops the chat's running turn; its `done` event says `stopped`.
#[tauri::command(async)]
pub fn chat_stop(state: State<'_, ChatState>, chat: String) {
    state.chats.stop(&chat);
}

/// Forgets the chat's conversation; its next turn starts a new session.
#[tauri::command(async)]
pub fn chat_reset(state: State<'_, ChatState>, chat: String) {
    state.chats.reset(&chat);
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
