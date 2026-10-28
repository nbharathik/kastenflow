//! Running an agent op as the agent: the op itself, its commit and what the
//! agent is told about it. Proposals run through here once accepted
//! (review.rs).

use serde_json::{Value, json};

use super::{Change, Kasten, NoteRef};
use crate::agent::AgentOp;
use crate::atomic::{create_atomic, write_atomic};
use crate::board::Layout;
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::history::Actor;
use crate::merge::merge3;
use crate::note::NoteFile;
use crate::ops::{Kind, NewNote};
use crate::time::Instant;

pub(super) fn note_ref(note: &NoteFile) -> Value {
    json!(NoteRef {
        path: note.meta.path.clone(),
        id: note.meta.id.clone(),
        title: note.meta.title.clone(),
    })
}

pub(super) fn day_of(now: Instant) -> String {
    now.rfc3339()[..10].to_owned()
}

/// The layout an agent's `add_to_board` asks for: positions, else a named layout.
pub(super) fn board_layout(layout: Option<&str>, positions: Option<&[[i64; 2]]>) -> Result<Layout> {
    match (layout, positions) {
        (_, Some(at)) => Ok(Layout::Positions(
            at.iter().map(|[x, y]| (*x, *y)).collect(),
        )),
        (Some("cluster_by_tag"), None) => Ok(Layout::ClusterByTag),
        (None | Some("grid"), None) => Ok(Layout::Grid),
        (Some(other), None) => Err(Error::Invalid(format!(
            "Layouts are grid and cluster_by_tag, or positions; not “{other}”"
        ))),
    }
}

/// The kind of note an agent's `type` names: agents make cards and pages.
pub(super) fn agent_kind(note_type: &str) -> Result<Kind> {
    match note_type {
        "card" => Ok(Kind::Card),
        "page" => Ok(Kind::Page),
        other => Err(Error::Invalid(format!(
            "Agents create cards and pages, not “{other}”"
        ))),
    }
}

