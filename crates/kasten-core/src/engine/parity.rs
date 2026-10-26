//! The parity ops of agents: what a person does with the page menu, the
//! journal, to-dos, comments, saved searches, the bibliography, diagram files
//! and the history, as ops that go through the modes like the rest. What is
//! refused is in parity_refusals.rs, what a reviewer reads in parity_words.rs.

use serde_json::{Value, json};

use super::boards::project_of;
use super::execute::{day_of, note_ref};
use super::{Change, Kasten};
use crate::agent::{AgentOp, Session};
use crate::bib::NewReference;
use crate::comments::NewComment;
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::history::Actor;
use crate::note::NoteFile;
use crate::policy::OpClass;
use crate::time::Instant;

/// Where a path in the trash was before: `.trash/<stamp>/<path>` is `<path>`.
fn original_of(path: &str) -> &str {
    path.strip_prefix(".trash/")
        .and_then(|rest| rest.split_once('/'))
        .map_or(path, |(_, original)| original)
}

fn to_json(value: impl serde::Serialize) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| Error::Invalid(e.to_string()))
}

/// `body` with the to-do on `line` (from 0) ticked or unticked, changing
/// that one checkbox and nothing else; none when it is so already. Refused
/// when the line is not a to-do.
pub(super) fn tick_in_body(body: &str, line: u32, done: bool) -> Result<Option<String>> {
    let tasks = crate::extract::extract(body).tasks;
    let at = line as usize;
    let Some(task) = tasks.iter().find(|t| t.line == at) else {
        let lines: Vec<String> = tasks.iter().map(|t| t.line.to_string()).collect();
        return Err(Error::Invalid(if lines.is_empty() {
            format!("Line {line} is not a to-do; this note has none")
        } else {
            format!(
                "Line {line} is not a to-do; its to-dos are on lines {}",
                lines.join(", ")
            )
        }));
    };
    if task.done == done {
        return Ok(None);
    }
    let mut out = String::with_capacity(body.len());
    for (i, text) in body.split_inclusive('\n').enumerate() {
        if i != at {
            out.push_str(text);
            continue;
        }
        let from = text.find('[');
        match from.and_then(|f| text.get(f..f + 3).map(|box_| (f, box_))) {
            Some((f, "[ ]" | "[x]" | "[X]")) => {
                out.push_str(&text[..f]);
                out.push_str(if done { "[x]" } else { "[ ]" });
                out.push_str(&text[f + 3..]);
            }
            _ => {
                return Err(Error::Invalid(format!(
                    "Line {line} has no check box to change"
                )));
            }
        }
    }
    Ok(Some(out))
}

impl Kasten {
    /// Ticks or unticks a to-do of a note, if the note is still as `base`
    /// says; changes that one check box.
    pub(super) fn set_task(
        &self,
        actor: &Actor,
        path: &str,
        line: u32,
        done: bool,
        base: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        self.apply(actor, "set_task", false, now.millis, |vault| {
            let current = vault.read(path)?;
            if current.hash != base {
                return Err(Error::Invalid(format!(
                    "“{}” changed since you read it. Read its to-dos again and tick the one you mean once more",
                    current.meta.title
                )));
            }
            let Some(body) = tick_in_body(split(&current.text).body, line, done)? else {
                return Ok(Change {
                    value: current,
                    paths: Vec::new(),
                    message: String::new(),
                });
            };
            let note = crate::ops::save_body(vault, path, &body, &current.hash, now)?
                .note()
                .clone();
            Ok(Change {
                message: format!("task: {}", note.meta.title),
                paths: vec![path.to_owned()],
                value: note,
            })
        })
    }

    /// Which parity ops wait for review whoever is trusted: a reference added
    /// to the bibliography, and another session's changes taken back.
    pub(super) fn parity_review_reason(&self, session: &Session, op: &AgentOp) -> Result<OpClass> {
        Ok(match op {
            AgentOp::AddReference { .. } => OpClass::Always(
                "A reference added to the bibliography always waits for review".to_owned(),
            ),
            AgentOp::UndoSession { session: target } if *target != session.id => OpClass::Always(
                "Taking back another session's changes always waits for review".to_owned(),
            ),
            _ => OpClass::Ordinary,
        })
    }

    /// The trailers that say an undo was an agent's, and in what mode: the
    /// revert itself is committed as the person's.
    fn undone_by(&self, actor: &Actor) -> Vec<(&'static str, String)> {
        match actor {
            Actor::Human => Vec::new(),
            Actor::Agent { client, session } => {
                self.mode_trailers(actor, &[("Kasten-Agent", format!("{client} {session}"))])
            }
            Actor::Approved {
                client,
                session,
                by,
            } => vec![
                ("Kasten-Agent", format!("{client} {session}")),
                ("Approved-by", by.clone()),
            ],
        }
    }

