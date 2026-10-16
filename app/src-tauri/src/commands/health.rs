//! Tauri commands for the vault's health: a read-only check of what needs
//! attention. The core adds up the vault; this adds what only the app knows.

use kasten_core::{Health, Instant};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::notes::OpenVault;
use crate::app_settings::AppSettings;
use crate::meaning::{MeaningState, MeaningStatus};

/// The core's report with the app's part.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppHealth {
    #[serde(flatten)]
    pub health: Health,
    /// The folder backup files go to on this computer, if one is set.
    pub backup_folder: Option<String>,
    /// How far search by meaning covers the vault; none if it cannot be told.
    pub meaning: Option<MeaningStatus>,
    pub app_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use kasten_core::Kasten;

    #[test]
    fn the_apps_part_sits_beside_the_cores_in_one_flat_object() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-app-health-{}",
            kasten_core::ulid_at(Instant::now().millis)
        ));
        let kasten = Kasten::init(&dir, "Health").unwrap();
        let report = AppHealth {
            health: kasten.health(Instant::now().millis),
            backup_folder: Some("D:/backups".to_owned()),
            meaning: None,
            app_version: "1.2.0".to_owned(),
        };
        let json = serde_json::to_value(&report).unwrap();
        for key in [
            "revision",
            "counts",
            "index",
            "history",
            "backup",
            "proposals",
            "trash",
            "conflicts",
            "lastCheck",
            "format",
            "backupFolder",
            "meaning",
            "appVersion",
        ] {
            assert!(json.get(key).is_some(), "missing {key} in {json}");
        }
        assert_eq!(json["backupFolder"], "D:/backups");
        assert_eq!(json["appVersion"], "1.2.0");
        assert!(json["revision"]["epoch"].as_u64().unwrap() > 0);
        drop(kasten);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// How the vault stands: its files, index, history, backup, review queue and
/// trash, the last check, and the backup folder and search by meaning.
#[tauri::command(async)]
pub fn vault_health(
    app: AppHandle,
    state: State<'_, OpenVault>,
    meaning: State<'_, MeaningState>,
) -> Result<AppHealth, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let settings = AppSettings::load(&dir);
    let kasten = state.require()?;
    crate::crash::caught(|| {
        let folder = crate::backup::backup_folder(&settings, &kasten);
        let mut health = kasten.health(Instant::now().millis);
        // Backup files are looked after only where a folder is set.
        if folder.is_none() {
            health.backup_file = None;
        }
        Ok(AppHealth {
            health,
            backup_folder: folder.map(|f| f.display().to_string()),
            meaning: crate::meaning::status_of(&kasten, &meaning).ok(),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
        })
    })
}
