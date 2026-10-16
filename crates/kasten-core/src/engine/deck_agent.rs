//! Decks and agents. `update_deck` reads a deck, lets the caller change it and
//! writes it back under one hold of the write lock, so a change made by an
//! agent starts from the deck as it is and no copy is ever needed. The rest
//! weighs, shows and runs the two deck ops an agent's tools make (`EditDeck`,
//! `CreateDeck`) and the sending of a deck to the trash.

use serde_json::{Value, json};

use super::deck_limits::slides_taken_out;
use super::review::Preview;
use super::{Change, Kasten};
use crate::agent::{AgentOp, Target};
use crate::atomic::write_atomic;
use crate::deck::{self, DeckFile, DeckSaved, slide_changes};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::merge::merge3;
use crate::time::Instant;

/// The longest op name a commit carries.
const OP_CHARS: usize = 40;

/// `text` on one line, without runs of spaces: a commit's first line has
/// nothing after it that could pass for a trailer.
pub(super) fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The op name for a commit trailer: a tool's name as it is, or `fallback`
/// for anything that could not pass for a name (the tool comes from a stored
/// proposal, which anyone with the vault can edit).
pub(super) fn op_name(tool: &str, fallback: &str) -> String {
    let fine = !tool.is_empty()
        && tool.chars().count() <= OP_CHARS
        && tool
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if fine { tool } else { fallback }.to_owned()
}

fn lower_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn upper_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// A deck's title, or its file's name when it has none.
pub(super) fn title_or_name(text: &str, path: &str) -> String {
    deck::head_of(text)
        .ok()
        .and_then(|head| head.title)
        .map(|title| one_line(&title))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| {
            let name = path.rsplit('/').next().unwrap_or(path);
            name.trim_end_matches(".deck").to_owned()
        })
}

/// The text a deck op writes. An agent's own write is the version with the marks that badge its work; a change a
/// person accepted in the review is the plain one, since they have looked at it.
fn text_to_write<'a>(actor: &Actor, text: &'a str, marked: Option<&'a str>) -> &'a str {
    match (actor, marked) {
        (Actor::Agent { .. }, Some(marked)) => marked,
        _ => text,
    }
}

pub(super) fn slides(n: usize) -> String {
    format!("{n} slide{}", if n == 1 { "" } else { "s" })
}

/// What an edit made from the deck `base` makes of the deck as it is now,
/// `current`: the edit's own text when nothing has happened to the deck
/// since, and otherwise the two put together, if they can be. Changes to
/// different lines can still not fit together (a section that starts at a
/// slide the other removed, one slide id made twice), so what a merge makes
/// is held to the rules of the format before it is used.
pub(super) fn applied(base: &str, written: &str, current: &str) -> Result<String> {
    if current == base {
        return Ok(written.to_owned());
    }
    let merged = merge3(base, written, current).ok_or_else(|| {
        Error::Invalid("The deck changed on the same lines since this was made".to_owned())
    })?;
    match deck::structure_problem(&merged) {
        None => Ok(merged),
        Some(why) => Err(Error::Invalid(format!(
            "The deck changed since this was made, and the two changes do not fit together: {why}"
        ))),
    }
}

/// Errors unless the text of a deck op, and the version of it with the
/// agent's marks, are decks the tools and the editor can work on.
fn usable(text: &str, marked: Option<&str>) -> Result<()> {
    deck::check_structure(text)?;
    marked.map_or(Ok(()), deck::check_structure)
}

impl Kasten {
    /// Changes the deck at `path` in one hold of the write lock: `change` is
    /// given the deck as it is now and returns the text it should become, or
    /// `None` to leave it. The text is written and committed as `actor`, with
    /// `message` and the trailers of an agent (`Kasten-Session`, and
    /// `Kasten-Op: <op>`). Because the deck is read inside the lock, the change
    /// is never made to a stale version, so a save that is too late to be
    /// written, and would go to a `(conflict …).deck` copy, cannot happen here.
    /// The answer is `Written` or `Unchanged`, never `Conflict`. A person's
    /// saves keep the base-hash check of `save_deck`. A text that is not a
    /// deck the tools and the editor can work on (a slide id twice, a section
    /// that starts at no slide) is refused and the deck is left as it is.
    /// The slides a write takes out of the deck count against an agent's
    /// session, under the name `op`.
    pub fn update_deck(
        &self,
        actor: &Actor,
        path: &str,
        op: &str,
        message: &str,
        now: Instant,
        change: impl FnOnce(&DeckFile) -> Result<Option<String>>,
    ) -> Result<DeckSaved> {
        let op = op_name(op, "update_deck");
        let message = one_line(message);
        self.apply(actor, &op, false, now.millis, |vault| {
            let current = deck::read_deck(vault, path)?;
            let unchanged = |deck: DeckFile| Change {
                message: String::new(),
                paths: Vec::new(),
                value: DeckSaved::Unchanged { deck },
            };
            let Some(text) = change(&current)? else {
                return Ok(unchanged(current));
            };
            deck::head_of(&text)?;
            if text == current.text {
                return Ok(unchanged(current));
            }
            deck::check_structure(&text)?;
            write_atomic(&vault.file_of(path, &[".deck"])?, text.as_bytes())?;
            let took = slides_taken_out(&op, &current.text, &text);
            self.count_slides_taken_out(actor, took, now);
            let message = if message.is_empty() {
                format!("deck: edit {}", title_or_name(&text, path))
            } else {
                message
            };
            Ok(Change {
                message,
                paths: vec![path.to_owned()],
                value: DeckSaved::Written {
                    deck: deck::read_deck(vault, path)?,
                },
            })
        })
    }

