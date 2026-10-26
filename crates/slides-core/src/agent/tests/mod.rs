//! Tests of the agent tools, run against a store in memory.

mod decks;
mod edits;
mod files;
mod raw;
mod render;
mod slide_tools;

use serde_json::{Value, json};

use super::images::tests::png;
use super::{Agent, MemoryStore, ToolError, ToolOutput};
use crate::canonical;
use crate::model::Deck;

/// An agent and the store it works on.
pub(super) struct Kit {
    pub store: MemoryStore,
    pub agent: Agent,
}

impl Kit {
    pub fn new() -> Kit {
        Kit {
            store: MemoryStore::new(),
            agent: Agent::new(),
        }
    }

    pub fn call(&mut self, tool: &str, args: Value) -> Result<ToolOutput, ToolError> {
        self.agent.call(&mut self.store, tool, args)
    }

    /// The answer of a tool that works, as JSON.
    pub fn ok(&mut self, tool: &str, args: Value) -> Value {
        match self.call(tool, args) {
            Ok(out) => out.data.unwrap_or_else(|| Value::String(out.text)),
            Err(e) => panic!("`{tool}` failed: {}", e.message),
        }
    }

    /// Why a tool refused.
    pub fn err(&mut self, tool: &str, args: Value) -> String {
        match self.call(tool, args) {
            Ok(out) => panic!("`{tool}` should have failed, and said: {}", out.text),
            Err(e) => e.message,
        }
    }

    /// The deck as the store holds it.
    pub fn deck(&self, name: &str) -> Deck {
        canonical::parse(self.store.decks.get(name).expect("the deck is there"))
            .expect("the deck reads")
    }

    /// Makes a deck from an outline and returns its file name.
    pub fn make(&mut self, outline: &str) -> String {
        let made = self.ok("create_deck", json!({ "outline": outline }));
        made["deck"].as_str().unwrap().to_owned()
    }
}

/// A picture in the store, of the given size.
pub(super) fn with_picture(kit: &mut Kit, name: &str, w: u32, h: u32) -> String {
    kit.store.assets.insert(format!("assets/{name}"), png(w, h));
    format!("assets/{name}")
}

pub(super) const OUTLINE: &str = "# Tool use in models

## Why tools?
- Models know what they were trained on
- A tool reaches what they cannot know

Notes:
Start with a question: what could the model not answer alone?

## Two views
- The model asks
- The host runs it

- The answer comes back
- The loop goes on

## Part two <!-- layout: section -->

## Ask, act, observe
> Make it work, make it right, make it fast.

## A first call
```python
result = search(\"weather in Oslo\")
print(result)
```
";
