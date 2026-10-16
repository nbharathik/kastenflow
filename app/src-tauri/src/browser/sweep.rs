//! A web view that stays hidden costs a process and does nothing. Every
//! minute the ones hidden for ten minutes or more are closed, the same way
//! the one used least recently is when a fifth is wanted: the tab keeps its
//! address and loads it again when it is shown.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use super::{Browser, drop_view};

/// How often hidden views are looked for.
pub const EVERY: Duration = Duration::from_secs(60);

/// How long a view may stay hidden.
pub const IDLE: Duration = Duration::from_secs(10 * 60);

/// Starts looking, for as long as the app runs.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(EVERY);
        loop {
            tick.tick().await;
            sweep(&app, Instant::now(), IDLE);
        }
    });
}

/// Closes the views hidden for `idle` or longer at `now`; says how many went.
fn sweep(app: &AppHandle, now: Instant, idle: Duration) -> usize {
    let browser = app.state::<Browser>();
    let stale = browser.reg(|r| r.stale(now, idle));
    for id in &stale {
        drop_view(app, &browser, id, true);
    }
    stale.len()
}
