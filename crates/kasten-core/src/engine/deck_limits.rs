//! What makes a deck op wait for review whoever is trusted: a deck sent to the
//! trash, and taking too many slides out of decks. The second is added up over
//! the session's last ten minutes (`Tally`), so a limit of three cannot be
//! kept a call at a time, and it counts what a change does to the deck as it
//! is now: the slides it removes, the slides it leaves with nothing on them
//! (their ids are still there), and for an edit that replaces the whole deck
//! every slide it does not leave as it was. A change a person accepted is not
//! counted; they looked at it.

use super::Kasten;
use super::agent::WINDOW_MS;
use super::deck_agent::{applied, slides};
use crate::agent::{AgentOp, Session};
use crate::deck::{self, REPLACES_DECK, slide_changes};
use crate::error::Result;
use crate::history::Actor;
use crate::policy::OpClass;
use crate::time::Instant;

/// How many slides an edit by `tool` takes out of a deck by making it
/// `after` from `before`.
pub(super) fn slides_taken_out(tool: &str, before: &str, after: &str) -> usize {
    let changes = slide_changes(before, after);
    if tool == REPLACES_DECK {
        changes.replaced()
    } else {
        changes.taken_out()
    }
}

impl Kasten {
    /// Notes that a write took `count` slides out of decks. Only what an
    /// agent wrote by itself counts against its session.
    pub(super) fn count_slides_taken_out(&self, actor: &Actor, count: usize, now: Instant) {
        if let Actor::Agent { session, .. } = actor {
            self.state()
                .tallies
                .entry(session.clone())
                .or_default()
                .took_out_slides(count, now.millis);
        }
    }

    /// Why a deck op must wait for review whoever is trusted, if it must: a
    /// deck sent to the trash always waits, and slides taken out past the
    /// limit are a soft limit that trust does not lift (autonomous mode does).
    /// Nothing is deleted, but taken-out slides are gone from the deck until
    /// the change is undone, and that is what a person is asked about.
    pub(super) fn deck_review_reason(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<OpClass> {
        Ok(match op {
            AgentOp::Trash { path, .. } if path.ends_with(".deck") => {
                OpClass::Always("Trashing a deck always waits for review".to_owned())
            }
            AgentOp::EditDeck {
                path,
                tool,
                base,
                text,
                marked,
                ..
            } => {
                // What the write will make of the deck as it is now.
                let current = deck::read_deck(&self.vault, path)?.text;
                let after = applied(base, marked.as_deref().unwrap_or(text), &current)?;
                let changes = slide_changes(&current, &after);
                let (does, gone) = if tool.as_str() == REPLACES_DECK {
                    ("Replaces", changes.replaced())
                } else if changes.emptied.is_empty() {
                    ("Removes", changes.taken_out())
                } else {
                    ("Removes or empties", changes.taken_out())
                };
                let limit = self.config().guardrails.max_slides_removed as usize;
                let earlier = self
                    .state()
                    .tallies
                    .get(&session.id)
                    .map_or(0, |tally| tally.slides_taken_out(now.millis, WINDOW_MS));
                if gone > 0 && earlier + gone > limit {
                    OpClass::Soft(if earlier == 0 {
                        format!(
                            "{does} {} in one change (the limit is {limit})",
                            slides(gone)
                        )
                    } else {
                        format!(
                            "This session already took {} out of decks in the last 10 minutes; this would make {} (the limit is {limit})",
                            slides(earlier),
                            earlier + gone
                        )
                    })
                } else {
                    OpClass::Ordinary
                }
            }
            _ => OpClass::Ordinary,
        })
    }
}
