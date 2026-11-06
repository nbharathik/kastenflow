//! The app's side of running a code picture: what the window is asked, who must allow it first, and what
//! is believed of its answer. The window is a stand-in that records what it is asked and answers with
//! what a test gives it.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use kasten_core::agent::Session;
use kasten_core::bridge::{Call, GeneratorOutput, MAX_GENERATED_SVG, Request};
use kasten_core::latex::LatexDoc;
use kasten_core::{Instant, Kasten};
use serde_json::{Value, json};

use super::generator::{ASK_EVENT, PERMISSION_WAIT, RUN_EVENT, handle};
use super::side::Side;
use super::window::Failed;
use crate::plugins::latex::service::Outcome;

mod allow;

struct Window {
    payload: Option<Vec<u8>>,
    allowed: bool,
    /// Where a person's "Allow to run" is kept, as the app keeps it; none: `allowed` says.
    store: Option<std::path::PathBuf>,
    permission: Result<String, Failed>,
    run: Result<String, Failed>,
    asked: Mutex<Vec<(String, Value, Duration)>>,
}

impl Side for Window {
    fn kasten(&self) -> Result<Arc<Kasten>, String> {
        Err("no vault".to_owned())
    }
    fn latex_on(&self) -> Result<(), String> {
        Ok(())
    }
    fn diagrams_on(&self) -> Result<(), String> {
        Ok(())
    }
    fn build(&self, _doc: &LatexDoc, _wait: Duration) -> Result<Outcome, String> {
        Err("no engine".to_owned())
    }
    fn draw_png(&self, _svg: &str, _background: &str, _wait: Duration) -> Result<String, Failed> {
        Err(silent("not here"))
    }
    fn payload(&self, _id: &str) -> Result<Vec<u8>, String> {
        self.payload
            .clone()
            .ok_or_else(|| "The deck did not come with the request".to_owned())
    }
    fn ask_generator(&self, event: &str, job: Value, wait: Duration) -> Result<String, Failed> {
        self.asked
            .lock()
            .unwrap()
            .push((event.to_owned(), job, wait));
        if event == ASK_EVENT {
            self.permission.clone()
        } else {
            self.run.clone()
        }
    }
    fn generator_allowed(&self, deck: &str, hash: &str) -> bool {
        match &self.store {
            Some(dir) => crate::smart::settings::generator_allowed(Some(dir), deck, hash),
            None => self.allowed,
        }
    }
    fn share_selection(&self, _now: u64) -> Result<(), String> {
        Ok(())
    }
    fn selection_published_since(&self, _since: u64) -> bool {
        false
    }
}

fn silent(why: &str) -> Failed {
    Failed {
        why: why.to_owned(),
        answered: false,
    }
}

fn said(why: &str) -> Failed {
    Failed {
        why: why.to_owned(),
        answered: true,
    }
}

/// The first bytes of a PNG `w` by `h` pixels, as base64: its signature and header chunk.
fn png(w: u32, h: u32) -> String {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&w.to_be_bytes());
    bytes.extend_from_slice(&h.to_be_bytes());
    bytes.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
    STANDARD.encode(bytes)
}

const SVG: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"100\" viewBox=\"0 0 200 100\"></svg>";

fn svg_answer() -> String {
    json!({ "svg": SVG, "preview_png_base64": png(16, 8), "warnings": ["a font"], "logs": ["rows: 2"] }).to_string()
}

fn payload_bytes() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "language": "js",
        "code": "return kit.svg(200, 100, '');",
        "inputs": [{ "name": "sales", "text": "a,b\n1,2\n" }],
        "theme": { "accent1": "#2563eb" },
    }))
    .unwrap()
}

fn window(
    allowed: bool,
    permission: Result<String, Failed>,
    run: Result<String, Failed>,
) -> Window {
    Window {
        payload: Some(payload_bytes()),
        allowed,
        store: None,
        permission,
        run,
        asked: Mutex::default(),
    }
}

