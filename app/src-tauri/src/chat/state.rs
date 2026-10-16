//! The chat's part of the app's state: the threads, the keychain, the HTTP
//! clients made on first use, the AI providers' addresses the person has
//! confirmed, and the models built from a provider's config.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use kasten_core::Kasten;
use kasten_core::config::Provider;

use super::address;
use super::attach::Attachments;
use super::budget::ChatBudgets;
use super::chatgpt::{self, SIGN_IN_AGAIN, SIGN_IN_FIRST};
use super::clients;
use super::http::{HttpModel, Kind};
use super::providers;
use super::steady::Steady;
use super::store::Store;
use super::threads::Chats;
use super::write::Writes;
use crate::app_settings::AppSettings;
use crate::secrets::KeyStore;

/// The chat's part of the app's state.
pub struct ChatState {
    pub chats: Chats,
    keys: Arc<dyn KeyStore>,
    /// Made on first use, so starting the app loads no TLS, and made again
    /// after a connection failed in a way that says the old one is no good.
    http: Arc<clients::Shared>,
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
        // A keychain that hiccups must not look empty: a read that fails is
        // asked again, and one that keeps failing gives what was last seen.
        let keys: Arc<dyn KeyStore> = Arc::new(Steady::new(keys));
        ChatState {
            chats: Chats::default(),
            chatgpt: Arc::new(chatgpt::Account::new(Arc::clone(&keys))),
            keys,
            http: clients::shared(),
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

    /// The app's config folder, where the chat's limits are kept.
    pub(crate) fn config_dir(&self) -> Option<PathBuf> {
        self.origins().settings.clone()
    }

    /// The attachments of the open vault.
    pub(crate) fn attachments(&self) -> Result<Arc<Attachments>, String> {
        self.chats.files().ok_or_else(|| {
            "Attachments cannot be kept: the app's data folder could not be found".to_owned()
        })
    }

    /// Opens the saved threads and attachments of the vault in `kasten`, in
    /// the app's `data` folder, and the limits a turn runs within. Run when
    /// the vault opens. Nothing is removed here or later on its own.
    pub fn open_threads(&self, kasten: &Arc<Kasten>, data: Option<&Path>) {
        if let Some(dir) = self.config_dir() {
            self.chats.set_budgets(ChatBudgets::load(&dir));
        }
        let Some(data) = data else {
            return;
        };
        let root = kasten.root().display().to_string();
        let store = Arc::new(Store::open(data, &root));
        let files = Arc::new(Attachments::open(data, &root));
        self.chats.use_store(store, Some(files));
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
        self.http.client()
    }

    /// Where the providers' client comes from, for models that make it again
    /// after a connection failed.
    pub(crate) fn clients(&self) -> Arc<clients::Shared> {
        Arc::clone(&self.http)
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
            let status = account.status().await;
            if status.reauth {
                return Err(SIGN_IN_AGAIN.to_owned());
            }
            if !status.signed_in {
                return Err(SIGN_IN_FIRST.to_owned());
            }
            return Ok(HttpModel::new(self.http()?, provider, None, model)?
                .with_account(account)
                .with_clients(self.clients()));
        }
        let key = match (kind, self.key(provider).await) {
            (_, Ok(key)) => key,
            // A local server may need no key; the Anthropic API always does.
            (Kind::OpenAi, Err(_)) => None,
            (_, Err(err)) => return Err(err),
        };
        Ok(HttpModel::new(self.http()?, provider, key, model)?.with_clients(self.clients()))
    }
}

/// Runs keychain and vault work off the async threads.
pub(super) async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(crate::crash::joined)?
}
