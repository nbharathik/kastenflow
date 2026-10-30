//! What agents may do with the structure ops: what is refused in every mode,
//! which ops wait for review and why, which files they touch (for the limit on
//! notes changed in ten minutes), what the agent is told when one runs, and
//! what a reviewer reads. The ops themselves are in structure.rs.

use serde_json::{Map, Value, json};

use super::Kasten;
use super::execute::note_ref;
use super::setup_plan::plan_setup;
use super::setup_saved::file_count;
use super::setups::SetupTarget;
use super::structure::project_title;
use super::tag_lists::{check_views, shown};
use crate::agent::{AgentOp, Session};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::moving::subtree;
use crate::policy::OpClass;
use crate::structure::check_nesting;
use crate::time::Instant;

/// The properties of a project page that `set_project_state` keeps.
const STATE_KEYS: [&str; 5] = [
    "status",
    "health",
    "next_action",
    "last_review",
    "review_after",
];

fn tag_name(tag: &str) -> &str {
    tag.trim().trim_start_matches('#').trim()
}

/// Refuses `update_props` naming the keys of a project's state on a project
/// page: those are set with `set_project_state`, which checks them.
pub(super) fn state_keys_refused(path: &str, props: &Map<String, Value>) -> Result<()> {
    // On a disk that ignores case (Windows, macOS) `Projects/x/_Project.md` is the same file.
    let lower = path.to_lowercase();
    let parts: Vec<&str> = lower.split('/').collect();
    if !matches!(parts.as_slice(), ["projects", folder, "_project.md"] if !folder.is_empty()) {
        return Ok(());
    }
    match props.keys().find(|key| {
        STATE_KEYS
            .iter()
            .any(|s| s.eq_ignore_ascii_case(key.trim()))
    }) {
        Some(key) => Err(Error::Invalid(format!(
            "“{key}” is part of a project's state; use set_project_state to change its status, health, next action and review days"
        ))),
        None => Ok(()),
    }
}

impl Kasten {
    /// Refusals for the structure ops that no mode or trust lifts. The note an
    /// op names has been checked for a lock already (`refusals_with`).
    pub(super) fn structure_refusals(
        &self,
        op: &AgentOp,
        staged_new: &dyn Fn(&str) -> bool,
    ) -> Result<()> {
        match op {
            AgentOp::SetParent { path, parent } => {
                self.set_parent_refusals(path, parent.as_deref(), staged_new)
            }
            AgentOp::ReorderChildren { parent, .. } => {
                let holder = self.vault.read(parent)?;
                if holder.meta.kind != "page" {
                    return Err(Error::Invalid(format!(
                        "Only a page has sub-pages to put in order, not a {} note",
                        holder.meta.kind
                    )));
                }
                Ok(())
            }
            AgentOp::CreateProject { title, setup } => {
                let title = project_title(title)?;
                if let Some(id) = setup {
                    plan_setup(&self.vault, id, &SetupTarget::New { title })?;
                }
                Ok(())
            }
            AgentOp::SetProjectState { path, state } => self.check_project_state(path, state),
            AgentOp::SetTagViews { tag, views } => self.tag_views_refusals(tag_name(tag), views),
            AgentOp::UpdateProps { path, props } => state_keys_refused(path, props),
            _ => Ok(()),
        }
    }

    /// Whether an agent may put the page at `path` inside `parent` (or take it
    /// out of its page): the page and everything that moves with it are not
    /// locked, the parent is not locked and may hold it, and no locked note
    /// links to a title that a move could rewrite.
    pub(super) fn set_parent_refusals(
        &self,
        path: &str,
        parent: Option<&str>,
        staged_new: &dyn Fn(&str) -> bool,
    ) -> Result<()> {
        let writable = |p: &str| {
            if staged_new(p) {
                Self::writable_form(p)
            } else {
                self.writable(p)
            }
        };
        let notes = self.index().notes()?;
        let Some(note) = notes.iter().find(|n| n.path == path) else {
            return Err(Error::NotFound(path.to_owned()));
        };
        // Taking a page out of its page changes only that page; the page it
        // leaves is not written, so only the page itself must be unlocked.
        writable(path)?;
        let Some(parent) = parent else {
            return check_nesting(&notes, note, None);
        };
        writable(parent)?;
        let Some(holder) = notes.iter().find(|n| n.path == parent) else {
            // A page only a chat's staged changes have: judged when it exists.
            return if staged_new(parent) {
                Ok(())
            } else {
                Err(Error::NotFound(parent.to_owned()))
            };
        };
        check_nesting(&notes, note, Some(holder))?;
        for moved in subtree(&notes, note) {
            writable(&moved.path)?;
            self.no_locked_links(&moved.title, &moved.path, "move it")?;
        }
        Ok(())
    }

