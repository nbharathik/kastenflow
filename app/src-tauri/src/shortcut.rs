//! The quick capture shortcut, which works from any app: registered at
//! start from the app's settings (CmdOrCtrl+Shift+Space by default) and
//! changed from Settings, which hears when another app has it already.
//! Wayland lets no app take a key for the whole desktop, so there the
//! person binds `kasten-app --capture` in their desktop's own settings.

use std::str::FromStr;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::app_settings::AppSettings;

pub const DEFAULT: &str = "CmdOrCtrl+Shift+Space";

/// A shortcut Kasten will take: it must hold a modifier other than Shift,
/// or it would steal plain typing in every other app.
pub fn parse(text: &str) -> Result<Shortcut, String> {
    let shortcut = Shortcut::from_str(text.trim())
        .map_err(|_| format!("“{text}” is not a shortcut KastenFlow knows"))?;
    let held = shortcut.mods - Modifiers::SHIFT;
    if held.is_empty() {
        return Err(
            "A shortcut for every app needs Ctrl, Alt or Cmd, so it doesn't catch plain typing"
                .into(),
        );
    }
    Ok(shortcut)
}

/// The shortcut as the person reads it: `⌘⇧Space` on a Mac,
/// `Ctrl+Shift+Space` elsewhere.
pub fn label(text: &str, mac: bool) -> String {
    let mut parts: Vec<String> = Vec::new();
    for part in text.split('+').map(str::trim).filter(|p| !p.is_empty()) {
        let upper = part.to_uppercase();
        let shown = match upper.as_str() {
            "CMDORCTRL" | "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCONTROL" => {
                if mac {
                    "⌘"
                } else {
                    "Ctrl"
                }
            }
            "CMD" | "COMMAND" | "SUPER" | "META" => {
                if mac {
                    "⌘"
                } else {
                    "Super"
                }
            }
            "CTRL" | "CONTROL" => {
                if mac {
                    "⌃"
                } else {
                    "Ctrl"
                }
            }
            "ALT" | "OPTION" => {
                if mac {
                    "⌥"
                } else {
                    "Alt"
                }
            }
            "SHIFT" => {
                if mac {
                    "⇧"
                } else {
                    "Shift"
                }
            }
            _ => part,
        };
        parts.push(
            shown
                .strip_prefix("Key")
                .filter(|k| k.len() == 1)
                .unwrap_or(shown)
                .to_owned(),
        );
    }
    parts.join(if mac { "" } else { "+" })
}

/// Whether this desktop lets no app take a key everywhere.
pub fn wayland() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE").is_ok_and(|t| t.eq_ignore_ascii_case("wayland"))
            || std::env::var_os("WAYLAND_DISPLAY").is_some())
}

fn chosen(app: &AppHandle) -> String {
    app.path()
        .app_config_dir()
        .ok()
        .and_then(|dir| AppSettings::load(&dir).capture_shortcut)
        .unwrap_or_else(|| DEFAULT.to_owned())
}

fn take(app: &AppHandle, text: &str) -> Result<(), String> {
    let shortcut = parse(text)?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                crate::capture::toggle(app);
            }
        })
        .map_err(|_| {
            format!(
                "{} is taken by another app or the system; choose another",
                label(text, cfg!(target_os = "macos"))
            )
        })
}

/// Takes the chosen shortcut at start; one another app has is left alone.
pub fn start(app: &AppHandle) {
    if wayland() {
        return;
    }
    if let Err(problem) = take(app, &chosen(app)) {
        eprintln!("Quick capture has no shortcut: {problem}");
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureShortcut {
    pub shortcut: String,
    pub label: String,
    /// This desktop takes no shortcut for every app: bind the command in
    /// its own settings instead.
    pub wayland: bool,
    /// What to bind there.
    pub command: String,
}

#[tauri::command(async)]
pub fn capture_shortcut(app: AppHandle) -> CaptureShortcut {
    let shortcut = chosen(&app);
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "kasten-app".to_owned());
    CaptureShortcut {
        label: label(&shortcut, cfg!(target_os = "macos")),
        shortcut,
        wayland: wayland(),
        command: format!("\"{exe}\" --capture"),
    }
}

/// Changes the shortcut, or puts back the default with None. A shortcut
/// another app has is refused and the old one stays.
#[tauri::command]
pub fn set_capture_shortcut(
    app: AppHandle,
    shortcut: Option<String>,
) -> Result<CaptureShortcut, String> {
    let next = shortcut
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT.to_owned());
    parse(&next)?;
    let before = chosen(&app);
    if let Ok(old) = parse(&before) {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Err(problem) = take(&app, &next) {
        let _ = take(&app, &before);
        return Err(problem);
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let kept = (next != DEFAULT).then(|| next.clone());
    AppSettings::update(&dir, |s| s.capture_shortcut = kept).map_err(|e| e.to_string())?;
    crate::tray::shortcut_changed(&app, &next);
    Ok(capture_shortcut(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_only_shortcuts_with_a_real_modifier() {
        assert!(parse(DEFAULT).is_ok());
        assert!(parse("Alt+KeyN").is_ok());
        assert!(parse("Ctrl+Shift+K").is_ok());
        assert!(
            parse("Shift+KeyA")
                .unwrap_err()
                .contains("Ctrl, Alt or Cmd")
        );
        assert!(parse("KeyA").is_err());
        assert!(
            parse("Ctrl+Nonsense")
                .unwrap_err()
                .contains("not a shortcut")
        );
    }

    #[test]
    fn reads_as_each_system_writes_it() {
        assert_eq!(label(DEFAULT, true), "⌘⇧Space");
        assert_eq!(label(DEFAULT, false), "Ctrl+Shift+Space");
        assert_eq!(label("Alt+KeyN", false), "Alt+N");
        assert_eq!(label("Ctrl+Alt+KeyJ", true), "⌃⌥J");
    }
}
