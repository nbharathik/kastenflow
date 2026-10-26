//! `board_edit`: typed steps on a whiteboard, sent as one batch of changes
//! the way the app sends a person's edits. Taking more nodes off than the
//! guardrails allow waits for the user's review.

use kasten_core::agent::AgentOp;
use kasten_core::board::BoardChange;
use kasten_core::{Error, Result};

use super::lookup::Lookup;
use crate::params_parity::{BoardEditArgs, BoardStep};

/// The most steps one call may carry.
const MAX_STEPS: usize = 200;

pub(crate) fn board_edit(k: &dyn Lookup, a: BoardEditArgs) -> Result<AgentOp> {
    if a.steps.is_empty() {
        return Err(Error::Invalid(
            "Give at least one step: add_sticky, move, resize, remove, restyle or edge_style"
                .to_owned(),
        ));
    }
    if a.steps.len() > MAX_STEPS {
        return Err(Error::Invalid(format!(
            "At most {MAX_STEPS} steps in one call; send the rest in another"
        )));
    }
    let board = k.resolve_board(&a.board)?;
    let (mut added, mut moved, mut taken, mut styled) = (0, 0, 0, 0);
    let mut changes = Vec::with_capacity(a.steps.len());
    for step in a.steps {
        match step {
            BoardStep::AddSticky { text, x, y } => {
                added += 1;
                changes.push(BoardChange::Sticky { text, x, y });
            }
            BoardStep::Move { id, x, y } => {
                moved += 1;
                changes.push(BoardChange::Place {
                    id,
                    x,
                    y,
                    width: None,
                    height: None,
                });
            }
            BoardStep::Resize {
                id,
                x,
                y,
                width,
                height,
            } => {
                moved += 1;
                changes.push(BoardChange::Place {
                    id,
                    x,
                    y,
                    width: Some(width),
                    height: Some(height),
                });
            }
            BoardStep::Remove { ids } => {
                taken += ids.len();
                changes.push(BoardChange::Remove { ids });
            }
            BoardStep::Restyle { ids, color } => {
                styled += 1;
                changes.push(BoardChange::Color { ids, color });
            }
            BoardStep::EdgeStyle {
                id,
                label,
                color,
                from_end,
                to_end,
                line,
                dashed,
            } => {
                styled += 1;
                if label.is_some() || color.is_some() || from_end.is_some() || to_end.is_some() {
                    changes.push(BoardChange::Edge {
                        id: id.clone(),
                        label,
                        color,
                        from_end,
                        to_end,
                        from_side: None,
                        to_side: None,
                    });
                }
                if line.is_some() || dashed.is_some() {
                    changes.push(BoardChange::Line {
                        id,
                        line,
                        dash: dashed,
                    });
                }
            }
        }
    }
    let parts: Vec<String> = [
        (added, "added"),
        (moved, "moved or resized"),
        (taken, "taken off"),
        (styled, "restyled"),
    ]
    .into_iter()
    .filter(|(n, _)| *n > 0)
    .map(|(n, what)| format!("{n} {what}"))
    .collect();
    Ok(AgentOp::BoardChanges {
        board,
        changes,
        summary: parts.join(", "),
    })
}
