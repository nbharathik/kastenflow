//! The mailbox's other two requests, with the same stand-in app: a diagram
//! drawn as a PNG by a fake window (whose answer is checked before it is
//! passed on), and the selection shared with a client that asked.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use kasten_core::bridge::{Answer, Call, Seen, Snippet};
use kasten_core::history::Actor;
use kasten_core::{Instant, content_hash};
use serde_json::Value;

use super::{Setup, StandIn, mailbox, setup};
use crate::bridge::window::{Failed, MAX_PNG_BYTES, MAX_SIDE_PX};

const XML: &str = "<mxfile host=\"test\"><diagram id=\"p1\" name=\"Page-1\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/><mxCell id=\"2\" value=\"Hello\" style=\"rounded=0;whiteSpace=wrap;html=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"40\" y=\"40\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell></root></mxGraphModel></diagram></mxfile>";
const EDITOR_SVG: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"121px\" height=\"61px\" viewBox=\"-0.5 -0.5 121 61\"><defs/><g><rect x=\"0\" y=\"0\" width=\"120\" height=\"60\" fill=\"#ffffff\"/><text x=\"60\" y=\"30\">Hello from the editor</text></g></svg>";

/// The first bytes of a PNG that is `w` by `h` (the signature and the header chunk).
fn png(w: u32, h: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    bytes.extend(w.to_be_bytes());
    bytes.extend(h.to_be_bytes());
    bytes.extend([8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
    bytes
}

fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

fn drawing(path: &str) -> Call {
    Call::DiagramPng {
        diagram: path.into(),
        page: None,
    }
}

fn ask(app: &Setup, call: &Call) -> Result<Value, String> {
    match mailbox(&app.root)
        .ask(call, None, Duration::from_secs(30))
        .unwrap()
    {
        Answer::Reply(reply) if reply.ok => Ok(reply.result),
        Answer::Reply(reply) => Err(reply.error.unwrap_or_default()),
        other => Err(format!("{other:?}")),
    }
}

fn made(app: &Setup, title: &str, xml: &str) -> String {
    app.side
        .kasten
        .create_diagram(&Actor::Human, title, None, Some(xml), Instant::now())
        .unwrap()
}

fn window_says(side: &StandIn, answers: Vec<Result<String, Failed>>) {
    side.window.lock().unwrap().extend(answers);
}

fn silent() -> Failed {
    Failed {
        why: "KastenFlow's window did not draw the picture in time. Open its window and ask again"
            .to_owned(),
        answered: false,
    }
}

#[test]
fn a_diagram_is_drawn_by_the_window_and_comes_back_as_a_png_with_its_size() {
    let app = setup("ok");
    let path = made(&app, "Flow", XML);
    let changed_before = app.side.kasten.dirty().unwrap();
    let drawn = png(2400, 1200);
    window_says(&app.side, vec![Ok(b64(&drawn))]);
    let told = ask(&app, &drawing(&path)).unwrap();
    assert_eq!(told["png_base64"], b64(&drawn));
    assert_eq!(told["width"], 2400);
    assert_eq!(told["height"], 1200);
    assert_eq!(told["bytes"], drawn.len());
    assert_eq!(told["from"], "draft");
    assert_eq!(told["background"], "#ffffff");
    // The window was handed one cleaned SVG, on white, and nothing else.
    let asked = app.side.drawn.lock().unwrap().clone();
    assert_eq!(asked.len(), 1);
    assert!(asked[0].0.starts_with("<svg") && asked[0].0.contains("Hello"));
    assert!(!asked[0].0.contains("<script") && !asked[0].0.contains("http://evil"));
    assert_eq!(asked[0].1, "#ffffff");
    // Nothing was written to the vault by drawing it.
    assert_eq!(app.side.kasten.dirty().unwrap(), changed_before);
}

#[test]
fn the_background_the_diagram_says_is_the_one_the_window_draws_on() {
    let app = setup("ok");
    let clear = made(
        &app,
        "Clear",
        &XML.replace("<mxGraphModel>", "<mxGraphModel background=\"none\">"),
    );
    let tinted = made(
        &app,
        "Tinted",
        &XML.replace("<mxGraphModel>", "<mxGraphModel background=\"#FFEECC\">"),
    );
    window_says(
        &app.side,
        vec![Ok(b64(&png(10, 10))), Ok(b64(&png(10, 10)))],
    );
    assert_eq!(
        ask(&app, &drawing(&clear)).unwrap()["background"],
        "transparent"
    );
    assert_eq!(
        ask(&app, &drawing(&tinted)).unwrap()["background"],
        "#ffeecc"
    );
    let asked = app.side.drawn.lock().unwrap().clone();
    assert_eq!(asked[0].1, "transparent");
    assert_eq!(asked[1].1, "#ffeecc");
}

#[test]
fn a_page_of_the_diagram_is_drawn_and_an_unknown_one_is_said_in_a_sentence() {
    let app = setup("ok");
    let path = made(&app, "Flow", XML);
    window_says(&app.side, vec![Ok(b64(&png(10, 10)))]);
    let call = Call::DiagramPng {
        diagram: path.clone(),
        page: Some("Page-1".into()),
    };
    assert_eq!(ask(&app, &call).unwrap()["from"], "draft");
    let call = Call::DiagramPng {
        diagram: path,
        page: Some("Nope".into()),
    };
    let why = ask(&app, &call).unwrap_err();
    assert!(why.contains("Nope"), "{why}");
    assert_eq!(
        app.side.drawn.lock().unwrap().len(),
        1,
        "no picture for a page that is not there"
    );
}

#[test]
fn the_editors_picture_is_tried_first_and_the_draft_when_the_window_cannot_draw_it() {
    let app = setup("ok");
    let path = made(&app, "Flow", XML);
    app.side
        .kasten
        .save_diagram_preview(
            &Actor::Human,
            &path,
            EDITOR_SVG,
            &content_hash(XML),
            Instant::now(),
        )
        .unwrap();
    window_says(
        &app.side,
        vec![
            Err(Failed {
                why: "The canvas is tainted".to_owned(),
                answered: true,
            }),
            Ok(b64(&png(300, 200))),
        ],
    );
    let told = ask(&app, &drawing(&path)).unwrap();
    assert_eq!(told["from"], "draft");
    let asked = app.side.drawn.lock().unwrap().clone();
    assert_eq!(asked.len(), 2);
    assert!(asked[0].0.contains("Hello from the editor"));
    assert!(!asked[1].0.contains("Hello from the editor"));
}

#[test]
fn a_window_that_stays_silent_is_not_asked_twice_and_is_told_plainly() {
    let app = setup("ok");
    let path = made(&app, "Flow", XML);
    app.side
        .kasten
        .save_diagram_preview(
            &Actor::Human,
            &path,
            EDITOR_SVG,
            &content_hash(XML),
            Instant::now(),
        )
        .unwrap();
    window_says(&app.side, vec![Err(silent())]);
    let why = ask(&app, &drawing(&path)).unwrap_err();
    assert!(
        why.starts_with("KastenFlow's window did not draw the picture in time"),
        "{why}"
    );
    assert_eq!(app.side.drawn.lock().unwrap().len(), 1);
    // Nothing answered at all, as with no window: the same sentence.
    let why = ask(&app, &drawing(&path)).unwrap_err();
    assert!(why.contains("window did not draw"), "{why}");
}

#[test]
fn what_the_window_sends_back_is_checked_before_it_is_passed_on() {
    let app = setup("ok");
    let path = made(&app, "Flow", XML);
    let mut too_big = png(1000, 1000);
    too_big.resize(MAX_PNG_BYTES + 1, 0);
    let huge_text = "A".repeat(MAX_PNG_BYTES * 2);
    let cases: Vec<(String, &str)> = vec![
        (b64(&too_big), "too big"),
        (huge_text, "too big"),
        (b64(&png(MAX_SIDE_PX + 1, 100)), "pixels"),
        (b64(&png(100, 0)), "pixels"),
        (
            b64(b"hello, this is not a picture at all, just words"),
            "not a PNG",
        ),
        (
            b64(b"%PDF-1.4 a pdf is not a png either, however it starts"),
            "not a PNG",
        ),
        (
            b64(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>        "),
            "not a PNG",
        ),
        ("!!! not base64 !!!".to_owned(), "not a picture"),
    ];
    for (answer, says) in &cases {
        window_says(&app.side, vec![Ok(answer.clone())]);
        let why = ask(&app, &drawing(&path)).unwrap_err();
        assert!(why.contains(says), "{says}: {why}");
    }
    // Right at the limits it is taken.
    let mut at_limit = png(MAX_SIDE_PX, MAX_SIDE_PX);
    at_limit.resize(MAX_PNG_BYTES, 0);
    window_says(&app.side, vec![Ok(b64(&at_limit))]);
    let told = ask(&app, &drawing(&path)).unwrap();
    assert_eq!(told["bytes"], MAX_PNG_BYTES);
    assert_eq!(told["width"], MAX_SIDE_PX);
}

#[test]
fn a_diagram_is_drawn_only_while_the_plugin_is_on_and_only_if_it_is_one() {
    let app = setup("ok");
    let path = made(&app, "Flow", XML);
    window_says(&app.side, vec![Ok(b64(&png(10, 10)))]);
    for (diagram, says) in [
        ("library/notes.md", "not a diagram"),
        ("library/none.drawio", "none.drawio"),
    ] {
        let why = ask(&app, &drawing(diagram)).unwrap_err();
        assert!(why.contains(says), "{diagram}: {why}");
    }
    app.side
        .diagrams_on
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let why = ask(&app, &drawing(&path)).unwrap_err();
    assert_eq!(why, "Turn on the Diagrams plugin in Settings → Plugins");
    assert!(app.side.drawn.lock().unwrap().is_empty());
}

fn snippet(text: &str) -> Snippet {
    Snippet {
        kind: "page".into(),
        path: "library/notes.md".into(),
        title: "Notes".into(),
        heading: Some("Method".into()),
        range: None,
        elements: Vec::new(),
        text: text.into(),
        truncated: false,
        time: 0,
    }
}

#[test]
fn a_clients_ask_makes_the_app_share_the_selection_and_wait_for_the_windows_first_word() {
    let app = setup("ok");
    *app.side.selected.lock().unwrap() = vec![snippet("the words I selected")];
    let told = ask(&app, &Call::WatchSelection {}).unwrap();
    assert_eq!(told["shared"], true);
    assert_eq!(told["published"], true);
    assert_eq!(told["for_seconds"], 120);
    // What the client reads next is what the window published.
    let Seen::Selected(read) = mailbox(&app.root).read_selection(Instant::now().millis) else {
        panic!("a selection was shared");
    };
    assert_eq!(read.snippets[0].text, "the words I selected");
    assert_eq!(read.snippets[0].heading.as_deref(), Some("Method"));
    assert!(app.side.sharing.on(Instant::now().millis));
    // Asking again keeps it going and publishes the selection as it is then.
    *app.side.selected.lock().unwrap() = vec![snippet("something else")];
    ask(&app, &Call::WatchSelection {}).unwrap();
    let Seen::Selected(read) = mailbox(&app.root).read_selection(Instant::now().millis) else {
        panic!("a selection was shared");
    };
    assert_eq!(read.snippets[0].text, "something else");
}

#[test]
fn nothing_selected_is_shared_as_nothing_and_a_silent_window_is_not_waited_for_long() {
    let app = setup("ok");
    let told = ask(&app, &Call::WatchSelection {}).unwrap();
    assert_eq!(told["published"], true);
    assert_eq!(
        mailbox(&app.root).read_selection(Instant::now().millis),
        Seen::Nothing
    );
    // A window that never answers: the ask still comes back, and says so.
    app.side
        .window_publishes
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let started = std::time::Instant::now();
    let told = ask(&app, &Call::WatchSelection {}).unwrap();
    assert_eq!(told["shared"], true);
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn the_selection_goes_when_the_loop_ends_with_the_app() {
    let app = setup("ok");
    *app.side.selected.lock().unwrap() = vec![snippet("private words")];
    ask(&app, &Call::WatchSelection {}).unwrap();
    assert!(
        app.root
            .join(".kasten/cache/bridge/selection.json")
            .is_file()
    );
    app.running.stop();
    assert!(
        !app.root
            .join(".kasten/cache/bridge/selection.json")
            .exists()
    );
    assert_eq!(
        mailbox(&app.root).read_selection(Instant::now().millis),
        Seen::AppClosed
    );
}
