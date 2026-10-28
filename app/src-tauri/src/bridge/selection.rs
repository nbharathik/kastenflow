//! Sharing the person's selection with a client that asked for it. The core
//! keeps the rules (`kasten_core::bridge::Sharing`: five snippets, 20 KB each,
//! two minutes after the last ask, owner-only, never in history); this is the
//! app's part. A client's ask (`Call::WatchSelection`) tells the window to
//! publish what is selected; the window answers with `selection_publish`
//! whenever it changes; a thread renews the file's time while it is shared and
//! takes the file away when no client asked for two minutes. The window shows
//! "Shared with a connected client" for as long as it is shared.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use kasten_core::Instant;
use kasten_core::bridge::{Mailbox, Sharing, Snippet, Tick};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::closing::MAIN;

/// The event that tells the window to publish its selection, or to stop.
const WATCH: &str = "kasten://selection-watch";
/// How often the clock is looked at.
const EVERY: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, Serialize)]
struct Watch {
    on: bool,
}

/// Whether the selection is shared, and where it is written.
pub struct Share {
    pub sharing: Sharing,
    mailbox: Mailbox,
}

impl Share {
    pub fn new(mailbox: Mailbox) -> Share {
        // What an earlier run left behind (a crash) is not shared with anyone.
        mailbox.clear_selection();
        Share {
            sharing: Sharing::default(),
            mailbox,
        }
    }

    /// The window sent what is selected.
    pub fn publish(&self, snippets: &[Snippet], now: u64) -> Result<bool, String> {
        self.sharing
            .publish(&self.mailbox, snippets, now)
            .map_err(|err| err.to_string())
    }

    /// Looks at the clock (see `Sharing::tick`).
    pub fn tick(&self, now: u64) -> Tick {
        self.sharing.tick(&self.mailbox, now)
    }

    /// The app is closing: nothing is shared and the file goes.
    pub fn stop(&self) {
        self.sharing.stop(&self.mailbox);
    }
}

/// Tells the window that the selection is shared (`on`) or no longer is.
pub fn tell(app: &AppHandle, on: bool) {
    let _ = app.emit_to(MAIN, WATCH, Watch { on });
}

fn share_of(app: &AppHandle) -> Option<Arc<Share>> {
    app.try_state::<Arc<Share>>().map(|s| Arc::clone(&s))
}

/// The window's selection, as the snippets the person sees shared. Written
/// only while a client has asked; false when nothing was written.
#[tauri::command]
pub fn selection_publish(app: AppHandle, snippets: Vec<Snippet>) -> Result<bool, String> {
    match share_of(&app) {
        Some(share) => share.publish(&snippets, Instant::now().millis),
        None => Ok(false),
    }
}

/// Whether the selection is shared now (the window asks as it starts).
#[tauri::command]
pub fn selection_watching(app: AppHandle) -> bool {
    share_of(&app).is_some_and(|share| share.sharing.on(Instant::now().millis))
}

/// The thread that looks at the clock while the app runs.
pub struct Ticker {
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Ticker {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let thread = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(thread) = thread {
            let _ = thread.join();
        }
    }
}

/// Starts looking at the clock: the file's time is renewed while it is shared,
/// and the window is told when the sharing lapses.
pub fn spawn_ticker(app: AppHandle, share: Arc<Share>) -> Option<Ticker> {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let thread = std::thread::Builder::new()
        .name("kasten-selection".into())
        .spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                if share.tick(Instant::now().millis) == Tick::Lapsed {
                    tell(&app, false);
                }
                std::thread::sleep(EVERY);
            }
        })
        .ok()?;
    Some(Ticker {
        stop,
        thread: Mutex::new(Some(thread)),
    })
}
