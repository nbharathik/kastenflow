//! Diagrams in a change set that is applied or made again. A diagram edited
//! by typed steps is not stale because a person changed it meanwhile: the
//! steps are run again on the file as it is, and the ones that can no longer
//! be made are dropped and said. A diagram written whole cannot be put
//! together with another version and stays stale.

use super::super::Kasten;
use crate::agent::{AgentOp, ChangeSet, Dropped};
use crate::atomic::read_if_there;
use crate::diagrams::{self, steps};
use crate::error::Result;
use crate::note::content_hash;
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::Vault;

/// The diagram at `path` as the set's steps leave it when run on `now`, the
/// file as it is; none when a step cannot be run again or one of them is not
/// an edit by steps.
pub(super) fn replayed(set: &ChangeSet, path: &str, now: &str) -> Option<String> {
    let mut text = now.to_owned();
    let mut edited = false;
    for step in set
        .steps
        .iter()
        .filter(|s| s.paths.iter().any(|p| p == path))
    {
        match &step.op {
            Some(AgentOp::EditDiagram {
                page,
                preset,
                steps: list,
                ..
            }) => {
                text = steps::replay(&text, page.as_deref(), preset.as_deref(), list)
                    .ok()?
                    .xml;
                edited = true;
            }
            _ => return None,
        }
    }
    edited.then_some(text)
}

/// Writes the draft picture of a diagram a set has just written, with the
/// rest of the set (taken back with it if the set fails), and says its path.
/// A diagram that cannot be drawn is kept without a picture.
pub(super) fn keep_draft(
    vault: &Vault,
    undo: &mut Rollback,
    path: &str,
    text: &str,
    paths: &mut Vec<String>,
) -> Result<()> {
    let Some(svg) = diagrams::draft_for(text) else {
        return Ok(());
    };
    let Ok(file) = vault.file_of(&diagrams::sidecar_of(path), &[diagrams::SIDECAR_EXT]) else {
        return Ok(());
    };
    let before = read_if_there(&file)?;
    let picture = diagrams::stamped(&svg, &content_hash(text));
    undo.write(&file, picture.as_bytes(), before)?;
    paths.push(diagrams::sidecar_of(path));
    Ok(())
}

impl Kasten {
    /// Makes an edit by steps again in `fresh`, leaving out the steps that
    /// cannot be made on the diagram as it is: whether anything was staged,
    /// and the steps left out.
    pub(super) fn replan_edit(
        &self,
        fresh: &mut ChangeSet,
        op: &AgentOp,
        now: Instant,
    ) -> Result<(bool, Vec<Dropped>)> {
        let AgentOp::EditDiagram {
            path,
            page,
            preset,
            steps: list,
            reason,
            summary,
        } = op
        else {
            return Ok((self.replan(fresh, op, now)?, Vec::new()));
        };
        let (current, _) = self.starting_from(fresh, path, crate::agent::FileKind::Diagram)?;
        let (_, kept, skipped) =
            steps::replay_tolerant(&current, page.as_deref(), preset.as_deref(), list)?;
        let dropped = skipped
            .iter()
            .map(|s| Dropped {
                summary: steps::describe(std::slice::from_ref(&list[s.step])),
                why: s.why.clone(),
            })
            .collect();
        if kept.is_empty() {
            return Ok((false, dropped));
        }
        let remade = AgentOp::EditDiagram {
            path: path.clone(),
            page: page.clone(),
            preset: preset.clone(),
            steps: kept,
            reason: reason.clone(),
            summary: summary.clone(),
        };
        self.replan(fresh, &remade, now)
            .map(|staged| (staged, dropped))
    }
}
