//! Backing up beyond the vault's own history: backup files in a folder a
//! sync client (Dropbox, Google Drive, OneDrive) or a disk keeps, written
//! daily once the vault is quiet; Get latest from the backup, by hand; one
//! last push as Kasten closes; and restoring a backup into a new folder.
//! Kasten is desktop-first: backup keeps notes safe and moves them to a
//! new computer. It is not live sync.

pub mod contract;
pub mod github_cmds;
pub mod now_cmds;
pub mod restore;
mod schedule;
pub mod status_cmds;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use kasten_core::{BackupFile, Instant, Kasten, Latest};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app_settings::AppSettings;
use crate::closing::MAIN;
use crate::commands::notes::OpenVault;

pub use schedule::{file_if_due, file_wait, final_backup};

fn settings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || crate::crash::caught(job))
        .await
        .map_err(crate::crash::joined)?
}

pub use kasten_core::computer_name;

/// The backup folder confirmed for the vault on this computer, if any.
pub fn backup_folder(settings: &AppSettings, kasten: &Kasten) -> Option<PathBuf> {
    let folder = kasten.root().display().to_string();
    settings.backup_folders.get(&folder).map(PathBuf::from)
}

/// Why `folder` can't take backup files for the vault at `root`, if it
/// can't: it must be a folder, and outside the vault, or each file would
/// go into the vault's own history.
fn refuse_folder(folder: &Path, root: &Path) -> Option<String> {
    let Ok(folder) = fs::canonicalize(folder) else {
        return Some(format!("No folder at {}", folder.display()));
    };
    if !folder.is_dir() {
        return Some(format!("{} is not a folder", folder.display()));
    }
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_owned());
    folder.starts_with(&root).then(|| {
        "Choose a folder outside the vault: a backup inside it would back up itself".into()
    })
}

/// Tells the window that files changed, so it reads them again.
fn changed(app: &AppHandle, latest: &Latest) {
    let mut paths = latest.changed.clone();
    paths.extend(latest.copies.iter().cloned());
    if !paths.is_empty() {
        let _ = app.emit_to(MAIN, "vault-changed", &paths);
    }
    let _ = app.emit_to(MAIN, "vault-committed", kasten_core::Tick::default());
}

/// Sets the folder backup files go to for the open vault, on this
/// computer; None stops them. Files already written stay.
#[tauri::command(async)]
pub fn set_backup_folder(
    app: AppHandle,
    state: State<'_, OpenVault>,
    folder: Option<String>,
) -> Result<(), String> {
    let kasten = state.require()?;
    let chosen = match folder {
        Some(folder) => {
            let path = crate::commands::vaults::expand(&folder, app.path().home_dir().ok());
            if let Some(why) = refuse_folder(&path, kasten.root()) {
                return Err(why);
            }
            Some(std::path::absolute(&path).map_err(|e| e.to_string())?)
        }
        None => None,
    };
    let vault = kasten.root().display().to_string();
    AppSettings::update(&settings_dir(&app)?, |s| match chosen {
        Some(path) => {
            s.backup_folders.insert(vault, path.display().to_string());
        }
        None => {
            s.backup_folders.remove(&vault);
        }
    })
    .map_err(|e| format!("Could not keep the backup folder: {e}"))?;
    // The backup thread sleeps while no folder is set: it looks again now.
    kasten.wake_workers();
    Ok(())
}

/// Writes a backup file now, into the folder set for this vault.
#[tauri::command]
pub async fn backup_file_now(
    app: AppHandle,
    state: State<'_, OpenVault>,
) -> Result<BackupFile, String> {
    let kasten = state.require()?;
    let settings = AppSettings::load(&settings_dir(&app)?);
    let folder =
        backup_folder(&settings, &kasten).ok_or("Choose a folder for backup files first")?;
    let written = blocking(move || {
        kasten
            .write_backup_file(&folder, &computer_name(), Instant::now())
            .map_err(|e| e.to_string())
    })
    .await;
    let _ = app.emit_to(MAIN, "vault-committed", kasten_core::Tick::default());
    written
}

/// Gets the latest from the backup remote: the other computer's changes
/// come in beside this one's, and nothing is overwritten or lost.
#[tauri::command]
pub async fn get_latest(app: AppHandle, state: State<'_, OpenVault>) -> Result<Latest, String> {
    let kasten = state.require()?;
    let latest =
        blocking(move || kasten.get_latest(Instant::now()).map_err(|e| e.to_string())).await?;
    changed(&app, &latest);
    Ok(latest)
}

/// Gets the latest from a backup file, as from a remote.
#[tauri::command]
pub async fn get_latest_from_file(
    app: AppHandle,
    state: State<'_, OpenVault>,
    path: String,
) -> Result<Latest, String> {
    let kasten = state.require()?;
    let file = crate::commands::vaults::expand(&path, app.path().home_dir().ok());
    let latest = blocking(move || {
        kasten
            .get_latest_from_file(&file, Instant::now())
            .map_err(|e| e.to_string())
    })
    .await?;
    changed(&app, &latest);
    Ok(latest)
}

/// Whether the backup has changes this computer lacks, from a quick look
/// that waits at most twenty seconds; false when it can't tell.
#[tauri::command]
pub async fn backup_ahead(state: State<'_, OpenVault>) -> Result<bool, String> {
    let kasten = state.require()?;
    let answer = schedule::bounded(std::time::Duration::from_secs(20), move || {
        kasten.backup_ahead().unwrap_or(false)
    })
    .await;
    Ok(answer.unwrap_or(false))
}

/// Finishes a Get latest that was stopped part way, as on opening.
pub fn finish_on_open(app: &AppHandle, kasten: &Arc<Kasten>) {
    if !kasten.unfinished_get_latest() {
        return;
    }
    match kasten.finish_get_latest(Instant::now()) {
        Ok(Some(latest)) => changed(app, &latest),
        Ok(None) => {}
        Err(err) => {
            let _ = app.emit_to(
                MAIN,
                "vault-error",
                format!("Getting the latest did not finish: {err}"),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_files_never_go_inside_the_vault() {
        let base = std::env::temp_dir().join(format!("kasten-app-backup-{}", std::process::id()));
        let vault = base.join("vault");
        let inside = vault.join("backups");
        let outside = base.join("Dropbox");
        for dir in [&inside, &outside] {
            fs::create_dir_all(dir).unwrap();
        }
        assert!(
            refuse_folder(&inside, &vault)
                .unwrap()
                .contains("outside the vault")
        );
        assert!(refuse_folder(&vault, &vault).is_some());
        assert_eq!(refuse_folder(&outside, &vault), None);
        assert!(
            refuse_folder(&base.join("missing"), &vault)
                .unwrap()
                .starts_with("No folder")
        );
        let _ = fs::remove_dir_all(&base);
    }
}
