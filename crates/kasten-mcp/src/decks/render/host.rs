//! Drawing with slides-render's shared host: one browser for the program,
//! started on the first picture, let go after a few idle minutes. Every
//! drawing goes through the gate (one at a time and one waiting), and the
//! browser is given at most 20 seconds for a call.

use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use slides_core::Deck;
use slides_core::agent::{Draw, Drawn, StoreResult};
use slides_core::lint::Measures;
use slides_render::{Error, Options};

use super::errors::{failed, refused};
use super::pictures::VaultPictures;
use super::{Ask, browser_pretended_missing};
use crate::decks::gate::{GATE, WAIT};

/// How long one call to the browser may take.
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

/// How long a `lint_deck` waits for a drawing in progress before it estimates instead.
const MEASURE_WAIT: Duration = Duration::from_secs(5);

/// After a browser could not be started, `lint_deck` estimates for this long
/// before it tries again: a failing browser should not slow every lint.
const COOL_OFF: Duration = Duration::from_secs(5 * 60);

static FAILED_AT: Mutex<Option<Instant>> = Mutex::new(None);

fn options() -> Options {
    Options {
        timeout: CALL_TIMEOUT,
        idle: Some(slides_render::IDLE),
        ..Options::default()
    }
}

/// Starts the program's browser if it is not running (the first to ask sets
/// how: the timeout above), or says why it cannot.
fn ensure() -> Result<(), Error> {
    if browser_pretended_missing() {
        return Err(Error::NoBrowser { notes: Vec::new() });
    }
    slides_render::shared_with(options()).map(|_| ())
}

/// The bibliography the deck's citations are written from, if the vault has one.
fn references(ask: &Ask) -> Option<Arc<str>> {
    let text = ask.kasten.references().ok()?;
    (!text.trim().is_empty()).then(|| Arc::from(text))
}

fn what_of(what: Draw) -> slides_render::Draw {
    match what {
        Draw::Slide { slide, step, scale } => slides_render::Draw::Slide { slide, step, scale },
        Draw::Grid => slides_render::Draw::Grid { columns: None },
    }
}

pub(super) fn draw(ask: &Ask, deck: &Deck, what: Draw) -> StoreResult<Drawn> {
    let made = GATE
        .run(ask.cancel, WAIT, || {
            ensure()?;
            let pictures = VaultPictures::load(ask.kasten, ask.stage, deck);
            let left_out = pictures.left_out.clone();
            slides_render::draw_with(deck, Arc::new(pictures), references(ask), what_of(what))
                .map(|png| (png, left_out))
        })
        .map_err(refused)?;
    let (png, left_out) = made.map_err(failed)?;
    let mut warnings = png.warnings;
    warnings.extend(left_out);
    Ok(Drawn {
        png: png.bytes,
        width: png.width,
        height: png.height,
        warnings,
    })
}

fn cooling() -> bool {
    FAILED_AT
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_some_and(|at| at.elapsed() < COOL_OFF)
}

fn cool_off() {
    if !browser_pretended_missing() {
        *FAILED_AT.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
    }
}

pub(super) fn measure(ask: &Ask, deck: &Deck) -> Option<Measures> {
    if cooling() {
        return None;
    }
    let made = GATE
        .run(ask.cancel, MEASURE_WAIT, || {
            ensure()?;
            let pictures = VaultPictures::load(ask.kasten, ask.stage, deck);
            slides_render::measure_with(deck, Arc::new(pictures), references(ask))
        })
        .ok()?;
    match made {
        Ok(measures) => Some(measures),
        Err(Error::NoBrowser { .. } | Error::NoPage | Error::Launch(_)) => {
            cool_off();
            None
        }
        Err(_) => None,
    }
}
