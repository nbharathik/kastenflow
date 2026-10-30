//! Asking the app's window to draw a picture. Drawing an SVG as a PNG needs a
//! browser's canvas, which only the window has: the window is told by an event
//! (like the one that makes it write before the app closes), draws the SVG it
//! was handed on an off-screen canvas, and answers with a command. The answer
//! is only text here: it is checked (a PNG, a sensible size) before anyone
//! uses it, and a window that does not answer in time is said so in a sentence.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::closing::MAIN;

/// The event that asks the window to draw a picture.
const DRAW: &str = "kasten://draw-png";
/// The most pixels a side of the picture may have, and the most bytes the PNG may come to.
pub const MAX_SIDE_PX: u32 = 4_000;
pub const MAX_PNG_BYTES: usize = 2 * 1024 * 1024;
/// How many times the diagram's size the picture is drawn at, when it fits.
const SCALE: f64 = 2.0;

/// What the window is asked to draw.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Job<'a> {
    id: &'a str,
    /// The cleaned SVG: nothing in it runs or fetches.
    svg: &'a str,
    /// A CSS colour, or `transparent`.
    background: &'a str,
    scale: f64,
    max_side: u32,
    max_bytes: usize,
}

/// Why the window did not give a picture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failed {
    pub why: String,
    /// The window answered that it could not (rather than staying silent).
    pub answered: bool,
}

type Waiting = HashMap<String, mpsc::Sender<Result<String, String>>>;

/// The pictures being drawn: one waiting asker for each.
#[derive(Default)]
pub struct Pictures {
    waiting: Mutex<Waiting>,
}

impl Pictures {
    fn held(&self) -> std::sync::MutexGuard<'_, Waiting> {
        self.waiting.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The window's answer for job `id`: a base64 PNG, or why not. False when
    /// nobody is waiting for it (it was late, or never asked).
    pub fn answer(&self, id: &str, result: Result<String, String>) -> bool {
        match self.held().remove(id) {
            Some(asker) => asker.send(result).is_ok(),
            None => false,
        }
    }
}

/// Asks the window to draw `svg` on `background` and waits up to `wait`.
pub fn draw(
    app: &AppHandle,
    pictures: &Pictures,
    svg: &str,
    background: &str,
    wait: Duration,
) -> Result<String, Failed> {
    let silent = |why: &str| Failed {
        why: why.to_owned(),
        answered: false,
    };
    let id = (kasten_mcp::bridge::platform().random_id)()
        .map_err(|_| silent("The app could not make an id for the picture"))?;
    let (sender, receiver) = mpsc::channel();
    pictures.held().insert(id.clone(), sender);
    let job = Job {
        id: &id,
        svg,
        background,
        scale: SCALE,
        max_side: MAX_SIDE_PX,
        max_bytes: MAX_PNG_BYTES,
    };
    if app.emit_to(MAIN, DRAW, job).is_err() {
        pictures.held().remove(&id);
        return Err(silent(
            "KastenFlow's window is not ready to draw the picture. Open its window and ask again",
        ));
    }
    match receiver.recv_timeout(wait) {
        Ok(Ok(png)) => Ok(png),
        Ok(Err(why)) => Err(Failed {
            why,
            answered: true,
        }),
        Err(_) => {
            pictures.held().remove(&id);
            Err(silent(
                "KastenFlow's window did not draw the picture in time. Open its window and ask again",
            ))
        }
    }
}

/// The window drew the picture of job `id` (`png`, as base64), or says it
/// could not (`error`).
#[tauri::command]
pub fn diagram_png_answer(
    app: AppHandle,
    id: String,
    png: Option<String>,
    error: Option<String>,
) -> bool {
    let Some(pictures) = app.try_state::<Pictures>() else {
        return false;
    };
    let result = match (png, error) {
        (Some(png), None) => Ok(png),
        (_, Some(why)) => Err(why.chars().take(300).collect()),
        (None, None) => Err("The window sent nothing".to_owned()),
    };
    pictures.answer(&id, result)
}