fn call(output: GeneratorOutput) -> Call {
    Call::RunGenerator {
        deck: Some("library/talk.deck".to_owned()),
        output,
        timeout_ms: 8_000,
    }
}

fn by_a_person(call: &Call) -> Request {
    Request::new("a".repeat(32), call, None, 0)
}

fn by_an_agent(call: &Call) -> Request {
    let session = Session::start("claude-code", Instant::now());
    Request::new("a".repeat(32), call, Some(&session), 0)
}

#[test]
fn code_a_person_wrote_runs_at_once_with_what_it_may_read_and_the_picture_is_checked() {
    let side = window(false, Err(silent("never asked")), Ok(svg_answer()));
    let call = call(GeneratorOutput::Svg);
    let result = handle(&side, &by_a_person(&call), &call).unwrap();
    assert_eq!(result["output"], "svg");
    assert_eq!(result["svg"], SVG);
    assert_eq!(
        (result["width"].as_u64(), result["height"].as_u64()),
        (Some(200), Some(100))
    );
    assert_eq!(result["warnings"], json!(["a font"]));
    assert_eq!(result["logs"], json!(["rows: 2"]));
    assert_eq!(result["preview_png_base64"], json!(png(16, 8)));

    let asked = side.asked.lock().unwrap();
    assert_eq!(
        asked.len(),
        1,
        "nobody was asked to allow a person's own code"
    );
    let (event, job, wait) = &asked[0];
    assert_eq!(event, RUN_EVENT);
    assert_eq!(job["code"], "return kit.svg(200, 100, '');");
    assert_eq!(
        job["inputs"],
        json!([{ "name": "sales", "text": "a,b\n1,2\n" }])
    );
    assert_eq!(job["theme"], json!({ "accent1": "#2563eb" }));
    assert_eq!(
        (job["output"].as_str(), job["timeoutMs"].as_u64()),
        (Some("svg"), Some(8_000))
    );
    assert_eq!(job["agent"], Value::Null);
    assert_eq!(job["deck"], "library/talk.deck");
    assert_eq!(job["maxSvg"], MAX_GENERATED_SVG);
    assert_eq!(
        *wait,
        Duration::from_secs(18),
        "the code's own time and room for the window"
    );
}

#[test]
fn code_an_agent_wrote_waits_for_the_persons_allow_and_then_runs() {
    let side = window(false, Ok("allow".to_owned()), Ok(svg_answer()));
    let call = call(GeneratorOutput::Svg);
    handle(&side, &by_an_agent(&call), &call).unwrap();
    let asked = side.asked.lock().unwrap();
    assert_eq!(asked.len(), 2);
    let (event, question, wait) = &asked[0];
    assert_eq!(event, ASK_EVENT);
    assert_eq!(question["deck"], "library/talk.deck");
    assert_eq!(question["agent"], "claude-code");
    assert_eq!(question["code"], "return kit.svg(200, 100, '');");
    assert_eq!(question["inputs"], json!(["sales"]));
    assert_eq!(*wait, PERMISSION_WAIT);
    assert_eq!(asked[1].0, RUN_EVENT);
    assert_eq!(asked[1].1["agent"], "claude-code");
}

#[test]
fn a_deck_the_person_already_allowed_runs_an_agents_code_without_asking() {
    let side = window(true, Err(silent("never asked")), Ok(svg_answer()));
    let call = call(GeneratorOutput::Svg);
    handle(&side, &by_an_agent(&call), &call).unwrap();
    let asked = side.asked.lock().unwrap();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].0, RUN_EVENT);
}

