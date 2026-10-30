//! What runs beside the commands while the app is open: the watcher, which
//! indexes changes made outside Kasten and tells the window, and the clock,
//! which commits quiet edits, pushes backups on schedule and writes the
//! daily backup file. The clock and the backup thread sleep until their next
//! work is due or the engine reports a change (engine `wake_workers`), not on
//! a five-second beat: a quiet vault wakes them only for a safety check
//! every ten minutes.

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
    // Every change to the vault's files, whoever made it, moves a counter the
    // window's views watch. The core calls this once its write lock is free.
    let counted = app.clone();
    kasten.on_revision(move |revision| {
        let _ = counted.emit_to(MAIN, "vault-revision", &revision);
    });
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
            let mut last = std::time::Instant::now();
            loop {
                pace(&mut last);
                // Read before looking at what is pending, so a change made
                // while this round runs ends the sleep below at once.
                let mark = kasten.work_mark();
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
                // Sleep until the quiet spell of what waits for a commit is
                // over, or until the engine reports a change. With nothing
                // pending, only a change (or the safety limit) wakes the clock.
                let wait = kasten
                    .commit_wait(Instant::now().millis)
                    .map_or(SAFETY, |ms| Duration::from_millis(ms).min(SAFETY));
                kasten.wait_for_work(mark, wait);
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
            let mut looks = crate::git_host::visibility::Looks::new();
            let mut pushes = crate::notify::Streak::default();
            let mut files = crate::notify::Streak::default();
            let mut last = std::time::Instant::now();
            let mut file_look = last;
            loop {
                pace(&mut last);
                let mark = pushing.work_mark();
                // Who can see the backup repository: at the start, then daily.
                if looks.due() {
                    crate::git_host::visibility::tick(&backup, &pushing, &mut looks);
                }
                // The daily backup file, looked at once a minute at most.
                if file_look.elapsed() >= FILE_LOOK
                    && let Some(dir) = &settings
                {
                    file_look = std::time::Instant::now();
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
                // Sleep until the next look at the repository, push or daily
                // file is due, or until the engine reports a change. With
                // none of them waiting, only a change (or the safety limit)
                // wakes this thread.
                let mut wait = SAFETY.min(looks.next_in());
                if let Some(ms) = pushing.push_wait(Instant::now().millis) {
                    wait = wait.min(Duration::from_millis(ms));
                }
                if let Some(dir) = &settings
                    && let Some(due) = crate::backup::file_wait(&pushing, dir)
                {
                    wait = wait.min(due.max(FILE_LOOK.saturating_sub(file_look.elapsed())));
                }
                pushing.wait_for_work(mark, wait);
            }
        });
    if let Err(err) = started {
        eprintln!("Backups cannot run on schedule: {err}");
    }
    watcher
}

/// The fastest either thread goes round, however busy the vault: changes
/// make it go round at once, but never more often than the old five-second
/// clock did.
const PACE: Duration = Duration::from_secs(5);

/// The longest either thread sleeps with nothing waiting. The engine wakes
/// them for every change it sees; this only covers one it cannot, such as a
/// git command run by hand in the vault.
const SAFETY: Duration = Duration::from_secs(10 * 60);

/// How seldom the daily backup file is looked at.
const FILE_LOOK: Duration = Duration::from_secs(60);

/// Sleeps out what is left of `PACE` since `last` and starts the next round.
fn pace(last: &mut std::time::Instant) {
    std::thread::sleep(PACE.saturating_sub(last.elapsed()));
    *last = std::time::Instant::now();
}
