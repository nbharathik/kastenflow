//! Vault-wide commands: status and backup, history and restore, settings
//! and the integrity check.

use kasten_core::history::{Actor, BackupStatus, CommitInfo};
use kasten_core::{
    BackupFileStatus, Config, Instant, Kasten, NoteFile, Report, Revision, VaultRestore,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::notes::OpenVault;
use crate::app_settings::AppSettings;

/// Confirms the vault's backup remote on this computer, or forgets it:
/// kept in the app's settings, outside the vault, and given to the core,
/// which pushes nowhere else.
pub(crate) fn confirm(
    app: &AppHandle,
    kasten: &Kasten,
    remote: Option<&str>,
) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let folder = kasten.root().display().to_string();
    AppSettings::update(&dir, |settings| settings.confirm_remote(&folder, remote))
        .map_err(|e| format!("Could not save the backup remote: {e}"))?;
    kasten.confirm_remote(remote);
    Ok(())
}

/// What the status bar and settings show about the open vault.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub name: String,
    pub root: String,
    /// Whether the vault has git history.
    pub history: bool,
    pub remote: Option<String>,
    pub backup: BackupStatus,
    /// Human edits waiting for their commit.
    pub pending: usize,
    /// The folder backup files go to on this computer, if one is set.
    pub backup_folder: Option<String>,
    /// How the backup files stand, when a folder is set.
    pub backup_file: Option<BackupFileStatus>,
    /// This computer's name, which its backup files carry.
    pub computer: String,
    /// A Get latest stopped part way and waits to be finished.
    pub unfinished: bool,
    /// The sync app whose folder holds the vault, if any.
    pub synced: Option<String>,
}

/// Resolves once the vault is open, or with why it could not be: the
/// window asks this before anything else.
#[tauri::command]
pub async fn vault_ready(state: State<'_, OpenVault>) -> Result<(), String> {
    state.ready().await
}

#[tauri::command(async)]
pub fn vault_status(app: AppHandle, state: State<'_, OpenVault>) -> Result<VaultStatus, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let settings = AppSettings::load(&dir);
    state.run(|k| {
        let config = k.config();
        let now = Instant::now().millis;
        let folder = crate::backup::backup_folder(&settings, k);
        Ok(VaultStatus {
            name: config.name,
            root: k.root().display().to_string(),
            history: k.has_history(),
            remote: config.git.remote,
            backup: k.backup_status(now),
            pending: k.pending_edits().len(),
            backup_file: folder.as_ref().map(|_| k.backup_file_status(now)),
            backup_folder: folder.map(|f| f.display().to_string()),
            computer: crate::backup::computer_name(),
            unfinished: k.unfinished_get_latest(),
            synced: kasten_core::synced_by(k.root(), app.path().home_dir().ok().as_deref())
                .map(str::to_owned),
        })
    })
}

/// Commits the typing done so far, as `edit: <title>` (on leaving a page).
#[tauri::command(async)]
pub fn commit_edits(state: State<'_, OpenVault>) -> Result<Option<String>, String> {
    state.run(|k| k.commit_edits())
}

#[tauri::command(async)]
pub fn start_history(state: State<'_, OpenVault>) -> Result<(), String> {
    state.run(|k| k.start_history())
}

/// Backs up now. Asking for a backup to the remote Settings shows
/// confirms it on this computer.
#[tauri::command(async)]
pub fn push_now(app: AppHandle, state: State<'_, OpenVault>) -> Result<BackupStatus, String> {
    let kasten = state.require()?;
    confirm(&app, &kasten, kasten.config().git.remote.as_deref())?;
    state.run(|k| {
        let now = Instant::now().millis;
        k.commit_edits()?;
        k.push(now)?;
        Ok(k.backup_status(now))
    })
}

#[tauri::command(async)]
pub fn note_history(
    state: State<'_, OpenVault>,
    path: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<CommitInfo>, String> {
    state.run(|k| k.log(path.as_deref(), limit.unwrap_or(100)))
}

#[tauri::command(async)]
pub fn note_version(
    state: State<'_, OpenVault>,
    rev: String,
    path: String,
) -> Result<Option<String>, String> {
    state.run(|k| k.file_at(&rev, &path))
}

#[tauri::command(async)]
pub fn restore_version(
    state: State<'_, OpenVault>,
    path: String,
    rev: String,
) -> Result<NoteFile, String> {
    state.run(|k| {
        k.commit_edits()?;
        k.restore_version(&Actor::Human, &path, &rev, Instant::now())
    })
}

/// Puts the whole vault back as it was at `rev`, as one commit that undo
/// takes back; files made since go to the trash.
#[tauri::command(async)]
pub fn restore_vault(state: State<'_, OpenVault>, rev: String) -> Result<VaultRestore, String> {
    state.run(|k| {
        k.commit_edits()?;
        k.restore_vault(&Actor::Human, &rev, Instant::now())
    })
}

#[tauri::command(async)]
pub fn get_config(state: State<'_, OpenVault>) -> Result<Config, String> {
    state.run(|k| Ok(k.config()))
}

/// Saves the vault's settings. A backup remote typed in Settings is
/// confirmed by typing it.
#[tauri::command(async)]
pub fn set_config(
    app: AppHandle,
    state: State<'_, OpenVault>,
    config: Config,
) -> Result<(), String> {
    let kasten = state.require()?;
    let before = kasten.config().git.remote;
    let after = config.git.remote.clone();
    state.run(|k| k.set_config(config))?;
    if after != before {
        confirm(&app, &kasten, after.as_deref())?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn verify_vault(state: State<'_, OpenVault>) -> Result<Report, String> {
    state.run(|k| k.verify())
}

/// The vault's change counters as they are now; the window also hears each
/// change as a `vault-revision` event (runtime.rs).
#[tauri::command(async)]
pub fn vault_revision(state: State<'_, OpenVault>) -> Result<Revision, String> {
    state.run(|k| Ok(k.revision()))
}
