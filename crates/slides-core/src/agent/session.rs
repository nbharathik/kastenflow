//! One agent's conversation with a store: which version of each deck it last
//! saw, and the way every change is made: read the deck, change it with
//! operations, save it against the version that was read, and say what is
//! wrong with it now.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use super::store::{DeckText, Saved, Store};
use super::{ToolError, ToolOutput, ToolResult, create, edit, files, place, read, steps, template};
use crate::canonical;
use crate::lint::{self, Options, Severity};
use crate::model::Deck;
use crate::ops::Engine;

/// The most problems a write tool lists; the rest are counted.
const MOST_PROBLEMS: usize = 8;

/// A connection to an agent. It remembers the version of each deck the agent
/// last saw; a change is made to that version, and if the deck has moved on
/// since, it is not written over: the change is kept as a copy beside it.
#[derive(Default)]
pub struct Agent {
    seen: BTreeMap<String, DeckText>,
    calls: u64,
}

/// A deck opened for a change.
pub(super) struct Loaded {
    pub name: String,
    /// The version the change is made to.
    pub base: DeckText,
    pub deck: Deck,
}

/// A change that was saved.
pub(super) struct Edited<T> {
    pub value: T,
    pub name: String,
    pub saved: DeckText,
    /// The slides the change touched; empty when it touched the deck as a whole.
    pub touched: Vec<String>,
    /// Whether the deck is different from before.
    pub changed: bool,
    pub deck: Deck,
}

/// The deck's file name as the store knows it: `talk` and `talk.deck` are the same deck.
pub(super) fn full_name(given: &str) -> String {
    let given = given.trim();
    if given.ends_with(".deck") {
        given.to_owned()
    } else {
        format!("{given}.deck")
    }
}

impl Agent {
    pub fn new() -> Agent {
        Agent::default()
    }

