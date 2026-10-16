//! Whether an agent op waits for review: the rules that hold even for a
//! trusted session, and the soft limits that a session's recent changes
//! count against.

use super::Kasten;
use super::agent::WINDOW_MS;
use crate::agent::{AgentOp, Session};
use crate::diff::removed_fraction;
use crate::error::Result;
use crate::frontmatter::split;
use crate::time::Instant;

fn percent(fraction: f64) -> String {
    format!("{:.0}%", fraction * 100.0)
}

impl Kasten {
    /// Paths the op would change that exist now, and how many new files it makes.
    fn touches(&self, op: &AgentOp) -> Result<(Vec<String>, usize)> {
        Ok(match op {
            // The file usually moves to its new title's name: one new path.
            AgentOp::Rename { path, .. } => {
                let title = self.vault.read(path)?.meta.title;
                let mut paths = self.index().linking(&title)?;
                paths.push(path.clone());
                (paths, 1)
            }
            AgentOp::Move { path, .. } => {
                let notes = self.list()?;
                let mut tree = vec![path.clone()];
                let mut i = 0;
                while i < tree.len() {
                    let id = notes
                        .iter()
                        .find(|n| n.path == tree[i])
                        .and_then(|n| n.id.clone());
                    if let Some(id) = id {
                        for n in notes.iter().filter(|n| n.parent.as_deref() == Some(&id)) {
                            if !tree.contains(&n.path) {
                                tree.push(n.path.clone());
                            }
                        }
                    }
                    i += 1;
                }
                // Every moved note gets a new path too.
                let moved = tree.len();
                (tree, moved)
            }
            AgentOp::Trash { path, .. } => (self.with_sub_pages(path)?, 0),
            AgentOp::JournalAppend { date, .. } => {
                let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
                if self.vault.exists(&path) {
                    (vec![path], 0)
                } else {
                    (vec![], 1)
                }
            }
            other => match other.path() {
                Some(path) => (vec![path.to_owned()], 0),
                None => (vec![], usize::from(other.creates())),
            },
        })
    }

    /// Why an op must wait for review, if it must.
    pub(super) fn review_reason(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Option<String>> {
        // Decks: a deck to the trash, and many slides taken out, wait even when trusted.
        if let Some(reason) = self.deck_review_reason(session, op, now)? {
            return Ok(Some(reason));
        }
        // Diagrams: one to the trash waits even when trusted; a rewrite that takes a lot out, when not.
        if let Some(reason) = self.diagram_review_reason(session, op, now)? {
            return Ok(Some(reason));
        }
        match op {
            AgentOp::Edit { .. } => {
                return Ok(Some("A full rewrite always waits for review".to_owned()));
            }
            AgentOp::TagSchema { .. } => {
                return Ok(Some(
                    "A tag schema change always waits for review".to_owned(),
                ));
            }
            AgentOp::Template { .. } => {
                return Ok(Some(
                    "A template made or changed by an agent always waits for review".to_owned(),
                ));
            }
            AgentOp::Trash { path, .. } if path.ends_with(".canvas") => {
                return Ok(Some("Trashing a board always waits for review".to_owned()));
            }
            _ => {}
        }
        if self.trusted(&session.id, now) {
            return Ok(None);
        }
        let limits = self.config().guardrails;
        if let AgentOp::ReplaceSection {
            path,
            heading,
            markdown,
        } = op
        {
            let note = self.vault.read(path)?;
            let body = split(&note.text).body;
            let new = crate::sections::replace_section(body, heading, markdown)?;
            let removed = removed_fraction(body, &new);
            if removed > limits.max_removed_fraction {
                return Ok(Some(format!(
                    "Removes {} of the note's text (the limit is {})",
                    percent(removed),
                    percent(limits.max_removed_fraction)
                )));
            }
        }
        let (trashed, recent) = {
            let state = self.state();
            let tally = state.tallies.get(&session.id).cloned().unwrap_or_default();
            let recent: Vec<String> = tally
                .recent(now.millis, WINDOW_MS)
                .into_iter()
                .map(str::to_owned)
                .collect();
            (tally.trashed, recent)
        };
        if let AgentOp::Trash { path, .. } = op {
            let max = limits.max_trash_per_session as usize;
            let going = self.with_sub_pages(path)?.len();
            if trashed + going > max {
                return Ok(Some(if going > 1 {
                    format!(
                        "With its sub-pages this moves {going} notes to the trash, after {trashed} already (the limit is {max})"
                    )
                } else {
                    format!(
                        "This session already moved {trashed} notes to the trash (the limit is {max})"
                    )
                }));
            }
        }
        let (paths, new) = self.touches(op)?;
        let fresh = paths.iter().filter(|p| !recent.contains(p)).count() + new;
        let max = limits.max_notes_per_session_10min as usize;
        if fresh > 0 && recent.len() + fresh > max {
            return Ok(Some(format!(
                "This session changed {} notes in the last 10 minutes; this would make {} (the limit is {max})",
                recent.len(),
                recent.len() + fresh
            )));
        }
        Ok(None)
    }
}
