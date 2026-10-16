//! Drawing slides for the agent tools: `render_slide`, `render_grid` and the
//! exact text sizes `lint_deck` uses. The drawing is slides-render's: a
//! headless Chrome, Chromium or Edge that the person already has, driven with
//! a page built into the program, and given only the deck's own pictures. It
//! is a cargo feature, `render`, because the page is about 10 MB: the
//! command-line `kasten-mcp` has it; the desktop app has it only if its
//! installer stays within its budget. Without it every tool here says so in
//! one sentence and nothing else changes.
//!
//! Nothing here installs a browser, and a browser that cannot start with its
//! sandbox is never started without it: the person is told what to do instead.

#[cfg(feature = "render")]
mod errors;
#[cfg(feature = "render")]
mod host;
#[cfg(feature = "render")]
mod pictures;
mod status;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use kasten_core::Kasten;
use kasten_core::agent::ChangeSet;
use slides_core::Deck;
use slides_core::agent::{Draw, Drawn, Facts, StoreResult};
use slides_core::lint::Measures;

pub use status::{Report, report};

/// What an agent is told where this program does not draw slides.
pub const NOT_BUILT: &str = "Drawing slides is not part of this program; the kasten-mcp program from the command-line download draws them where Chrome, Chromium or Edge is installed.";

/// Whether this program can draw slides at all (it has the render feature).
pub const fn built() -> bool {
    cfg!(feature = "render")
}

/// What the instructions can promise about this program, worked out once per
/// process. It never starts a browser: whether one is installed is told by
/// `server_status`, as it is now, and by the sentence a drawing fails with.
pub fn facts() -> Facts {
    static FACTS: OnceLock<Facts> = OnceLock::new();
    *FACTS.get_or_init(|| Facts { render: built() })
}

static NO_BROWSER: AtomicBool = AtomicBool::new(false);

/// For tests: from now on, in this process, drawing and the status behave as
/// on a machine with no browser, whatever the machine has. It is how the
/// words said where there is none are tested, and how a test that is not
/// about drawing keeps a browser from being started that would outlive it.
/// It changes nothing else, and does nothing in a program built without the
/// feature.
#[doc(hidden)]
pub fn pretend_no_browser(on: bool) {
    NO_BROWSER.store(on, Ordering::SeqCst);
}

#[cfg_attr(not(feature = "render"), allow(dead_code))]
pub(crate) fn browser_pretended_missing() -> bool {
    NO_BROWSER.load(Ordering::SeqCst)
}

/// What a drawing is given of the call it belongs to.
#[cfg_attr(not(feature = "render"), allow(dead_code))]
pub(super) struct Ask<'a> {
    pub kasten: &'a Kasten,
    /// A chat that previews its changes: its staged pictures are the deck's too.
    pub stage: Option<&'a Mutex<ChangeSet>>,
    /// Set when the caller no longer wants the picture.
    pub cancel: Option<&'a AtomicBool>,
}

/// Draws a slide, or all of them.
pub(super) fn draw(ask: &Ask, deck: &Deck, what: Draw) -> StoreResult<Drawn> {
    #[cfg(feature = "render")]
    {
        host::draw(ask, deck, what)
    }
    #[cfg(not(feature = "render"))]
    {
        let _ = (ask, deck, what);
        Err(slides_core::agent::StoreError::Unavailable(
            NOT_BUILT.to_owned(),
        ))
    }
}

/// How big the words of the deck come out, when a browser can lay them out;
/// `None` leaves lint to estimate, and say so.
pub(super) fn measure(ask: &Ask, deck: &Deck) -> Option<Measures> {
    #[cfg(feature = "render")]
    {
        host::measure(ask, deck)
    }
    #[cfg(not(feature = "render"))]
    {
        let _ = (ask, deck);
        None
    }
}

/// Lets go of the browser. A browser is not stopped by the program that
/// started it ending, so the program does this before it ends.
pub fn shutdown() {
    #[cfg(feature = "render")]
    slides_render::shutdown();
}
