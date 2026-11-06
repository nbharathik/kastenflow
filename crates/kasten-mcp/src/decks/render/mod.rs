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
mod window;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use kasten_core::Kasten;
use kasten_core::agent::ChangeSet;
use slides_core::Deck;
use slides_core::agent::{Compare, Draw, Drawn, Facts, StoreResult};
use slides_core::lint::Measures;

pub use status::{Report, report};

/// What an agent is told where this program has no browser to draw slides with.
pub const NOT_BUILT: &str = "This program draws no slides itself. Open KastenFlow on this vault: it draws them in its own window. The kasten-mcp program from the command-line download draws them where Chrome, Chromium or Edge is installed.";

/// Where text was laid out, in words that follow "measured in".
pub(super) const BROWSER: &str = "a browser";
const WINDOW: &str = "the KastenFlow window";

/// Said after a browser's refusal when the app's window may be asked instead.
#[cfg(feature = "render")]
const OPEN_APP: &str = "KastenFlow can also draw slides in its own window: open KastenFlow on this vault and ask again.";

/// Whether this program can draw slides at all (it has the render feature).
pub const fn built() -> bool {
    cfg!(feature = "render")
}

/// What the instructions can promise about this program, worked out once per
/// process. It never starts a browser or asks the window: every program here
/// can draw in KastenFlow's window when the app is open (and in a browser when
/// it was built to), and the sentence a drawing fails with says what to open.
pub fn facts() -> Facts {
    static FACTS: OnceLock<Facts> = OnceLock::new();
    *FACTS.get_or_init(|| Facts {
        render: true,
        diff: true,
    })
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

/// Whether a browser's refusal is that there is none to use (a busy or cancelled
/// drawing is not, and does not turn to the window).
#[cfg(feature = "render")]
fn no_browser(why: &slides_core::agent::StoreError) -> bool {
    let slides_core::agent::StoreError::Unavailable(m) = why else {
        return false;
    };
    m.contains("Chrome")
        || m.contains("does not carry the page")
        || m.contains("could not be started")
}

/// Draws a slide, or all of them: in a browser where the program was built to
/// and one is installed, else in KastenFlow's window when the app is open.
pub(super) fn draw(ask: &Ask, deck: &Deck, what: Draw) -> StoreResult<Drawn> {
    #[cfg(feature = "render")]
    {
        use slides_core::agent::StoreError;

        match host::draw(ask, deck, what) {
            Err(why) if no_browser(&why) => window::draw(ask, deck, what).map_err(|failure| {
                match (&why, failure) {
                    // The app is closed too: say both ways of seeing the slides.
                    (StoreError::Unavailable(browser), StoreError::Unavailable(w))
                        if w == window::APP_CLOSED =>
                    {
                        StoreError::Unavailable(format!("{browser} {OPEN_APP}"))
                    }
                    (_, other) => other,
                }
            }),
            other => other,
        }
    }
    #[cfg(not(feature = "render"))]
    {
        window::draw(ask, deck, what)
    }
}

/// A slide before and after, side by side: only the app's window puts pictures together.
pub(super) fn compare(ask: &Ask, compare: &Compare) -> StoreResult<Drawn> {
    window::compare(ask, compare)
}

/// How big the words of the deck come out, and where they were laid out: in a
/// browser when this program has one, else in the app's window when it is open.
/// `None` leaves lint to estimate, and say so.
pub(super) fn measure(ask: &Ask, deck: &Deck) -> Option<(Measures, &'static str)> {
    #[cfg(feature = "render")]
    {
        if let Some(measures) = host::measure(ask, deck) {
            return Some((measures, BROWSER));
        }
    }
    window::measure(ask, deck).map(|measures| (measures, WINDOW))
}

/// Lets go of the browser. A browser is not stopped by the program that
/// started it ending, so the program does this before it ends.
pub fn shutdown() {
    #[cfg(feature = "render")]
    slides_render::shutdown();
}