#[test]
fn a_person_who_says_no_or_does_not_answer_keeps_the_code_from_running() {
    let call = call(GeneratorOutput::Svg);
    let no = window(false, Ok("deny".to_owned()), Ok(svg_answer()));
    let why = handle(&no, &by_an_agent(&call), &call).unwrap_err();
    assert!(
        why.contains("did not allow") && why.contains("Do not ask again"),
        "{why}"
    );
    assert_eq!(no.asked.lock().unwrap().len(), 1, "the code was never run");

    let silent_person = window(
        false,
        Err(silent("KastenFlow's window did not answer in time")),
        Ok(svg_answer()),
    );
    let why = handle(&silent_person, &by_an_agent(&call), &call).unwrap_err();
    assert!(
        why.contains("has not answered") && why.contains("open KastenFlow"),
        "{why}"
    );
    assert_eq!(silent_person.asked.lock().unwrap().len(), 1);

    let refused = window(
        false,
        Err(said("The person closed the question")),
        Ok(svg_answer()),
    );
    assert_eq!(
        handle(&refused, &by_an_agent(&call), &call).unwrap_err(),
        "The person closed the question"
    );
    assert_eq!(refused.asked.lock().unwrap().len(), 1);
}

#[test]
fn what_the_window_says_went_wrong_in_the_code_comes_back_as_it_was_said() {
    let call = call(GeneratorOutput::Svg);
    let side = window(
        true,
        Err(silent("never asked")),
        Err(said("Line 3: ReferenceError: sales is not defined")),
    );
    assert_eq!(
        handle(&side, &by_a_person(&call), &call).unwrap_err(),
        "Line 3: ReferenceError: sales is not defined"
    );
    let silent_window = window(
        true,
        Err(silent("never asked")),
        Err(silent("KastenFlow's window did not run the code in time")),
    );
    assert!(
        handle(&silent_window, &by_a_person(&call), &call)
            .unwrap_err()
            .contains("in time")
    );
}

