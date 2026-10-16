//! The new text of each deck that renaming a citation key changes. A deck's text is
//! made by the Slides engine, never by the vault's core: each citation on a slide that
//! names the old key is changed with the `patch_elements` operation, and the deck is
//! written as the engine writes every deck. The core takes the text only if it is the
//! deck with that key swapped in its slides and nothing else different, so anything
//! this does beyond the key is refused there. Citations in a deck's master or layouts
//! are not slide elements the operation reaches: the core reports them and leaves them.

use kasten_core::cite::{DeckText, KeyRenamePlan};
use kasten_core::{Error, Kasten, Result};
use serde_json::{Value, json};
use slides_core::{Element, Engine};

/// Seeds the ids of anything new an operation makes; a key change makes none.
const SEED: u64 = 0;

fn invalid(why: String) -> Error {
    Error::Invalid(why)
}

/// The citations in `elements` (groups too) that name `from`: each one's id and keys.
fn citing(elements: &[Element], from: &str, out: &mut Vec<(String, Vec<String>)>) {
    for element in elements {
        if let Element::Citation(citation) = element
            && citation.keys.iter().any(|key| key == from)
        {
            out.push((element.id().to_owned(), citation.keys.clone()));
        }
        citing(element.children(), from, out);
    }
}

/// `keys` with `to` written for `from`, a key not repeated.
fn renamed(keys: &[String], from: &str, to: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for key in keys {
        let key = if key == from {
            to.to_owned()
        } else {
            key.clone()
        };
        if !out.contains(&key) {
            out.push(key);
        }
    }
    out
}

/// The new text of every deck in `plan` that cites `from` on its slides, with `to` for the
/// key, each with the hash of the text it was made from (the plan's). A deck that changed
/// since the plan, or that cannot be opened, is an error.
pub fn deck_texts(
    kasten: &Kasten,
    plan: &KeyRenamePlan,
    from: &str,
    to: &str,
) -> Result<Vec<DeckText>> {
    let mut texts = Vec::new();
    for planned in plan.decks.iter().filter(|d| d.deck.count > 0) {
        let path = &planned.deck.path;
        let file = kasten.deck(path)?;
        if file.hash != planned.hash {
            return Err(invalid(format!(
                "{path} changed since the rename was planned. Plan it again"
            )));
        }
        let deck = slides_core::parse(&file.text)
            .map_err(|err| invalid(format!("{path} cannot be opened: {err}")))?;
        let mut operations = Vec::new();
        for slide in &deck.slides {
            let mut citations = Vec::new();
            citing(&slide.elements, from, &mut citations);
            if citations.is_empty() {
                continue;
            }
            let patches: Vec<Value> = citations
                .iter()
                .map(|(id, keys)| json!({"id": id, "patch": {"keys": renamed(keys, from, to)}}))
                .collect();
            operations.push((
                "patch_elements".to_owned(),
                json!({"slide": slide.id, "patches": patches}),
            ));
        }
        if operations.is_empty() {
            return Err(invalid(format!(
                "{path} cites “{from}” on a slide, but no citation of it could be found there"
            )));
        }
        let mut engine = Engine::new(deck, SEED);
        engine
            .apply_batch(operations)
            .map_err(|err| invalid(format!("{path}: {err}")))?;
        let text = slides_core::write(engine.deck())
            .map_err(|err| invalid(format!("{path} cannot be written: {err}")))?;
        texts.push(DeckText {
            path: path.clone(),
            base_hash: file.hash,
            text,
        });
    }
    Ok(texts)
}
