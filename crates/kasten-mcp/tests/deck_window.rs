//! Slides drawn by the app's window: the tools hand the deck to the app through
//! the vault's mailbox, and what comes back is a real picture (an image block
//! for the client, and for the app's own chat). A stand-in thread plays the
//! app; with it gone the tools say to open KastenFlow.

mod common;

use std::sync::{Arc, Mutex};

use common::{TempDir, deck_of_eight, vault};
use kasten_core::agent::Session;
use kasten_core::bridge::{Call, Decks, Handler, Request, Server, serve};
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, call_full};
use serde_json::{Value, json};

const PNG_HEAD: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

type Seen = Arc<Mutex<Vec<(Call, Decks)>>>;

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("claude-code", Instant::now());
    (v, k, s)
}

/// The app, as far as drawing goes: it reads the deck that came beside the request and answers.
fn app(k: &Kasten, answer: fn(&Call) -> Result<Value, String>) -> (Server, Seen) {
    let seen: Seen = Arc::default();
    let (kept, reading) = (
        Arc::clone(&seen),
        kasten_mcp::bridge::mailbox_of(k).unwrap(),
    );
    let handler: Handler = Arc::new(move |request: Request, call: Call| {
        let bytes = reading.take_payload(&request.id).unwrap_or_default();
        let decks: Decks = serde_json::from_slice(&bytes).map_err(|_| "no deck came".to_owned())?;
        let result = answer(&call);
        kept.lock().unwrap().push((call, decks));
        result
    });
    let server = serve(
        kasten_mcp::bridge::mailbox(k.root()).unwrap(),
        "1.2.4",
        handler,
    )
    .unwrap();
    (server, seen)
}

fn drawn(_: &Call) -> Result<Value, String> {
    Ok(json!({
        "png_base64": slides_core::agent::base64_encode(&PNG_HEAD),
        "width": 1920,
        "height": 1080,
        "warnings": ["a font was substituted"],
    }))
}

#[test]
fn a_slide_is_drawn_by_the_window_and_comes_back_as_a_picture() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let (_app, seen) = app(&k, drawn);
    let out = call_full(
        &k,
        &s,
        kasten_mcp::tools::Writes::Direct,
        None,
        "render_slide",
        json!({"deck": path, "slide": ids[1], "scale": 2, "step": 1}),
    )
    .unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].mime, "image/png");
    assert_eq!(out.images[0].bytes, PNG_HEAD);
    assert_eq!(out.value["width"], 1920);
    assert_eq!(out.value["warnings"], json!(["a font was substituted"]));
    let seen = seen.lock().unwrap();
    assert_eq!(
        seen[0].0,
        Call::SlidePng {
            slide: 1,
            step: Some(1),
            scale_percent: 200
        }
    );
    assert!(seen[0].1.after.contains(&ids[1]), "the deck came with it");
    assert!(seen[0].1.before.is_none());
}

#[test]
fn the_whole_deck_and_a_slide_before_and_after_are_drawn_too() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let (_app, seen) = app(&k, drawn);
    let grid = call_full(
        &k,
        &s,
        kasten_mcp::tools::Writes::Direct,
        None,
        "render_grid",
        json!({"deck": path}),
    )
    .unwrap();
    assert_eq!(grid.images.len(), 1);

    // Look, change, and look at what the change did.
    let first = call(
        &k,
        &s,
        "render_slide",
        json!({"deck": path, "slide": ids[1]}),
    )
    .unwrap();
    let hash = first["hash"].as_str().unwrap().to_owned();
    let banner = json!([{ "type": "text", "id": "banner", "x": 50, "y": 400, "w": 400, "h": 60, "markdown": "Hello" }]);
    call(
        &k,
        &s,
        "add_elements",
        json!({"deck": path, "slide": ids[1], "elements": banner}),
    )
    .unwrap();
    let diff = call_full(
        &k,
        &s,
        kasten_mcp::tools::Writes::Direct,
        None,
        "render_diff",
        json!({"deck": path, "slide": ids[1], "before": hash}),
    )
    .unwrap();
    assert_eq!(diff.images.len(), 1);
    assert_eq!(diff.value["outlined"], json!({"before": 0, "after": 1}));
    let seen = seen.lock().unwrap();
    let (call, decks) = seen.last().unwrap();
    let Call::SlideDiff {
        after_marks,
        before_marks,
        ..
    } = call
    else {
        panic!("expected a comparison, got {call:?}");
    };
    assert_eq!(
        (before_marks.len(), after_marks.as_slice()),
        (0, &[[50, 400, 400, 60]][..])
    );
    let before = decks.before.as_ref().expect("the older deck came too");
    assert!(!before.contains("banner") && decks.after.contains("banner"));
}