#[test]
fn a_picture_is_believed_only_when_it_is_what_was_asked_for() {
    let svg_call = call(GeneratorOutput::Svg);
    let ask = |answer: Value| {
        let side = window(true, Err(silent("never asked")), Ok(answer.to_string()));
        handle(&side, &by_a_person(&svg_call), &svg_call)
    };
    assert!(ask(json!({ "svg": 4 })).unwrap_err().contains("no picture"));
    assert!(
        ask(json!({ "svg": "hello" }))
            .unwrap_err()
            .contains("not an SVG")
    );
    assert!(
        ask(json!({ "svg": "<div>no svg</div>" }))
            .unwrap_err()
            .contains("not an SVG")
    );
    assert!(
        ask(json!({ "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }))
            .unwrap_err()
            .contains("no usable size")
    );
    assert!(
        ask(json!({ "svg": "<svg width=\"0\" height=\"10\"></svg>" }))
            .unwrap_err()
            .contains("no usable size")
    );
    let big = format!(
        "<svg width=\"1\" height=\"1\">{}</svg>",
        "x".repeat(MAX_GENERATED_SVG)
    );
    assert!(
        ask(json!({ "svg": big }))
            .unwrap_err()
            .contains("larger than 1 MB")
    );
    // A viewBox says the size when there are no width and height.
    let boxed = ask(json!({ "svg": "<svg viewBox=\"0 0 320 180\"></svg>" })).unwrap();
    assert_eq!(
        (boxed["width"].as_u64(), boxed["height"].as_u64()),
        (Some(320), Some(180))
    );
    // A preview that is not a PNG is left out, not an error.
    let looked = ask(json!({ "svg": SVG, "preview_png_base64": "bm90IGEgcG5n" })).unwrap();
    assert!(looked.get("preview_png_base64").is_none());
    // The window's lines are cut.
    let wordy = ask(json!({ "svg": SVG, "warnings": (0..40).map(|i| format!("w{i}")).collect::<Vec<_>>(), "logs": ["x".repeat(900)] })).unwrap();
    assert_eq!(wordy["warnings"].as_array().unwrap().len(), 20);
    assert_eq!(wordy["logs"][0].as_str().unwrap().len(), 300);
    assert!(
        handle(
            &window(true, Err(silent("")), Ok("not json".to_owned())),
            &by_a_person(&svg_call),
            &svg_call
        )
        .is_err()
    );
}

#[test]
fn a_png_is_checked_by_its_bytes_and_its_size() {
    let call = call(GeneratorOutput::Png);
    let ask = |answer: Value| {
        let side = window(true, Err(silent("never asked")), Ok(answer.to_string()));
        handle(&side, &by_a_person(&call), &call)
    };
    let made = ask(json!({ "png_base64": png(800, 400) })).unwrap();
    assert_eq!(
        (
            made["output"].as_str(),
            made["width"].as_u64(),
            made["height"].as_u64()
        ),
        (Some("png"), Some(800), Some(400))
    );
    assert_eq!(made["png_base64"], json!(png(800, 400)));
    assert!(
        ask(json!({ "svg": SVG }))
            .unwrap_err()
            .contains("no picture")
    );
    assert!(
        ask(json!({ "png_base64": "bm90IGEgcG5n" }))
            .unwrap_err()
            .contains("not a PNG")
    );
    assert!(
        ask(json!({ "png_base64": "%%%" }))
            .unwrap_err()
            .contains("not a picture")
    );
    assert!(
        ask(json!({ "png_base64": png(5000, 10) }))
            .unwrap_err()
            .contains("pixels")
    );
    assert!(
        ask(json!({ "png_base64": png(0, 10) }))
            .unwrap_err()
            .contains("pixels")
    );
    let heavy = STANDARD.encode(vec![0u8; 3 * 1024 * 1024]);
    assert!(
        ask(json!({ "png_base64": heavy }))
            .unwrap_err()
            .contains("too big")
    );
}

#[test]
fn code_that_cannot_be_run_is_refused_before_the_window_or_the_person_is_asked() {
    let call = call(GeneratorOutput::Svg);
    for (bytes, says) in [
        (None, "did not come"),
        (Some(b"not json".to_vec()), "could not be read"),
        (Some(serde_json::to_vec(&json!({ "language": "python", "code": "print(1)" })).unwrap()), "JavaScript"),
        (Some(serde_json::to_vec(&json!({ "language": "js", "code": "  " })).unwrap()), "empty"),
        (
            Some(serde_json::to_vec(&json!({ "language": "js", "code": "x", "inputs": [{ "name": "1a", "text": "" }] })).unwrap()),
            "cannot name",
        ),
        (
            Some(serde_json::to_vec(&json!({ "language": "js", "code": "x", "theme": { "accent1": "url(x)" } })).unwrap()),
            "theme colours",
        ),
    ] {
        let mut side = window(false, Ok("allow".to_owned()), Ok(svg_answer()));
        side.payload = bytes;
        let why = handle(&side, &by_an_agent(&call), &call).unwrap_err();
        assert!(why.contains(says), "{says}: {why}");
        assert!(side.asked.lock().unwrap().is_empty(), "{says}");
    }
    // Some other call is not this one's.
    let other = Call::SlideGrid {};
    let side = window(true, Err(silent("")), Ok(svg_answer()));
    assert!(handle(&side, &by_a_person(&other), &other).is_err());
}

#[test]
fn the_time_given_is_kept_within_what_a_request_may_ask() {
    let side = window(true, Err(silent("never asked")), Ok(svg_answer()));
    // A request file with more time than allowed is refused by the core; the app also clamps what it was handed.
    let long = Call::RunGenerator {
        deck: None,
        output: GeneratorOutput::Svg,
        timeout_ms: 600_000,
    };
    handle(&side, &by_a_person(&long), &long).unwrap();
    let (_, job, wait) = side.asked.lock().unwrap()[0].clone();
    assert_eq!(job["timeoutMs"], 30_000);
    assert_eq!(wait, Duration::from_secs(40));
    assert_eq!(job["deck"], "");
}
