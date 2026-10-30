//! A diagram as a PNG, for an agent that asks (`Call::DiagramPng`). The core
//! makes the SVG (the diagram editor's own picture when it drew one for this
//! very source, else the program's draft) and cleans it; the window draws it on
//! a canvas, with no network and nothing run; and what the window answers is
//! checked here, because it is only text until it is: a PNG, of a sensible
//! size, no bigger than the reply can carry. Nothing is written to the vault:
//! the asker keeps the picture, in the agent's session, through an agent op.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use kasten_core::DiagramPicture;
use kasten_core::latex::{FigureKind, sniff};
use serde_json::{Value, json};

use super::side::Side;
use super::window::{MAX_PNG_BYTES, MAX_SIDE_PX};

/// How long the window gets to draw one picture.
const DRAW_WAIT: Duration = Duration::from_secs(20);
/// A PNG's size is at bytes 16 to 24 (the first chunk after the signature).
const PNG_HEAD: usize = 24;

/// The width and height of a PNG whose first chunk is its header.
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < PNG_HEAD || sniff(bytes) != Some(FigureKind::Png) {
        return None;
    }
    let side =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    Some((side(16), side(20)))
}

/// The window's answer, checked: the PNG's bytes and size, or why it is refused.
fn checked(answer: &str) -> Result<(Vec<u8>, u32, u32), String> {
    // Longer than the largest PNG as base64 is too big before it is even read.
    if answer.len() > MAX_PNG_BYTES / 3 * 4 + 8 {
        return Err("The picture the window drew is too big to send. Try a smaller diagram or one page of it".to_owned());
    }
    let bytes = STANDARD
        .decode(answer.trim())
        .map_err(|_| "The window's picture was not a picture".to_owned())?;
    let Some((width, height)) = png_size(&bytes) else {
        return Err("The window's picture was not a PNG".to_owned());
    };
    if bytes.len() > MAX_PNG_BYTES {
        return Err("The picture the window drew is too big to send. Try a smaller diagram or one page of it".to_owned());
    }
    if width == 0 || height == 0 || width > MAX_SIDE_PX || height > MAX_SIDE_PX {
        return Err(format!(
            "The picture the window drew is {width} by {height} pixels; the most is {MAX_SIDE_PX}"
        ));
    }
    Ok((bytes, width, height))
}

/// Draws the picture the core made, once: a PNG, or why not.
fn drawn(
    side: &dyn Side,
    picture: &DiagramPicture,
) -> Result<(Vec<u8>, u32, u32), super::window::Failed> {
    let answer = side.draw_png(&picture.svg, picture.background.css(), DRAW_WAIT)?;
    checked(&answer).map_err(|why| super::window::Failed {
        why,
        answered: true,
    })
}

/// The answer to a request for the PNG of `diagram` (a vault path), or of one of its `page`s.
pub fn png(side: &dyn Side, diagram: &str, page: Option<&str>) -> Result<Value, String> {
    side.diagrams_on()?;
    let kasten = side.kasten()?;
    if !diagram.ends_with(kasten_core::diagrams::EXT) {
        return Err("That is not a diagram of this vault".to_owned());
    }
    let plain = |err: kasten_core::Error| err.to_string();
    let mut picture = kasten.diagram_picture(diagram, page, true).map_err(plain)?;
    let mut result = drawn(side, &picture);
    // A picture the diagram editor drew can hold labels some windows will not
    // draw on a canvas; the program's own draft always can.
    if let Err(failed) = &result
        && failed.answered
        && picture.from == "editor"
    {
        picture = kasten
            .diagram_picture(diagram, page, false)
            .map_err(plain)?;
        result = drawn(side, &picture);
    }
    let (bytes, width, height) = result.map_err(|failed| failed.why)?;
    Ok(json!({
        "png_base64": STANDARD.encode(&bytes),
        "bytes": bytes.len(),
        "width": width,
        "height": height,
        "from": picture.from,
        "background": picture.background.css(),
        "warnings": picture.warnings,
    }))
}
