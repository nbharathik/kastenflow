//! Staging the ops on whiteboards and diagrams. A board is edited by the same
//! pure steps the real ops run on its text; a diagram carries its whole source
//! with it. Both are applied only to a vault file that is still as they started
//! from (a file changed since makes the set stale), where a note is merged.

use std::collections::HashSet;

use serde_json::{Value, json};

use super::super::Kasten;
use super::super::boards::{add_cards, board_edited, connect_nodes, group_nodes};
use super::super::execute::board_layout;
use super::plan::Planned;
use crate::agent::{AgentOp, ChangeSet, FileKind, NewFile};
use crate::board::{self, Canvas};
use crate::diagrams::steps;
use crate::diagrams::{self, title_of};
use crate::error::Result;
use crate::note::content_hash;
use crate::time::Instant;

fn quoted(title: &str) -> String {
    format!("“{}”", title.trim())
}

/// The vault paths a staged change means to use.
fn taken(set: &ChangeSet) -> HashSet<String> {
    set.created_files
        .iter()
        .map(|f| f.provisional.clone())
        .collect()
}

impl Kasten {
    /// Changes the board at `path` in the set with `change` (the pure step of
    /// a board op); `told` makes what the agent is told of what it made.
    fn finish_board<T>(
        &self,
        set: &mut ChangeSet,
        path: &str,
        change: impl FnOnce(&mut Canvas, &crate::board::BoardView) -> Result<(T, String)>,
        told: impl FnOnce(&T) -> Value,
    ) -> Result<Planned> {
        let (current, base) = self.starting_from(set, path, FileKind::Board)?;
        let edit = board_edited(path, &current, self.card_titles()?, change)?;
        let changed = edit.text != current;
        if changed {
            self.put_text(set, path, FileKind::Board, base, edit.text)?;
        }
        Ok(Planned::Staged {
            paths: if changed {
                vec![path.to_owned()]
            } else {
                vec![]
            },
            result: told(&edit.value),
            summary: format!("{} on {}", capitalised(&edit.what), quoted(&edit.title)),
        })
    }

    /// Stages an op on a board or a diagram, or None for an op that is not one.
    pub(super) fn plan_board_op(
        &self,
        set: &mut ChangeSet,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Option<Planned>> {
        Ok(Some(match op {
            AgentOp::CreateBoard { title, project } => {
                let (path, text) =
                    board::plan_board(&self.vault, title, project.as_deref(), &taken(set))?;
                self.put_new(
                    set,
                    NewFile {
                        provisional: path.clone(),
                        title: title.trim().to_owned(),
                        op: "create_board".to_owned(),
                        text,
                        kind: FileKind::Board,
                    },
                )?;
                Planned::Staged {
                    summary: format!("Create the board {}", quoted(title)),
                    result: json!({ "board": path }),
                    paths: vec![path],
                }
            }
            AgentOp::AddToBoard {
                board,
                notes,
                layout,
                positions,
            } => {
                let layout = board_layout(layout.as_deref(), positions.as_deref())?;
                let items = self.file_items(notes)?;
                self.finish_board(
                    set,
                    board,
                    |canvas, _| add_cards(canvas, &items, layout, now),
                    |added| json!(added),
                )?
            }
            AgentOp::Connect {
                board,
                from,
                to,
                label,
            } => self.finish_board(
                set,
                board,
                |canvas, view| connect_nodes(canvas, view, (from, to), label.as_deref(), now),
                |id| json!({ "edge": id }),
            )?,
            AgentOp::Group {
                board,
                nodes,
                label,
            } => self.finish_board(
                set,
                board,
                |canvas, view| group_nodes(canvas, view, nodes, label, now),
                |id| json!({ "section": id }),
            )?,
            AgentOp::CreateDiagram {
                title,
                project,
                xml,
            } => {
                let source = Some(xml.as_str()).filter(|x| !x.trim().is_empty());
                let (path, text) = diagrams::plan_diagram(
                    &self.vault,
                    title,
                    project.as_deref(),
                    source,
                    &taken(set),
                )?;
                let named = title_of(&path);
                self.put_new(
                    set,
                    NewFile {
                        provisional: path.clone(),
                        title: named.clone(),
                        op: "create_diagram".to_owned(),
                        text,
                        kind: FileKind::Diagram,
                    },
                )?;
                Planned::Staged {
                    summary: format!("Create the diagram {}", quoted(title)),
                    result: json!({ "path": path, "title": named }),
                    paths: vec![path],
                }
            }
            AgentOp::EditDiagram {
                path,
                page,
                preset,
                steps: list,
                summary,
                ..
            } => {
                let (current, base) = self.starting_from(set, path, FileKind::Diagram)?;
                let edited = steps::replay(&current, page.as_deref(), preset.as_deref(), list)?;
                if edited.changed {
                    self.put_text(set, path, FileKind::Diagram, base, edited.xml.clone())?;
                }
                let words = if summary.trim().is_empty() {
                    steps::summarize(list)
                } else {
                    summary.trim().to_owned()
                };
                Planned::Staged {
                    summary: format!("Edit the diagram {}: {words}", quoted(&title_of(path))),
                    result: json!({
                        "path": path,
                        "status": if edited.changed { "saved" } else { "unchanged" },
                        "hash": content_hash(&edited.xml),
                        "ids": edited.applied.ids,
                        "notes": edited.applied.notes,
                        "moved": edited.applied.moved,
                        "summary": words,
                    }),
                    paths: if edited.changed {
                        vec![path.clone()]
                    } else {
                        vec![]
                    },
                }
            }
            AgentOp::UpdateDiagram {
                path,
                xml,
                base: read,
                ..
            } => {
                diagrams::check_xml(xml)?;
                let (current, base) = self.starting_from(set, path, FileKind::Diagram)?;
                // Written against the source the agent read: a diagram that is not that
                // any more (a person drew meanwhile) is not written over, here or when
                // the staged change is made again after it went stale.
                if *read != current {
                    return Err(crate::error::Error::Invalid(format!(
                        "The diagram {} changed since it was read, so this rewrite is not made. Read it again and send the change",
                        quoted(&title_of(path))
                    )));
                }
                let changed = *xml != current;
                if changed {
                    self.put_text(set, path, FileKind::Diagram, base, xml.clone())?;
                }
                Planned::Staged {
                    summary: format!("Rewrite the diagram {}", quoted(&title_of(path))),
                    result: json!({
                        "path": path,
                        "status": if changed { "saved" } else { "unchanged" },
                        "hash": content_hash(xml),
                    }),
                    paths: if changed { vec![path.clone()] } else { vec![] },
                }
            }
            _ => return Ok(None),
        }))
    }
}

/// `text` with its first letter capital.
fn capitalised(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
