//! Backing up to a git host: "Sign in with GitHub", which makes a private
//! repository to back up into, a fine-grained token pasted for one
//! repository, the GitHub command line's sign-in, and a token pasted for any
//! other host. Each token is kept in the keychain for its own server and given
//! to the engine, which sends it nowhere else. Where the keychain cannot keep
//! it, a GitHub token lasts until KastenFlow closes.

pub(crate) mod api;
pub(crate) mod device;
pub(crate) mod endpoints;
pub(crate) mod failure;
pub(crate) mod gh;
pub mod github;
pub(crate) mod lock;
pub(crate) mod repos;
pub(crate) mod session;
pub(crate) mod token;
pub(crate) mod visibility;

#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use kasten_core::history::{GitToken, https_origin};
use kasten_core::{Instant, Kasten};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub use self::device::SignIn;
use self::device::{SignInCode, wait_for_token};
use self::endpoints::{Endpoints, client_id, revoke_url};
use crate::app_settings::AppSettings;
use crate::backup::contract::{BackupError, Protection, RepoRow};
use crate::chat::commands::ChatState;
use crate::closing::MAIN;
use crate::commands::notes::OpenVault;
use crate::secrets;

const EVENT: &str = "kasten://github-sign-in";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub login: Option<String>,
    /// A token for github.com is in the keychain, or kept until KastenFlow
    /// closes.
    pub signed_in: bool,
    /// The token is not in the keychain: the sign-in ends when KastenFlow
    /// closes.
    pub session_only: bool,
    /// This copy of KastenFlow can sign in with GitHub, not only take a token.
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

/// The GitHub token: the keychain's, else the one kept until KastenFlow
/// closes.
pub(crate) fn github_token(chat: &ChatState) -> Result<GitToken, BackupError> {
    let kept = secrets::git_token(chat.keys().as_ref(), github::ORIGIN)
        .ok()
        .flatten();
    kept.or_else(session::get)
        .ok_or_else(|| BackupError::SignedOut {
            message: "Sign in with GitHub first".to_owned(),
        })
}

/// The signed-in account's login, from what was kept at sign-in, else asked.
pub(crate) async fn login_of(
    app: &AppHandle,
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
) -> Result<String, BackupError> {
    let kept = settings_dir(app)
        .ok()
        .and_then(|dir| AppSettings::load(&dir).github_login);
    match kept {
        Some(login) => Ok(login),
        None => github::whoami(http, ep, token).await,
    }
}

/// Gives the engine the token for its remote's server, if the keychain
/// (or this session) has one: on opening a vault, and after signing in.
pub fn hand_token(kasten: &Kasten, keys: &dyn secrets::KeyStore) {
    let origin = kasten.config().git.remote.as_deref().and_then(https_origin);
    if let Some(origin) = origin {
        let found = secrets::git_token(keys, &origin).ok().flatten();
        let found = found.or_else(|| session::get().filter(|t| t.origin == origin));
        if let Some(token) = found {
            kasten.set_git_token(Some(token));
        }
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
    let code = github::request_code(&http, &Endpoints::github(), &id).await?;
    let stop = Arc::new(AtomicBool::new(false));
    sign_in.replace(Some(Arc::clone(&stop)));
    let shown = SignInCode {
        user_code: code.user_code.clone(),
        verification_uri: code.verification_uri.clone(),
        expires_in: code.expires_in,
    };
    let keys = chat.keys();
    tauri::async_runtime::spawn(async move {
        let end = wait_for_token(&app, &http, &id, &code, &stop, keys.as_ref()).await;
        if let Some(end) = end {
            let _ = app.emit_to(MAIN, EVENT, end);
        }
    });
    Ok(shown)
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
    let in_keychain = secrets::git_token(chat.keys().as_ref(), github::ORIGIN)
        .ok()
        .flatten()
        .is_some();
    let session_only = !in_keychain && session::get().is_some();
    let signed_in = in_keychain || session_only;
    Ok(Account {
        login: login.filter(|_| signed_in),
        signed_in,
        session_only,
        can_sign_in: client_id().is_some(),
        suggested: state.kasten().map(|k| github::repo_name(&k.config().name)),
    })
}

/// Forgets the GitHub token here, and answers the page where GitHub lets
/// the person take KastenFlow's access back for good.
#[tauri::command(async)]
pub fn github_sign_out(
    app: AppHandle,
    chat: State<'_, ChatState>,
) -> Result<Option<String>, String> {
    secrets::forget_git_token(chat.keys().as_ref(), github::ORIGIN)?;
    session::forget();
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
    Ok(Some(revoke_url(client_id().as_deref())))
}

/// The account's private repositories, backups first, to restore from.
#[tauri::command]
pub async fn github_backups(
    app: AppHandle,
    chat: State<'_, ChatState>,
) -> Result<Vec<RepoRow>, BackupError> {
    let token = github_token(&chat)?;
    let http = chat.http().map_err(BackupError::other)?;
    let ep = Endpoints::github();
    let login = login_of(&app, &http, &ep, &token.secret).await?;
    repos::all(&http, &ep, &token.secret, &login).await
}

/// A repository made for the vault's backup, and the lock on its branch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedBackup {
    #[serde(flatten)]
    pub repo: RepoRow,
    pub protection: Protection,
}

/// Makes a private repository named `name` for the open vault, backs up
/// into it at once, and keeps it as the vault's backup on this computer. A
/// name in use is a typed error carrying that repository, to use instead.
#[tauri::command]
pub async fn github_create_backup(
    app: AppHandle,
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    name: String,
) -> Result<CreatedBackup, BackupError> {
    let kasten = state.require().map_err(BackupError::other)?;
    let token = github_token(&chat)?;
    let http = chat.http().map_err(BackupError::other)?;
    let ep = Endpoints::github();
    let login = login_of(&app, &http, &ep, &token.secret).await?;
    let (repo, protection) =
        repos::create_backup(&http, &ep, &token.secret, &login, name.trim()).await?;
    visibility::remember(&repo.full_name, repo.visibility, Some(protection.clone()));
    let url = repo.clone_url.clone();
    blocking(move || {
        kasten
            .update_config(|config| {
                config.git.remote = Some(url.clone());
                Ok(())
            })
            .map_err(|e| e.to_string())?;
        crate::commands::vault::confirm(&app, &kasten, Some(&url))?;
        kasten.set_git_token(Some(token));
        let now = Instant::now().millis;
        kasten.commit_edits().map_err(|e| e.to_string())?;
        kasten.commit_external().map_err(|e| e.to_string())?;
        kasten.push(now).map_err(|e| e.to_string())
    })
    .await
    .map_err(BackupError::other)?;
    Ok(CreatedBackup { repo, protection })
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
    if origin == github::ORIGIN {
        session::forget();
    }
    if let Some(kasten) = state.kasten() {
        kasten.set_git_token(None);
    }
    Ok(())
}
