//! Code pictures over MCP: the tools hand the agent's program, and what it reads, to the app through
//! the vault's mailbox; the app's window runs it in its sandbox and the picture comes back, is kept in
//! the vault's assets and goes on the slide with the program inside it. A stand-in thread plays the
//! app; with it gone the tools say to open KastenFlow.

mod common;

use std::fs;
use std::sync::{Arc, Mutex};

use common::{TempDir, deck_of_eight, vault};
use kasten_core::agent::Session;
use kasten_core::bridge::{
    Call, GeneratorOutput, GeneratorPayload, Handler, Request, Server, serve,
};
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_full};
use serde_json::{Value, json};

const PNG_HEAD: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
const NOTE: &str = "library/welcome-to-kasten.md";

/// What the app was asked: the call, the code and inputs that came with it, and whether an agent asked.
type Seen = Arc<Mutex<Vec<(Call, GeneratorPayload, bool)>>>;

type Answer = fn(&Call, &GeneratorPayload) -> Result<Value, String>;

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("claude-code", Instant::now());
    (v, k, s)
}

/// The app, as far as running code goes: it reads the code that came beside the request and answers.
fn app(k: &Kasten, answer: Answer) -> (Server, Seen) {
    let seen: Seen = Arc::default();
    let (kept, reading) = (
        Arc::clone(&seen),
        kasten_mcp::bridge::mailbox_of(k).unwrap(),
    );
    let handler: Handler = Arc::new(move |request: Request, call: Call| {
        let bytes = reading.take_payload(&request.id).unwrap_or_default();
        let payload: GeneratorPayload =
            serde_json::from_slice(&bytes).map_err(|_| "no code came".to_owned())?;
        let result = answer(&call, &payload);
        kept.lock()
            .unwrap()
            .push((call, payload, request.session.is_some()));
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

/// A picture that says how long the code was, so other code draws another picture.
fn drawn(_: &Call, payload: &GeneratorPayload) -> Result<Value, String> {
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"100\" viewBox=\"0 0 200 100\"><text x=\"5\" y=\"20\">{}</text></svg>",
        payload.code.len()
    );
    Ok(json!({
        "output": "svg",
        "svg": svg,
        "width": 200,
        "height": 100,
        "preview_png_base64": slides_core::agent::base64_encode(&PNG_HEAD),
        "warnings": ["a font was substituted"],
        "logs": ["rows: 2"],
    }))
}

fn place(k: &Kasten, s: &Session, deck: &str, slide: &str, code: &str) -> Value {
    call(
        k,
        s,
        "place_code_picture",
        json!({ "deck": deck, "slide": slide, "code": code, "alt": "Sales",
            "box": { "x": 100, "y": 200, "w": 400, "h": 300 },
            "inputs": [
                { "name": "sales", "kind": "data", "value": "month,total\nJan,3\nFeb,5\n" },
                { "name": "csv", "kind": "asset", "value": "assets/sales.csv" },
                { "name": "notes", "kind": "note", "value": NOTE },
            ] }),
    )
    .unwrap()
}

fn with_csv(k: &Kasten) {
    fs::create_dir_all(k.root().join("assets")).unwrap();
    fs::write(k.root().join("assets/sales.csv"), "month,total\nMar,7\n").unwrap();
}

#[test]
fn a_program_is_run_by_the_window_with_what_it_reads_and_its_picture_is_kept_on_the_slide() {
    let (_v, k, s) = open();
    with_csv(&k);
    let (path, ids) = deck_of_eight(&k, &s);
    let (_app, seen) = app(&k, drawn);
    let out = call_full(
        &k,
        &s,
        Writes::Direct,
        None,
        "place_code_picture",
        json!({ "deck": path, "slide": ids[1], "code": "return kit.svg(200, 100, '');", "alt": "Sales",
            "box": { "x": 100, "y": 200, "w": 400, "h": 300 },
            "inputs": [
                { "name": "sales", "kind": "data", "value": "month,total\nJan,3\nFeb,5\n" },
                { "name": "csv", "kind": "asset", "value": "assets/sales.csv" },
                { "name": "notes", "kind": "note", "value": NOTE },
            ] }),
    )
    .unwrap();
    assert_eq!(out.value["status"], "done", "{}", out.value);
    let told = &out.value["result"]["codePicture"];
    assert_eq!(told["kind"], "svg");
    assert_eq!(told["warnings"], json!(["a font was substituted"]));
    assert_eq!(out.images.len(), 1, "the agent is shown the picture");
    assert_eq!(out.images[0].bytes, PNG_HEAD);

    // What the app was asked, by an agent, for this deck.
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let (asked, payload, by_agent) = &seen[0];
    assert!(*by_agent, "the app is told an agent asked");
    assert_eq!(
        *asked,
        Call::RunGenerator {
            deck: Some(path.clone()),
            output: GeneratorOutput::Svg,
            timeout_ms: kasten_core::bridge::DEFAULT_RUN_MS
        }
    );
    assert_eq!(payload.language, "js");
    assert_eq!(payload.code, "return kit.svg(200, 100, '');");
    let input = |name: &str| {
        payload
            .inputs
            .iter()
            .find(|i| i.name == name)
            .map(|i| i.text.as_str())
    };
    assert_eq!(input("sales"), Some("month,total\nJan,3\nFeb,5\n"));
    assert_eq!(
        input("csv"),
        Some("month,total\nMar,7\n"),
        "a text file of assets/ is read here, not in the window"
    );
    assert!(
        input("notes").is_some_and(|t| !t.trim().is_empty() && !t.starts_with("---")),
        "the note's words, without its header"
    );
    assert!(
        payload.theme.contains_key("accent1") && payload.theme.contains_key("bg1"),
        "{:?}",
        payload.theme
    );

    // The picture is in the vault's assets, and on the slide with its program.
    let picture = told["picture"].as_str().unwrap();
    assert!(
        k.assets().unwrap().iter().any(|a| a.path == picture),
        "{picture}"
    );
    let slide = call(
        &k,
        &s,
        "get_slide",
        json!({ "deck": path, "slide": ids[1] }),
    )
    .unwrap()
    .to_string();
    assert!(
        slide.contains(picture)
            && slide.contains("\"generator\"")
            && slide.contains("return kit.svg(200, 100, '');"),
        "{slide}"
    );
}

#[test]
fn what_the_window_says_went_wrong_is_told_to_the_agent_and_nothing_is_written() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let version =
        |k: &Kasten| call(k, &s, "get_deck", json!({ "deck": path })).unwrap()["hash"].clone();
    let before = version(&k);
    let assets = k.assets().unwrap().len();
    let (_app, seen) = app(&k, |_, _| Err("Line 4: sales is not defined".to_owned()));
    let err = call(
        &k,
        &s,
        "place_code_picture",
        json!({ "deck": path, "slide": ids[1], "code": "return sales;", "box": { "x": 0, "y": 0, "w": 100, "h": 100 } }),
    )
    .unwrap_err();
    assert!(err.contains("Line 4"), "{err}");
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert_eq!(version(&k), before);
    assert_eq!(k.assets().unwrap().len(), assets);
}

#[test]
fn with_the_app_closed_the_agent_is_told_to_open_it() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    for (tool, args) in [
        (
            "place_code_picture",
            json!({ "deck": path, "slide": ids[1], "code": "return 1;", "box": { "x": 0, "y": 0, "w": 100, "h": 100 } }),
        ),
        ("rerun_code_pictures", json!({ "deck": path })),
    ] {
        let result = call(&k, &s, tool, args);
        // A deck with no code picture has nothing to run; the first needs the window.
        if tool == "place_code_picture" {
            let err = result.unwrap_err();
            assert!(err.contains("open KastenFlow"), "{err}");
        } else {
            assert_eq!(result.unwrap()["result"]["changed"], false);
        }
    }
}

