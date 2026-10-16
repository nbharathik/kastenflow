//! Renaming a citation key across a vault: the deck texts come from the Slides engine
//! (`patch_elements` on each citation), and the core takes them only when they differ from
//! the decks in nothing but the key.

mod common;

use std::fs;
use std::path::Path;

use common::vault;
use kasten_core::cite::KeyRename;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::decks::cite_rename::deck_texts;
use serde_json::Value;

const NOW: Instant = Instant {
    millis: 1_790_236_800_000,
};
const FROM: &str = "vaswani2017attention";
const TO: &str = "vaswani2017";
const DECK: &str = "library/talk.deck";

/// The dev vault with its works in the managed bibliography and a deck that cites two of them.
fn cited() -> (common::TempDir, Kasten) {
    let t = vault();
    let k = Kasten::open(&t.0).unwrap();
    let keys = vec![FROM.to_owned(), "lecun2015deep".to_owned()];
    let hash = k.bibliography().unwrap().managed.hash;
    k.adopt_bib(&Actor::Human, "references.bib", Some(&keys), &hash, NOW)
        .unwrap();
    let fixture =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/decks/highlight-citations.deck");
    fs::create_dir_all(t.0.join("library")).unwrap();
    fs::copy(fixture, t.0.join(DECK)).unwrap();
    k.commit_external().unwrap();
    (t, k)
}

fn keys_of(deck: &Value) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                if map.get("type").and_then(Value::as_str) == Some("citation") {
                    out.extend(
                        map["keys"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|k| k.as_str().unwrap().to_owned()),
                    );
                }
                map.values().for_each(|v| walk(v, out));
            }
            Value::Array(items) => items.iter().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    walk(deck, &mut out);
    out
}

#[test]
fn the_slides_engine_makes_the_decks_text_and_the_core_takes_it() {
    let (t, k) = cited();
    let before = fs::read_to_string(t.0.join(DECK)).unwrap();
    let plan = k.plan_key_rename(FROM, TO).unwrap();
    assert_eq!(plan.decks.len(), 1);
    assert_eq!(
        (plan.decks[0].deck.count, plan.decks[0].deck.in_layouts),
        (1, 0)
    );

    let texts = deck_texts(&k, &plan, FROM, TO).unwrap();
    assert_eq!(texts.len(), 1);
    assert_eq!(texts[0].path, DECK);
    assert_eq!(texts[0].base_hash, plan.decks[0].hash);
    let new: Value = serde_json::from_str(&texts[0].text).unwrap();
    assert_eq!(keys_of(&new), [TO, "lecun2015deep"]);

    let done = k
        .rename_citation_key(
            &Actor::Human,
            &KeyRename {
                from: FROM.to_owned(),
                to: TO.to_owned(),
                bib_hash: plan.bib_hash.clone(),
                decks: texts.clone(),
            },
            NOW,
        )
        .unwrap();
    assert_eq!((done.decks, done.layouts), (1, 0));
    let after = fs::read_to_string(t.0.join(DECK)).unwrap();
    assert_eq!(after, texts[0].text);
    // The deck is the Slides engine's own form: only the key's bytes changed in it.
    assert_eq!(
        after.replace(TO, FROM),
        before,
        "nothing but the key differs"
    );
    assert!(
        k.bibliography()
            .unwrap()
            .managed
            .entries
            .iter()
            .any(|e| e.key == TO)
    );
}

#[test]
fn a_deck_that_changed_since_the_plan_is_not_made_into_text() {
    let (t, k) = cited();
    let plan = k.plan_key_rename(FROM, TO).unwrap();
    let text = fs::read_to_string(t.0.join(DECK)).unwrap();
    fs::write(t.0.join(DECK), format!("{text}\n")).unwrap();
    let err = deck_texts(&k, &plan, FROM, TO).unwrap_err().to_string();
    assert!(err.contains("changed since"), "{err}");
}

#[test]
fn the_other_key_of_a_citation_can_be_the_one_renamed_and_a_key_no_deck_cites_has_no_text() {
    let (_t, k) = cited();
    let plan = k.plan_key_rename("lecun2015deep", "lecun2015").unwrap();
    let texts = deck_texts(&k, &plan, "lecun2015deep", "lecun2015").unwrap();
    assert_eq!(texts.len(), 1);
    let new: Value = serde_json::from_str(&texts[0].text).unwrap();
    assert_eq!(keys_of(&new), [FROM, "lecun2015"]);

    let plan = k.plan_key_rename(FROM, "elsewhere2000").unwrap();
    let mut other = plan.clone();
    other.decks.clear();
    assert!(
        deck_texts(&k, &other, FROM, "elsewhere2000")
            .unwrap()
            .is_empty()
    );
}
