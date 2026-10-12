//! The quick capture window: a small box over whatever the person is doing,
//! opened by the global shortcut, the tray or `kasten-app --capture`. It is
//! made on first use and hidden, never closed, so a draft waits for the
//! next time. Saving goes through the same core commands as the main
//! window; the main window then hears what was captured.

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use crate::closing::MAIN;

pub const CAPTURE: &str = "capture";
const WIDTH: f64 = 560.0;
const HEIGHT: f64 = 200.0;
/// The tallest the window grows to while its place picker is open.
const MAX_HEIGHT: f64 = 560.0;

/// The height asked for, kept between the box's own height and the most the
/// picker may take (a number that is not one means the box's own).
pub fn clamp_height(asked: f64) -> f64 {
    if asked.is_nan() {
        HEIGHT
    } else {
        asked.clamp(HEIGHT, MAX_HEIGHT)
    }
}

/// Where a window of `size` goes to sit a third of the way down the
/// monitor at `origin` of `area`, centred across it.
pub fn place(origin: (i32, i32), area: (u32, u32), size: (u32, u32)) -> (i32, i32) {
    let x = origin.0 + (area.0.saturating_sub(size.0) / 2) as i32;
    let y = origin.1 + (area.1.saturating_sub(size.1) / 3) as i32;
    (x, y)
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(found) = app.get_webview_window(CAPTURE) {
        return Some(found);
    }
    let built = WebviewWindowBuilder::new(app, CAPTURE, WebviewUrl::App("capture.html".into()))
        .title("Quick capture")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .build();
    match built {
        Ok(made) => Some(made),
        Err(err) => {
            eprintln!("The quick capture window could not open: {err}");
            None
        }
    }
}

/// Puts the window on the monitor the pointer is on.
fn centre_on_pointer(app: &AppHandle, window: &WebviewWindow) {
    let Ok(pointer) = app.cursor_position() else {
        let _ = window.center();
        return;
    };
    let monitor = app
        .monitor_from_point(pointer.x, pointer.y)
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, window.outer_size()) else {
        let _ = window.center();
        return;
    };
    let area = monitor.work_area();
    let (x, y) = place(
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
        (size.width, size.height),
    );
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Shows the capture box, ready to type in.
pub fn show(app: &AppHandle) {
    let Some(window) = window(app) else {
        return;
    };
    centre_on_pointer(app, &window);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(CAPTURE, "kasten://capture-open", ());
}

/// Shows the capture box, or hides it when it is the window in front.
pub fn toggle(app: &AppHandle) {
    let open = app
        .get_webview_window(CAPTURE)
        .is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
    if open { hide(app) } else { show(app) }
}

fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(CAPTURE) {
        let _ = window.hide();
    }
}

/// The capture window hides when it loses focus or is asked to close;
/// its draft stays for next time.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != CAPTURE {
        return;
    }
    match event {
        WindowEvent::Focused(false) => {
            let _ = window.hide();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        _ => {}
    }
}

#[tauri::command]
pub fn capture_hide(app: AppHandle) {
    hide(&app);
}

/// Gives the capture window room for its place picker (a height in logical
/// pixels), or takes it back, keeping its top left where it is. Only this
/// window's height changes, and never beyond what the picker needs.
#[tauri::command]
pub fn capture_resize(app: AppHandle, height: f64) {
    if let Some(window) = app.get_webview_window(CAPTURE) {
        let _ = window.set_size(LogicalSize::new(WIDTH, clamp_height(height)));
    }
}

/// What was captured, for the main window's notice.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Captured {
    pub path: String,
    pub title: String,
    /// Where it went, in words: "Inbox", "Today's journal", a project.
    pub place: String,
}

/// The capture window saved something: it hides, and the main window
/// hears so it can show it.
#[tauri::command]
pub fn capture_done(app: AppHandle, captured: Captured) {
    hide(&app);
    let _ = app.emit_to(MAIN, "kasten://captured", captured);
}

#[cfg(test)]
mod tests {
    use super::{clamp_height, place};

    #[test]
    fn the_picker_may_grow_the_window_only_so_far() {
        assert_eq!(clamp_height(420.0), 420.0);
        // Never shorter than the box, never taller than the picker needs.
        assert_eq!(clamp_height(50.0), 200.0);
        assert_eq!(clamp_height(5000.0), 560.0);
        assert_eq!(clamp_height(f64::NAN), 200.0);
        assert_eq!(clamp_height(f64::INFINITY), 560.0);
        assert_eq!(clamp_height(f64::NEG_INFINITY), 200.0);
    }

    #[test]
    fn sits_a_third_down_the_monitor_it_is_on() {
        assert_eq!(place((0, 0), (1920, 1080), (560, 200)), (680, 293));
        // A second monitor to the left keeps its own origin.
        assert_eq!(place((-1440, 0), (1440, 900), (560, 200)), (-1000, 233));
        // A window larger than the monitor starts at its corner.
        assert_eq!(place((0, 0), (400, 100), (560, 200)), (0, 0));
    }
}