#[test]
fn a_picture_is_run_again_with_new_code_and_the_deck_is_run_again_when_nothing_changed() {
    let (_v, k, s) = open();
    with_csv(&k);
    let (path, ids) = deck_of_eight(&k, &s);
    let (_app, seen) = app(&k, drawn);
    let placed = place(&k, &s, &path, &ids[1], "return kit.svg(200, 100, '');");
    let first = placed["result"]["codePicture"]["picture"]
        .as_str()
        .unwrap()
        .to_owned();
    let element = placed["result"]["result"]["element"]
        .as_str()
        .unwrap()
        .to_owned();

    // New code: another picture takes the place of the old one, which stays in the vault.
    let again = call(
        &k,
        &s,
        "run_code_picture",
        json!({ "deck": path, "slide": ids[1], "element": element, "code": "return kit.svg(200, 100, 'more');" }),
    )
    .unwrap();
    let second = again["result"]["codePicture"]["picture"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(first, second);
    assert!(
        k.assets().unwrap().iter().any(|a| a.path == first),
        "the old picture is kept"
    );
    let slide = call(
        &k,
        &s,
        "get_slide",
        json!({ "deck": path, "slide": ids[1] }),
    )
    .unwrap()
    .to_string();
    assert!(slide.contains(&second) && slide.contains("more"), "{slide}");

    // Run all: the same code and the same data draw the same picture, so nothing changes.
    let all = call(&k, &s, "rerun_code_pictures", json!({ "deck": path })).unwrap();
    assert_eq!(all["result"]["changed"], false, "{all}");
    assert_eq!(all["result"]["pictures"][0]["status"], "unchanged");
    assert_eq!(seen.lock().unwrap().len(), 3);
}

#[test]
fn an_input_that_cannot_be_read_is_refused_before_the_window_is_asked() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let (_app, seen) = app(&k, drawn);
    for (input, says) in [
        (
            json!({ "name": "a", "kind": "asset", "value": "library/x.csv" }),
            "text file of assets",
        ),
        (
            json!({ "name": "a", "kind": "asset", "value": "assets/../x.csv" }),
            "not a path in the vault",
        ),
        (
            json!({ "name": "a", "kind": "asset", "value": "assets/missing.csv" }),
            "no text file",
        ),
        (
            json!({ "name": "a", "kind": "note", "value": "library/no-such-note.md" }),
            "no-such-note",
        ),
    ] {
        let err = call(
            &k,
            &s,
            "place_code_picture",
            json!({ "deck": path, "slide": ids[1], "code": "return 1;", "inputs": [input.clone()], "box": { "x": 0, "y": 0, "w": 100, "h": 100 } }),
        )
        .unwrap_err();
        assert!(err.contains(says), "{input}: {err}");
    }
    assert!(seen.lock().unwrap().is_empty());
}
