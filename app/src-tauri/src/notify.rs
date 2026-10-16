//! System notifications, only while Kasten is in the background and only
//! when the person hasn't switched them off in Settings: the backup has
//! started failing, the backup file has, a new version is ready, and, once,
//! that closing the window left Kasten running. The words never carry a
//! note's title or text.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::app_settings::AppSettings;
use crate::closing::MAIN;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Notice {
    BackupFailing,
    BackupFileFailing,
    UpdateReady {
        version: String,
    },
    KeepsRunning,
    /// A chat finished its answer.
    ChatAnswered,
    /// A chat paused and waits for the person to let it go on.
    ChatNeedsYou,
    /// A chat could not finish.
    ChatFailed,
}

impl Notice {
    /// The notice's title and body.
    pub fn words(&self) -> (&'static str, String) {
        match self {
            Notice::BackupFailing => (
                "KastenFlow can't back up",
                "Your notes are safe on this computer, but the backup isn't getting them. Open Settings → History and backup to see why.".into(),
            ),
            Notice::BackupFileFailing => (
                "KastenFlow can't write the backup file",
                "Your notes are safe on this computer. Open Settings → History and backup to see why.".into(),
            ),
            Notice::UpdateReady { version } => ("KastenFlow update ready", format!("Version {version} installs when you restart KastenFlow.")),
            Notice::KeepsRunning => (
                "KastenFlow is still running",
                if cfg!(target_os = "linux") {
                    "It stays in the tray, and quick capture still works. Start KastenFlow again to open it, or quit from the tray.".into()
                } else {
                    "It stays in the tray, and quick capture still works. Quit from the tray icon.".into()
                },
            ),
            Notice::ChatAnswered => (
                "KastenFlow has an answer",
                "A chat finished. Open KastenFlow to read it.".into(),
            ),
            Notice::ChatNeedsYou => (
                "KastenFlow is waiting for you",
                "A chat paused. Open KastenFlow to let it go on.".into(),
            ),
            Notice::ChatFailed => (
                "KastenFlow could not finish a chat",
                "Open KastenFlow to see why.".into(),
            ),
        }
    }
}

/// Whether to show a notice: switched on, and Kasten not the window in
/// front, where the person sees the same news already.
pub fn wanted(switched_on: bool, in_front: bool) -> bool {
    switched_on && !in_front
}

fn in_front(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN)
        .is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
}

pub fn tell(app: &AppHandle, notice: Notice) {
    let switched_on = app
        .path()
        .app_config_dir()
        .map(|dir| AppSettings::load(&dir).notifies())
        .unwrap_or(true);
    if !wanted(switched_on, in_front(app)) {
        return;
    }
    let (title, body) = notice.words();
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Tells about a failing backup once per run of failures, not on every
/// try.
#[derive(Debug, Default)]
pub struct Streak {
    told: bool,
}

impl Streak {
    /// Notes whether the backup is failing now; true when this is news.
    pub fn failing(&mut self, failing: bool) -> bool {
        let news = failing && !self.told;
        self.told = failing;
        news
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_only_in_the_background_and_when_wanted() {
        assert!(wanted(true, false));
        assert!(!wanted(true, true));
        assert!(!wanted(false, false));
    }

    #[test]
    fn tells_once_per_run_of_failures() {
        let mut streak = Streak::default();
        assert!(!streak.failing(false));
        assert!(streak.failing(true));
        assert!(!streak.failing(true));
        assert!(!streak.failing(false));
        assert!(streak.failing(true));
    }

    #[test]
    fn never_names_a_note() {
        for notice in [
            Notice::BackupFailing,
            Notice::BackupFileFailing,
            Notice::KeepsRunning,
            Notice::ChatAnswered,
            Notice::ChatNeedsYou,
            Notice::ChatFailed,
        ] {
            let (title, body) = notice.words();
            assert!(title.starts_with("KastenFlow "), "{title}");
            assert!(!body.contains(".md"));
        }
        assert!(
            Notice::UpdateReady {
                version: "0.1.1".into()
            }
            .words()
            .1
            .contains("0.1.1")
        );
    }
}
