//! What an agent is told when a picture cannot be drawn. Each is a sentence
//! that says what to do, and none offers to install anything or to run the
//! browser without its sandbox.

use slides_core::agent::StoreError;
use slides_render::Error;

use crate::decks::gate::{Refused, WAIT};

/// Said where there is no browser, after slides-render's own sentence.
const NO_INSTALL: &str = "KastenFlow does not install a browser for you.";

/// Said where the page the browser draws with is not in this program.
const NO_PAGE_LEFT: &str = "Until that is done nothing can be drawn: lint is your eyes, so use lint_deck, and ask the person to look at the deck in KastenFlow Slides.";

/// A drawing that was not started.
pub(super) fn refused(why: Refused) -> StoreError {
    StoreError::Unavailable(match why {
        Refused::Busy => "A picture is being drawn and another is already waiting, so this one was not started. Ask for one picture at a time, and again in a few seconds.".to_owned(),
        Refused::Waited => format!(
            "This picture waited {} seconds for the one being drawn before it and was not started. Ask again in a moment, one picture at a time.",
            WAIT.as_secs()
        ),
        Refused::Cancelled => "This request was cancelled before the picture was drawn.".to_owned(),
    })
}

/// A drawing that failed, as the render host says it did.
pub(super) fn failed(error: Error) -> StoreError {
    match error {
        Error::NoBrowser { .. } => StoreError::Unavailable(format!("{error} {NO_INSTALL}")),
        Error::NoPage => StoreError::Unavailable(format!("{error} {NO_PAGE_LEFT}")),
        // A slide that is not in the deck, and the like: the caller asked for the impossible.
        Error::Request(message) => StoreError::Invalid(message),
        other => StoreError::Unavailable(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(error: StoreError) -> String {
        error.to_string()
    }

    #[test]
    fn each_way_of_not_drawing_has_its_own_sentence_and_none_offers_to_weaken_the_sandbox() {
        let none = said(failed(Error::NoBrowser {
            notes: vec!["CHROMIUM_PATH is set to x, but there is no program there.".to_owned()],
        }));
        assert!(
            none.contains("none was found") && none.contains("does not install a browser"),
            "{none}"
        );
        assert!(none.contains("CHROMIUM_PATH is set to x"), "{none}");
        let page = said(failed(Error::NoPage));
        assert!(
            page.contains("does not carry the page") && page.contains("lint_deck"),
            "{page}"
        );
        let busy = said(refused(Refused::Busy));
        assert!(busy.contains("already waiting"), "{busy}");
        assert!(said(refused(Refused::Waited)).contains("30 seconds"));
        assert!(said(refused(Refused::Cancelled)).contains("cancelled"));
        let sandbox = said(failed(Error::Launch(
            "its sandbox could not start here. Set SLIDES_RENDER_NO_SANDBOX=1 if the machine is the boundary you trust.".to_owned(),
        )));
        assert!(
            sandbox.starts_with("The browser could not be started"),
            "{sandbox}"
        );
        // A request that cannot be met is the caller's to fix.
        assert!(matches!(
            failed(Error::Request("There is no slide 9.".to_owned())),
            StoreError::Invalid(_)
        ));
    }

    #[test]
    fn only_the_words_that_name_the_missing_browser_bring_slides_cores_hint_about_lint() {
        // slides-core adds its hint to a sentence that says Chrome or "not available".
        let lint_hint = |m: &str| m.contains("Chrome") || m.contains("not available");
        assert!(lint_hint(&said(failed(Error::NoBrowser { notes: vec![] }))));
        for other in [
            said(refused(Refused::Busy)),
            said(refused(Refused::Waited)),
            said(refused(Refused::Cancelled)),
            said(failed(Error::Closed)),
        ] {
            assert!(!lint_hint(&other), "{other}");
        }
    }
}