    /// What no trust or approval lifts, for the deck ops: a request that
    /// cannot be made a deck of.
    pub(super) fn deck_refusals(&self, op: &AgentOp) -> Result<()> {
        match op {
            AgentOp::EditDeck { text, marked, .. } => {
                deck::head_of(text)?;
                usable(text, marked.as_deref())?;
            }
            AgentOp::CreateDeck {
                title,
                project,
                text,
                marked,
                ..
            } => {
                deck::check_new_deck(&self.vault, title, project.as_deref(), text)?;
                usable(text, marked.as_deref())?;
            }
            _ => {}
        }
        Ok(())
    }

    /// What a reviewer sees of a deck op: the deck, and in words what the
    /// change does. The two versions of an edit are in the op itself, which a
    /// review draws slide by slide; a deck for the trash is shown as it is.
    pub(super) fn deck_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        Ok(match op {
            AgentOp::EditDeck {
                path,
                summary,
                base,
                text,
                ..
            } => {
                let words = slide_changes(base, text).words();
                let what = one_line(summary);
                Some(Preview {
                    target: Some(Target {
                        path: path.clone(),
                        title: title_or_name(text, path),
                    }),
                    before: None,
                    after: None,
                    diff: if what.is_empty() {
                        words
                    } else {
                        format!("{}: {}", upper_first(&what), lower_first(&words))
                    },
                })
            }
            AgentOp::CreateDeck { title, text, .. } => {
                let count = deck::head_of(text).map_or(0, |head| head.slides);
                Some(Preview {
                    target: None,
                    before: None,
                    after: None,
                    diff: format!(
                        "Create the deck “{}” with {}",
                        one_line(title),
                        slides(count)
                    ),
                })
            }
            AgentOp::Trash { path, .. } if path.ends_with(".deck") => {
                let file = deck::read_deck(&self.vault, path)?;
                let title = title_or_name(&file.text, path);
                Some(Preview {
                    target: Some(Target {
                        path: path.clone(),
                        title: title.clone(),
                    }),
                    before: Some(file.text),
                    after: None,
                    diff: format!("Move the deck “{title}” to the trash"),
                })
            }
            _ => None,
        })
    }

    /// Runs a deck op as `actor`; what the agent is told comes back.
    pub(super) fn deck_execute(&self, actor: &Actor, op: &AgentOp, now: Instant) -> Result<Value> {
        match op {
            AgentOp::EditDeck {
                path,
                tool,
                summary,
                base,
                text,
                marked,
                ..
            } => {
                let title = title_or_name(text, path);
                let written = text_to_write(actor, text, marked.as_deref());
                let what = one_line(summary);
                let message = if what.is_empty() {
                    format!("deck: edit {title}")
                } else {
                    format!("deck: edit {title} § {what}")
                };
                let saved = self.update_deck(
                    actor,
                    path,
                    &op_name(tool, "edit_deck"),
                    &message,
                    now,
                    // What was proposed applies to the version it was made
                    // from; anything a person did since is kept.
                    |current| applied(base, written, &current.text).map(Some),
                )?;
                let (deck, changed) = match saved {
                    DeckSaved::Written { deck } => (deck, true),
                    DeckSaved::Unchanged { deck } | DeckSaved::Conflict { deck, .. } => {
                        (deck, false)
                    }
                };
                Ok(json!({ "path": deck.path, "hash": deck.hash, "changed": changed }))
            }
            AgentOp::CreateDeck {
                title,
                project,
                tool,
                text,
                marked,
                ..
            } => {
                let name = op_name(tool, "create_deck");
                let written = text_to_write(actor, text, marked.as_deref());
                let path = self.apply(actor, &name, false, now.millis, |vault| {
                    let path = deck::create_deck(vault, title, project.as_deref(), written)?;
                    Ok(Change {
                        message: format!("deck: create {}", one_line(title)),
                        paths: vec![path.clone()],
                        value: path,
                    })
                })?;
                Ok(json!({ "path": path }))
            }
            other => Err(Error::Invalid(format!("{} is not a deck op", other.name()))),
        }
    }
}
