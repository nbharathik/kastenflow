//! The presenter's window: the speaker's second window during a talk, with the slide as the audience sees it, what comes next,
//! the notes and the time. The window that presents asks for it (`open_presenter`); it is made on another monitor when there is
//! one, else beside the presenting window, and shows a page of its own (`presenter.html?presenter=<deck>`), which draws the
//! presenter's view and loads none of the app. The two windows tell each other where they are through `presenter_post`, which
//! passes each message on to the other window alone and reads none of it.

use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent,
};

use crate::closing::MAIN;

pub const PRESENTER: &str = "presenter";

/// What the two windows say to each other on.
const EVENT: &str = "kasten://present";

/// The size of the window before it is placed.
const WIDTH: f64 = 1180.0;
const HEIGHT: f64 = 780.0;

/// The kinds of message the two windows exchange: the presenter asking for the deck, the deck, a position, the talk being a rehearsal,
/// the show's heartbeat, the presenter asking for the show to end, the presenter asking for the show to change screens, and a window closing.
const KINDS: [&str; 8] = [
    "hello", "deck", "state", "rehearse", "beat", "end", "screen", "bye",
];

/// The most one message may weigh: a deck with its pictures' addresses, and nothing like a picture itself.
const MAX_BYTES: usize = 32 << 20;

/// A rectangle on the desktop, in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    fn contains(&self, point: (i32, i32)) -> bool {
        point.0 >= self.x
            && point.1 >= self.y
            && i64::from(point.0) < i64::from(self.x) + i64::from(self.w)
            && i64::from(point.1) < i64::from(self.y) + i64::from(self.h)
    }

    fn centre(&self) -> (i32, i32) {
        (self.x + (self.w / 2) as i32, self.y + (self.h / 2) as i32)
    }
}

/// The monitor the window presenting is not on: the first other one, or none when there is a single monitor.
pub fn other_monitor(monitors: &[Rect], audience: Rect) -> Option<Rect> {
    let centre = audience.centre();
    monitors.iter().copied().find(|m| !m.contains(centre))
}

/// Where a window of `size` goes to sit in the middle of `area`; at its corner when it is larger.
pub fn centred(area: Rect, size: (u32, u32)) -> (i32, i32) {
    (
        area.x + (area.w.saturating_sub(size.0) / 2) as i32,
        area.y + (area.h.saturating_sub(size.1) / 2) as i32,
    )
}

/// Where a window of `size` goes beside the presenting window (to its right), kept on the monitor `screen` when it is known.
pub fn beside(audience: Rect, size: (u32, u32), screen: Option<Rect>) -> (i32, i32) {
    let right = audience.x + audience.w as i32;
    let Some(screen) = screen else {
        return (right, audience.y);
    };
    let last = screen.x + screen.w as i32 - size.0 as i32;
    (right.min(last).max(screen.x), audience.y.max(screen.y))
}

/// A deck's path as it goes in the address: everything but letters, digits, `-._~` and `/` written as `%` and two digits.
pub fn in_address(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Whether a message is one the two windows exchange: an object of a known kind that is not too large.
pub fn is_message(message: &Value) -> bool {
    let known = message
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| KINDS.contains(&kind));
    known && message.to_string().len() <= MAX_BYTES
}

fn rect_of(window: &WebviewWindow) -> Option<Rect> {
    let at = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(Rect {
        x: at.x,
        y: at.y,
        w: size.width,
        h: size.height,
    })
}

