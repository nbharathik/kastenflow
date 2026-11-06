//! Slides drawn for an agent (`Call::SlidePng`, `SlideGrid`, `SlideDiff`) and
//! the size of a deck's words (`SlideMeasure`). The deck came beside the
//! request; the window draws it with the same renderer the editor's picture
//! export uses, fetching nothing but the vault's own pictures, and what it
//! answers is only text here until it is checked: a PNG by its bytes, of a
//! sensible size, no bigger than the reply can carry; the sizes as JSON of the
//! right shape. Nothing is written to the vault.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use kasten_core::bridge::{Call, Decks, Request, SCALE_RANGE};
use kasten_core::latex::{FigureKind, sniff};
use serde_json::{Value, json};

use super::side::Side;
use super::window::{MAX_PNG_BYTES, MAX_SIDE_PX};

/// How long the window gets to draw one picture.
const DRAW_WAIT: Duration = Duration::from_secs(45);
/// How long it gets to lay a deck's words out.
const MEASURE_WAIT: Duration = Duration::from_secs(15);
/// The most JSON the sizes of a deck's words may come to.
const MAX_MEASURE_BYTES: usize = 2 * 1024 * 1024;
/// A PNG's size is at bytes 16 to 24 (the first chunk after the signature).
const PNG_HEAD: usize = 24;

/// The PNG's width and height, if these bytes are one.
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < PNG_HEAD || sniff(bytes) != Some(FigureKind::Png) {
        return None;
    }
    let side =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    Some((side(16), side(20)))
}

/// The window's picture, checked: its bytes and size, or why it is refused.
fn checked(answer: &str) -> Result<(Vec<u8>, u32, u32), String> {
    const TOO_BIG: &str =
        "The picture the window drew is too big to send. Ask for a smaller scale or one slide";
    if answer.len() > MAX_PNG_BYTES / 3 * 4 + 8 {
        return Err(TOO_BIG.to_owned());
    }
    let bytes = STANDARD
        .decode(answer.trim())
        .map_err(|_| "The window's picture was not a picture".to_owned())?;
    let Some((width, height)) = png_size(&bytes) else {
        return Err("The window's picture was not a PNG".to_owned());
    };
    if bytes.len() > MAX_PNG_BYTES {
        return Err(TOO_BIG.to_owned());
    }
    if width == 0 || height == 0 || width > MAX_SIDE_PX || height > MAX_SIDE_PX {
        return Err(format!(
            "The picture the window drew is {width} by {height} pixels; the most is {MAX_SIDE_PX}"
        ));
    }
    Ok((bytes, width, height))
}

/// The sizes the window measured, checked: JSON with a `slides` object.
fn measures(answer: &str) -> Result<Value, String> {
    if answer.len() > MAX_MEASURE_BYTES {
        return Err("The sizes the window measured are too big to send".to_owned());
    }
    let value: Value = serde_json::from_str(answer)
        .map_err(|_| "The window's measurements were not readable".to_owned())?;
    if !value["slides"].is_object() {
        return Err("The window's measurements were not what lint expects".to_owned());
    }
    Ok(json!({ "measures": value }))
}

/// The window's job for `call`, without the decks.
fn job_of(call: &Call) -> Option<Value> {
    let scale = |percent: &u32| f64::from(*percent) / 100.0;
    Some(match call {
        Call::SlidePng {
            slide,
            step,
            scale_percent,
        } => {
            json!({ "kind": "slide", "slide": slide, "step": step, "scale": scale(scale_percent) })
        }
        Call::SlideGrid {} => json!({ "kind": "grid", "scale": 1.0 }),
        Call::SlideDiff {
            before_slide,
            after_slide,
            step,
            scale_percent,
            before_marks,
            after_marks,
        } => json!({
            "kind": "diff",
            "slide": after_slide,
            "beforeSlide": before_slide,
            "step": step,
            "scale": scale(scale_percent),
            "beforeMarks": before_marks,
            "afterMarks": after_marks,
        }),
        Call::SlideMeasure {} => json!({ "kind": "measure", "scale": 1.0 }),
        _ => return None,
    })
}

/// The answer to a request for slides: the picture (`png_base64`, its size and
/// `warnings`), or for `SlideMeasure` the sizes (`measures`); or one sentence
/// for why not.
pub fn handle(side: &dyn Side, request: &Request, call: &Call) -> Result<Value, String> {
    let mut job = job_of(call).ok_or_else(|| "The app does not know how to do that".to_owned())?;
    if let Call::SlidePng { scale_percent, .. } | Call::SlideDiff { scale_percent, .. } = call
        && !SCALE_RANGE.contains(scale_percent)
    {
        return Err("A slide is drawn at 25 to 400 percent".to_owned());
    }
    let bytes = side.payload(&request.id)?;
    let decks: Decks = serde_json::from_slice(&bytes)
        .map_err(|_| "The deck that came with the request could not be read".to_owned())?;
    job["after"] = Value::String(decks.after);
    job["before"] = decks.before.map_or(Value::Null, Value::String);
    job["maxSide"] = json!(MAX_SIDE_PX);
    job["maxBytes"] = json!(MAX_PNG_BYTES);
    let measuring = matches!(call, Call::SlideMeasure {});
    let wait = if measuring { MEASURE_WAIT } else { DRAW_WAIT };
    let answer = side.ask_slides(job, wait).map_err(|failed| failed.why)?;
    if measuring {
        return measures(&answer);
    }
    let (png, width, height) = checked(&answer)?;
    Ok(json!({
        "png_base64": STANDARD.encode(&png),
        "bytes": png.len(),
        "width": width,
        "height": height,
        "warnings": [],
    }))
}
