//! The keys taken from the system, tested with a stand-in for its table.

use super::*;

/// Records what was asked of the system's table, and can refuse.
#[derive(Default)]
struct Fake {
    taken: Vec<Key>,
    calls: Vec<String>,
    refuse: Vec<Key>,
}

impl Registrar for Fake {
    fn register(&mut self, key: Key) -> Result<(), String> {
        self.calls.push(format!("register {}", key.name()));
        if self.refuse.contains(&key) {
            return Err("taken by another app".to_owned());
        }
        self.taken.push(key);
        Ok(())
    }

    fn unregister(&mut self, key: Key) {
        self.calls.push(format!("unregister {}", key.name()));
        self.taken.retain(|k| *k != key);
    }
}

fn sorted(keys: &[Key]) -> Vec<&'static str> {
    let mut names: Vec<_> = keys.iter().map(|k| k.name()).collect();
    names.sort_unstable();
    names
}

/// Keys with a native view on the screen, as when a tab or the preview is shown.
fn with_a_view() -> Keys {
    let mut keys = Keys::default();
    keys.set_viewing(true);
    keys
}

#[test]
fn no_key_is_taken_unless_the_window_is_in_front_and_a_native_view_has_the_keyboard() {
    let mut keys = with_a_view();
    let mut system = Fake::default();
    keys.settle(&mut system);
    assert!(system.taken.is_empty());
    // The window's own page has the keyboard, in a window in front.
    keys.set_window(true);
    keys.settle(&mut system);
    assert!(system.taken.is_empty());
    // A page in a native view has it.
    keys.set_child(true);
    keys.settle(&mut system);
    assert_eq!(sorted(&system.taken), ["l", "t", "w"]);
    // A view without the window in front (another program has it) takes nothing.
    let mut away = with_a_view();
    let mut other = Fake::default();
    away.set_child(true);
    away.settle(&mut other);
    assert!(other.calls.is_empty());
}

#[test]
fn nothing_is_taken_for_a_focus_that_went_to_no_view_on_the_screen() {
    // Its developer tools, or a frame: no native view is shown.
    let mut keys = Keys::default();
    let mut system = Fake::default();
    keys.set_window(true);
    keys.set_child(true);
    keys.settle(&mut system);
    assert!(system.calls.is_empty());
    // The last view is hidden or closed while it had the keyboard: the keys go back.
    keys.set_viewing(true);
    keys.settle(&mut system);
    assert_eq!(system.taken.len(), 3);
    keys.set_viewing(false);
    keys.settle(&mut system);
    assert!(system.taken.is_empty());
}

#[test]
fn escape_is_taken_only_while_a_preview_is_open() {
    let mut keys = with_a_view();
    let mut system = Fake::default();
    keys.set_window(true);
    keys.set_child(true);
    keys.settle(&mut system);
    assert!(!system.taken.contains(&Key::Escape));
    keys.set_preview(true);
    keys.settle(&mut system);
    assert_eq!(sorted(&system.taken), ["Escape", "l", "t", "w"]);
    // The preview closes: Escape goes back at once; the page's own Escape works again.
    keys.set_preview(false);
    keys.settle(&mut system);
    assert_eq!(sorted(&system.taken), ["l", "t", "w"]);
    // And a preview with the keyboard in the window's own page takes nothing.
    keys.set_preview(true);
    keys.set_child(false);
    keys.settle(&mut system);
    assert!(system.taken.is_empty());
}

#[test]
fn the_keys_are_given_back_when_the_window_is_left_and_taken_again_when_it_returns() {
    let mut keys = with_a_view();
    let mut system = Fake::default();
    keys.set_window(true);
    keys.set_child(true);
    keys.set_preview(true);
    keys.settle(&mut system);
    assert_eq!(system.taken.len(), 4);
    // Another program in front: not one key of the system is held for KastenFlow.
    keys.set_window(false);
    keys.settle(&mut system);
    assert!(system.taken.is_empty());
    assert!(keys.held().is_empty());
    // The window comes back with the page still in front of the keyboard.
    keys.set_window(true);
    keys.settle(&mut system);
    assert_eq!(system.taken.len(), 4);
}

#[test]
fn the_keys_are_given_back_when_the_windows_own_page_has_the_keyboard_again() {
    let mut keys = with_a_view();
    let mut system = Fake::default();
    keys.set_window(true);
    keys.set_child(true);
    keys.settle(&mut system);
    keys.set_child(false);
    keys.settle(&mut system);
    assert!(system.taken.is_empty());
    // Nothing is asked twice: settling again changes nothing.
    let calls = system.calls.len();
    keys.settle(&mut system);
    assert_eq!(system.calls.len(), calls);
}

#[test]
fn a_key_the_system_refuses_is_not_held_and_is_tried_again() {
    let mut keys = with_a_view();
    let mut system = Fake {
        refuse: vec![Key::CloseTab],
        ..Fake::default()
    };
    keys.set_window(true);
    keys.set_child(true);
    keys.settle(&mut system);
    assert_eq!(sorted(&system.taken), ["l", "t"]);
    assert_eq!(sorted(keys.held()), ["l", "t"]);
    // Giving back never asks the system to drop a key it never gave.
    keys.set_child(false);
    keys.settle(&mut system);
    assert!(!system.calls.contains(&"unregister w".to_owned()));
    // Another app let go of it: the next settling takes it.
    system.refuse.clear();
    keys.set_child(true);
    keys.settle(&mut system);
    assert_eq!(sorted(&system.taken), ["l", "t", "w"]);
}

#[test]
fn the_keys_are_ctrl_on_windows_and_linux_command_on_a_mac_and_escape_alone() {
    let ctrl = Key::NewTab.shortcut(false);
    assert_eq!((ctrl.mods, ctrl.key), (Modifiers::CONTROL, Code::KeyT));
    let close = Key::CloseTab.shortcut(true);
    assert_eq!((close.mods, close.key), (Modifiers::SUPER, Code::KeyW));
    let address = Key::Address.shortcut(false);
    assert_eq!(
        (address.mods, address.key),
        (Modifiers::CONTROL, Code::KeyL)
    );
    let escape = Key::Escape.shortcut(false);
    assert_eq!(
        (escape.mods, escape.key),
        (Modifiers::empty(), Code::Escape)
    );
    // What the main window is told is what a keyboard event calls the key.
    assert_eq!(Key::NewTab.name(), "t");
    assert_eq!(Key::Escape.name(), "Escape");
}