impl Kasten {
    /// Runs an op as `actor`, returning what agents are told about it.
    pub(crate) fn execute(&self, actor: &Actor, op: &AgentOp, now: Instant) -> Result<Value> {
        Ok(match op {
            AgentOp::Capture { markdown, tags } => {
                note_ref(&self.capture(actor, markdown, tags, now)?)
            }
            AgentOp::CreateNote {
                note_type,
                title,
                body,
                project,
                tags,
                props,
                parent,
                template,
            } => {
                let kind = agent_kind(note_type)?;
                let new = NewNote {
                    kind,
                    title: title.clone(),
                    date: day_of(now),
                    project: project.clone(),
                    parent: parent.clone(),
                    template: template.clone(),
                    icon: None,
                };
                note_ref(&self.create_with_body(actor, &new, body, tags, props, "create", now)?)
            }
            AgentOp::Append {
                path,
                markdown,
                heading,
            } => note_ref(&self.append(actor, path, markdown, heading.as_deref(), now)?),
            AgentOp::ReplaceSection {
                path,
                heading,
                markdown,
            } => note_ref(&self.replace_section(actor, path, heading, markdown, now)?),
            AgentOp::UpdateProps { path, props } => {
                note_ref(&self.update_props(actor, path, props, now)?)
            }
            AgentOp::Tags { path, add, remove } => {
                note_ref(&self.set_tags(actor, path, add, remove, now)?)
            }
            AgentOp::Rename { path, title } => {
                let renamed = self.rename(actor, path, title, now)?;
                json!({ "note": note_ref(&renamed.note), "relinked": renamed.relinked })
            }
            AgentOp::Move { path, project } => {
                note_ref(&self.move_note(actor, path, project.as_deref())?)
            }
            AgentOp::JournalAppend {
                date,
                markdown,
                heading,
            } => note_ref(&self.journal_append(actor, date, markdown, heading.as_deref(), now)?),
            AgentOp::Trash { path, .. } => json!({ "trashed": self.trash(actor, path, now)? }),
            AgentOp::Edit {
                path, body, base, ..
            } => note_ref(&self.rewrite(actor, path, body, base, now)?),
            AgentOp::TagSchema { tag, schema } => {
                json!({ "path": self.write_tag_schema(actor, tag, schema, now)? })
            }
            AgentOp::Template {
                name, text, base, ..
            } => json!({ "path": self.write_template(actor, name, text, base.as_deref(), now)? }),
            AgentOp::CreateBoard { title, project } => {
                json!({ "board": self.create_board(actor, title, project.as_deref(), now)? })
            }
            AgentOp::AddToBoard {
                board,
                notes,
                layout,
                positions,
            } => {
                let layout = board_layout(layout.as_deref(), positions.as_deref())?;
                json!(self.add_to_board(actor, board, notes, layout, now)?)
            }
            AgentOp::Connect {
                board,
                from,
                to,
                label,
            } => json!({ "edge": self.connect(actor, board, from, to, label.as_deref(), now)? }),
            AgentOp::Group {
                board,
                nodes,
                label,
            } => json!({ "section": self.group_on_board(actor, board, nodes, label, now)? }),
            AgentOp::BoardChanges { board, changes, .. } => {
                let applied = self.board_apply(actor, board, changes, now)?;
                // Only what an agent wrote by itself counts against its session.
                if let Actor::Agent { session, .. } = actor {
                    self.state()
                        .tallies
                        .entry(session.clone())
                        .or_default()
                        .took_off_cards(crate::board::removed_by(changes), now.millis);
                }
                json!({ "made": applied.made, "nodes": applied.board.nodes.len() })
            }
            AgentOp::EditDeck { .. } | AgentOp::CreateDeck { .. } => {
                self.deck_execute(actor, op, now)?
            }
            AgentOp::CreateDiagram { .. }
            | AgentOp::UpdateDiagram { .. }
            | AgentOp::EditDiagram { .. } => self.diagram_execute(actor, op, now)?,
            AgentOp::SaveSource { .. } => self.latex_execute(actor, op, now)?,
            AgentOp::CreateLatexDoc { .. }
            | AgentOp::AppendLatexFile { .. }
            | AgentOp::TrashLatexFile { .. } => self.latex_files_execute(actor, op, now)?,
            AgentOp::AddLatexAsset { .. }
            | AgentOp::CiteReference { .. }
            | AgentOp::SendPageToLatex { .. } => self.latex_more_execute(actor, op, now)?,
            AgentOp::ExportLatexPdf { .. } => self.latex_export_execute(actor, op, now)?,
            AgentOp::SmartCreate { .. } => self.smart_create_execute(actor, op, now)?,
            AgentOp::SmartWrite { .. } | AgentOp::SmartDelete { .. } => {
                self.smart_execute(actor, op, now)?
            }
            AgentOp::RequestSmartPages { .. } => self.smart_request_execute(actor, op, now)?,
            AgentOp::EditPage { .. } => self.page_execute(actor, op, now)?,
            AgentOp::Batch { ops, .. } => self.execute_batch(actor, ops, now)?,
            AgentOp::SetParent { .. }
            | AgentOp::ReorderChildren { .. }
            | AgentOp::CreateProject { .. }
            | AgentOp::SetProjectState { .. }
            | AgentOp::SetTagViews { .. } => self.structure_execute(actor, op, now)?,
            AgentOp::SetViewOrder { .. } => self.view_order_execute(actor, op, now)?,
            AgentOp::DuplicateNote { .. }
            | AgentOp::RestoreNote { .. }
            | AgentOp::SetNoteMeta { .. }
            | AgentOp::ApplyTemplate { .. }
            | AgentOp::JournalDay { .. }
            | AgentOp::SetTask { .. }
            | AgentOp::AddComment { .. }
            | AgentOp::ResolveComment { .. }
            | AgentOp::CreateCollection { .. }
            | AgentOp::UpdateCollection { .. }
            | AgentOp::AddReference { .. }
            | AgentOp::RenameDiagram { .. }
            | AgentOp::MoveDiagram { .. }
            | AgentOp::DuplicateDiagram { .. }
            | AgentOp::UndoSession { .. } => self.parity_execute(actor, op, now)?,
            AgentOp::SaveProjectSetup { .. } => self.setup_save_execute(actor, op, now)?,
        })
    }

