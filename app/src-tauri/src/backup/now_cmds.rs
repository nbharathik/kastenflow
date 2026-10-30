//! "Back up now", which always answers, and the look at the backup for changes
//! other computers made. Each is one kasten-core op; nothing here touches
//! vault files. The window asks for the look on a timer and says whether an
//! open page has unsaved edits, which only it knows.

use kasten_core::backup::{AutoPull, BackUpNow};
use kasten_core::{Instant, Kasten};
use tauri::{AppHandle, Emitter, State};

use super::contract::BackupError;
use crate::closing::MAIN;
use crate::commands::notes::OpenVault;

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

/// Backs up now and answers: done (how many changes went), nothing to do, or
/// the reason nothing was sent.
#[tauri::command]
pub async fn backup_now(
    app: AppHandle,
    state: State<'_, OpenVault>,
) -> Result<BackUpNow, BackupError> {
    let kasten = state.require().map_err(BackupError::other)?;
    let answer = blocking(move || Ok(kasten.back_up_now(Instant::now().millis))).await?;
    let _ = app.emit_to(MAIN, "vault-committed", kasten_core::Tick::default());
    Ok(answer)
}

/// What the look at the backup should do now, without making it: whether a
/// look is due and, if the person's setting is automatic, could be taken in.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookDue {
    pub due: bool,
    pub can_take_in: bool,
}

fn due(kasten: &Kasten, unsaved_edits: bool) -> LookDue {
    LookDue {
        due: kasten.fetch_due(Instant::now().millis),
        can_take_in: kasten.can_auto_pull(unsaved_edits),
    }
}

/// Whether the backup is due to be looked at, and whether a fast-forward
/// could be taken in now. `unsaved_edits`: an open page has edits not yet saved.
#[tauri::command]
pub async fn backup_look_due(
    state: State<'_, OpenVault>,
    unsaved_edits: bool,
) -> Result<LookDue, BackupError> {
    let kasten = state.require().map_err(BackupError::other)?;
    blocking(move || Ok(due(&kasten, unsaved_edits))).await
}

/// Looks at the backup and, in the automatic setting, takes in what other
/// computers added when that is safe. Never a merge. `unsaved_edits`: an open
/// page has edits not yet saved, so nothing is taken in.
#[tauri::command]
pub async fn backup_look(
    app: AppHandle,
    state: State<'_, OpenVault>,
    unsaved_edits: bool,
) -> Result<AutoPull, BackupError> {
    let kasten = state.require().map_err(BackupError::other)?;
    let answer = blocking(move || Ok(kasten.auto_pull(Instant::now(), unsaved_edits)?)).await?;
    if matches!(answer, AutoPull::Brought { .. }) {
        let _ = app.emit_to(MAIN, "vault-committed", kasten_core::Tick::default());
    }
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kasten_core::backup::Held;

    #[test]
    fn the_answers_say_their_shape_to_the_window() {
        let held = serde_json::to_value(AutoPull::Held {
            why: Held::UnsavedEdits,
        })
        .unwrap();
        assert_eq!(held["result"], "held");
        assert_eq!(held["why"], "unsavedEdits");
        let brought = serde_json::to_value(AutoPull::Brought {
            changes: 4,
            files: 2,
            head: "abc".into(),
        })
        .unwrap();
        assert_eq!(
            (brought["result"].as_str(), brought["changes"].as_u64()),
            (Some("brought"), Some(4))
        );
        let done = serde_json::to_value(BackUpNow::Done { sent: 3 }).unwrap();
        assert_eq!(
            (done["answer"].as_str(), done["sent"].as_u64()),
            (Some("done"), Some(3))
        );
        let nothing = serde_json::to_value(BackUpNow::NothingToDo).unwrap();
        assert_eq!(nothing["answer"], "nothingToDo");
    }
}
