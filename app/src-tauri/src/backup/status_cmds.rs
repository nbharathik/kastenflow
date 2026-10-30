//! The backup's status line, linking a vault to a backup that already exists,
//! and what to do when the backup was rewritten. Each is one kasten-core op;
//! nothing here touches vault files.

use kasten_core::backup::CarryOn;
use kasten_core::history::BackupStatus as Core;
use kasten_core::history::https_origin;
use kasten_core::{Instant, Kasten};
use tauri::{AppHandle, Manager, State};

use super::contract::{
    BackupError, BackupStatus, LargeFile, LinkOutcome, Protection, SkippedFile, Visibility,
};
use crate::app_settings::AppSettings;
use crate::chat::commands::ChatState;
use crate::commands::notes::OpenVault;
use crate::git_host::{self, repos, visibility};

fn iso(millis: u64) -> String {
    Instant { millis }.rfc3339()
}

/// The status the window reads, from the engine's and what is known of the
/// repository.
pub fn status_from(
    core: &Core,
    remote: Option<&str>,
    seen: Visibility,
    protection: Protection,
    allowed: bool,
) -> BackupStatus {
    BackupStatus {
        waiting: core.waiting,
        unpushed: core.unpushed,
        verified_at: core.verified_at.map(iso),
        skipped: core
            .skipped
            .iter()
            .map(|f| SkippedFile {
                path: f.path.clone(),
                size: f.size,
                since: f.since.clone(),
            })
            .collect(),
        warn: core
            .warn
            .iter()
            .map(|f| LargeFile {
                path: f.path.clone(),
                size: f.size,
            })
            .collect(),
        visibility: seen,
        paused: visibility::should_pause(seen, allowed),
        protection,
        lost_history: core.lost_history,
        recovered_branch: core.recovered_branch.clone(),
        last_backup_at: core.last_push.map(iso),
        repo_size: core.repo_size,
        repo_url: remote.map(str::to_owned),
    }
}

fn status_of(app: &AppHandle, kasten: &Kasten) -> BackupStatus {
    let core = kasten.backup_status(Instant::now().millis);
    let remote = kasten.config().git.remote;
    let full = remote.as_deref().and_then(visibility::repo_of);
    let settings = app
        .path()
        .app_config_dir()
        .map(|dir| AppSettings::load(&dir))
        .unwrap_or_default();
    let (seen, protection, allowed) = match &full {
        Some(full) => (
            visibility::last_visibility(full),
            visibility::last_protection(full),
            visibility::allowed(&settings, full),
        ),
        None => (Visibility::Unknown, Protection::default(), false),
    };
    status_from(&core, remote.as_deref(), seen, protection, allowed)
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, BackupError> + Send + 'static,
) -> Result<T, BackupError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::crash::caught(|| job().map_err(|e| e.message()))
    })
    .await
    .map_err(crate::crash::joined)
    .map_err(BackupError::other)?
    .map_err(BackupError::other)
}

/// The backup's status line.
#[tauri::command]
pub async fn backup_status(
    app: AppHandle,
    state: State<'_, OpenVault>,
) -> Result<BackupStatus, BackupError> {
    let kasten = state.require().map_err(BackupError::other)?;
    blocking(move || Ok(status_of(&app, &kasten))).await
}