    /// The projects a parity op touches beyond those its own path is in, for
    /// the mode that holds: a page restored goes back where it was, a diagram
    /// moved goes into a project, an undone session changed what it changed.
    pub(super) fn parity_projects(&self, op: &AgentOp) -> Result<Vec<Option<String>>> {
        Ok(match op {
            AgentOp::RestoreNote { path } => vec![project_of(original_of(path))],
            AgentOp::MoveDiagram { project, .. } => vec![project.clone()],
            AgentOp::UndoSession { session } => {
                let mut out = Vec::new();
                for commit in self.session_commits_left(session)? {
                    for changed in self.commit_changes(&commit)? {
                        out.push(project_of(original_of(&changed.path)));
                    }
                }
                out
            }
            _ => Vec::new(),
        })
    }

    /// The paths a parity op changes that exist now, and how many new files it
    /// makes, for the limit on notes changed in ten minutes.
    pub(super) fn parity_touches(&self, op: &AgentOp) -> Result<(Vec<String>, usize)> {
        Ok(match op {
            AgentOp::JournalDay { date } => {
                let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
                if self.vault.exists(&path) {
                    (vec![], 0)
                } else {
                    (vec![], 1)
                }
            }
            _ => (vec![], 1),
        })
    }

    pub(super) fn parity_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        Ok(match op {
            AgentOp::DuplicateNote { path } => note_ref(&self.duplicate(actor, path, now)?),
            AgentOp::RestoreNote { path } => note_ref(&self.restore_trashed(actor, path)?),
            AgentOp::SetNoteMeta { path, key, value } => {
                note_ref(&self.set_meta(actor, path, key, value.as_deref(), now)?)
            }
            AgentOp::ApplyTemplate {
                path,
                template,
                date,
            } => {
                let day = date.clone().unwrap_or_else(|| day_of(now));
                note_ref(&self.apply_template(actor, path, template, &day, now)?)
            }
            AgentOp::JournalDay { date } => note_ref(&self.journal(actor, date, now)?),
            AgentOp::SetTask {
                path,
                line,
                done,
                base,
            } => {
                let note = self.set_task(actor, path, *line, *done, base, now)?;
                json!({
                    "path": note.meta.path,
                    "title": note.meta.title,
                    "line": line,
                    "done": done,
                    "hash": note.hash,
                })
            }
            AgentOp::AddComment { path, anchor, text } => to_json(self.add_comment(
                actor,
                path,
                &NewComment {
                    anchor: anchor.clone(),
                    text: text.clone(),
                },
                now,
            )?)?,
            AgentOp::ResolveComment { path, id, resolved } => {
                to_json(self.resolve_comment(actor, path, id, *resolved, now)?)?
            }
            AgentOp::CreateCollection { name, edits } => {
                to_json(self.create_collection_as(actor, name, edits, now)?)?
            }
            AgentOp::UpdateCollection { path, edits, base } => {
                to_json(self.update_collection_as(actor, path, edits, base, now)?)?
            }
            AgentOp::AddReference {
                kind,
                key,
                fields,
                allow_duplicate,
            } => {
                let reference = NewReference {
                    kind: kind.clone(),
                    key: key.clone(),
                    fields: fields.clone(),
                    allow_duplicate: *allow_duplicate,
                };
                let base = self.bibliography()?.managed.hash;
                to_json(self.add_reference_as(actor, &reference, &base, now)?)?
            }
            AgentOp::RenameDiagram { path, title } => {
                let moved = self.rename_diagram(actor, path, title, now)?;
                json!({ "path": moved.path, "relinked": moved.relinked })
            }
            AgentOp::MoveDiagram { path, project } => {
                let moved = self.move_diagram(actor, path, project.as_deref(), now)?;
                json!({ "path": moved.path, "relinked": moved.relinked })
            }
            AgentOp::DuplicateDiagram { path } => {
                json!({ "path": self.duplicate_diagram(actor, path, now)? })
            }
            AgentOp::UndoSession { session } => {
                let by = self.undone_by(actor);
                to_json(self.undo_session_with(session, now, &by)?)?
            }
            other => {
                return Err(Error::Invalid(format!(
                    "{} is not one of these ops",
                    other.name()
                )));
            }
        })
    }
}
