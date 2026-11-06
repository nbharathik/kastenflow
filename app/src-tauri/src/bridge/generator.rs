//! Running the code of a code picture for an agent (`Call::RunGenerator`). The code and what it may
//! read came beside the request, already read from the vault by the asker; this hands them to the
//! window, which runs them in a sandboxed frame (no network, no vault, one message out; see
//! `smart::generator`), and what the window answers is only text until it is checked here: an SVG
//! that is one, a PNG by its bytes, of a sensible size, no bigger than the reply can carry.
//!
//! Code an agent wrote waits for a person. When this code has not been allowed for the deck (an allow
//! is for the code the person saw, by its hash, and never for a code picture in no deck), the window is
//! asked first to show the person the code and its "Allow to run"; only their answer lets the code
//! go on, and the app, not the window's drawing, enforces it. Nothing is written to the vault.

use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use kasten_core::bridge::{
    Call, GeneratorOutput, GeneratorPayload, MAX_GENERATED_PNG, MAX_GENERATED_SIDE,
    MAX_GENERATED_SVG, Request, clamp_run_ms,
};
use kasten_core::latex::{FigureKind, sniff};
use serde_json::{Value, json};

use super::side::Side;
use crate::smart::settings;

/// The event that asks the window to run code.
pub const RUN_EVENT: &str = "kasten://run-generator";
/// The event that asks the window to show a person agent-written code and its "Allow to run".
pub const ASK_EVENT: &str = "kasten://allow-generator";

/// How long a person is given to answer, and the room the window needs besides the code's own time.
pub const PERMISSION_WAIT: Duration = Duration::from_secs(100);
const RUN_SLACK: Duration = Duration::from_secs(10);
/// How much of the code a person is shown in the question (the window shows the rest on request).
const SHOWN_CODE_CHARS: usize = 4_000;
/// The most warnings and log lines kept, and the longest of each.
const MOST_LINES: usize = 20;
const LINE_CHARS: usize = 300;
/// The biggest side an SVG may say it is.
const MOST_SVG_SIDE: f64 = 100_000.0;
/// The most a preview of an SVG may weigh, so the reply with both stays under its limit.
const MAX_PREVIEW: usize = 1024 * 1024;
/// A PNG's size is at bytes 16 to 24 (the first chunk after the signature).
const PNG_HEAD: usize = 24;

/// One program at a time: the window runs them in turn.
static ONE: Mutex<()> = Mutex::new(());

/// The PNG's width and height, if these bytes are one.
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < PNG_HEAD || sniff(bytes) != Some(FigureKind::Png) {
        return None;
    }
    let side =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    Some((side(16), side(20)))
}

fn lines(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(MOST_LINES)
        .map(|line| line.chars().take(LINE_CHARS).collect())
        .collect()
}

/// A PNG as the window said it (base64), when it is one and fits `most` bytes.
fn png_of(text: &str, most: usize) -> Result<(Vec<u8>, u32, u32), String> {
    if text.len() > most / 3 * 4 + 8 {
        return Err(
            "The picture the code drew is too big to send. Ask for a smaller one".to_owned(),
        );
    }
    let bytes = STANDARD
        .decode(text.trim())
        .map_err(|_| "The window's picture was not a picture".to_owned())?;
    let Some((width, height)) = png_size(&bytes) else {
        return Err("The window's picture was not a PNG".to_owned());
    };
    if bytes.len() > most {
        return Err(
            "The picture the code drew is too big to send. Ask for a smaller one".to_owned(),
        );
    }
    if width == 0 || height == 0 || width > MAX_GENERATED_SIDE || height > MAX_GENERATED_SIDE {
        return Err(format!(
            "The picture the code drew is {width} by {height} pixels; the most is {MAX_GENERATED_SIDE}"
        ));
    }
    Ok((bytes, width, height))
}

/// The width and height an SVG says it is: its `width` and `height`, else its `viewBox`.
fn svg_size(svg: &str) -> Option<(f64, f64)> {
    let start = svg.find("<svg")?;
    let tag = &svg[start..start + svg[start..].find('>')?];
    let attribute = |name: &str| -> Option<f64> {
        let at = tag.find(&format!(" {name}=\""))? + name.len() + 3;
        let end = tag[at..].find('"')?;
        let digits: String = tag[at..at + end]
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        digits.parse().ok()
    };
    if let (Some(w), Some(h)) = (attribute("width"), attribute("height")) {
        return Some((w, h));
    }
    let at = tag.find("viewBox=\"")? + 9;
    let end = tag[at..].find('"')?;
    let numbers: Vec<f64> = tag[at..at + end]
        .split([' ', ','])
        .filter_map(|v| v.parse().ok())
        .collect();
    (numbers.len() == 4).then(|| (numbers[2], numbers[3]))
}

