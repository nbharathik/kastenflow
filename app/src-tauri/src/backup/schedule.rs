//! What runs on its own: the daily backup file, once the vault is quiet,
//! and one last push as Kasten closes. Git's own network calls can't be
//! given a time limit here, so a wait for one runs on a thread of its own
//! and stops waiting after a while; the call finishes, or not, unseen.

use std::path::Path;
use std::sync::{Arc, mpsc};
use std::time::Duration;

use kasten_core::{BackupFile, Instant, Kasten};

use crate::app_settings::AppSettings;

/// How long closing waits for the last push.
const LAST_PUSH: Duration = Duration::from_secs(8);

/// Runs `job` on a thread of its own and answers what it gave, or None if
/// it took longer than `limit`.
pub(super) async fn bounded<T: Send + 'static>(
    limit: Duration,
    job: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    tauri::async_runtime::spawn_blocking(move || wait_at_most(limit, job))
        .await
        .ok()
        .flatten()
}

fn wait_at_most<T: Send + 'static>(
    limit: Duration,
    job: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (done, answer) = mpsc::channel();
    let started = std::thread::Builder::new()
        .name("kasten-network".into())
        .stack_size(crate::STACK_BYTES)
        .spawn(move || {
            let _ = done.send(job());
        });
    started.ok()?;
    answer.recv_timeout(limit).ok()
}

/// Writes the daily backup file when one is due and a folder is set for
/// this vault on this computer; None when nothing was due.
pub fn file_if_due(kasten: &Kasten, settings_dir: &Path) -> Option<Result<BackupFile, String>> {
    let now = Instant::now();
    if !kasten.backup_file_due(now.millis) {
        return None;
    }
    let folder = super::backup_folder(&AppSettings::load(settings_dir), kasten)?;
    Some(
        kasten
            .write_backup_file(&folder, &super::computer_name(), now)
            .map_err(|e| e.to_string()),
    )
}

/// How long until the daily backup file may be due, so the backup thread
/// can sleep that long; None when only a change can make one due: no folder
/// is set for this vault (setting one wakes the thread), or the engine has
/// nothing new to write.
pub fn file_wait(kasten: &Kasten, settings_dir: &Path) -> Option<Duration> {
    super::backup_folder(&AppSettings::load(settings_dir), kasten)?;
    kasten
        .backup_file_wait(Instant::now().millis)
        .map(Duration::from_millis)
}

/// One last push as Kasten closes, when the backup lacks something and no
/// push failed lately; closing waits for it eight seconds at most.
pub fn final_backup(kasten: &Arc<Kasten>) {
    let now = Instant::now().millis;
    if !kasten.push_on_close_due(now) {
        return;
    }
    let pushing = Arc::clone(kasten);
    let _ = wait_at_most(LAST_PUSH, move || {
        crate::crash::caught(|| pushing.push(now).map_err(|e| e.to_string()))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stops_waiting_after_the_limit() {
        assert_eq!(wait_at_most(Duration::from_secs(5), || 7), Some(7));
        let slow = wait_at_most(Duration::from_millis(20), || {
            std::thread::sleep(Duration::from_millis(500));
            7
        });
        assert_eq!(slow, None);
    }
}
