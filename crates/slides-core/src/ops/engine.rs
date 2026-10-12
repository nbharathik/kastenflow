//! The engine holds a deck, applies operations to it, and keeps what is needed
//! to undo and redo them. The editor drives one through WebAssembly; the
//! command line and agents drive the same one.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{Changes, Op, Scope, Snapshot};
use crate::canonical::{check_slide, check_structure};
use crate::citations::Refs;
use crate::error::{Error, Result};
use crate::ids::IdGen;
use crate::model::Deck;

/// How many steps can be undone.
const HISTORY: usize = 500;

struct Entry {
    label: String,
    /// The part of the deck an operation changed, as it was before.
    state: Snapshot,
}

/// A deck being worked on.
pub struct Engine {
    deck: Deck,
    ids: IdGen,
    undo: Vec<Entry>,
    redo: Vec<Entry>,
    /// The bibliography the host gave, which is not part of the deck and not undone.
    refs: Option<Arc<Refs>>,
}

/// What an operation did.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    /// What the operation returns, such as the ids it made.
    pub output: Value,
    pub changes: Changes,
}

impl Engine {
    /// A deck and the generator that made its ids, with nothing to undo.
    pub(super) fn from_parts(deck: Deck, ids: IdGen) -> Engine {
        Engine {
            deck,
            ids,
            undo: Vec::new(),
            redo: Vec::new(),
            refs: None,
        }
    }

    /// Works on `deck`. `seed` starts the ids of everything new; a host gives
    /// it something random.
    pub fn new(deck: Deck, seed: u64) -> Engine {
        Engine {
            deck,
            ids: IdGen::new(seed),
            undo: Vec::new(),
            redo: Vec::new(),
            refs: None,
        }
    }

    /// Gives the engine the bibliography that citation keys are looked up in, or takes it
    /// away. It is what "ungroup to shapes" writes a citation from, so a citation turned into
    /// shapes says what the editor showed. It is the host's, not the deck's: changing it is
    /// not an operation and is not undone.
    pub fn set_references(&mut self, refs: Option<Arc<Refs>>) {
        self.refs = refs;
    }

    /// The bibliography the host gave, if it has.
    pub fn references(&self) -> Option<&Refs> {
        self.refs.as_deref()
    }

    pub fn deck(&self) -> &Deck {
        &self.deck
    }

    pub fn into_deck(self) -> Deck {
        self.deck
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// The name of the operation an undo would take back.
    pub fn undo_label(&self) -> Option<&str> {
        self.undo.last().map(|e| e.label.as_str())
    }

    pub fn redo_label(&self) -> Option<&str> {
        self.redo.last().map(|e| e.label.as_str())
    }

    pub(super) fn run_one<T: Op>(&mut self, input: Value) -> Result<(Value, Snapshot)> {
        let op: T = serde_json::from_value(input).map_err(|e| Error::bad_input(T::NAME, e))?;
        let scope = op.scope(&self.deck);
        let before = Snapshot::of(&self.deck, &scope);
        let mut cx = super::Cx {
            deck: &mut self.deck,
            ids: &mut self.ids,
            refs: self.refs.as_deref(),
        };
        let result = op
            .run(&mut cx)
            .and_then(|out| serde_json::to_value(out).map_err(|e| Error::bad_input(T::NAME, e)));
        match result.and_then(|out| self.check(&before).map(|()| out)) {
            Ok(out) => {
                // An element the operation changed is no longer the assistant's work as it stood.
                crate::marks::settle(&before, &mut self.deck);
                Ok((out, before))
            }
            Err(e) => {
                before.restore(&mut self.deck);
                Err(e)
            }
        }
    }

    /// The rules of the format, over what the operation touched.
    fn check(&self, before: &Snapshot) -> Result<()> {
        let scope = before.scope();
        if scope.order || scope.meta || scope.theme {
            return check_structure(&self.deck);
        }
        for id in &scope.slides {
            if let Some(i) = self.deck.index_of(id) {
                check_slide(&self.deck, i)?;
            }
        }
        Ok(())
    }

    /// Applies one operation by name, with its input as JSON.
    pub fn apply(&mut self, name: &str, input: Value) -> Result<Applied> {
        let (output, before) = self.dispatch(name, input)?;
        let changes = before.changes(&self.deck);
        if !changes.is_empty() {
            self.record(name, before);
        }
        Ok(Applied { output, changes })
    }

    /// Applies an operation as part of the last step when that step already
    /// holds the slides and details the operation changes, so one undo takes
    /// both back: a text box and the first words typed into it are one step,
    /// though the words come later. When the last step does not cover it (or
    /// there is none) it is a step of its own, as with `apply`. The caller says
    /// which step it means by calling this only right after making it.
    pub fn apply_into_last(&mut self, name: &str, input: Value) -> Result<Applied> {
        let (output, before) = self.dispatch(name, input)?;
        let changes = before.changes(&self.deck);
        if !changes.is_empty() {
            if self
                .undo
                .last()
                .is_some_and(|last| last.state.covers(&before))
            {
                // What could have been redone belongs to a deck that is no longer there.
                self.redo.clear();
            } else {
                self.record(name, before);
            }
        }
        Ok(Applied { output, changes })
    }

    /// Applies several operations as one step: all take effect or none does,
    /// and one undo takes them all back.
    pub fn apply_batch(&mut self, operations: Vec<(String, Value)>) -> Result<Vec<Applied>> {
        let whole = Snapshot::of(&self.deck, &Scope::everything());
        let mut applied = Vec::with_capacity(operations.len());
        let mut names = Vec::new();
        for (name, input) in operations {
            match self.dispatch(&name, input) {
                Ok((output, before)) => {
                    applied.push(Applied {
                        output,
                        changes: before.changes(&self.deck),
                    });
                    names.push(name);
                }
                Err(e) => {
                    whole.restore(&mut self.deck);
                    return Err(e);
                }
            }
        }
        if !whole.changes(&self.deck).is_empty() {
            self.record(&names.join(", "), whole);
        }
        Ok(applied)
    }

    fn record(&mut self, label: &str, state: Snapshot) {
        self.redo.clear();
        self.undo.push(Entry {
            label: label.to_owned(),
            state,
        });
        if self.undo.len() > HISTORY {
            self.undo.remove(0);
        }
    }

    /// Takes back the last step; the changes are what to show.
    pub fn undo(&mut self) -> Option<Changes> {
        let entry = self.undo.pop()?;
        let (changes, redo) = self.swap(entry);
        self.redo.push(redo);
        Some(changes)
    }

    /// Does again the step that was taken back.
    pub fn redo(&mut self) -> Option<Changes> {
        let entry = self.redo.pop()?;
        let (changes, undo) = self.swap(entry);
        self.undo.push(undo);
        Some(changes)
    }

    /// Puts an entry's state back and returns the entry that would undo that.
    fn swap(&mut self, entry: Entry) -> (Changes, Entry) {
        // Slides that exist now but did not then are about to go; keep them so a redo can bring them back.
        let mut scope = entry.state.scope();
        for slide in &self.deck.slides {
            if !entry.state.lists(&slide.id) && !scope.slides.contains(&slide.id) && scope.order {
                scope.slides.push(slide.id.clone());
            }
        }
        let current = Snapshot::of(&self.deck, &scope);
        entry.state.restore(&mut self.deck);
        let changes = current.changes(&self.deck);
        (
            changes,
            Entry {
                label: entry.label,
                state: current,
            },
        )
    }
}
