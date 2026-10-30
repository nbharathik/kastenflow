//! The GitHub commands of the simpler backup set-up: the repository picker,
//! looking at a repository, the name check, making one private, the other
//! ways of signing in (a token for one repository, the GitHub command line),
//! and who can see the backup. A token is only ever read from the keychain or
//! the sign-in in hand; it is in no result and no message.

use tauri::{AppHandle, Manager, State};

use super::contract::{BackupError, RepoCheck, RepoPage, RevokeLink, SignedIn, Visibility};
use crate::app_settings::AppSettings;
use crate::chat::commands::ChatState;
use crate::commands::notes::OpenVault;
use crate::git_host::endpoints::{Endpoints, client_id, revoke_url, token_page_url};
use crate::git_host::{self, device, gh, github, repos, session, token, visibility};

/// What the commands share: the client, GitHub's addresses, the token and
/// the account.
struct Asking {
    http: reqwest::Client,
    ep: Endpoints,
    secret: String,
    login: String,
}

async fn asking(app: &AppHandle, chat: &ChatState) -> Result<Asking, BackupError> {
    let secret = git_host::github_token(chat)?.secret;
    let http = chat.http().map_err(BackupError::other)?;
    let ep = Endpoints::github();
    let login = git_host::login_of(app, &http, &ep, &secret).await?;
    Ok(Asking {
        http,
        ep,
        secret,
        login,
    })
}

/// The account's private repositories matching `query`, a page at a time
/// (from 1), KastenFlow's backups first on each page.
#[tauri::command]
pub async fn github_repos(
    app: AppHandle,
    chat: State<'_, ChatState>,
    query: String,
    page: u32,
) -> Result<RepoPage, BackupError> {
    let a = asking(&app, &chat).await?;
    repos::list(&a.http, &a.ep, &a.secret, &a.login, &query, page).await
}

/// Up to six of the vault's commits to look for on GitHub: the newest three
/// and the oldest three.
fn sample(log: &[String]) -> Vec<String> {
    let mut ids: Vec<String> = log.iter().take(3).cloned().collect();
    for id in log.iter().rev().take(3) {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }
    ids
}

/// Looks at `repo` (`owner/name`): there or not, who can see it, empty,
/// this vault's, or something else; and the lock on its branch.
#[tauri::command]
pub async fn github_repo_check(
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    repo: String,
) -> Result<RepoCheck, BackupError> {
    let secret = git_host::github_token(&chat).ok().map(|t| t.secret);
    let http = chat.http().map_err(BackupError::other)?;
    let ids = match state.kasten() {
        Some(kasten) => tauri::async_runtime::spawn_blocking(move || {
            let log = kasten.log(None, 1000).unwrap_or_default();
            sample(&log.into_iter().map(|c| c.id).collect::<Vec<_>>())
        })
        .await
        .unwrap_or_default(),
        None => Vec::new(),
    };
    let found = repos::check(&http, &Endpoints::github(), secret.as_deref(), &repo, &ids).await?;
    if found.exists {
        visibility::remember(&repo, found.visibility, Some(found.protection.clone()));
    }
    Ok(found)
}

/// Who can see `repo` now; pauses or resumes the open vault's backup if it is
/// that repository.
#[tauri::command]
pub async fn github_repo_visibility(
    app: AppHandle,
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    repo: String,
) -> Result<Visibility, BackupError> {
    let secret = git_host::github_token(&chat).ok().map(|t| t.secret);
    let http = chat.http().map_err(BackupError::other)?;
    let found = repos::visibility(&http, &Endpoints::github(), secret.as_deref(), &repo).await?;
    visibility::remember(&repo, found, None);
    settle(&app, &state, &repo, found);
    Ok(found)
}

/// Applies what is known of `repo` to the open vault, if it backs up there.
fn settle(app: &AppHandle, state: &OpenVault, repo: &str, found: Visibility) {
    if let Some(kasten) = state.kasten()
        && let Some(remote) = kasten.config().git.remote
        && visibility::repo_of(&remote) == Some(repo.to_lowercase())
    {
        visibility::apply(app, &kasten, &remote, found);
    }
}

/// Makes `repo` private (one call); answers what it is now.
#[tauri::command]
pub async fn github_make_private(
    app: AppHandle,
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    repo: String,
) -> Result<Visibility, BackupError> {
    let a = asking(&app, &chat).await?;
    let now = repos::make_private(&a.http, &a.ep, &a.secret, &repo).await?;
    visibility::remember(&repo, now, None);
    settle(&app, &state, &repo, now);
    Ok(now)
}