#[test]
fn what_the_window_says_it_could_not_draw_is_told_to_the_agent() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let (_app, _seen) = app(&k, |_| Err("The window's picture was not a PNG".to_owned()));
    let err = call(
        &k,
        &s,
        "render_slide",
        json!({"deck": path, "slide": ids[1]}),
    )
    .unwrap_err();
    assert!(
        err.contains("was not a PNG") && err.contains("lint_deck"),
        "{err}"
    );
}

#[test]
fn with_the_app_closed_the_agent_is_told_to_open_it_and_to_use_lint_meanwhile() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    for tool in ["render_slide", "render_grid"] {
        let err = call(&k, &s, tool, json!({"deck": path, "slide": ids[1]})).unwrap_err();
        assert!(
            err.contains("KastenFlow") && err.contains("lint_deck"),
            "{tool}: {err}"
        );
    }
    let err = call(
        &k,
        &s,
        "render_diff",
        json!({"deck": path, "slide": ids[1], "elements": [{"type": "text", "x": 1, "y": 1, "w": 9, "h": 9, "markdown": "x"}]}),
    )
    .unwrap_err();
    assert!(
        err.contains("open KastenFlow") && err.contains("lint_deck"),
        "{err}"
    );
}

#[test]
fn lint_measures_in_the_window_when_it_is_open_and_says_so() {
    let (_v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    let estimated = call(&k, &s, "lint_deck", json!({"deck": path})).unwrap();
    assert_eq!(estimated["measuredIn"], "estimate");
    let (_app, seen) = app(&k, |_| Ok(json!({"measures": {"slides": {}}})));
    let measured = call(&k, &s, "lint_deck", json!({"deck": path})).unwrap();
    assert_eq!(measured["textMeasured"], true, "{measured}");
    assert_eq!(measured["measuredIn"], "the KastenFlow window");
    assert_eq!(seen.lock().unwrap()[0].0, Call::SlideMeasure {});
}

/// A real one-pixel picture, as the window sends it.
const TINY_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

fn tiny(_: &Call) -> Result<Value, String> {
    Ok(json!({ "png_base64": TINY_PNG, "width": 1, "height": 1, "warnings": [] }))
}

#[test]
fn a_deck_is_exported_as_a_picture_of_each_slide_kept_in_the_assets() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let (_app, seen) = app(&k, tiny);
    let out = call(&k, &s, "export", json!({"deck": path, "format": "png"})).unwrap();
    assert_eq!(out["status"], json!("done"), "{out}");
    let files = out["result"]["files"].as_array().unwrap();
    assert_eq!(files.len(), ids.len());
    for file in files {
        let kept = file["path"].as_str().unwrap();
        assert!(
            kept.starts_with("assets/") && kept.ends_with(".png"),
            "{kept}"
        );
        assert!(v.0.join(kept).is_file(), "{kept}");
    }
    assert_eq!(
        seen.lock().unwrap().len(),
        ids.len(),
        "one drawing for each slide"
    );
}

#[test]
fn exporting_pictures_with_the_app_closed_says_to_open_it() {
    let (_v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    let err = call(&k, &s, "export", json!({"deck": path, "format": "png"})).unwrap_err();
    assert!(
        err.contains("open KastenFlow") && err.contains("lint_deck"),
        "{err}"
    );
}
