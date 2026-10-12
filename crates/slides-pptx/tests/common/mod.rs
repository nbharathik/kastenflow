//! Decks for the integration tests, built through the operations as the editor
//! builds them (never by hand-writing JSON files), with their pictures.
#![allow(dead_code)]

pub mod compare;
pub mod decks;
pub mod foreign;
pub mod lists;
pub mod pictures;
pub mod samples;
pub mod variety;
pub mod zips;

use std::collections::BTreeMap;

use serde_json::{Value, json};
use slides_core::{Deck, Engine};
use slides_pptx::Media;

/// Pictures held in memory by path.
#[derive(Clone, Default)]
pub struct Files(pub BTreeMap<String, Vec<u8>>);

impl Media for Files {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.0.get(path).cloned()
    }
}

/// A deck being built with operations; any refusal is a bug of the test.
pub struct Builder {
    pub engine: Engine,
}

/// A slide just added: its id, and the id of the element in each slot by role.
pub struct Added {
    pub id: String,
    pub slots: BTreeMap<String, String>,
}

impl Added {
    pub fn slot(&self, role: &str) -> &str {
        self.slots.get(role).map_or("", String::as_str)
    }
}

impl Builder {
    pub fn new(theme: &str, title: &str, seed: u64) -> Builder {
        Builder {
            engine: Engine::create(title, theme, seed)
                .unwrap_or_else(|e| panic!("a new deck: {e}")),
        }
    }

    pub fn from_deck(deck: Deck, seed: u64) -> Builder {
        Builder {
            engine: Engine::new(deck, seed),
        }
    }

    pub fn apply(&mut self, op: &str, input: Value) -> Value {
        self.engine
            .apply(op, input)
            .unwrap_or_else(|e| panic!("{op}: {e}"))
            .output
    }

    pub fn slide(&mut self, layout: &str, content: Value) -> Added {
        let out = self.apply("add_slide", json!({ "layout": layout, "content": content }));
        Added {
            id: out["slide"].as_str().unwrap_or_default().to_owned(),
            slots: out["elements"]
                .as_object()
                .map(|o| {
                    o.iter()
                        .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_owned()))
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    /// Sets the words of an element from paragraphs of runs.
    pub fn words(&mut self, slide: &str, element: &str, paragraphs: Vec<Value>) {
        self.apply(
            "set_rich_text",
            json!({ "slide": slide, "id": element, "text": { "paragraphs": paragraphs } }),
        );
    }

    /// Adds elements; returns their ids.
    pub fn add(&mut self, slide: &str, elements: Value) -> Vec<String> {
        let out = self.apply(
            "add_elements",
            json!({ "slide": slide, "elements": elements }),
        );
        out["ids"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|v| v.as_str().unwrap_or_default().to_owned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn patch(&mut self, slide: &str, element: &str, patch: Value) {
        self.apply(
            "patch_elements",
            json!({ "slide": slide, "patches": [{ "id": element, "patch": patch }] }),
        );
    }

    pub fn notes(&mut self, slide: &str, markdown: &str) {
        self.apply("set_notes", json!({ "slide": slide, "notes": markdown }));
    }

    pub fn flags(&mut self, slide: &str, hidden: Option<bool>, backup: Option<bool>) {
        self.apply(
            "set_slide_flags",
            json!({ "ids": [slide], "hidden": hidden, "backup": backup }),
        );
    }

    pub fn deck(self) -> Deck {
        self.engine.into_deck()
    }
}

/// A paragraph of plain words.
pub fn para(text: &str) -> Value {
    json!({ "runs": [{ "t": text }] })
}

/// A list item of a level; `kind` is `bullet` or `number`.
pub fn item(kind: &str, level: u8, text: &str) -> Value {
    json!({ "list": kind, "level": level, "runs": [{ "t": text }] })
}

/// A paragraph of runs, each `(text, extras)` with the extras merged into the run.
pub fn runs(parts: &[(&str, Value)]) -> Value {
    let runs: Vec<Value> = parts
        .iter()
        .map(|(t, extra)| {
            let mut run = json!({ "t": t });
            if let (Some(r), Some(e)) = (run.as_object_mut(), extra.as_object()) {
                r.extend(e.clone());
            }
            run
        })
        .collect();
    json!({ "runs": runs })
}

/// A cell of a table.
pub fn cell(text: &str) -> Value {
    json!({ "text": { "paragraphs": [para(text)] } })
}

pub mod inspect;
