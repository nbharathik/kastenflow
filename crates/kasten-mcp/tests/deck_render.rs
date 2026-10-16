//! What the tools that draw slides say where they cannot: in a program built
//! without the render feature, and on a machine with no browser. (With a
//! browser and the page, a picture comes back; `journey.rs` takes whichever
//! this machine has.)

mod common;

use common::{TempDir, deck_of_eight, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::json;

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    (v, k, s)
}

/// A program without the render feature says in one sentence that it does not draw slides.
#[cfg(not(feature = "render"))]
#[test]
fn a_program_that_does_not_draw_says_so_and_does_not_list_the_tools() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    for tool in ["render_slide", "render_grid"] {
        let err = call(&k, &s, tool, json!({"deck": path, "slide": ids[1]})).unwrap_err();
        assert!(
            err.contains("Drawing slides is not part of this program")
                && err.contains("command-line download"),
            "{tool}: {err}"
        );
        assert!(!specs().iter().any(|t| t.name == tool), "{tool} is listed");
    }
}

/// With it, a machine that has no browser is told what is missing, and nothing is installed.
#[cfg(feature = "render")]
#[test]
fn drawing_without_a_browser_says_what_is_missing_and_offers_to_install_nothing() {
    use kasten_mcp::decks::render::pretend_no_browser;

    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    pretend_no_browser(true);
    for tool in ["render_slide", "render_grid"] {
        let err = call(&k, &s, tool, json!({"deck": path, "slide": ids[1]})).unwrap_err();
        assert!(
            err.contains("Drawing slides needs Chrome or Chromium, and none was found")
                && err.contains("does not install a browser"),
            "{tool}: {err}"
        );
        // Lint is what is left to see with.
        assert!(err.contains("lint_deck"), "{tool}: {err}");
        assert!(!err.contains("not part of this program"), "{tool}: {err}");
    }
    // The tools that do not draw are not held up by it: lint estimates instead.
    call(&k, &s, "lint_deck", json!({"deck": path})).unwrap();
    assert!(specs().iter().any(|t| t.name == "render_slide"));
}

/// A drawing that is cancelled before it starts is never started, whatever the machine has.
#[cfg(feature = "render")]
#[test]
fn a_drawing_the_caller_has_withdrawn_is_not_started() {
    use std::sync::atomic::AtomicBool;

    use kasten_mcp::tools::{Writes, call_with};

    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let withdrawn = AtomicBool::new(true);
    let err = call_with(
        &k,
        &s,
        Writes::Direct,
        Some(&withdrawn),
        "render_slide",
        json!({"deck": path, "slide": ids[1]}),
    )
    .unwrap_err();
    assert!(err.contains("cancelled"), "{err}");
}