    /// Writes a template as a whole file: a new one, or a change merged
    /// with edits made since it was proposed.
    fn write_template(
        &self,
        actor: &Actor,
        name: &str,
        text: &str,
        base: Option<&str>,
        now: Instant,
    ) -> Result<String> {
        let path = AgentOp::template_path(name)
            .ok_or_else(|| Error::Invalid("A template needs a name".to_owned()))?;
        self.apply(actor, "template", false, now.millis, |vault| {
            let file = vault.path_of(&path)?;
            match base {
                None => {
                    if let Some(dir) = file.parent() {
                        std::fs::create_dir_all(dir)?;
                    }
                    create_atomic(&file, text.as_bytes()).map_err(|err| {
                        if err.kind() == std::io::ErrorKind::AlreadyExists {
                            Error::Invalid(format!("A template called “{name}” already exists"))
                        } else {
                            err.into()
                        }
                    })?;
                }
                Some(base) => {
                    let current = std::fs::read_to_string(&file)?;
                    let merged = if current == base {
                        text.to_owned()
                    } else {
                        merge3(base, text, &current).ok_or_else(|| {
                            Error::Invalid(
                                "The template changed on the same lines since this was proposed"
                                    .to_owned(),
                            )
                        })?
                    };
                    write_atomic(&file, merged.as_bytes())?;
                }
            }
            Ok(Change {
                message: format!("template: {}", name.trim()),
                paths: vec![path.clone()],
                value: path.clone(),
            })
        })
    }

    /// A full rewrite written against `base`, merged with edits made since.
    fn rewrite(
        &self,
        actor: &Actor,
        path: &str,
        body: &str,
        base: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        self.merge_body(actor, "propose_edit", path, (base, body), now, |note| {
            format!("edit: {}", note.meta.title)
        })
    }

    /// An accepted section change as the reviewer saw it, `before` to
    /// `after`, merged with edits made since; refused where they overlap.
    pub(super) fn accept_section(
        &self,
        actor: &Actor,
        path: &str,
        heading: &str,
        (before, after): (&str, &str),
        now: Instant,
    ) -> Result<Value> {
        let heading = heading.trim().trim_start_matches('#').trim();
        let note = self.merge_body(
            actor,
            "replace_section",
            path,
            (before, after),
            now,
            |note| format!("section: {} § {heading}", note.meta.title),
        )?;
        Ok(note_ref(&note))
    }

    /// Writes `body`, written against `base`, into the note: as it is when
    /// the note still has `base`, else merged with what changed since.
    fn merge_body(
        &self,
        actor: &Actor,
        op: &str,
        path: &str,
        (base, body): (&str, &str),
        now: Instant,
        message: impl FnOnce(&NoteFile) -> String,
    ) -> Result<NoteFile> {
        self.apply(actor, op, false, now.millis, |vault| {
            let current = vault.read(path)?;
            let now_body = split(&current.text).body;
            let text = if now_body == base {
                body.to_owned()
            } else {
                merge3(base, body, now_body).ok_or_else(|| {
                    Error::Invalid(
                        "The note changed on the same lines since this was proposed".to_owned(),
                    )
                })?
            };
            let note = crate::ops::save_body(vault, path, &text, &current.hash, now)?
                .note()
                .clone();
            Ok(Change {
                message: message(&note),
                paths: vec![path.to_owned()],
                value: note,
            })
        })
    }
}
