//! Typed diagram edits (`AgentOp::EditDiagram`) through the guardrails. The
//! steps are run on the diagram as it is when they are applied (now, when a
//! proposal is accepted, or when staged changes are applied), so a person's
//! edit made meanwhile is merged cell by cell and never needs a conflict
//! copy. Refused: a path that is not a diagram, no steps, steps that cannot
//! be made. Waiting for review (unless the session is trusted): an edit that
//! takes more than the allowed share of the cells out, or moves more than
//! that share of the boxes.

use serde_json::{Value, json};

use super::review::Preview;
use super::{Change, Kasten};
use crate::agent::{AgentOp, Session, Target};
use crate::diagrams::steps::{self, Edited};
use crate::diagrams::{self, DiagramFile, moved_cells, removed_cells, title_of};
use crate::diff::unified;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;

fn percent(fraction: f64) -> String {
    format!("{:.0}%", fraction * 100.0)
}

/// Moving a few boxes is not a loss however few there are: a review is for
/// a layout that rearranges a drawing.
const FEW_MOVED: usize = 4;

/// The parts of an `EditDiagram` op.
struct Parts<'a> {
    path: &'a str,
    page: Option<&'a str>,
    preset: Option<&'a str>,
    steps: &'a [steps::Step],
    summary: &'a str,
}

fn parts(op: &AgentOp) -> Option<Parts<'_>> {
    match op {
        AgentOp::EditDiagram {
            path,
            page,
            preset,
            steps,
            summary,
            ..
        } => Some(Parts {
            path,
            page: page.as_deref(),
            preset: preset.as_deref(),
            steps,
            summary,
        }),
        _ => None,
    }
}

impl Parts<'_> {
    fn words(&self) -> String {
        if self.summary.trim().is_empty() {
            steps::summarize(self.steps)
        } else {
            self.summary.trim().to_owned()
        }
    }

    fn run(&self, xml: &str) -> Result<Edited> {
        steps::replay(xml, self.page, self.preset, self.steps)
    }
}

impl Kasten {
    /// What no trust lifts for an edit: a path that is not a diagram, no steps.
    pub(super) fn diagram_edit_refusals(&self, op: &AgentOp) -> Result<()> {
        let Some(p) = parts(op) else { return Ok(()) };
        if !p.path.ends_with(diagrams::EXT) {
            return Err(Error::Invalid(format!(
                "{} is not a diagram: diagram_edit changes a .drawio file",
                p.path
            )));
        }
        if p.steps.is_empty() {
            return Err(Error::Invalid(
                "diagram_edit needs at least one step".to_owned(),
            ));
        }
        if p.steps.len() > steps::MAX_STEPS {
            return Err(Error::Invalid(format!(
                "At most {} steps may be sent at once; this is {}",
                steps::MAX_STEPS,
                p.steps.len()
            )));
        }
        Ok(())
    }

    /// Why an edit must wait for review, if it must. The steps are made on
    /// the diagram first, so one that cannot be made is refused here, before
    /// anything waits.
    pub(super) fn diagram_edit_review_reason(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Option<String>> {
        let Some(p) = parts(op) else { return Ok(None) };
        let current = diagrams::read_diagram(&self.vault, p.path)?;
        let edited = p.run(&current.xml)?;
        if self.trusted(&session.id, now) {
            return Ok(None);
        }
        let limit = self.config().guardrails.max_removed_fraction;
        let (gone, total) = removed_cells(&current.xml, &edited.xml);
        if total > 0 && gone as f64 / total as f64 > limit {
            return Ok(Some(format!(
                "Takes {gone} of the diagram's {total} elements out ({}; the limit is {})",
                percent(gone as f64 / total as f64),
                percent(limit)
            )));
        }
        let (moved, boxes) = moved_cells(&current.xml, &edited.xml)?;
        if moved >= FEW_MOVED && boxes > 0 && moved as f64 / boxes as f64 > limit {
            return Ok(Some(format!(
                "Moves {moved} of the diagram's {boxes} boxes ({}; the limit is {})",
                percent(moved as f64 / boxes as f64),
                percent(limit)
            )));
        }
        Ok(None)
    }

    /// What a reviewer sees of an edit: the diagram before and after, and the steps in words.
    pub(super) fn diagram_edit_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        let Some(p) = parts(op) else { return Ok(None) };
        let current = diagrams::read_diagram(&self.vault, p.path)?;
        let edited = p.run(&current.xml)?;
        let title = title_of(p.path);
        let words = format!(
            "Edit the diagram “{title}”: {}\n\n{}",
            p.words(),
            steps::describe(p.steps)
        );
        Ok(Some(Preview {
            target: Some(Target {
                path: p.path.to_owned(),
                title,
            }),
            diff: format!(
                "{words}\n\n{}",
                unified(p.path, &current.xml, &edited.xml, 3)
            ),
            before: Some(current.xml),
            after: Some(edited.xml),
        }))
    }

    /// Runs an edit as `actor`: the steps on the diagram as it is now.
    pub(super) fn diagram_edit_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let Some(p) = parts(op) else {
            return Err(Error::Invalid(format!(
                "{} is not a diagram edit",
                op.name()
            )));
        };
        let title = title_of(p.path);
        let words = p.words();
        let (edited, saved) = self.apply(actor, "edit_diagram", false, now.millis, |vault| {
            let current: DiagramFile = diagrams::read_diagram(vault, p.path)?;
            let edited = p.run(&current.xml)?;
            let (paths, changed) =
                diagrams::write_edited(vault, p.path, &current, &edited.xml, now)?;
            Ok(Change {
                message: format!("diagram: edit {title} — {words}"),
                paths,
                value: (edited, changed),
            })
        })?;
        let hash = self.diagram(p.path)?.hash;
        Ok(json!({
            "path": p.path,
            "status": if saved { "saved" } else { "unchanged" },
            "hash": hash,
            "ids": edited.applied.ids,
            "notes": edited.applied.notes,
            "moved": edited.applied.moved,
            "summary": words,
        }))
    }
}
