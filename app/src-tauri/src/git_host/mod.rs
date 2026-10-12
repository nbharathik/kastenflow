//! Backing up to a git host: "Sign in with GitHub", which makes a private
//! repository to back up into, and a token pasted for GitHub or any other
//! host. Each token is kept in the keychain for its own server and given to
//! the engine, which sends it nowhere else.

pub mod github;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant as Clock};

use kasten_core::history::{GitToken, https_origin};
use kasten_core::{Instant, Kasten};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app_settings::AppSettings;
use crate::chat::commands::ChatState;
use crate::closing::MAIN;
use crate::commands::notes::OpenVault;
use crate::secrets;

const EVENT: &str = "kasten://github-sign-in";

/// The GitHub app "Sign in with GitHub" goes through, set when the release
/// is built; without it only a pasted token works.
fn client_id() -> Option<&'static str> {
    option_env!("KASTEN_GITHUB_CLIENT_ID").filter(|id| !id.trim().is_empty())
}

/// The sign-in under way, which a new one or Cancel stops.
#[derive(Default)]
pub struct SignIn(Mutex<Option<Arc<AtomicBool>>>);

impl SignIn {
    fn replace(&self, next: Option<Arc<AtomicBool>>) {
        let mut slot = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(old) = slot.take() {
            old.store(true, Ordering::SeqCst);
        }
        *slot = next;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
}

/// How a sign-in ended, sent to the window.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SignInEnd {
    Signed { login: String },
    Expired,
    Denied,
    Disabled,
    Failed { message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub login: Option<String>,
    /// A token for github.com is in the keychain.
    pub signed_in: bool,
    /// This copy of Kasten can sign in with GitHub, not only take a token.
    pub can_sign_in: bool,
    /// A name for a new backup repository, from the open vault's.
    pub suggested: Option<String>,
}

fn settings_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || crate::crash::caught(job))
        .await
        .map_err(crate::crash::joined)?
}

fn github_token(chat: &ChatState) -> Result<GitToken, String> {
    secrets::git_token(chat.keys().as_ref(), github::ORIGIN)?
        .ok_or_else(|| "Sign in with GitHub first".to_owned())
}

/// Gives the engine the token for its remote's server, if the keychain
/// has one: on opening a vault, and after signing in.
pub fn hand_token(kasten: &Kasten, keys: &dyn secrets::KeyStore) {
    let origin = kasten.config().git.remote.as_deref().and_then(https_origin);
    if let Some(origin) = origin
        && let Ok(Some(token)) = secrets::git_token(keys, &origin)
    {
        kasten.set_git_token(Some(token));
    }
}

/// Starts "Sign in with GitHub": the code to type at GitHub. The answer
/// comes as an event, once the person has typed it or given up.
#[tauri::command]
pub async fn github_sign_in_start(
    app: AppHandle,
    chat: State<'_, ChatState>,
    sign_in: State<'_, SignIn>,
) -> Result<SignInCode, String> {
    let id = client_id()
        .ok_or("This copy of KastenFlow can't sign in with GitHub; paste a token instead")?;
    let http = chat.http()?;
    let code = github::request_code(&http, id).await?;
    let stop = Arc::new(AtomicBool::new(false));
    sign_in.replace(Some(Arc::clone(&stop)));
    let shown = SignInCode {
        user_code: code.user_code.clone(),
        verification_uri: code.verification_uri.clone(),
        expires_in: code.expires_in,
    };
    let keys = chat.keys();
    tauri::async_runtime::spawn(async move {
        let end = wait_for_token(&app, &http, id, &code, &stop, keys.as_ref()).await;
        if let Some(end) = end {
            let _ = app.emit_to(MAIN, EVENT, end);
        }
    });
    Ok(shown)
}

/// Asks GitHub, at the pace it sets, until the code is typed, refused or
/// runs out; None when the sign-in was stopped.
async fn wait_for_token(
    app: &AppHandle,
    http: &reqwest::Client,
    id: &str,
    code: &github::DeviceCode,
    stop: &AtomicBool,
    keys: &dyn secrets::KeyStore,
) -> Option<SignInEnd> {
    let deadline = Clock::now() + Duration::from_secs(code.expires_in);
    let mut interval = code.interval.max(5);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if stop.load(Ordering::SeqCst) {
            return None;
        }
        if Clock::now() >= deadline {
            return Some(SignInEnd::Expired);
        }
        match github::poll(http, id, &code.device_code).await {
            github::Poll::Pending => {}
            github::Poll::SlowDown => interval += 5,
            github::Poll::Expired => return Some(SignInEnd::Expired),
            github::Poll::Denied => return Some(SignInEnd::Denied),
            github::Poll::Disabled => return Some(SignInEnd::Disabled),
            github::Poll::Failed(message) => return Some(SignInEnd::Failed { message }),
            github::Poll::Token(secret) => {
                return Some(match signed_in(app, http, keys, secret).await {
                    Ok(login) => SignInEnd::Signed { login },
                    Err(message) => SignInEnd::Failed { message },
                });
            }
        }
    }
}

