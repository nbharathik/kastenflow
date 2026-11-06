//! Drawing slides in KastenFlow's own window, for a program that draws no
//! slides itself (or has no browser): the deck is handed to the app through
//! the vault's mailbox, beside the request, the window draws it with the same
//! renderer the editor's PNG export uses, and the picture comes back. Nothing
//! is installed or run: the window draws the deck text and the vault's own
//! pictures, and says in a sentence when it is closed or does not answer.

use std::sync::Mutex;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use kasten_core::bridge::{Answer, Call, Decks};
use kasten_core::latex::base64_decode;
use serde_json::Value;
use slides_core::Deck;
use slides_core::agent::{Compare, Draw, Drawn, StoreError, StoreResult};
use slides_core::lint::Measures;

use super::Ask;
use crate::decks::store::failed;

/// How long the window gets to draw one picture.
const DRAW_WAIT: Duration = Duration::from_secs(60);
/// How long a lint waits for the window to lay the words out.
const MEASURE_WAIT: Duration = Duration::from_secs(20);
/// How long a lint waits behind a drawing in progress before it estimates.
const MEASURE_QUEUE: Duration = Duration::from_secs(5);
/// After the window did not answer a lint, lint estimates for this long.
const COOL_OFF: Duration = Duration::from_secs(120);

pub(super) const APP_CLOSED: &str = "Drawing slides is not available right now: KastenFlow draws them in its own window, so open KastenFlow on this vault and ask again.";
const TIMED_OUT: &str = "The KastenFlow window did not draw the slide in time (drawing slides is not available until it answers). Check that KastenFlow is open and showing, then ask again.";
const CANCELLED: &str = "This request was cancelled before the picture was drawn.";

/// One drawing at a time: the window draws on the page the person is looking at.
static ONE: Mutex<()> = Mutex::new(());
static FAILED_AT: Mutex<Option<Instant>> = Mutex::new(None);

fn unavailable(message: impl Into<String>) -> StoreError {
    StoreError::Unavailable(message.into())
}

/// Asks the window and waits: its result, or a sentence for why not.
fn ask_window(ask: &Ask, call: &Call, decks: &Decks, wait: Duration) -> StoreResult<Value> {
    if ask.cancel.is_some_and(|c| c.load(Ordering::SeqCst)) {
        return Err(unavailable(CANCELLED));
    }
    let payload = serde_json::to_vec(decks).map_err(|e| StoreError::Io(e.to_string()))?;
    let mailbox = crate::bridge::mailbox_of(ask.kasten).map_err(failed)?;
    match mailbox.ask_with(call, None, wait, Some(&payload)) {
        Ok(Answer::Reply(reply)) if reply.ok => Ok(reply.result),
        Ok(Answer::Reply(reply)) => Err(unavailable(format!(
            "The KastenFlow window could not draw it: {}. Drawing slides is not available until that is sorted out.",
            reply
                .error
                .as_deref()
                .unwrap_or("it gave no reason")
                .trim_end_matches('.')
        ))),
        Ok(Answer::AppClosed) => Err(unavailable(APP_CLOSED)),
        Ok(Answer::TimedOut) => Err(unavailable(TIMED_OUT)),
        Err(error) => Err(failed(error)),
    }
}

/// The deck as the text the window opens.
fn text_of(deck: &Deck) -> StoreResult<String> {
    slides_core::write(deck).map_err(|e| StoreError::Invalid(e.to_string()))
}

/// A scale as hundredths of a pixel to the unit, within what a request carries.
fn percent(scale: f32) -> u32 {
    (scale * 100.0).round().clamp(25.0, 400.0) as u32
}

/// The picture a reply carries.
fn drawn(result: &Value) -> StoreResult<Drawn> {
    let text = result["png_base64"]
        .as_str()
        .ok_or_else(|| unavailable("The KastenFlow window sent no picture"))?;
    let side = |key: &str| u32::try_from(result[key].as_u64().unwrap_or(0)).unwrap_or(0);
    Ok(Drawn {
        png: base64_decode(text).map_err(failed)?,
        width: side("width"),
        height: side("height"),
        warnings: result["warnings"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|w| w.as_str().map(str::to_owned))
            .collect(),
    })
}

fn one() -> std::sync::MutexGuard<'static, ()> {
    ONE.lock().unwrap_or_else(|p| p.into_inner())
}

/// A slide, or the grid of all of them, drawn by the window.
pub(super) fn draw(ask: &Ask, deck: &Deck, what: Draw) -> StoreResult<Drawn> {
    let decks = Decks {
        after: text_of(deck)?,
        before: None,
    };
    let call = match what {
        Draw::Slide { slide, step, scale } => Call::SlidePng {
            slide: u32::try_from(slide).unwrap_or(0),
            step,
            scale_percent: percent(scale),
        },
        Draw::Grid => Call::SlideGrid {},
    };
    let _alone = one();
    drawn(&ask_window(ask, &call, &decks, DRAW_WAIT)?)
}

/// A slide before and after, side by side, with the changed boxes outlined.
pub(super) fn compare(ask: &Ask, compare: &Compare) -> StoreResult<Drawn> {
    let decks = Decks {
        after: text_of(compare.after)?,
        before: Some(text_of(compare.before)?),
    };
    let boxes = |marks: &[[f64; 4]]| -> Vec<[i32; 4]> {
        marks
            .iter()
            .map(|m| [m[0] as i32, m[1] as i32, m[2] as i32, m[3] as i32])
            .collect()
    };
    let call = Call::SlideDiff {
        before_slide: u32::try_from(compare.before_slide).unwrap_or(0),
        after_slide: u32::try_from(compare.after_slide).unwrap_or(0),
        step: compare.step,
        scale_percent: percent(compare.scale),
        before_marks: boxes(&compare.before_marks),
        after_marks: boxes(&compare.after_marks),
    };
    let _alone = one();
    drawn(&ask_window(ask, &call, &decks, DRAW_WAIT)?)
}

fn cooling() -> bool {
    FAILED_AT
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_some_and(|at| at.elapsed() < COOL_OFF)
}

/// How big the words come out when the window lays them out; None (lint
/// estimates) when it is closed, busy, slow, or answers something unreadable.
pub(super) fn measure(ask: &Ask, deck: &Deck) -> Option<Measures> {
    if cooling() {
        return None;
    }
    // Behind a drawing in progress it waits a few seconds, then estimates.
    let started = Instant::now();
    let _alone = loop {
        match ONE.try_lock() {
            Ok(guard) => break guard,
            Err(std::sync::TryLockError::Poisoned(p)) => break p.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) if started.elapsed() < MEASURE_QUEUE => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    };
    let decks = Decks {
        after: text_of(deck).ok()?,
        before: None,
    };
    match ask_window(ask, &Call::SlideMeasure {}, &decks, MEASURE_WAIT) {
        Ok(result) => serde_json::from_value(result.get("measures")?.clone()).ok(),
        Err(StoreError::Unavailable(why)) if why == TIMED_OUT => {
            *FAILED_AT.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
            None
        }
        Err(_) => None,
    }
}
