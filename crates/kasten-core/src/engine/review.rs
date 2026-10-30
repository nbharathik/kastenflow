//! Proposals: writing one for review, accepting it (the op then runs as the
//! agent's, with `Approved-by`, through execute.rs) or rejecting it.
//! Decided proposals move to the archive.

use serde_json::Value;

use super::{Change, Kasten};
use crate::agent::{AgentOp, Proposal, ProposalStatus, Session, Target};
use crate::diff::unified;
use crate::error::Result;
use crate::frontmatter::split;
use crate::history::Actor;
use crate::id::ulid_at;
use crate::sections::{append_under, replace_section};
use crate::time::Instant;

/// What a reviewer sees: the note, its text before and after, and a diff
/// or a description.
pub(super) struct Preview {
    pub(super) target: Option<Target>,
    pub(super) before: Option<String>,
    pub(super) after: Option<String>,
    pub(super) diff: String,
}

impl Kasten {
    /// What a proposal shows a reviewer: the note, the text before and
    /// after, and a diff or a description.
    pub(super) fn preview(&self, op: &AgentOp) -> Result<Preview> {
        if let AgentOp::Batch { ops, .. } = op {
            return Ok(self.batch_preview(ops));
        }
        if let Some(deck) = self.deck_preview(op)? {
            return Ok(deck);
        }
        if let Some(diagram) = self.diagram_op_preview(op)? {
            return Ok(diagram);
        }
        if let Some(source) = self.latex_op_preview(op)? {
            return Ok(source);
        }
        if let Some(files) = self.latex_files_preview(op)? {
            return Ok(files);
        }
        if let Some(more) = self.latex_more_preview(op)? {
            return Ok(more);
        }
        if let Some(export) = self.latex_export_preview(op)? {
            return Ok(export);
        }
        if let Some(file) = self.smart_op_preview(op)? {
            return Ok(file);
        }
        if let Some(page) = self.page_op_preview(op)? {
            return Ok(page);
        }
        if let AgentOp::Template {
            name, text, base, ..
        } = op
        {
            let path = AgentOp::template_path(name).unwrap_or_default();
            let words = match base {
                None => format!("Make the template “{}”", name.trim()),
                Some(_) => format!("Change the template “{}”", name.trim()),
            };
            let diff = match base {
                Some(before) => unified(&path, before, text, 3),
                None => format!("{words}\n\n{}", unified(&path, "", text, 3)),
            };
            return Ok(Preview {
                target: Some(Target {
                    path,
                    title: name.trim().to_owned(),
                }),
                before: base.clone(),
                after: Some(text.clone()),
                diff,
            });
        }
        let note = op
            .path()
            .filter(|p| p.ends_with(".md"))
            .map(|p| self.vault.read(p))
            .transpose()?;
        let target = match (&note, op.path()) {
            (Some(n), _) => Some(Target {
                path: n.meta.path.clone(),
                title: n.meta.title.clone(),
            }),
            (None, Some(board)) => Some(Target {
                path: board.to_owned(),
                title: self
                    .board(board)
                    .map_or_else(|_| board.to_owned(), |b| b.title),
            }),
            (None, None) => None,
        };
        let body = note.as_ref().map(|n| split(&n.text).body.to_owned());
        let title = target.as_ref().map_or(String::new(), |t| t.title.clone());
        let (before, after, words) = match op {
            AgentOp::Append {
                markdown, heading, ..
            } => {
                let b = body.clone().unwrap_or_default();
                let after = append_under(&b, markdown, heading.as_deref())?;
                (Some(b), Some(after), String::new())
            }
            AgentOp::ReplaceSection {
                heading, markdown, ..
            } => {
                let b = body.clone().unwrap_or_default();
                let after = replace_section(&b, heading, markdown)?;
                (Some(b), Some(after), String::new())
            }
            AgentOp::Edit { body: new, .. } => (body.clone(), Some(new.clone()), String::new()),
            AgentOp::Capture { markdown, .. } => (
                None,
                Some(markdown.clone()),
                "Capture a new card".to_owned(),
            ),
            AgentOp::CreateNote { title, body, .. } => {
                (None, Some(body.clone()), format!("Create “{title}”"))
            }
            AgentOp::JournalAppend {
                date,
                markdown,
                heading,
            } => {
                let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
                let b = self
                    .vault
                    .read(&path)
                    .map(|n| split(&n.text).body.to_owned())
                    .unwrap_or_default();
                let after = append_under(&b, markdown, heading.as_deref())?;
                (
                    Some(b),
                    Some(after),
                    format!("Add to the journal for {date}"),
                )
            }
            AgentOp::TagSchema { tag, schema } => {
                let slug = crate::slug::slugify(tag);
                let old =
                    std::fs::read_to_string(self.vault.root().join(format!("tags/{slug}.yaml")))
                        .ok();
                let new = crate::tags::schema_yaml(tag, schema)?;
                (old, Some(new), format!("Change the schema of #{tag}"))
            }
            AgentOp::UpdateProps { props, .. } => {
                let lines: Vec<String> = props.iter().map(|(k, v)| format!("{k}: {v}")).collect();
                (
                    None,
                    None,
                    format!("Set on “{title}”: {}", lines.join(", ")),
                )
            }
            AgentOp::Tags { add, remove, .. } => (
                None,
                None,
                format!(
                    "On “{title}”, add tags [{}] and remove [{}]",
                    add.join(", "),
                    remove.join(", ")
                ),
            ),
            AgentOp::Rename { title: new, .. } => {
                (None, None, format!("Rename “{title}” to “{new}”"))
            }
            AgentOp::Move { project, .. } => (
                None,
                None,
                format!(
                    "Move “{title}” to {}",
                    project.as_deref().unwrap_or("the library")
                ),
            ),
            AgentOp::Trash { path, .. } if path.ends_with(".canvas") => {
                let text = std::fs::read_to_string(self.vault.file_of(path, &[".canvas"])?).ok();
                (text, None, format!("Move the board {path} to the trash"))
            }
            AgentOp::Trash { .. } => (body.clone(), None, format!("Move “{title}” to the trash")),
            // Shown before the note is read, above.
            AgentOp::Batch { .. }
            | AgentOp::Template { .. }
            | AgentOp::EditDeck { .. }
            | AgentOp::CreateDeck { .. }
            | AgentOp::CreateDiagram { .. }
            | AgentOp::UpdateDiagram { .. }
            | AgentOp::SaveSource { .. }
            | AgentOp::CreateLatexDoc { .. }
            | AgentOp::AppendLatexFile { .. }
            | AgentOp::TrashLatexFile { .. }
            | AgentOp::AddLatexAsset { .. }
            | AgentOp::CiteReference { .. }
            | AgentOp::ExportLatexPdf { .. }
            | AgentOp::SendPageToLatex { .. }
            | AgentOp::SmartCreate { .. }
            | AgentOp::SmartWrite { .. }
            | AgentOp::SmartDelete { .. }
            | AgentOp::EditPage { .. }
            | AgentOp::EditDiagram { .. } => (None, None, String::new()),
            AgentOp::RequestSmartPages { .. } => (None, None, self.smart_request_words(op)),
            AgentOp::SetParent { .. }
            | AgentOp::ReorderChildren { .. }
            | AgentOp::CreateProject { .. }
            | AgentOp::SetProjectState { .. }
            | AgentOp::SetTagViews { .. } => (None, None, self.structure_words(op, &title)),
            AgentOp::SetViewOrder { .. } => (None, None, self.view_order_words(op)),
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
            | AgentOp::UndoSession { .. } => (None, None, self.parity_words(op, &title)),
            AgentOp::SaveProjectSetup { .. } => (None, None, self.setup_save_words(op)),
            AgentOp::CreateBoard { title, .. } => {
                (None, None, format!("Create the board “{title}”"))
            }
            AgentOp::AddToBoard { board, notes, .. } => (
                None,
                None,
                format!("Put {} notes on {board}: {}", notes.len(), notes.join(", ")),
            ),
            AgentOp::Connect {
                board,
                from,
                to,
                label,
            } => (
                None,
                None,
                format!(
                    "On {board}, connect {from} → {to}{}",
                    label.as_ref().map_or(String::new(), |l| format!(" ({l})"))
                ),
            ),
            AgentOp::Group {
                board,
                nodes,
                label,
            } => (
                None,
                None,
                format!(
                    "On {board}, make a section “{label}” around {}",
                    nodes.join(", ")
                ),
            ),
            AgentOp::BoardChanges {
                board,
                changes,
                summary,
            } => (
                None,
                None,
                if summary.trim().is_empty() {
                    format!(
                        "On {board}, {} changes, taking {} off",
                        changes.len(),
                        crate::board::removed_by(changes)
                    )
                } else {
                    format!("On {board}: {}", summary.trim())
                },
            ),
        };
        let name = target.as_ref().map_or("new note", |t| t.path.as_str());
        let diff = match (&before, &after) {
            (Some(b), Some(a)) if words.is_empty() => unified(name, b, a, 3),
            (b, a) if !words.is_empty() && a.is_some() => {
                format!(
                    "{words}\n\n{}",
                    unified(
                        name,
                        b.as_deref().unwrap_or(""),
                        a.as_deref().unwrap_or(""),
                        3
                    )
                )
            }
            _ => words,
        };
        Ok(Preview {
            target,
            before,
            after,
            diff,
        })
    }

