//! The tray icon, so Kasten is a click away while its window is closed:
//! open it, quick capture, back up now, get the latest, and quit, which
//! writes open pages first as closing does.

use std::sync::Arc;

use kasten_core::Instant;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::app_settings::AppSettings;
use crate::closing::MAIN;
use crate::commands::notes::OpenVault;

/// The capture item, whose shortcut changes with the setting.
struct CaptureItem(MenuItem<Wry>);

/// Puts the icon in the tray; a desktop without one just has none.
pub fn start(app: &AppHandle) {
    if let Err(err) = build(app) {
        eprintln!("No tray icon: {err}");
    }
}

fn build(app: &AppHandle) -> tauri::Result<()> {
    let shortcut = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| AppSettings::load(&dir).capture_shortcut)
        .unwrap_or_else(|| crate::shortcut::DEFAULT.to_owned());
    let open = MenuItem::with_id(app, "open", "Open KastenFlow", true, None::<&str>)?;
    let capture = MenuItem::with_id(
        app,
        "capture",
        "Quick capture",
        true,
        Some(shortcut.as_str()),
    )?;
    let backup = MenuItem::with_id(app, "backup", "Back up now", true, None::<&str>)?;
    let latest = MenuItem::with_id(app, "latest", "Get latest", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit KastenFlow", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &capture,
            &PredefinedMenuItem::separator(app)?,
            &backup,
            &latest,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("kasten")
        .tooltip("KastenFlow")
        .menu(&menu)
        // A Mac's menu bar opens its menu on a click; elsewhere a click
        // opens the window and the menu is on the other button.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| chosen(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
                && !cfg!(target_os = "macos")
            {
                crate::main_window::show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(CaptureItem(capture));
    Ok(())
}

/// Shows the new shortcut beside Quick capture.
pub fn shortcut_changed(app: &AppHandle, shortcut: &str) {
    if let Some(item) = app.try_state::<CaptureItem>() {
        let _ = item.0.set_accelerator(Some(shortcut));
    }
}

fn chosen(app: &AppHandle, id: &str) {
    match id {
        "open" => crate::main_window::show_main(app),
        "capture" => crate::capture::show(app),
        "backup" => back_up_now(app),
        "latest" => {
            // The window writes open pages first, then gets the latest.
            crate::main_window::show_main(app);
            let _ = app.emit_to(MAIN, "kasten://get-latest", ());
        }
        "quit" => crate::closing::quit_when_written(app),
        _ => {}
    }
}

/// Commits what is waiting, pushes to the confirmed remote and writes a
/// backup file where a folder is set, off the menu's thread.
fn back_up_now(app: &AppHandle) {
    let Some(kasten) = app.state::<OpenVault>().kasten() else {
        return;
    };
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("kasten-backup-now".into())
        .spawn(move || {
            let failed = crate::crash::caught(|| Ok(back_up(&app, &kasten))).unwrap_or(true);
            if failed {
                crate::notify::tell(&app, crate::notify::Notice::BackupFailing);
            }
            let _ = app.emit_to(MAIN, "vault-committed", kasten_core::Tick::default());
        });
}

/// Backs up every way set up; true when one of them failed.
fn back_up(app: &AppHandle, kasten: &Arc<kasten_core::Kasten>) -> bool {
    let now = Instant::now();
    let _ = kasten.commit_edits();
    let _ = kasten.commit_external();
    let mut failed = false;
    use kasten_core::history::BackupState;
    // Only a remote confirmed on this computer; one the vault's settings
    // merely name waits for the person in Settings.
    if !matches!(
        kasten.backup_status(now.millis).state,
        BackupState::Off | BackupState::Unconfirmed
    ) {
        failed |= kasten.push(now.millis).is_err();
    }
    let folder = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| crate::backup::backup_folder(&AppSettings::load(&dir), kasten));
    if let Some(folder) = folder {
        failed |= kasten
            .write_backup_file(&folder, &crate::backup::computer_name(), now)
            .is_err();
    }
    failed
}
