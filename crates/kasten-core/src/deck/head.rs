//! A deck's envelope, and the images it names.

use serde_json::Value;

use crate::error::{Error, Result};

/// The `format` every deck states.
pub const FORMAT: &str = "kasten-deck";

/// The largest deck core reads or writes: a deck holds text and paths, and
/// its images are separate files.
pub const MAX_BYTES: usize = 32 << 20;

/// What lists and checks need to know about a deck.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub title: Option<String>,
    pub slides: usize,
    pub version: u64,
}

fn not_a_deck(why: &str) -> Error {
    Error::Invalid(format!("Not a KastenFlow deck: {why}"))
}

/// Reads the envelope of the deck in `text`, or says why it is not one.
/// Whether this build can open the version is for the editor to say.
pub fn head_of(text: &str) -> Result<Head> {
    if text.len() > MAX_BYTES {
        return Err(not_a_deck("it is too large"));
    }
    let value: Value = serde_json::from_str(text).map_err(|_| not_a_deck("not JSON"))?;
    let Some(deck) = value.as_object() else {
        return Err(not_a_deck("not a deck object"));
    };
    if deck.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(not_a_deck("its format is not kasten-deck"));
    }
    let version = deck
        .get("formatVersion")
        .and_then(Value::as_u64)
        .filter(|v| *v >= 1)
        .ok_or_else(|| not_a_deck("it has no format version"))?;
    let slides = deck
        .get("slides")
        .and_then(Value::as_array)
        .ok_or_else(|| not_a_deck("it has no slides list"))?
        .len();
    let title = match deck.get("title") {
        None | Some(Value::Null) => None,
        Some(Value::String(title)) => Some(title.clone()),
        Some(_) => return Err(not_a_deck("its title is not text")),
    };
    Ok(Head {
        title,
        slides,
        version,
    })
}

/// The vault paths of the images a deck uses, on its slides, in its
/// theme's master, as slide backgrounds and as the posters of embedded pages
/// and videos, sorted and without repeats. Text that is not a deck names none.
pub fn images_of(text: &str) -> Vec<String> {
    slides_assets::deck::images_of(text)
}