    /// Keeps an op for review; returns the proposal's id.
    pub(crate) fn propose(
        &self,
        session: &Session,
        op: &AgentOp,
        reason: &str,
        now: Instant,
    ) -> Result<String> {
        let Preview {
            target,
            before,
            after,
            diff,
        } = self.preview(op)?;
        let note = match op {
            AgentOp::Trash { reason, .. }
            | AgentOp::Batch { reason, .. }
            | AgentOp::Edit { reason, .. }
            | AgentOp::EditDiagram { reason, .. }
            | AgentOp::SaveSource { reason, .. }
            | AgentOp::CreateLatexDoc { reason, .. }
            | AgentOp::AppendLatexFile { reason, .. }
            | AgentOp::TrashLatexFile { reason, .. }
            | AgentOp::CiteReference { reason, .. }
            | AgentOp::ExportLatexPdf { reason, .. }
            | AgentOp::SendPageToLatex { reason, .. }
            | AgentOp::SmartCreate { reason, .. }
            | AgentOp::SmartWrite { reason, .. }
            | AgentOp::SmartDelete { reason, .. }
            | AgentOp::EditPage { reason, .. }
            | AgentOp::UpdateDiagram { reason, .. } => reason.clone(),
            AgentOp::RequestSmartPages { reason, .. } => Some(reason.trim().to_owned()),
            _ => None,
        };
        let proposal = Proposal {
            id: ulid_at(now.millis),
            created: now.rfc3339(),
            session: session.id.clone(),
            client: session.client.clone(),
            status: ProposalStatus::Pending,
            op: op.clone(),
            target,
            reason: reason.to_owned(),
            note,
            diff,
            before,
            after,
            decided: None,
            decided_by: None,
        };
        let rel = Proposal::pending_path(&proposal.id);
        self.apply(&session.actor(), "propose", false, now.millis, |vault| {
            proposal.write(vault.root(), &rel)?;
            Ok(Change {
                message: format!("propose: {}", proposal.summary()),
                paths: vec![rel.clone()],
                value: proposal.id.clone(),
            })
        })
    }