/// Says the person wants `repo` as a public backup: remembered on this
/// computer, and pushing goes on if it was paused for that.
#[tauri::command]
pub async fn github_allow_public(
    app: AppHandle,
    state: State<'_, OpenVault>,
    repo: String,
) -> Result<(), BackupError> {
    if !crate::git_host::api::valid_full_name(&repo) {
        return Err(BackupError::other("That is not a repository name"));
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| BackupError::other(e.to_string()))?;
    let key = repo.to_lowercase();
    AppSettings::update(&dir, |s| s.public_ok.insert(key))
        .map_err(|e| BackupError::other(format!("Could not keep that choice: {e}")))?;
    settle(&app, &state, &repo, visibility::last_visibility(&repo));
    Ok(())
}

/// Whether a repository called `name` can be made in the account; checked as
/// the person types.
#[tauri::command]
pub async fn github_name_available(
    app: AppHandle,
    chat: State<'_, ChatState>,
    name: String,
) -> Result<bool, BackupError> {
    let a = asking(&app, &chat).await?;
    repos::name_available(&a.http, &a.ep, &a.secret, &a.login, name.trim()).await
}

/// GitHub's page for making a fine-grained token, filled in for a backup.
#[tauri::command]
pub fn github_token_page() -> String {
    token_page_url()
}

/// Signs in with a pasted fine-grained token. Where `repo` (`owner/name`) is
/// given, the token must be able to see and write to it; nothing is kept
/// unless it can.
#[tauri::command]
pub async fn github_token_sign_in(
    app: AppHandle,
    chat: State<'_, ChatState>,
    token: String,
    repo: Option<String>,
) -> Result<SignedIn, BackupError> {
    let http = chat.http().map_err(BackupError::other)?;
    sign_in_with(&app, &chat, &http, &token, repo.as_deref()).await
}

async fn sign_in_with(
    app: &AppHandle,
    chat: &ChatState,
    http: &reqwest::Client,
    secret: &str,
    repo: Option<&str>,
) -> Result<SignedIn, BackupError> {
    let keys = chat.keys();
    let (signed, kept) =
        token::sign_in(http, &Endpoints::github(), keys.as_ref(), secret, repo).await?;
    device::keep_signed_in(app, &kept, &signed.login, signed.remembered)
        .map_err(BackupError::other)?;
    Ok(signed)
}

/// Whether the GitHub command line is installed and signed in here.
#[tauri::command]
pub async fn github_gh_cli_available() -> Result<bool, BackupError> {
    Ok(tauri::async_runtime::spawn_blocking(gh::available)
        .await
        .unwrap_or(false))
}

/// Signs in with the token the GitHub command line holds (asked for now,
/// once), kept like any other.
#[tauri::command]
pub async fn github_gh_cli_sign_in(
    app: AppHandle,
    chat: State<'_, ChatState>,
) -> Result<SignedIn, BackupError> {
    let secret = tauri::async_runtime::spawn_blocking(gh::token)
        .await
        .map_err(|e| BackupError::other(crate::crash::joined(e)))??;
    let http = chat.http().map_err(BackupError::other)?;
    sign_in_with(&app, &chat, &http, &secret, None).await
}

/// The page where GitHub lets the person take KastenFlow's access back for
/// good, and whether the sign-in ends on its own when KastenFlow closes.
#[tauri::command]
pub fn github_revoke_link(chat: State<'_, ChatState>) -> RevokeLink {
    let in_keychain = crate::secrets::git_token(chat.keys().as_ref(), github::ORIGIN)
        .ok()
        .flatten()
        .is_some();
    RevokeLink {
        url: revoke_url(client_id().as_deref()),
        session_only: !in_keychain && session::get().is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(count: u32) -> Vec<String> {
        (1..=count).map(|n| format!("c{n:07}")).collect()
    }

    #[test]
    fn the_sample_is_the_newest_and_the_oldest_commits() {
        assert_eq!(
            sample(&ids(10)),
            [
                "c0000001", "c0000002", "c0000003", "c0000010", "c0000009", "c0000008"
            ]
        );
        assert_eq!(sample(&ids(2)), ["c0000001", "c0000002"]);
        assert!(sample(&[]).is_empty());
    }
}
