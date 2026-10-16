//! The diagram ops of agents: a new diagram, a diagram's source written
//! whole, and a diagram sent to the trash (`AgentOp::Trash` on a `.drawio`
//! path, which takes the picture along). A request that is not a diagram is
//! refused. A diagram for the trash always waits for review, and so does a
//! rewrite that takes a large part of the drawing out, counted by cell id
//! whatever the layout of the text; a session a person trusted may rewrite as
//! it likes. An agent never writes the picture: it is drawn again from the
//! source the next time the editor is at hand.

use serde_json::{Value, json};

use super::Kasten;
use super::review::Preview;
use crate::agent::{AgentOp, Session, Target};
use crate::diagrams::{self, DiagramSaved, removed_cells, title_of};
use crate::diff::unified;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::note::content_hash;
use crate::time::Instant;

fn percent(fraction: f64) -> String {
    format!("{:.0}%", fraction * 100.0)
}

fn some(xml: &str) -> Option<&str> {
    Some(xml).filter(|x| !x.trim().is_empty())
}

impl Kasten {
    /// What no trust or approval lifts, for the diagram ops: a source that is
    /// not a well-formed diagram, a title that cannot name a file, a path that
    /// is not a diagram.
    pub(super) fn diagram_refusals(&self, op: &AgentOp) -> Result<()> {
        match op {
            AgentOp::CreateDiagram {
                title,
                project,
                xml,
                ..
            } => diagrams::check_new_diagram(&self.vault, title, project.as_deref(), some(xml))?,
            AgentOp::UpdateDiagram { path, xml, .. } => {
                if !path.ends_with(diagrams::EXT) {
                    return Err(Error::Invalid(format!(
                        "{path} is not a diagram: update_diagram changes a .drawio file"
                    )));
                }
                diagrams::check_xml(xml)?;
            }
            AgentOp::EditDiagram { .. } => self.diagram_edit_refusals(op)?,
            _ => {}
        }
        Ok(())
    }

    /// Why a diagram op must wait for review, if it must: a diagram for the
    /// trash whoever is trusted, and, for a session nobody trusted, a rewrite
    /// that takes more of the drawing out than the guardrails allow.
    pub(super) fn diagram_review_reason(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Option<String>> {
        Ok(match op {
            AgentOp::Trash { path, .. } if path.ends_with(diagrams::EXT) => {
                Some("Trashing a diagram always waits for review".to_owned())
            }
            AgentOp::EditDiagram { .. } => self.diagram_edit_review_reason(session, op, now)?,
            AgentOp::UpdateDiagram { path, xml, .. } if !self.trusted(&session.id, now) => {
                let current = diagrams::read_diagram(&self.vault, path)?;
                let (gone, total) = removed_cells(&current.xml, xml);
                let limit = self.config().guardrails.max_removed_fraction;
                let removed = if total == 0 {
                    0.0
                } else {
                    gone as f64 / total as f64
                };
                (removed > limit).then(|| {
                    format!(
                        "Takes {gone} of the diagram's {total} elements out ({}; the limit is {})",
                        percent(removed),
                        percent(limit)
                    )
                })
            }
            _ => None,
        })
    }

    /// What a reviewer sees of a diagram op: the diagram, its source before
    /// and after, and in words what the change does.
    pub(super) fn diagram_op_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        Ok(match op {
            AgentOp::EditDiagram { .. } => return self.diagram_edit_preview(op),
            AgentOp::CreateDiagram { title, xml, .. } => {
                let cells = diagrams::cell_ids(xml).len();
                Some(Preview {
                    target: None,
                    before: None,
                    after: some(xml).map(str::to_owned),
                    diff: format!(
                        "Create the diagram “{}”{}",
                        title.trim(),
                        if cells > 0 {
                            format!(" with {cells} elements")
                        } else {
                            String::new()
                        }
                    ),
                })
            }
            AgentOp::UpdateDiagram { path, xml, .. } => {
                let current = diagrams::read_diagram(&self.vault, path)?;
                let title = title_of(path);
                let (gone, total) = removed_cells(&current.xml, xml);
                let words = format!(
                    "Rewrite the diagram “{title}”: takes {gone} of its {total} elements out"
                );
                Some(Preview {
                    target: Some(Target {
                        path: path.clone(),
                        title,
                    }),
                    diff: format!("{words}\n\n{}", unified(path, &current.xml, xml, 3)),
                    before: Some(current.xml),
                    after: Some(xml.clone()),
                })
            }
            AgentOp::Trash { path, .. } if path.ends_with(diagrams::EXT) => {
                let current = diagrams::read_diagram(&self.vault, path)?;
                let title = title_of(path);
                Some(Preview {
                    target: Some(Target {
                        path: path.clone(),
                        title: title.clone(),
                    }),
                    before: Some(current.xml),
                    after: None,
                    diff: format!("Move the diagram “{title}” to the trash"),
                })
            }
            _ => None,
        })
    }

    /// Runs a diagram op as `actor`; what the agent is told comes back.
    pub(super) fn diagram_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        match op {
            AgentOp::EditDiagram { .. } => self.diagram_edit_execute(actor, op, now),
            AgentOp::CreateDiagram {
                title,
                project,
                xml,
                ..
            } => {
                let path =
                    self.create_diagram_drawn(actor, title, project.as_deref(), some(xml), now)?;
                Ok(json!({ "path": path, "title": title_of(&path) }))
            }
            // Written against the source the agent read: a diagram a person
            // changed since is left alone, and the agent's version goes beside it.
            AgentOp::UpdateDiagram {
                path, xml, base, ..
            } => Ok(
                match self.save_diagram(
                    actor,
                    path,
                    xml,
                    diagrams::draft_for(xml).as_deref(),
                    &content_hash(base),
                    now,
                )? {
                    DiagramSaved::Written { diagram } => {
                        json!({ "path": path, "status": "saved", "hash": diagram.hash })
                    }
                    DiagramSaved::Unchanged { diagram } => {
                        json!({ "path": path, "status": "unchanged", "hash": diagram.hash })
                    }
                    DiagramSaved::Conflict { copy, diagram } => json!({
                        "path": path,
                        "status": "conflict",
                        "copy": copy,
                        "hash": diagram.hash,
                        "note": "The diagram changed since it was read, so it was left as it is and this version was kept in the copy"
                    }),
                },
            ),
            other => Err(Error::Invalid(format!(
                "{} is not a diagram op",
                other.name()
            ))),
        }
    }
}
