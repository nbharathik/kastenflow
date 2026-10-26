//! What a reviewer reads of a parity op in a proposal: one plain sentence.

use super::Kasten;
use crate::agent::AgentOp;
use crate::frontmatter::split;

/// A quoted name, shortened to one line.
fn quoted(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    if line.chars().count() > 60 {
        let cut: String = line.chars().take(57).collect();
        format!("“{cut}…”")
    } else {
        format!("“{line}”")
    }
}

impl Kasten {
    /// " (Plans, Tasks and 2 more)": the first notes a session changed, so a
    /// reviewer of a held undo sees which notes come back. Empty when the
    /// digest cannot say.
    fn session_notes_words(&self, session: &str, started: u64) -> String {
        const SHOWN: usize = 3;
        let Ok(digest) = self.activity_digest(started.saturating_sub(1)) else {
            return String::new();
        };
        let Some(found) = digest.sessions.into_iter().find(|s| s.id == session) else {
            return String::new();
        };
        let names: Vec<String> = found
            .notes
            .iter()
            .take(SHOWN)
            .map(|path| {
                self.vault.read(path).map_or_else(
                    |_| {
                        let file = path.rsplit('/').next().unwrap_or(path);
                        file.trim_end_matches(".md").to_owned()
                    },
                    |note| note.meta.title,
                )
            })
            .collect();
        if names.is_empty() {
            return String::new();
        }
        let more = found.notes_touched.saturating_sub(names.len());
        let list = names
            .iter()
            .map(|n| quoted(n))
            .collect::<Vec<_>>()
            .join(", ");
        if more > 0 {
            format!(" ({list} and {more} more)")
        } else {
            format!(" ({list})")
        }
    }

    /// `title` is the title of the note the op names, when it names one.
    pub(super) fn parity_words(&self, op: &AgentOp, title: &str) -> String {
        let diagram = |path: &str| quoted(&crate::diagrams::title_of(path));
        match op {
            AgentOp::DuplicateNote { .. } => format!("Make a copy of {}", quoted(title)),
            AgentOp::RestoreNote { path } => {
                let name = self
                    .list_trash()
                    .ok()
                    .and_then(|all| all.into_iter().find(|t| t.trashed == *path))
                    .map_or_else(|| path.clone(), |t| t.title);
                format!("Put {} back from the trash", quoted(&name))
            }
            AgentOp::SetNoteMeta { key, value, .. } => match value {
                Some(value) => format!("Set the {key} of {} to {value}", quoted(title)),
                None => format!("Take the {key} off {}", quoted(title)),
            },
            AgentOp::ApplyTemplate { template, .. } => format!(
                "Fill {} from the template {}",
                quoted(title),
                quoted(template)
            ),
            AgentOp::JournalDay { date } => format!("Open the journal for {date}"),
            AgentOp::SetTask {
                path, line, done, ..
            } => {
                let text = self
                    .vault
                    .read(path)
                    .ok()
                    .and_then(|note| {
                        crate::extract::extract(split(&note.text).body)
                            .tasks
                            .into_iter()
                            .find(|t| t.line == *line as usize)
                            .map(|t| t.text)
                    })
                    .unwrap_or_else(|| format!("line {line}"));
                let verb = if *done { "Tick" } else { "Untick" };
                format!("{verb} the to-do {} on {}", quoted(&text), quoted(title))
            }
            AgentOp::AddComment { text, .. } => {
                format!("Comment on {}: {}", quoted(title), quoted(text))
            }
            AgentOp::ResolveComment { resolved, .. } => {
                let verb = if *resolved { "Resolve" } else { "Reopen" };
                format!("{verb} a comment on {}", quoted(title))
            }
            AgentOp::CreateCollection { name, .. } => format!("Save the search {}", quoted(name)),
            AgentOp::UpdateCollection { path, .. } => {
                let name = self
                    .collection(path)
                    .map_or_else(|_| path.clone(), |found| found.name);
                format!("Change the saved search {}", quoted(&name))
            }
            AgentOp::AddReference { key, kind, .. } => {
                format!("Add the {kind} reference {key} to the bibliography")
            }
            AgentOp::RenameDiagram { path, title } => {
                format!("Rename the diagram {} to {}", diagram(path), quoted(title))
            }
            AgentOp::MoveDiagram { path, project } => format!(
                "Move the diagram {} to {}",
                diagram(path),
                project.as_deref().unwrap_or("the library")
            ),
            AgentOp::DuplicateDiagram { path } => format!("Copy the diagram {}", diagram(path)),
            AgentOp::UndoSession { session } => {
                let who = self
                    .sessions(200)
                    .ok()
                    .and_then(|all| all.into_iter().find(|s| s.id == *session));
                match who {
                    Some(info) => format!(
                        "Take back the {} changes of the session of {}{}",
                        info.commits,
                        info.client,
                        self.session_notes_words(&info.id, info.started)
                    ),
                    None => "Take back the changes of another session".to_owned(),
                }
            }
            _ => String::new(),
        }
    }
}