    /// Proposals waiting for review, oldest first.
    pub fn proposals(&self) -> Result<Vec<Proposal>> {
        Proposal::pending(self.vault.root())
    }

    /// Applies a proposal as its agent's change, approved by `by`.
    pub fn accept_proposal(&self, id: &str, by: &str, now: Instant) -> Result<Value> {
        // One decision at a time: a proposal decided twice at once is found
        // pending only once.
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut proposal = Proposal::read(self.vault.root(), id)?;
        self.refusals(&proposal.op)?;
        let actor = Actor::Approved {
            client: proposal.client.clone(),
            session: proposal.session.clone(),
            by: by.to_owned(),
        };
        let value = match (&proposal.op, &proposal.before, &proposal.after) {
            // What the reviewer saw, never what the section holds now.
            (AgentOp::ReplaceSection { path, heading, .. }, Some(before), Some(after)) => {
                self.accept_section(&actor, path, heading, (before, after), now)?
            }
            (op, ..) => self.execute(&actor, op, now)?,
        };
        proposal.status = ProposalStatus::Accepted;
        self.archive(&actor, proposal, by, "accept", now)?;
        Ok(value)
    }

    /// Declines a proposal; it stays in the archive.
    pub fn reject_proposal(&self, id: &str, by: &str, now: Instant) -> Result<()> {
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut proposal = Proposal::read(self.vault.root(), id)?;
        proposal.status = ProposalStatus::Rejected;
        self.archive(&Actor::Human, proposal, by, "reject", now)
    }

    fn archive(
        &self,
        actor: &Actor,
        mut proposal: Proposal,
        by: &str,
        verb: &str,
        now: Instant,
    ) -> Result<()> {
        proposal.decided = Some(now.rfc3339());
        proposal.decided_by = Some(by.to_owned());
        let from = Proposal::pending_path(&proposal.id);
        let to = Proposal::archive_path(&proposal.id);
        self.apply(actor, verb, false, now.millis, |vault| {
            let root = vault.root();
            std::fs::create_dir_all(root.join(&to).parent().unwrap_or(root))?;
            // A move, then the decision written into the moved file.
            std::fs::rename(root.join(&from), root.join(&to))?;
            proposal.write(root, &to)?;
            Ok(Change {
                message: format!("{verb}: {}", proposal.summary()),
                paths: vec![from.clone(), to.clone()],
                value: (),
            })
        })
    }
}
