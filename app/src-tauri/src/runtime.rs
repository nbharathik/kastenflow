//! What runs beside the commands while the app is open: the watcher, which
//! indexes changes made outside Kasten and tells the window, and the clock,
//! which commits quiet edits, pushes backups on schedule and writes the
//! daily backup file.

use std::sync::Arc;
use std::time::Duration;

use kasten_core::history::BackupState;
use kasten_core::watch::{VaultWatcher, watch};
use kasten_core::{Instant, Kasten};
use tauri::{AppHandle, Emitter, Manager};

use crate::closing::MAIN;
use crate::crash;

/// Starts the watcher and the clock; the watcher stops when dropped.
pub fn start(app: &AppHandle, kasten: Arc<Kasten>) -> Option<VaultWatcher> {
    let events = app.clone();
    let for_watch = Arc::clone(&kasten);
    let watcher = watch(kasten.root(), move |paths| {
        // A slip while indexing one change must not stop the watcher.
        let indexed = crash::caught(|| {
            for_watch.outside_changes(&paths, Instant::now().millis);
            Ok(())
        });
        match indexed {
            Ok(()) => {
                // To the main window only: the browser tab's webviews hear nothing.
                let _ = events.emit_to(MAIN, "vault-changed", &paths);
            }
            Err(problem) => {
                let _ = events.emit_to(MAIN, "vault-error", problem);
            }
        }
    })
    .inspect_err(|err| {
        eprintln!("Changes made outside KastenFlow will show after a restart: {err}")
    })
    .ok();

    let pushing = Arc::clone(&kasten);
    let clock = app.clone();
    let started = std::thread::Builder::new()
        .name("kasten-clock".into())
        .spawn(move || {
            // A cache an earlier version committed leaves history once.
            if let Err(problem) =
                crash::caught(|| kasten.untrack_local_files().map_err(|err| err.to_string()))
            {
                let _ = clock.emit_to(MAIN, "vault-error", problem);
            }
            loop {
                std::thread::sleep(Duration::from_secs(5));
                // A slip in one tick must not end the clock, or edits
                // would stop being committed.
                let ticked = crash::caught(|| {
                    kasten
                        .commit_tick(Instant::now().millis)
                        .map_err(|err| err.to_string())
                });
                match ticked {
                    Ok(tick) if tick.edits.is_some() || tick.external.is_some() || tick.pushed => {
                        let _ = clock.emit_to(MAIN, "vault-committed", &tick);
                    }
                    Ok(_) => {}
                    Err(problem) => {
                        let _ = clock.emit_to(MAIN, "vault-error", problem);
                    }
                }
            }
        });
    if let Err(err) = started {
        eprintln!("Edits cannot be committed on schedule: {err}");
    }

    // Backups on a thread of their own: a push can wait on the network for
    // minutes, and the commits above must not wait with it.
    let backup = app.clone();
    let settings = app.path().app_config_dir().ok();
    let started = std::thread::Builder::new()
        .name("kasten-backup".into())
        .spawn(move || {
            let mut tick: u64 = 0;
            let mut pushes = crate::notify::Streak::default();
            let mut files = crate::notify::Streak::default();
            loop {
                std::thread::sleep(Duration::from_secs(5));
                tick = tick.wrapping_add(1);
                // The daily backup file, looked at once a minute.
                if tick.is_multiple_of(12)
                    && let Some(dir) = &settings
                {
                    let wrote = crash::caught(|| Ok(crate::backup::file_if_due(&pushing, dir)));
                    match wrote {
                        Ok(Some(written)) => {
                            let failing = written.is_err()
                                && pushing.backup_file_status(Instant::now().millis).state
                                    == BackupState::Failing;
                            if files.failing(failing) {
                                crate::notify::tell(
                                    &backup,
                                    crate::notify::Notice::BackupFileFailing,
                                );
                            }
                            let _ = backup.emit_to(
                                MAIN,
                                "vault-committed",
                                kasten_core::Tick::default(),
                            );
                        }
                        Ok(None) => {}
                        Err(problem) => {
                            let _ = backup.emit_to(MAIN, "vault-error", problem);
                        }
                    }
                }
                let pushed = crash::caught(|| {
                    Ok(pushing
                        .push_if_due(Instant::now().millis)
                        .map(|pushed| pushed.is_ok()))
                });
                if let Ok(Some(worked)) = pushed {
                    let failing = !worked
                        && pushing.backup_status(Instant::now().millis).state
                            == BackupState::Failing;
                    if pushes.failing(failing) {
                        crate::notify::tell(&backup, crate::notify::Notice::BackupFailing);
                    }
                }
                match pushed {
                    Ok(Some(true)) => {
                        let tick = kasten_core::Tick {
                            pushed: true,
                            ..Default::default()
                        };
                        let _ = backup.emit_to(MAIN, "vault-committed", &tick);
                    }
                    // A failed push is in the backup status the window reads.
                    Ok(_) => {}
                    Err(problem) => {
                        let _ = backup.emit_to(MAIN, "vault-error", problem);
                    }
                }
            }
        });
    if let Err(err) = started {
        eprintln!("Backups cannot run on schedule: {err}");
    }
    watcher
}