/// Puts the presenter's window on another monitor, if there is one, else beside the window that presents.
fn place(app: &AppHandle, window: &WebviewWindow) {
    // A show that chose its displays (the main window moved to the external one) says which is left for this window.
    if let (Some(area), Ok(size)) = (
        crate::presenter_screen::presenter_area(),
        window.outer_size(),
    ) {
        let (x, y) = centred(area, (size.width, size.height));
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.maximize();
        return;
    }
    let monitors: Vec<Rect> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let area = m.work_area();
            Rect {
                x: area.position.x,
                y: area.position.y,
                w: area.size.width,
                h: area.size.height,
            }
        })
        .collect();
    let (Some(main), Some(size)) = (
        app.get_webview_window(MAIN).as_ref().and_then(rect_of),
        window.outer_size().ok(),
    ) else {
        let _ = window.center();
        return;
    };
    let size = (size.width, size.height);
    match other_monitor(&monitors, main) {
        Some(area) => {
            let (x, y) = centred(area, size);
            let _ = window.set_position(PhysicalPosition::new(x, y));
            let _ = window.maximize();
        }
        None => {
            let screen = monitors.iter().copied().find(|m| m.contains(main.centre()));
            let (x, y) = beside(main, size, screen);
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
}

/// The page the presenter's window shows: a page of its own, so the window loads the presenter's code and not the whole app.
pub fn address_of(deck_path: &str) -> String {
    format!("presenter.html?presenter={}", in_address(deck_path))
}

/// The window a message from the window labelled `from` goes to: the presenter's window speaks to the one that presents, and the
/// one that presents (or any other) to the presenter's window. Each is sent to its one target and never to every window.
pub fn peer_of(from: &str) -> &'static str {
    if from == PRESENTER { MAIN } else { PRESENTER }
}

/// The number the next presenter window gets, and the number of the one that is open (none: 0). A `bye` for a window that was
/// destroyed can reach the show after a newer window was opened; its number lets the show tell.
static NEXT: AtomicU64 = AtomicU64::new(1);
static CURRENT: AtomicU64 = AtomicU64::new(0);

/// What the window that presents hears when the presenter's window numbered `window` goes.
fn gone_word(window: u64) -> Value {
    json!({ "type": "bye", "w": window })
}

/// Opens the presenter's window for the deck at `deck_path` (the window shows a deck the presenting window sends it, so the path is
/// only its name), or brings it forward if it is open; answers the window's number. It runs off the main thread (`async`): building
/// a window there while the main thread waits for the answer can deadlock on Windows.
#[tauri::command(async)]
pub fn open_presenter(app: AppHandle, deck_path: String) -> Result<u64, String> {
    if let Some(open) = app.get_webview_window(PRESENTER) {
        let _ = open.show();
        let _ = open.set_focus();
        return Ok(CURRENT.load(Ordering::SeqCst));
    }
    let number = NEXT.fetch_add(1, Ordering::SeqCst);
    let window = WebviewWindowBuilder::new(
        &app,
        PRESENTER,
        WebviewUrl::App(address_of(&deck_path).into()),
    )
    .title("Presenter view")
    .inner_size(WIDTH, HEIGHT)
    .min_inner_size(640.0, 420.0)
    .build()
    .map_err(|err| err.to_string())?;
    CURRENT.store(number, Ordering::SeqCst);
    place(&app, &window);
    // Its keys drive the show, so it has to be the window that has them.
    let _ = window.set_focus();
    Ok(number)
}

/// Passes a message from one of the two windows to the other.
#[tauri::command]
pub fn presenter_post(app: AppHandle, window: Window, message: Value) -> Result<(), String> {
    if !is_message(&message) {
        return Err("That is not a message between the presenting windows".into());
    }
    app.emit_to(peer_of(window.label()), EVENT, message)
        .map_err(|err| err.to_string())
}

/// The presenter's window closes itself, as its Close button asks (off the main thread, as `open_presenter` is).
#[tauri::command(async)]
pub fn presenter_close(window: Window) -> Result<(), String> {
    window.close().map_err(|err| err.to_string())
}

