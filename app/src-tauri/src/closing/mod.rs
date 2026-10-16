//! Quitting, restarting and hiding the window write the page's waiting
//! typing first. The request is held and the page is asked to write what
//! is waiting (features/workspace/page/close-writes.ts); it calls
//! `pages_written` when that is done. A page that does not answer, busy or
//! broken, never keeps the app open: after a few seconds it goes ahead
//! anyway, and asking again goes ahead at once.
//!
//! `flow.rs` decides what each request does; this carries it out. Only the
//! main window takes part: any other window closes on its own.

mod flow;

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, ExitRequestApi, Manager, Window, WindowEvent};

use crate::app_settings::AppSettings;

pub use flow::Then;
use flow::{Act, Event, Flow};

/// The label of the window the flow belongs to.
pub const MAIN: &str = "main";

/// The event the page writes its waiting typing on.
const WRITE_NOW: &str = "kasten://closing";

/// How long the page has to write before the app goes ahead anyway.
const GRACE: Duration = Duration::from_secs(3);

static FLOW: Mutex<Flow> = Mutex::new(Flow::new());

/// Feeds `event` to the flow and carries out its answer. Says whether a
/// request from the system should be held.
fn run(app: &AppHandle, event: Event) -> bool {
    // A panic inside a step cannot leave the flow half-changed: carry on.
    let step = FLOW.lock().unwrap_or_else(|e| e.into_inner()).on(event);
    match step.act {
        Act::Nothing => {}
        Act::AskPage { round } => ask_page(app, round),
        Act::Do(then) => carry_out(app, then),
    }
    step.hold
}

/// Asks the page to write, and goes ahead after the grace time whatever it
/// does.
fn ask_page(app: &AppHandle, round: u32) {
    if app.emit_to(MAIN, WRITE_NOW, ()).is_err() {
        run(app, Event::Written);
        return;
    }
    let app = app.clone();
    // Without a thread to wait on, the page's answer or a second request
    // still goes ahead.
    let _ = std::thread::Builder::new()
        .name("kasten-closing".into())
        .spawn(move || {
            std::thread::sleep(GRACE);
            run(&app, Event::GraceOver(round));
        });
}

fn carry_out(app: &AppHandle, then: Then) {
    // Chats that are working are saved as interrupted before the app goes.
    if matches!(then, Then::Quit | Then::Restart) {
        crate::chat::commands::interrupt_chats(app);
    }
    match then {
        Then::Hide => {
            if let Some(window) = app.get_webview_window(MAIN) {
                let _ = window.hide();
            }
            if !cfg!(target_os = "macos") {
                tell_once_it_keeps_running(app);
            }
        }
        Then::Quit => app.exit(0),
        // Unlike `restart`, this lets the exit run as usual first:
        // typing is committed and the window's place saved.
        Then::Restart => app.request_restart(),
    }
}

/// What closing the main window does: the window goes and Kasten keeps
/// running, in the Dock on a Mac, as Mac apps do, and in the tray
/// elsewhere; unless the person chose that closing quits, which a Mac's
/// Dock does not need.
pub fn closing_does(mac: bool, keep_running: bool) -> Then {
    if mac || keep_running {
        Then::Hide
    } else {
        Then::Quit
    }
}

fn settings(app: &AppHandle) -> Option<(std::path::PathBuf, AppSettings)> {
    let dir = app.path().app_config_dir().ok()?;
    let settings = AppSettings::load(&dir);
    Some((dir, settings))
}

/// The first time closing leaves Kasten running, a notice says so.
fn tell_once_it_keeps_running(app: &AppHandle) {
    let Some((dir, settings)) = settings(app) else {
        return;
    };
    if settings.told_keep_running {
        return;
    }
    crate::notify::tell(app, crate::notify::Notice::KeepsRunning);
    let _ = AppSettings::update(&dir, |s| s.told_keep_running = true);
}

/// Holds a request to close the main window until the page has written.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() != MAIN {
        return;
    }
    let app = window.app_handle();
    let keep = settings(app).is_none_or(|(_, s)| s.keeps_running());
    if run(
        app,
        Event::Asked(closing_does(cfg!(target_os = "macos"), keep)),
    ) {
        api.prevent_close();
    }
}

/// Quits once the page has written, as from the tray's Quit.
pub fn quit_when_written(app: &AppHandle) {
    run(app, Event::Asked(Then::Quit));
}

/// Holds a request to quit that comes from the person, such as Cmd+Q on
/// macOS; the app's own `exit` and `request_restart` go through.
pub fn on_exit_requested(app: &AppHandle, api: &ExitRequestApi, code: Option<i32>) {
    if code.is_none() && run(app, Event::Asked(Then::Quit)) {
        api.prevent_exit();
    }
}

/// Restarts the app once the page has written its waiting typing: on a
/// newly chosen vault, or on a new version.
pub fn restart_when_written(app: &AppHandle) {
    run(app, Event::Asked(Then::Restart));
}

/// The page has written what was waiting: what was asked now happens.
#[tauri::command]
pub fn pages_written(app: AppHandle) {
    run(&app, Event::Written);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_keeps_kasten_running_unless_asked_to_quit() {
        assert_eq!(closing_does(true, false), Then::Hide);
        assert_eq!(closing_does(true, true), Then::Hide);
        assert_eq!(closing_does(false, true), Then::Hide);
        assert_eq!(closing_does(false, false), Then::Quit);
    }
}
