//! Pictures in a user message, as each provider takes them. The adapters
//! (`anthropic`, `openai`, `responses`) call one function each, so what a
//! provider wants lives here and the adapters stay about the thread.
//!
//! A picture whose bytes could not be read again (the attachment store lost
//! it) goes as a sentence saying so, never as an empty image the provider
//! would turn the whole request down for.

use serde_json::{Value, json};

use super::model::Image;

/// The pictures that have bytes, and a line for each that has none.
fn readable(images: &[Image]) -> (Vec<&Image>, Vec<String>) {
    let mut have = Vec::new();
    let mut notes = Vec::new();
    for image in images {
        if image.data.is_empty() {
            notes.push(format!(
                "[The picture “{}” could not be read again and is not attached.]",
                image.name
            ));
        } else {
            have.push(image);
        }
    }
    (have, notes)
}

/// The text with the notes of lost pictures after it.
fn words(text: &str, notes: &[String]) -> String {
    let mut out = text.to_owned();
    for note in notes {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(note);
    }
    out
}

fn data_url(image: &Image) -> String {
    format!("data:{};base64,{}", image.mime, image.data)
}

/// Anthropic's content blocks: the pictures first, as its guidance advises,
/// then the words (a text block may not be empty).
pub fn anthropic(text: &str, images: &[Image]) -> Vec<Value> {
    let (have, notes) = readable(images);
    let mut blocks: Vec<Value> = have
        .iter()
        .map(|image| {
            json!({"type": "image", "source": {
                "type": "base64", "media_type": image.mime, "data": image.data
            }})
        })
        .collect();
    let text = words(text, &notes);
    if !text.trim().is_empty() {
        blocks.push(json!({"type": "text", "text": text}));
    }
    blocks
}

/// The `content` of a chat-completions user message: text and `image_url`
/// parts with the pictures as data URLs.
pub fn chat_completions(text: &str, images: &[Image]) -> Value {
    let (have, notes) = readable(images);
    let text = words(text, &notes);
    let mut parts = Vec::new();
    if !text.trim().is_empty() {
        parts.push(json!({"type": "text", "text": text}));
    }
    parts.extend(
        have.iter()
            .map(|image| json!({"type": "image_url", "image_url": {"url": data_url(image)}})),
    );
    json!(parts)
}

/// The `content` of a Responses-API user item: `input_text` and
/// `input_image` parts.
pub fn responses(text: &str, images: &[Image]) -> Value {
    let (have, notes) = readable(images);
    let text = words(text, &notes);
    let mut parts = Vec::new();
    if !text.trim().is_empty() {
        parts.push(json!({"type": "input_text", "text": text}));
    }
    parts.extend(
        have.iter()
            .map(|image| json!({"type": "input_image", "image_url": data_url(image)})),
    );
    json!(parts)
}