/// The window's answer, checked: what the asker gets, or one sentence for why not.
fn checked(answer: &str, output: GeneratorOutput) -> Result<Value, String> {
    let value: Value = serde_json::from_str(answer)
        .map_err(|_| "The window's answer was not readable".to_owned())?;
    let warnings = lines(&value["warnings"]);
    let logs = lines(&value["logs"]);
    match output {
        GeneratorOutput::Svg => {
            let svg = value["svg"]
                .as_str()
                .ok_or_else(|| "The window sent no picture".to_owned())?;
            if svg.len() > MAX_GENERATED_SVG {
                return Err("The picture the code drew is larger than 1 MB".to_owned());
            }
            if !svg.trim_start().starts_with('<') || !svg.contains("<svg") {
                return Err("What the code drew is not an SVG".to_owned());
            }
            let (width, height) = svg_size(svg)
                .filter(|(w, h)| *w > 0.0 && *h > 0.0 && *w <= MOST_SVG_SIDE && *h <= MOST_SVG_SIDE)
                .ok_or_else(|| {
                    "The SVG has no usable size: give <svg> a width and a height, or a viewBox (kit.svg does)".to_owned()
                })?;
            // A look at the drawing for the agent; a window that could not make one is not an error.
            let preview = value["preview_png_base64"]
                .as_str()
                .and_then(|text| png_of(text, MAX_PREVIEW).ok())
                .map(|(bytes, _, _)| STANDARD.encode(bytes));
            let mut told = json!({
                "output": "svg",
                "svg": svg,
                "width": width.round() as u64,
                "height": height.round() as u64,
                "warnings": warnings,
                "logs": logs,
            });
            if let Some(preview) = preview {
                told["preview_png_base64"] = Value::String(preview);
            }
            Ok(told)
        }
        GeneratorOutput::Png => {
            let text = value["png_base64"]
                .as_str()
                .ok_or_else(|| "The window sent no picture".to_owned())?;
            let (bytes, width, height) = png_of(text, MAX_GENERATED_PNG)?;
            Ok(json!({
                "output": "png",
                "png_base64": STANDARD.encode(&bytes),
                "width": width,
                "height": height,
                "warnings": warnings,
                "logs": logs,
            }))
        }
    }
}

/// Asks a person to allow agent-written code to run for the deck. Their "yes" is the window's answer;
/// anything else, or none, keeps the code from running.
fn permission(
    side: &dyn Side,
    deck: &str,
    client: &str,
    payload: &GeneratorPayload,
    hash: &str,
) -> Result<(), String> {
    let shown: String = payload.code.chars().take(SHOWN_CODE_CHARS).collect();
    let job = json!({
        "deck": deck,
        "agent": client,
        "code": shown,
        "codeBytes": payload.code.len(),
        // What "Allow to run" is kept for: the hash of all of the code, not only of the part shown.
        "hash": hash,
        "inputs": payload.inputs.iter().map(|i| i.name.clone()).collect::<Vec<_>>(),
    });
    match side.ask_generator(ASK_EVENT, job, PERMISSION_WAIT) {
        Ok(answer) if answer == "allow" => Ok(()),
        Ok(_) => Err("The person did not allow this code to run. Do not ask again: tell them what it would have drawn, and that they can allow code for this deck in KastenFlow".to_owned()),
        Err(failed) if failed.answered => Err(failed.why),
        Err(failed) => Err(format!(
            "{}. The person was asked to allow the code to run and has not answered: ask them to open KastenFlow and allow it",
            failed.why.trim_end_matches('.')
        )),
    }
}

/// The answer to a request to run code: the picture (`svg` or `png_base64`, its size, `warnings`,
/// `logs`), or one sentence for why not.
pub fn handle(side: &dyn Side, request: &Request, call: &Call) -> Result<Value, String> {
    let Call::RunGenerator {
        deck,
        output,
        timeout_ms,
    } = call
    else {
        return Err("The app does not know how to do that".to_owned());
    };
    let bytes = side.payload(&request.id)?;
    let payload: GeneratorPayload = serde_json::from_slice(&bytes)
        .map_err(|_| "The code that came with the request could not be read".to_owned())?;
    payload.check().map_err(|why| why.to_string())?;
    let _alone = ONE.lock().unwrap_or_else(|p| p.into_inner());
    let deck = deck.as_deref().unwrap_or_default();
    // Code a person wrote is theirs to run; code an agent wrote waits for them, until they have allowed
    // this very code in this deck (other code, or code in no deck, asks again).
    if let Some(session) = &request.session {
        let hash = settings::code_hash(&payload.code);
        if !side.generator_allowed(deck, &hash) {
            permission(side, deck, &session.client, &payload, &hash)?;
        }
    }
    let run = clamp_run_ms(*timeout_ms);
    let job = json!({
        "deck": deck,
        "agent": request.session.as_ref().map(|s| s.client.clone()),
        "output": output.word(),
        "timeoutMs": run,
        "code": payload.code,
        "inputs": payload.inputs,
        "theme": payload.theme,
        "maxSvg": MAX_GENERATED_SVG,
        "maxPng": MAX_GENERATED_PNG,
        "maxSide": MAX_GENERATED_SIDE,
    });
    let answer = side
        .ask_generator(RUN_EVENT, job, Duration::from_millis(run) + RUN_SLACK)
        .map_err(|failed| failed.why)?;
    checked(&answer, *output)
}