/// Keeps a new GitHub token and the account it is for.
async fn signed_in(
    app: &AppHandle,
    http: &reqwest::Client,
    keys: &dyn secrets::KeyStore,
    secret: String,
) -> Result<String, String> {
    let login = github::whoami(http, &secret).await?;
    let token = GitToken {
        origin: github::ORIGIN.to_owned(),
        username: github::TOKEN_USER.to_owned(),
        secret,
    };
    secrets::save_git_token(keys, &token)?;
    AppSettings::update(&settings_dir(app)?, |s| {
        s.github_login = Some(login.clone())
    })
    .map_err(|e| e.to_string())?;
    if let Some(kasten) = app.state::<OpenVault>().kasten() {
        hand_token(&kasten, keys);
    }
    Ok(login)
}

#[tauri::command]
pub fn github_sign_in_cancel(sign_in: State<'_, SignIn>) {
    sign_in.replace(None);
}

#[tauri::command(async)]
pub fn github_account(
    app: AppHandle,
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
) -> Result<Account, String> {
    let login = AppSettings::load(&settings_dir(&app)?).github_login;
    let signed_in = secrets::git_token(chat.keys().as_ref(), github::ORIGIN)
        .ok()
        .flatten()
        .is_some();
    Ok(Account {
        login: login.filter(|_| signed_in),
        signed_in,
        can_sign_in: client_id().is_some(),
        suggested: state.kasten().map(|k| github::repo_name(&k.config().name)),
    })
}

/// Forgets the GitHub token here, and answers the page where GitHub lets
/// the person take Kasten's access back for good.
#[tauri::command(async)]
pub fn github_sign_out(
    app: AppHandle,
    chat: State<'_, ChatState>,
) -> Result<Option<String>, String> {
    secrets::forget_git_token(chat.keys().as_ref(), github::ORIGIN)?;
    AppSettings::update(&settings_dir(&app)?, |s| s.github_login = None)
        .map_err(|e| e.to_string())?;
    if let Some(kasten) = app.state::<OpenVault>().kasten()
        && kasten
            .config()
            .git
            .remote
            .as_deref()
            .and_then(https_origin)
            .as_deref()
            == Some(github::ORIGIN)
    {
        kasten.set_git_token(None);
    }
    Ok(client_id().map(|id| format!("https://github.com/settings/connections/applications/{id}")))
}

/// The account's private repositories, to restore from.
#[tauri::command]
pub async fn github_backups(chat: State<'_, ChatState>) -> Result<Vec<github::Repo>, String> {
    let token = github_token(&chat)?;
    github::private_repos(&chat.http()?, &token.secret).await
}

/// Makes a private repository named `name` for the open vault, backs up
/// into it at once, and keeps it as the vault's backup on this computer.
#[tauri::command]
pub async fn github_create_backup(
    app: AppHandle,
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    name: String,
) -> Result<github::Repo, String> {
    let kasten = state.require()?;
    let token = github_token(&chat)?;
    let http = chat.http()?;
    let name = name.trim().to_owned();
    let repo = github::create_private_repo(&http, &token.secret, &name)
        .await?
        .ok_or_else(|| format!("You have a repository named {name} already; try {name}-2"))?;
    github::protect(&http, &token.secret, &repo.full_name).await;
    let url = repo.clone_url.clone();
    blocking(move || {
        let mut config = kasten.config();
        config.git.remote = Some(url.clone());
        kasten.set_config(config).map_err(|e| e.to_string())?;
        crate::commands::vault::confirm(&app, &kasten, Some(&url))?;
        kasten.set_git_token(Some(token));
        let now = Instant::now().millis;
        kasten.commit_edits().map_err(|e| e.to_string())?;
        kasten.commit_external().map_err(|e| e.to_string())?;
        kasten.push(now).map_err(|e| e.to_string())
    })
    .await?;
    Ok(repo)
}

/// What saving a token did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenSaved {
    /// Kept in the keychain; false when this computer has none Kasten can
    /// use, and the token lasts only until Kasten quits.
    pub remembered: bool,
}

/// Checks a pasted token reaches the vault's remote at `url`, then keeps it
/// for that server.
#[tauri::command]
pub async fn git_token_save(
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    url: String,
    username: Option<String>,
    secret: String,
) -> Result<TokenSaved, String> {
    let kasten = state.require()?;
    let origin = https_origin(url.trim())
        .ok_or("A token is for an https:// address; an ssh address signs in with an SSH key")?;
    let username = username
        .map(|u| u.trim().to_owned())
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| {
            if origin == github::ORIGIN {
                github::TOKEN_USER
            } else {
                "kasten"
            }
            .to_owned()
        });
    let token = GitToken {
        origin,
        username,
        secret: secret.trim().to_owned(),
    };
    let keys = chat.keys();
    blocking(move || {
        kasten
            .reach_remote(url.trim(), Some(&token))
            .map_err(|e| e.to_string())?;
        let remembered = secrets::save_git_token(keys.as_ref(), &token).is_ok();
        kasten.set_git_token(Some(token));
        Ok(TokenSaved { remembered })
    })
    .await
}

/// Forgets the token kept for the server at `url`.
#[tauri::command(async)]
pub fn git_token_forget(
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    url: String,
) -> Result<(), String> {
    let origin = https_origin(url.trim()).ok_or("That is not an https:// address")?;
    secrets::forget_git_token(chat.keys().as_ref(), &origin)?;
    if let Some(kasten) = state.kasten() {
        kasten.set_git_token(None);
    }
    Ok(())
}