    /// The checks of a tag's views from an agent: the views can be shown, and
    /// the tag has a schema (making one is `update_tag_schema`).
    pub(super) fn tag_views_refusals(&self, name: &str, views: &[Value]) -> Result<()> {
        if !name.chars().any(char::is_alphanumeric) {
            return Err(Error::Invalid(format!("Not a tag name: “{name}”")));
        }
        check_views(name, views)?;
        if !self
            .tag_schemas()?
            .iter()
            .any(|schema| schema.name.eq_ignore_ascii_case(name))
        {
            return Err(Error::Invalid(format!(
                "There is no schema for the tag “{name}” yet. update_tag_schema makes one, and it waits for review"
            )));
        }
        Ok(())
    }

    /// How the structure ops count for the modes: a project from a setup that
    /// would make tag schemas always waits (as a schema does), and leaving out
    /// a view the tag shows waits unless a person trusted the session.
    pub(super) fn structure_review_reason(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<OpClass> {
        match op {
            AgentOp::CreateProject {
                title,
                setup: Some(id),
            } => {
                let target = SetupTarget::New {
                    title: title.trim().to_owned(),
                };
                let planned = plan_setup(&self.vault, id, &target)?;
                let schemas = planned
                    .files
                    .iter()
                    .zip(&planned.exists)
                    .any(|((path, _), exists)| !exists && path.starts_with("tags/"));
                Ok(if schemas {
                    OpClass::Always(format!(
                        "The “{id}” setup makes tag schemas, and a schema made by an agent always waits for review"
                    ))
                } else {
                    OpClass::Ordinary
                })
            }
            AgentOp::SetTagViews { tag, views } if !self.trusted(&session.id, now) => {
                let name = tag_name(tag);
                let kept: Vec<String> = views
                    .iter()
                    .filter_map(|v| v.get("name").and_then(Value::as_str))
                    .map(|n| n.trim().to_lowercase())
                    .collect();
                let Some(schema) = self
                    .tag_schemas()?
                    .into_iter()
                    .find(|s| s.name.eq_ignore_ascii_case(name))
                else {
                    return Ok(OpClass::Ordinary);
                };
                let gone: Vec<String> = schema
                    .views
                    .iter()
                    .filter(|view| shown(view))
                    .filter_map(|view| view.get("name").and_then(Value::as_str))
                    .filter(|n| !kept.contains(&n.trim().to_lowercase()))
                    .map(|n| format!("“{}”", n.trim()))
                    .collect();
                // A view that is kept but comes back without a setting it had
                // (its sort, filter, grouping) loses that setting as surely.
                let stripped: Vec<String> = schema
                    .views
                    .iter()
                    .filter(|view| shown(view))
                    .filter_map(|old| {
                        let name = old.get("name")?.as_str()?.trim();
                        let now = views.iter().find(|v| {
                            v.get("name")
                                .and_then(Value::as_str)
                                .is_some_and(|n| n.trim().eq_ignore_ascii_case(name))
                        })?;
                        let (old, now) = (old.as_object()?, now.as_object()?);
                        old.keys()
                            .any(|key| !now.contains_key(key))
                            .then(|| format!("“{name}”"))
                    })
                    .collect();
                Ok(if !gone.is_empty() {
                    OpClass::Soft(format!(
                        "Takes the view {} off #{} (a view an agent leaves out waits for review)",
                        gone.join(", "),
                        schema.name
                    ))
                } else if !stripped.is_empty() {
                    OpClass::Soft(format!(
                        "Takes settings off the view {} of #{} (a view that loses its sort, filter or grouping waits for review)",
                        stripped.join(", "),
                        schema.name
                    ))
                } else {
                    OpClass::Ordinary
                })
            }
            _ => Ok(OpClass::Ordinary),
        }
    }

    /// The paths a structure op changes that exist now, and how many new files
    /// it makes, for the limit on notes changed in ten minutes.
    pub(super) fn structure_touches(&self, op: &AgentOp) -> Result<(Vec<String>, usize)> {
        Ok(match op {
            // The page and its sub-pages, which move and so get new paths, and
            // the parent, which may be given an id.
            AgentOp::SetParent {
                path,
                parent: Some(parent),
            } => {
                let notes = self.list()?;
                let mut tree: Vec<String> = match notes.iter().find(|n| n.path == *path) {
                    Some(root) => subtree(&notes, root).into_iter().map(|n| n.path).collect(),
                    None => vec![path.clone()],
                };
                let moved = tree.len();
                tree.push(parent.clone());
                (tree, moved)
            }
            AgentOp::SetParent { path, parent: None } => (vec![path.clone()], 0),
            // The page, and a setup's files.
            AgentOp::CreateProject { setup, .. } => {
                let files = setup.as_deref().map_or(0, |id| file_count(&self.vault, id));
                (vec![], 1 + files)
            }
            other => match other.path() {
                Some(path) => (vec![path.to_owned()], 0),
                None => (vec![], 0),
            },
        })
    }

    /// Runs a structure op as `actor`: what the agent is told comes back.
    pub(super) fn structure_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        Ok(match op {
            AgentOp::SetParent { path, parent } => {
                let placed = self.set_parent(actor, path, parent.as_deref(), now)?;
                json!({
                    "path": placed.note.meta.path,
                    "id": placed.note.meta.id,
                    "title": placed.note.meta.title,
                    "parent": placed.note.meta.parent,
                    "moved": placed.moves,
                })
            }
            AgentOp::ReorderChildren { parent, ids } => {
                let note = self.reorder_children(actor, parent, ids, now)?;
                json!({ "path": note.meta.path, "children": note.meta.children_order })
            }
            AgentOp::CreateProject { title, setup } => {
                let made = self.create_project(actor, title, setup.as_deref(), now)?;
                serde_json::to_value(made).map_err(|e| Error::Invalid(e.to_string()))?
            }
            AgentOp::SetProjectState { path, state } => {
                note_ref(&self.set_project_state(actor, path, state, now)?)
            }
            AgentOp::SetTagViews { tag, views } => {
                let schema = self.set_tag_views(actor, tag, views, now)?;
                json!({ "path": schema.path, "views": schema.views })
            }
            other => {
                return Err(Error::Invalid(format!(
                    "{} is not a structure change",
                    other.name()
                )));
            }
        })
    }

