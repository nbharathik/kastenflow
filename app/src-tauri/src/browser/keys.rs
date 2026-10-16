//! Keys a page in a native view would swallow. A browser webview is a child of
//! the window, so while a page in one has the keyboard focus the window's own
//! page hears nothing: Ctrl+T, Ctrl+W and Ctrl+L would do nothing until the
//! person clicked back into KastenFlow. While that is so (the window is in
//! front and its own page lost the focus to a native view) these keys are taken
//! from the system, and Escape too while a deck's web preview is open, and told
//! to the main window alone. Nothing is injected into the page: a page could
//! forge what a script told. The keys are given back the moment the window's own
//! page has the focus again, the window is left, or a key is used.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use super::{Browser, held, policy};
use crate::closing::MAIN;

/// What the main window hears when a key was taken.
pub const EVENT: &str = "kasten://child-key";

/// A key taken while a native view has the focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    NewTab,
    CloseTab,
    Address,
    Escape,
}

impl Key {
    /// How the main window is told: the key as a `KeyboardEvent` names it.
    pub const fn name(self) -> &'static str {
        match self {
            Key::NewTab => "t",
            Key::CloseTab => "w",
            Key::Address => "l",
            Key::Escape => "Escape",
        }
    }

    fn shortcut(self, mac: bool) -> Shortcut {
        let command = if mac {
            Modifiers::SUPER
        } else {
            Modifiers::CONTROL
        };
        match self {
            Key::NewTab => Shortcut::new(Some(command), Code::KeyT),
            Key::CloseTab => Shortcut::new(Some(command), Code::KeyW),
            Key::Address => Shortcut::new(Some(command), Code::KeyL),
            Key::Escape => Shortcut::new(None, Code::Escape),
        }
    }
}

/// Where keys are taken and given back: the system's shortcut table, or a stand-in.
pub trait Registrar {
    fn register(&mut self, key: Key) -> Result<(), String>;
    fn unregister(&mut self, key: Key);
}

/// What is true of the focus, and which keys are taken because of it.
#[derive(Debug, Default)]
pub struct Keys {
    /// The window is the one in front.
    window: bool,
    /// The window's own page lost the keyboard to something else (told by the page).
    child: bool,
    /// Some native view is on the screen to have it: a page that lost the focus to
    /// its developer tools or to a frame has not given it to a view.
    viewing: bool,
    /// The deck's web preview is open and shown.
    preview: bool,
    held: Vec<Key>,
}

impl Keys {
    pub fn set_window(&mut self, on: bool) {
        self.window = on;
    }

    pub fn set_child(&mut self, on: bool) {
        self.child = on;
    }

    pub fn set_viewing(&mut self, on: bool) {
        self.viewing = on;
    }

    pub fn set_preview(&mut self, on: bool) {
        self.preview = on;
    }

    /// The keys that should be taken now: none unless the window is in front and
    /// a native view that is on the screen has the keyboard.
    pub fn wanted(&self) -> Vec<Key> {
        if !(self.window && self.child && self.viewing) {
            return Vec::new();
        }
        let mut keys = vec![Key::NewTab, Key::CloseTab, Key::Address];
        if self.preview {
            keys.push(Key::Escape);
        }
        keys
    }

    /// Takes the keys that are wanted and not yet taken, and gives back the rest.
    /// A key the system refuses is tried again at the next settling.
    pub fn settle(&mut self, registrar: &mut impl Registrar) {
        let wanted = self.wanted();
        for key in self.held.clone() {
            if !wanted.contains(&key) {
                registrar.unregister(key);
                self.held.retain(|k| *k != key);
            }
        }
        for key in wanted {
            if !self.held.contains(&key) && registrar.register(key).is_ok() {
                self.held.push(key);
            }
        }
    }

    #[cfg(test)]
    fn held(&self) -> &[Key] {
        &self.held
    }
}

/// The system's table, through the global shortcut plugin.
struct Plugin<'a>(&'a AppHandle);

impl Registrar for Plugin<'_> {
    fn register(&mut self, key: Key) -> Result<(), String> {
        self.0
            .global_shortcut()
            .on_shortcut(
                key.shortcut(cfg!(target_os = "macos")),
                move |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        pressed(app, key);
                    }
                },
            )
            .map_err(|e| e.to_string())
    }

    fn unregister(&mut self, key: Key) {
        let _ = self
            .0
            .global_shortcut()
            .unregister(key.shortcut(cfg!(target_os = "macos")));
    }
}

#[derive(Clone, Serialize)]
struct Told {
    key: &'static str,
}

/// A taken key was pressed: the main window is told, gets the keyboard back
/// (the page that had it is not the one to answer), and the keys are given up.
fn pressed(app: &AppHandle, key: Key) {
    held(&app.state::<Browser>().keys).set_child(false);
    let _ = app.emit_to(MAIN, EVENT, Told { key: key.name() });
    if let Some(main) = app.get_webview(MAIN) {
        let _ = main.set_focus();
    }
    settle_later(app);
}

/// Settles on the main thread, after whatever is being handled now: the
/// system's table is changed there, never from inside a key's own handler.
fn settle_later(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let browser = handle.state::<Browser>();
        held(&browser.keys).settle(&mut Plugin(&handle));
    });
}

/// A view was made, shown, hidden or closed: whether one is on the screen, and
/// whether the preview is (Escape follows it), is read again.
pub fn refresh(app: &AppHandle) {
    let browser = app.state::<Browser>();
    let (viewing, preview) = browser.reg(|r| (r.any_shown(), r.shown(policy::PREVIEW)));
    {
        let mut keys = held(&browser.keys);
        keys.set_viewing(viewing);
        keys.set_preview(preview);
    }
    settle_later(app);
}

/// The window in front changed (left, or come back to).
pub fn window_focused(app: &AppHandle, on: bool) {
    held(&app.state::<Browser>().keys).set_window(on);
    settle_later(app);
}

/// Everything is given back and forgotten (the browser was turned off).
pub fn reset(app: &AppHandle) {
    let browser = app.state::<Browser>();
    {
        let mut keys = held(&browser.keys);
        keys.set_child(false);
        keys.set_viewing(false);
        keys.set_preview(false);
    }
    settle_later(app);
}

/// The window's own page lost the keyboard to a native view (`on`), or has it back.
/// Told by the page when it is blurred or focused; the app checks that the window
/// is really in front, as a window left for another program blurs its page too.
#[tauri::command(async)]
pub fn browser_child_focus(app: AppHandle, on: bool) {
    let front = app
        .get_window(MAIN)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    {
        let browser = app.state::<Browser>();
        let mut keys = held(&browser.keys);
        keys.set_window(front);
        keys.set_child(on && front);
    }
    refresh(&app);
}

/// The main window came to the front or was left: keys follow.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::Focused(on) = event
        && window.label() == MAIN
        && window.try_state::<Browser>().is_some()
    {
        window_focused(window.app_handle(), *on);
    }
}

#[cfg(test)]
#[path = "keys_tests.rs"]
mod tests;