    /// Runs the tool `name` with `args`, a JSON object.
    pub fn call(&mut self, store: &mut dyn Store, name: &str, args: Value) -> ToolResult {
        self.calls += 1;
        let args = if args.is_null() { json!({}) } else { args };
        if !args.is_object() {
            return Err(ToolError::new(format!(
                "The input to `{name}` must be a JSON object of named values."
            )));
        }
        match name {
            "list_decks" => read::list_decks(store),
            "get_deck" => read::get_deck(self, store, &args),
            "get_slide" => read::get_slide(self, store, &args),
            "get_outline" => read::get_outline(self, store, &args),
            "list_layouts" => read::list_layouts(self, store, &args),
            "get_theme" => read::get_theme(self, store, &args),
            "search_assets" => read::search_assets(store, &args),
            "lint_deck" => read::lint_deck(self, store, &args),
            "create_deck" => create::create_deck(self, store, &args),
            "update_elements" => edit::update_elements(self, store, &args),
            "apply_layout" => edit::apply_layout(self, store, &args),
            "apply_deck_template" => template::apply_deck_template(self, store, &args),
            "duplicate_slide" => edit::duplicate_slide(self, store, &args),
            "reorder_slides" => edit::reorder_slides(self, store, &args),
            "set_morph" => edit::set_morph(self, store, &args),
            "set_steps" => steps::set_steps(self, store, &args),
            "place_image" => place::place_image(self, store, &args),
            "add_asset" => files::add_asset(store, &args),
            "export" => files::export(self, store, &args),
            "import_pptx" => files::import_pptx(self, store, &args),
            "trash_deck" => files::trash_deck(self, store, &args),
            "render_slide" => files::render(self, store, &args, false),
            "render_grid" => files::render(self, store, &args, true),
            // An operation that is not on the list is called inside `update_elements`, not by its name;
            // the person's own (`accept_marks`) is still run so it can say whose it is.
            other
                if crate::ops::names().contains(&other)
                    && (!super::specs::is_hidden(other) || edit::PERSONS.contains(&other)) =>
            {
                edit::run_op(self, store, other, &args)
            }
            other => Err(ToolError::new(format!(
                "There is no tool called `{other}`. The tools are: {}.",
                super::tools()
                    .iter()
                    .map(|t| t.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))),
        }
    }

    /// The name of the deck a call is about: `deck`, or the only deck there is.
    pub(super) fn deck_name(
        &self,
        store: &mut dyn Store,
        args: &Value,
    ) -> Result<String, ToolError> {
        if let Some(given) = args
            .get("deck")
            .and_then(Value::as_str)
            .filter(|d| !d.trim().is_empty())
        {
            return Ok(full_name(given));
        }
        let decks = store.decks()?;
        match decks.as_slice() {
            [only] => Ok(only.name.clone()),
            [] => Err(ToolError::new(
                "There are no decks yet. `create_deck` makes one from an outline.",
            )),
            many => Err(ToolError::new(format!(
                "Say which deck with `deck`: {}.",
                many.iter()
                    .map(|d| d.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))),
        }
    }

    /// Notes that the agent knows this version of a deck, such as one it just made.
    pub(super) fn remember(&mut self, text: DeckText) {
        self.seen.insert(text.name.clone(), text);
    }

    /// Forgets a deck, such as one that was put in the trash.
    pub(super) fn forget(&mut self, name: &str) {
        self.seen.remove(name);
    }

    /// Reads a deck as it is now, and remembers that the agent has seen it.
    pub(super) fn read(
        &mut self,
        store: &mut dyn Store,
        name: &str,
    ) -> Result<(DeckText, Deck), ToolError> {
        let text = store.read(name)?;
        let deck = canonical::parse(&text.text)
            .map_err(|e| ToolError::new(format!("The deck `{name}` cannot be read: {e}")))?;
        self.seen.insert(name.to_owned(), text.clone());
        Ok((text, deck))
    }

    /// Opens a deck to change. The change is made to the version the agent last
    /// saw, or to the deck as it is if it has not seen it.
    fn open(&mut self, store: &mut dyn Store, name: &str) -> Result<Loaded, ToolError> {
        let base = match self.seen.get(name) {
            Some(seen) => seen.clone(),
            None => store.read(name)?,
        };
        let deck = canonical::parse(&base.text)
            .map_err(|e| ToolError::new(format!("The deck `{name}` cannot be read: {e}")))?;
        Ok(Loaded {
            name: name.to_owned(),
            base,
            deck,
        })
    }

    /// Changes a deck with `work`, which applies operations to the engine, and saves it.
    /// `keep` names a change that removes something: a copy of the deck is kept first.
    pub(super) fn edit<T>(
        &mut self,
        store: &mut dyn Store,
        name: &str,
        keep: Option<&str>,
        work: impl FnOnce(&mut Engine) -> Result<T, ToolError>,
    ) -> Result<Edited<T>, ToolError> {
        let Loaded { name, base, deck } = self.open(store, name)?;
        let before = deck.clone();
        let seed = store.entropy() ^ self.calls.rotate_left(32);
        let mut engine = Engine::new(deck, seed);
        let value = work(&mut engine)?;
        let after = engine.into_deck();
        let text = canonical::write(&after).map_err(ToolError::from)?;
        let changed = text != base.text;
        if !changed {
            return Ok(Edited {
                value,
                name,
                saved: base,
                touched: Vec::new(),
                changed,
                deck: after,
            });
        }
        if let Some(why) = keep {
            store.keep_copy(&name, &base.text, why)?;
        }
        match store.save(&name, &text, &base.hash)? {
            Saved::Written(saved) | Saved::Unchanged(saved) => {
                self.seen.insert(name.clone(), saved.clone());
                Ok(Edited {
                    value,
                    touched: touched(&before, &after),
                    name,
                    saved,
                    changed,
                    deck: after,
                })
            }
            Saved::Conflict { copy, current } => {
                self.seen.insert(name.clone(), current.clone());
                Err(ToolError::new(format!(
                    "`{name}` was changed by someone else after you last read it, so your change was not written to it. It was saved as `{copy}` beside it instead, and `{name}` is untouched. Read the deck again with get_deck (its hash is now {}), look at what changed, and repeat your change if it still applies.",
                    current.hash
                )))
            }
        }
    }

    /// The problems in a deck, for a tool to append to its answer: counts, and the first errors and warnings of the slides it touched.
    pub(super) fn problems(&self, store: &mut dyn Store, deck: &Deck, touched: &[String]) -> Value {
        let refs = store.references();
        let measures = lint::estimate::measures_with(deck, refs.as_ref());
        let report = lint::lint_deck_with(
            deck,
            &Options {
                measures: Some(&measures),
                refs: refs.as_ref(),
            },
        );
        let mine: Vec<_> = report
            .issues
            .iter()
            .filter(|i| {
                i.severity != Severity::Info && (touched.is_empty() || touched.contains(&i.slide))
            })
            .collect();
        let listed: Vec<Value> = mine
            .iter()
            .take(MOST_PROBLEMS)
            .map(|i| json!({ "slide": i.slide, "element": i.element, "rule": i.rule, "severity": i.severity, "message": i.message, "hint": i.hint }))
            .collect();
        let mut out = json!({
            "errors": report.count(Severity::Error),
            "warnings": report.count(Severity::Warning),
            "info": report.count(Severity::Info),
            "problems": listed,
        });
        if mine.len() > MOST_PROBLEMS {
            out["more"] = json!(mine.len() - MOST_PROBLEMS);
        }
        out
    }

    /// The answer of a tool that changed a deck.
    pub(super) fn answer<T: serde::Serialize>(
        &mut self,
        store: &mut dyn Store,
        edited: &Edited<T>,
        extra: Value,
    ) -> ToolResult {
        let mut out = json!({
            "deck": edited.name,
            "hash": edited.saved.hash,
            "slides": edited.deck.slides.len(),
            "changed": edited.changed,
        });
        if let (Some(target), Value::Object(more)) = (out.as_object_mut(), extra) {
            target.extend(more);
        }
        if let Some(target) = out.as_object_mut() {
            target.insert(
                "result".to_owned(),
                serde_json::to_value(&edited.value).unwrap_or(Value::Null),
            );
            if edited.changed {
                target.insert(
                    "lint".to_owned(),
                    self.problems(store, &edited.deck, &edited.touched),
                );
            }
        }
        Ok(ToolOutput::json(out))
    }
}

/// The ids of the slides that differ between two versions of a deck; empty if the deck as a whole does (its theme, its order, its size).
fn touched(before: &Deck, after: &Deck) -> Vec<String> {
    let ids = |d: &Deck| d.slides.iter().map(|s| s.id.clone()).collect::<Vec<_>>();
    if before.theme != after.theme
        || before.size != after.size
        || ids(before) != ids(after) && before.slides.len() == after.slides.len()
    {
        return Vec::new();
    }
    let known: BTreeSet<&str> = before.slides.iter().map(|s| s.id.as_str()).collect();
    after
        .slides
        .iter()
        .filter(|s| !known.contains(s.id.as_str()) || before.slide(&s.id) != Some(*s))
        .map(|s| s.id.clone())
        .collect()
}