    /// What a reviewer reads of a structure op. `title` is the title of the
    /// note the op names, when it names one.
    pub(super) fn structure_words(&self, op: &AgentOp, title: &str) -> String {
        let titled = |path: &str| {
            self.vault
                .read(path)
                .map_or_else(|_| path.to_owned(), |note| note.meta.title)
        };
        match op {
            AgentOp::SetParent {
                parent: Some(parent),
                ..
            } => format!("Put “{title}” inside the page “{}”", titled(parent)),
            AgentOp::SetParent { parent: None, .. } => {
                format!("Take “{title}” out of the page it is in")
            }
            AgentOp::ReorderChildren { ids, .. } if ids.is_empty() => {
                format!("Put the sub-pages of “{title}” back in alphabetical order")
            }
            AgentOp::ReorderChildren { ids, .. } => {
                let notes = self.list().unwrap_or_default();
                let names: Vec<String> = ids
                    .iter()
                    .filter_map(|id| notes.iter().find(|n| n.id.as_deref() == Some(id.as_str())))
                    .map(|n| format!("“{}”", n.title))
                    .collect();
                format!(
                    "Put the sub-pages of “{title}” in this order: {}, then the rest by title",
                    names.join(", ")
                )
            }
            AgentOp::CreateProject { title, setup } => match setup {
                Some(id) => format!(
                    "Create the project “{}” from the “{id}” setup",
                    title.trim()
                ),
                None => format!("Create the project “{}”", title.trim()),
            },
            AgentOp::SetProjectState { state, .. } => {
                let said = |name: &str, value: &Option<Option<String>>| match value {
                    None => None,
                    Some(None) => Some(format!("no {name}")),
                    Some(Some(v)) => Some(format!("{name} {v}")),
                };
                let parts: Vec<String> = [
                    said("status", &state.status),
                    said("health", &state.health),
                    said("next action", &state.next_action),
                    said("reviewed", &state.reviewed),
                    said("review after", &state.review_after),
                ]
                .into_iter()
                .flatten()
                .collect();
                format!("Set “{title}”: {}", parts.join(", "))
            }
            AgentOp::SetTagViews { tag, views } => {
                let names: Vec<&str> = views
                    .iter()
                    .filter_map(|v| v.get("name").and_then(Value::as_str))
                    .collect();
                format!(
                    "Show these views on #{}: {}",
                    tag_name(tag),
                    names.join(", ")
                )
            }
            _ => String::new(),
        }
    }
}
