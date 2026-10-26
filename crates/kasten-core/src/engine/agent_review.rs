//! Whether an agent op waits for review: the rules that hold even for a
//! trusted session, and the soft limits that a session's recent changes
//! count against.

use super::Kasten;
use super::agent::WINDOW_MS;
use crate::agent::{AgentOp, Session};
use crate::diff::removed_fraction;
use crate::error::Result;
use crate::frontmatter::split;
use crate::policy::OpClass;
use crate::time::Instant;

fn percent(fraction: f64) -> String {
    format!("{:.0}%", fraction * 100.0)
}

impl Kasten {
    /// Paths the op would change that exist now, and how many new files it makes.
    pub(super) fn touches(&self, op: &AgentOp) -> Result<(Vec<String>, usize)> {
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
            // A page is built of many files; code edits are not counted as notes changed.
            AgentOp::SmartWrite { .. } | AgentOp::SmartDelete { .. } => (vec![], 0),
            AgentOp::JournalAppend { date, .. } => {
                let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
                if self.vault.exists(&path) {
                    (vec![path], 0)
                } else {
                    (vec![], 1)
                }
            }
            AgentOp::SetParent { .. } | AgentOp::CreateProject { .. } => {
                self.structure_touches(op)?
            }
            AgentOp::DuplicateNote { .. }
            | AgentOp::RestoreNote { .. }
            | AgentOp::JournalDay { .. }
            | AgentOp::CreateCollection { .. }
            | AgentOp::DuplicateDiagram { .. } => self.parity_touches(op)?,
            other => match other.path() {
                Some(path) => (vec![path.to_owned()], 0),
                None => (vec![], usize::from(other.creates())),
            },
        })
    }

    /// What kind of op this is for the agent modes: one that waits for review
    /// whoever is trusted (`Always`), one over a limit that holds now (`Soft`;
    /// a trusted session has had the limits lifted that trust lifts), or an
    /// ordinary one. The refusals have been made already (`refusals`).
    pub(super) fn op_class(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<OpClass> {
        // Decks: a deck to the trash waits even when trusted, and many slides taken out too.
        let class = self.deck_review_reason(session, op, now)?;
        if class != OpClass::Ordinary {
            return Ok(class);
        }
        // Diagrams: one to the trash waits even when trusted; a rewrite that takes a lot out, when not.
        let class = self.diagram_review_reason(session, op, now)?;
        if class != OpClass::Ordinary {
            return Ok(class);
        }
        // LaTeX sources: a rewrite that takes a lot out of a file, when not trusted.
        let class = self.latex_review_reason(session, op, now)?;
        if class != OpClass::Ordinary {
            return Ok(class);
        }
        // Page edits by blocks: one that takes a lot out of the page, when not trusted.
        let class = self.page_review_reason(session, op, now)?;
        if class != OpClass::Ordinary {
            return Ok(class);
        }
        // Structure: a project from a setup that makes schemas waits always; leaving out a view, when not trusted.
        let class = self.structure_review_reason(session, op, now)?;
        if class != OpClass::Ordinary {
            return Ok(class);
        }
        // Parity ops: another session's undo and a reference added always wait.
        let class = self.parity_review_reason(session, op)?;
        if class != OpClass::Ordinary {
            return Ok(class);
        }
        let always = |reason: &str| Ok(OpClass::Always(reason.to_owned()));
        match op {
            AgentOp::Edit { .. } => return always("A full rewrite always waits for review"),
            AgentOp::TagSchema { .. } => {
                return always("A tag schema change always waits for review");
            }
            AgentOp::Template { .. } => {
                return always("A template made or changed by an agent always waits for review");
            }
            AgentOp::SaveProjectSetup { .. } => {
                return always(
                    "A setup saved by an agent is written into the templates folder, which always waits for review",
                );
            }
            AgentOp::Trash { path, .. } if path.ends_with(".canvas") => {
                return always("Trashing a board always waits for review");
            }
            _ => {}
        }
        match self.soft_limit(session, op, now)? {
            Some(reason) => Ok(OpClass::Soft(reason)),
            None => Ok(OpClass::Ordinary),
        }
    }

    /// The soft limit an op is over, if it is and its session is not trusted.
    fn soft_limit(&self, session: &Session, op: &AgentOp, now: Instant) -> Result<Option<String>> {
        if self.trusted(&session.id, now) {
            return Ok(None);
        }
        let limits = self.config().guardrails;
        if let AgentOp::BoardChanges { changes, .. } = op {
            let going = crate::board::removed_by(changes);
            let max = limits.max_board_nodes_removed as usize;
            // Added up over the session's last ten minutes, so a limit of ten
            // cannot be kept a call at a time.
            let earlier = self
                .state()
                .tallies
                .get(&session.id)
                .map_or(0, |tally| tally.cards_taken_off(now.millis, WINDOW_MS));
            if going > 0 && earlier + going > max {
                return Ok(Some(if earlier == 0 {
                    format!("Takes {going} cards off a board at once (the limit is {max})")
                } else {
                    format!(
                        "This session already took {earlier} cards off boards in the last 10 minutes; this would make {} (the limit is {max})",
                        earlier + going
                    )
                }));
            }
        }
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
