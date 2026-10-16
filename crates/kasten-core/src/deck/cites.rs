//! The citations of a deck, read out of its JSON: which keys it cites, where,
//! and whether one text is another with a key changed and nothing else. The
//! deck's own text is made by the Slides engine; this only looks at it, and
//! swaps a key in a deck that comes in from a bundle.

use std::collections::BTreeSet;

use serde_json::Value;

/// How many times a deck cites a key: on its slides, and in its master and
/// layouts (which a rename leaves alone).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Cited {
    pub slides: usize,
    pub layouts: usize,
}

/// The keys of a citation element: the element is an object of `"type": "citation"`.
fn keys_of(value: &Value) -> Option<&Vec<Value>> {
    let map = value.as_object()?;
    if map.get("type").and_then(Value::as_str) != Some("citation") {
        return None;
    }
    map.get("keys")?.as_array()
}

/// Calls `each` with the keys of every citation element under `value`.
fn walk(value: &Value, each: &mut impl FnMut(&[Value])) {
    match value {
        Value::Object(map) => {
            if let Some(keys) = keys_of(value) {
                each(keys);
            }
            for inner in map.values() {
                walk(inner, each);
            }
        }
        Value::Array(items) => {
            for inner in items {
                walk(inner, each);
            }
        }
        _ => {}
    }
}

fn count_in(value: &Value, key: &str) -> usize {
    let mut count = 0;
    walk(value, &mut |keys| {
        count += keys.iter().filter(|k| k.as_str() == Some(key)).count();
    });
    count
}

/// How many times the deck in `text` cites `key`. Text that is not a deck cites nothing.
pub fn cited(text: &str, key: &str) -> Cited {
    let Ok(Value::Object(deck)) = serde_json::from_str::<Value>(text) else {
        return Cited::default();
    };
    let mut cited = Cited::default();
    for (name, part) in &deck {
        if name == "slides" {
            cited.slides += count_in(part, key);
        } else {
            cited.layouts += count_in(part, key);
        }
    }
    cited
}

/// Every key the deck in `text` cites, on its slides or in its layouts.
pub fn keys(text: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    if let Ok(deck) = serde_json::from_str::<Value>(text) {
        walk(&deck, &mut |keys| {
            found.extend(keys.iter().filter_map(Value::as_str).map(str::to_owned));
        });
    }
    found
}

/// Writes `to` for `from` in the keys of every citation element under `value`
/// (a key already there is not repeated); gives how many keys changed.
fn swap(value: &mut Value, from: &str, to: &str) -> usize {
    let mut changed = 0;
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("citation")
                && let Some(Value::Array(keys)) = map.get_mut("keys")
            {
                let hits = keys.iter().filter(|k| k.as_str() == Some(from)).count();
                if hits > 0 {
                    changed += hits;
                    let mut renamed: Vec<Value> = Vec::new();
                    for key in keys.iter() {
                        let key = if key.as_str() == Some(from) {
                            Value::String(to.to_owned())
                        } else {
                            key.clone()
                        };
                        if !renamed.contains(&key) {
                            renamed.push(key);
                        }
                    }
                    *keys = renamed;
                }
            }
            for inner in map.values_mut() {
                changed += swap(inner, from, to);
            }
        }
        Value::Array(items) => {
            for inner in items {
                changed += swap(inner, from, to);
            }
        }
        _ => {}
    }
    changed
}

/// Whether `new` is `old` with `to` written for `from` in the citations of its
/// slides, and nothing else different: the same JSON values, whatever the order
/// of keys or the spacing of the text. The master and layouts must be as they
/// were (a rename leaves their citations alone), and the format version, which
/// follows from what a deck uses, is not compared.
pub fn same_but_keys(old: &str, new: &str, from: &str, to: &str) -> bool {
    let (Ok(mut old), Ok(mut new)) = (
        serde_json::from_str::<Value>(old),
        serde_json::from_str::<Value>(new),
    ) else {
        return false;
    };
    let (Some(old_deck), Some(new_deck)) = (old.as_object_mut(), new.as_object_mut()) else {
        return false;
    };
    old_deck.remove("formatVersion");
    new_deck.remove("formatVersion");
    if let Some(slides) = old_deck.get_mut("slides") {
        swap(slides, from, to);
    }
    old == new
}

/// The deck in `text` with `to` written for `from` in every citation, slides
/// and layouts alike, in the form decks are written in (sorted keys, two-space
/// indent, a final newline). None when it cites `from` nowhere or is not JSON.
/// For a deck that comes in from a bundle, whose citations must follow a key
/// that had to change.
pub fn swap_keys(text: &str, from: &str, to: &str) -> Option<String> {
    let mut deck: Value = serde_json::from_str(text).ok()?;
    if swap(&mut deck, from, to) == 0 {
        return None;
    }
    let mut out = serde_json::to_string_pretty(&deck).ok()?;
    out.push('\n');
    Some(out)
}

#[cfg(test)]
#[path = "cites_tests.rs"]
mod tests;