/// When the presenter's window goes, the window that presents is told, so it stops sending.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == PRESENTER && matches!(event, WindowEvent::Destroyed) {
        let number = CURRENT.swap(0, Ordering::SeqCst);
        let _ = window
            .app_handle()
            .emit_to(peer_of(PRESENTER), EVENT, gone_word(number));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn r(x: i32, y: i32, w: u32, h: u32) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn the_presenter_goes_to_the_monitor_the_talk_is_not_on() {
        let laptop = r(0, 0, 1440, 900);
        let projector = r(1440, 0, 1920, 1080);
        let talk = r(100, 80, 1200, 800);
        assert_eq!(other_monitor(&[laptop, projector], talk), Some(projector));
        // The talk on the projector: the presenter goes to the laptop.
        let on_projector = r(1500, 40, 1800, 1000);
        assert_eq!(
            other_monitor(&[laptop, projector], on_projector),
            Some(laptop)
        );
        // A monitor to the left has a negative origin.
        let left = r(-1920, 0, 1920, 1080);
        assert_eq!(other_monitor(&[left, laptop], talk), Some(left));
    }

    #[test]
    fn a_single_monitor_has_no_other() {
        assert_eq!(
            other_monitor(&[r(0, 0, 1440, 900)], r(0, 0, 1440, 900)),
            None
        );
        assert_eq!(other_monitor(&[], r(0, 0, 100, 100)), None);
    }

    #[test]
    fn a_window_sits_in_the_middle_of_its_monitor() {
        assert_eq!(centred(r(1440, 0, 1920, 1080), (1180, 780)), (1810, 150));
        assert_eq!(centred(r(-1920, 0, 1920, 1080), (1180, 780)), (-1550, 150));
        // Larger than the monitor: at its corner.
        assert_eq!(centred(r(0, 0, 800, 600), (1180, 780)), (0, 0));
    }

    #[test]
    fn beside_the_talk_and_on_its_screen() {
        let screen = r(0, 0, 2560, 1440);
        assert_eq!(
            beside(r(100, 100, 1200, 800), (1180, 780), Some(screen)),
            (1300, 100)
        );
        // No room to the right: as far right as the screen allows.
        assert_eq!(
            beside(r(1500, 100, 1000, 800), (1180, 780), Some(screen)),
            (1380, 100)
        );
        assert_eq!(beside(r(50, 60, 300, 200), (100, 100), None), (350, 60));
    }

    #[test]
    fn a_deck_path_goes_in_the_address_whole() {
        assert_eq!(
            in_address("projects/talk/decks/My deck.deck"),
            "projects/talk/decks/My%20deck.deck"
        );
        assert_eq!(in_address("a&b=c?d#e"), "a%26b%3Dc%3Fd%23e");
        assert_eq!(in_address("é"), "%C3%A9");
    }

    #[test]
    fn each_window_passes_its_words_to_the_other_and_only_to_it() {
        assert_eq!(peer_of(PRESENTER), MAIN);
        assert_eq!(peer_of(MAIN), PRESENTER);
        // A window that is neither (the guard keeps it from calling at all) is never taken for the presenter's.
        assert_eq!(peer_of("capture"), PRESENTER);
        assert_ne!(peer_of(PRESENTER), PRESENTER);
        // The word that the presenter's window is gone goes to the window that presents.
        // ...with the window's number, so a late word never closes the link of a newer window.
        assert_eq!(gone_word(3), json!({ "type": "bye", "w": 3 }));
        assert!(is_message(&gone_word(3)));
    }

    #[test]
    fn the_presenters_window_is_its_own_page_so_that_only_its_code_loads() {
        assert_eq!(
            address_of("projects/talk/decks/My deck.deck"),
            "presenter.html?presenter=projects/talk/decks/My%20deck.deck"
        );
    }

    #[test]
    fn the_windows_keep_in_touch_and_the_presenter_can_end_the_show() {
        for kind in ["beat", "end", "screen"] {
            assert!(KINDS.contains(&kind), "{kind}");
        }
    }

    #[test]
    fn only_the_messages_of_the_two_windows_pass() {
        for kind in KINDS {
            assert!(is_message(&json!({ "type": kind })), "{kind}");
        }
        // The sender's name and the place of a move in the order of moves ride along.
        assert!(is_message(
            &json!({ "type": "state", "state": { "indexh": 2 }, "from": "w1", "n": 4 })
        ));
        assert!(is_message(
            &json!({ "type": "state", "state": { "indexh": 2 } })
        ));
        for other in [
            json!("hello"),
            json!({}),
            json!({ "type": 4 }),
            json!({ "type": "run" }),
            json!(null),
        ] {
            assert!(!is_message(&other), "{other}");
        }
    }
}
