//! One render host for a whole program. A program that draws now and then (the agent tools of `slides mcp`) should
//! not start a browser for each picture: [`shared`] starts one when it is first needed, keeps it for the next call,
//! and lets it go after a few idle minutes so that a server that is left running does not hold on to memory.

use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use slides_core::Deck;
use slides_core::lint::Measures;

use crate::error::Result;
use crate::media::{FolderMedia, Media};
use crate::references;
use crate::renderer::{Options, Renderer};
use crate::types::Png;

/// How long the shared host may sit unused before its browser is shut down (a later call starts another).
pub const IDLE: Duration = Duration::from_secs(5 * 60);

static SHARED: Mutex<Option<Arc<Renderer>>> = Mutex::new(None);
/// Who is drawing: the host has one set of pictures at a time.
static DRAWING: Mutex<()> = Mutex::new(());

/// The render host of this program, started on first use with the usual options. Fails when there is no browser, with a
/// sentence that says what to do.
pub fn shared() -> Result<Arc<Renderer>> {
    shared_with(Options::default())
}

/// The render host of this program: the one already running, or else one started with `options` (with the idle time
/// of a shared host if they name none). The first to ask decides the options; later ones get the same host.
pub fn shared_with(options: Options) -> Result<Arc<Renderer>> {
    let mut slot = SHARED.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(renderer) = slot.as_ref().filter(|r| r.is_alive()) {
        return Ok(Arc::clone(renderer));
    }
    let renderer = Arc::new(Renderer::launch_with(Options {
        idle: options.idle.or(Some(IDLE)),
        ..options
    })?);
    *slot = Some(Arc::clone(&renderer));
    Ok(renderer)
}

/// Lets the shared host go, and with it its browser. Call it before the program ends: a browser is not stopped by
/// the program that started it ending abruptly.
pub fn shutdown() {
    let taken = SHARED.lock().unwrap_or_else(PoisonError::into_inner).take();
    drop(taken);
}

/// What the agent tools draw.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Draw {
    /// A slide (from 0) at a step (its last state when `None`), at `scale` pixels to the unit.
    Slide {
        slide: usize,
        step: Option<u32>,
        scale: f32,
    },
    /// Every slide as a labelled thumbnail.
    Grid { columns: Option<usize> },
}

/// Draws with the shared host, reading the deck's pictures from `media` and writing its citations from `references`
/// (BibTeX text; none draws them as their keys). This is the one call a tool needs.
pub fn draw_with(
    deck: &Deck,
    media: Arc<dyn Media>,
    references: Option<Arc<str>>,
    what: Draw,
) -> Result<Png> {
    let renderer = shared()?;
    let _drawing = DRAWING.lock().unwrap_or_else(PoisonError::into_inner);
    renderer.set_media(media);
    renderer.set_references(references.map(|r| r.to_string()));
    match what {
        Draw::Slide { slide, step, scale } => renderer.render_slide(deck, slide, step, scale),
        Draw::Grid { columns } => renderer.render_grid(deck, columns),
    }
}

/// The same for a deck whose pictures and `.bib` files are in the folder `assets`.
pub fn draw(deck: &Deck, assets: &Path, what: Draw) -> Result<Png> {
    draw_with(
        deck,
        Arc::new(FolderMedia::new(assets)?),
        references::in_folder(assets).map(Arc::from),
        what,
    )
}

/// The same for a deck whose pictures are read from `media` and whose citations are written from `references` (BibTeX
/// text; none measures them as their keys), such as a vault's.
pub fn measure_with(
    deck: &Deck,
    media: Arc<dyn Media>,
    references: Option<Arc<str>>,
) -> Result<Measures> {
    let renderer = shared()?;
    let _drawing = DRAWING.lock().unwrap_or_else(PoisonError::into_inner);
    renderer.set_media(media);
    renderer.set_references(references.map(|r| r.to_string()));
    renderer.measure(deck)
}

/// How big the words of every element of the deck come out (see [`Renderer::measure`]), with the shared host, for a
/// deck whose pictures and `.bib` files are in the folder `assets`: the citations are as long as they will be drawn.
pub fn measure(deck: &Deck, assets: &Path) -> Result<Measures> {
    let renderer = shared()?;
    let media = Arc::new(FolderMedia::new(assets)?);
    let _drawing = DRAWING.lock().unwrap_or_else(PoisonError::into_inner);
    renderer.set_media(media);
    renderer.set_references(references::in_folder(assets));
    renderer.measure(deck)
}