/// Points the backup at a repository that already exists. A public GitHub
/// repository is not accepted silently: it is refused (`PublicRepo`) until
/// the person makes it private or says they want a public backup.
#[tauri::command]
pub async fn backup_link_existing(
    app: AppHandle,
    state: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    url: String,
) -> Result<LinkOutcome, BackupError> {
    let kasten = state.require().map_err(BackupError::other)?;
    let url = url.trim().to_owned();
    let origin = https_origin(&url);
    let token = origin
        .as_deref()
        .and_then(|o| {
            crate::secrets::git_token(chat.keys().as_ref(), o)
                .ok()
                .flatten()
        })
        .or_else(|| {
            git_host::github_token(&chat)
                .ok()
                .filter(|t| Some(&t.origin) == origin.as_ref())
        });
    if let Some(full) = visibility::repo_of(&url) {
        let http = chat.http().map_err(BackupError::other)?;
        let secret = token.as_ref().map(|t| t.secret.as_str());
        let found = repos::visibility(
            &http,
            &git_host::endpoints::Endpoints::github(),
            secret,
            &full,
        )
        .await
        .unwrap_or(Visibility::Unknown);
        visibility::remember(&full, found, None);
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|e| BackupError::other(e.to_string()))?;
        if visibility::should_pause(found, visibility::allowed(&AppSettings::load(&dir), &full)) {
            return Err(BackupError::PublicRepo {
                message: format!(
                    "{full} is a public repository, so anyone can read your notes. Make it private, or say you want a public backup"
                ),
                repo: full,
            });
        }
    }
    let confirmed = url.clone();
    blocking(move || {
        if let Some(token) = token {
            kasten.set_git_token(Some(token));
        }
        let linked = kasten.link_existing_backup(&url)?;
        match linked {
            kasten_core::backup::LinkResult::Refused { choices } => {
                Ok(LinkOutcome::Refused { choices })
            }
            kasten_core::backup::LinkResult::Linked { empty, behind } => {
                crate::commands::vault::confirm(&app, &kasten, Some(&confirmed))
                    .map_err(BackupError::other)?;
                Ok(LinkOutcome::Linked {
                    empty,
                    behind,
                    status: Box::new(status_of(&app, &kasten)),
                })
            }
        }
    })
    .await
}

/// Saves this computer's full history to a safety branch on the backup
/// (never forced); answers the branch's name.
#[tauri::command]
pub async fn backup_save_full_history(state: State<'_, OpenVault>) -> Result<String, BackupError> {
    let kasten = state.require().map_err(BackupError::other)?;
    blocking(move || Ok(kasten.save_full_history_to_safety_branch(Instant::now().millis)?)).await
}

/// Carries on with the backup as it is now, after it was rewritten.
#[tauri::command]
pub async fn backup_carry_on(state: State<'_, OpenVault>) -> Result<CarryOn, BackupError> {
    let kasten = state.require().map_err(BackupError::other)?;
    blocking(move || Ok(kasten.carry_on_with_backup()?)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::contract::ProtectionState;
    use kasten_core::backup::{LargeFile as CoreLarge, SkippedFile as CoreSkipped};

    #[test]
    fn the_engines_facts_reach_the_window_unchanged() {
        let mut core = Core::judge(true, Some(1_000), 0, None, 2_000);
        core.unpushed = 3;
        core.waiting = true;
        core.lost_history = true;
        core.recovered_branch = Some("kasten/recovered-2026-10-22".into());
        core.repo_size = Some(42);
        core.verified_at = Some(1_000);
        core.skipped = vec![CoreSkipped {
            path: "big.bin".into(),
            size: 9,
            since: "2026-10-01T00:00:00Z".into(),
        }];
        core.warn = vec![CoreLarge {
            path: "mid.bin".into(),
            size: 7,
        }];
        let status = status_from(
            &core,
            Some("https://github.com/ada/notes.git"),
            Visibility::Public,
            Protection {
                state: ProtectionState::Unprotected,
                reason: Some("why".into()),
            },
            false,
        );
        assert!(status.waiting && status.lost_history && status.paused);
        assert_eq!(status.unpushed, 3);
        assert_eq!(
            status.recovered_branch.as_deref(),
            Some("kasten/recovered-2026-10-22")
        );
        assert_eq!(status.repo_size, Some(42));
        assert_eq!(status.skipped[0].path, "big.bin");
        assert_eq!(
            (status.warn[0].path.as_str(), status.warn[0].size),
            ("mid.bin", 7)
        );
        assert_eq!(
            status.last_backup_at.as_deref(),
            Some("1970-01-01T00:00:01Z")
        );
        assert_eq!(status.verified_at, status.last_backup_at);
        assert_eq!(status.protection.reason.as_deref(), Some("why"));
        assert_eq!(
            status.repo_url.as_deref(),
            Some("https://github.com/ada/notes.git")
        );
    }

    #[test]
    fn a_public_backup_the_person_wanted_is_not_paused() {
        let core = Core::judge(true, None, 0, None, 0);
        let on = |allowed| {
            status_from(
                &core,
                None,
                Visibility::Public,
                Protection::default(),
                allowed,
            )
            .paused
        };
        assert!(on(false));
        assert!(!on(true));
        let private = status_from(
            &core,
            None,
            Visibility::Private,
            Protection::default(),
            false,
        );
        assert!(!private.paused);
    }
}
