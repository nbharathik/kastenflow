//! Reading and writing a `.deck` file. A deck is written in one canonical
//! form (sorted keys, two-space indent, whole numbers without a fraction,
//! a final newline), so the same deck is always the same bytes and a change
//! shows in git as a few lines.

use std::collections::HashSet;

use serde_json::{Number, Value};

use crate::error::{Error, Result};
use crate::model::{Deck, Element, FORMAT_NAME};

/// The version of the deck format this build reads and writes.
pub const FORMAT_VERSION: u32 = 1;

/// Reads a `.deck` file's text.
pub fn parse(text: &str) -> Result<Deck> {
    let value: Value = serde_json::from_str(text).map_err(Error::malformed)?;
    from_value(value)
}

/// Reads a deck from JSON already parsed.
pub fn from_value(value: Value) -> Result<Deck> {
    let value = migrate(value)?;
    let deck: Deck = serde_json::from_value(value).map_err(Error::malformed)?;
    check_structure(&deck)?;
    Ok(deck)
}

/// Brings a deck of an older format version up to this one. There is no older
/// version yet: each future version adds one step here and a fixture of the
/// version it replaces.
fn migrate(value: Value) -> Result<Value> {
    if value.get("format").and_then(Value::as_str) != Some(FORMAT_NAME) {
        return Err(Error::malformed(
            "it is not a KastenFlow Slides deck (`format` should be `kasten-deck`)",
        ));
    }
    let found = value
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| Error::malformed("`formatVersion` is missing"))?;
    if found == 0 {
        return Err(Error::malformed("`formatVersion` starts at 1"));
    }
    if found > u64::from(FORMAT_VERSION) {
        return Err(Error::TooNew {
            found: u32::try_from(found).unwrap_or(u32::MAX),
            supported: FORMAT_VERSION,
        });
    }
    Ok(value)
}

/// The rules of the format that a deck must meet to be worked on.
pub fn check_structure(deck: &Deck) -> Result<()> {
    if deck.format != FORMAT_NAME {
        return Err(Error::invalid(format!(
            "`format` is `{}`, not `{FORMAT_NAME}`",
            deck.format
        )));
    }
    let mut seen = HashSet::new();
    for (i, slide) in deck.slides.iter().enumerate() {
        if slide.id.is_empty() || !seen.insert(slide.id.as_str()) {
            return Err(Error::invalid(format!(
                "slide {} has {} id `{}`",
                i + 1,
                if slide.id.is_empty() {
                    "an empty"
                } else {
                    "a repeated"
                },
                slide.id
            )));
        }
        check_slide(deck, i)?;
    }
    for section in &deck.sections {
        if !seen.contains(section.starts_at.as_str()) {
            return Err(Error::invalid(format!(
                "section `{}` starts at `{}`, which is not a slide",
                section.title, section.starts_at
            )));
        }
    }
    let mut layouts = HashSet::new();
    for layout in &deck.theme.layouts {
        if !layouts.insert(layout.name.as_str()) {
            return Err(Error::invalid(format!(
                "the theme has two layouts called `{}`",
                layout.name
            )));
        }
        check_elements(
            &layout.elements,
            &format!("layout `{}`", layout.name),
            &mut HashSet::new(),
        )?;
    }
    Ok(())
}

/// The rules that concern one slide: the slide at `index`.
pub fn check_slide(deck: &Deck, index: usize) -> Result<()> {
    let Some(slide) = deck.slides.get(index) else {
        return Ok(());
    };
    if index == 0 && slide.backup {
        return Err(Error::invalid(
            "the first slide cannot be a backup slide: there is no slide above it to stack under",
        ));
    }
    if deck.theme.layout(&slide.layout).is_none() {
        return Err(Error::invalid(format!(
            "slide `{}` uses the layout `{}`, which the theme does not have",
            slide.id, slide.layout
        )));
    }
    check_elements(
        &slide.elements,
        &format!("slide `{}`", slide.id),
        &mut HashSet::new(),
    )
}

/// `owner` says where the list is: "slide `s-1`" or "layout `quote`".
fn check_elements<'a>(list: &'a [Element], owner: &str, ids: &mut HashSet<&'a str>) -> Result<()> {
    for element in list {
        let id = element.id();
        if id.is_empty() || !ids.insert(id) {
            return Err(Error::invalid(format!(
                "{owner} has {} element id `{id}`",
                if id.is_empty() {
                    "an empty"
                } else {
                    "a repeated"
                }
            )));
        }
        check_elements(element.children(), owner, ids)?;
    }
    Ok(())
}

/// The deck as JSON in canonical form.
pub fn to_value(deck: &Deck) -> Result<Value> {
    let mut value = serde_json::to_value(deck).map_err(|e| Error::invalid(e.to_string()))?;
    canonicalize(&mut value);
    Ok(value)
}

/// The text of the `.deck` file for a deck.
pub fn write(deck: &Deck) -> Result<String> {
    let mut text = serde_json::to_string_pretty(&to_value(deck)?)
        .map_err(|e| Error::invalid(e.to_string()))?;
    text.push('\n');
    Ok(text)
}

/// Sorts every object's keys and writes a whole number without a fraction.
pub fn canonicalize(value: &mut Value) {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<_> = std::mem::take(map).into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            for (key, mut child) in entries {
                canonicalize(&mut child);
                map.insert(key, child);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(canonicalize),
        Value::Number(n) if n.is_f64() => {
            if let Some(f) = n.as_f64()
                && f.fract() == 0.0
                && f.abs() < 9.0e15
            {
                *value = Value::Number(Number::from(f as i64));
            }
        }
        _ => {}
    }
}
