//! A project page's state: its status, health, next action and review days.
//! They are plain properties of the page (`status`, `health`, `next_action`,
//! `last_review`, `review_after` in its `props:`), but changed through one op
//! that checks every value against a fixed vocabulary, and the page's own
//! tags, before it writes anything, and commits the change once. The next
//! action is a `task` note, kept by its id (the note is given one in the same
//! commit if it has none).

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use super::{Change, Kasten};
use crate::atomic::write_atomic;
use crate::dates::is_real_day;
use crate::error::{Error, Result};
use crate::frontmatter::{join, set_key, split, still_readable};
use crate::history::Actor;
use crate::note::NoteFile;
use crate::ops::{ensure_id, eol_of};
use crate::props::{props_of, set_props};
use crate::tags::{check_props, load_schemas};
use crate::time::Instant;

/// What a project is doing. A page with no status is Active.
pub const STATUSES: [&str; 3] = ["Active", "Paused", "Done"];
/// How a project is going.
pub const HEALTHS: [&str; 3] = ["On track", "At risk", "Blocked"];

/// `None` when the key is absent, `Some(None)` when it is `null`.
fn present<'de, D: Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

/// A change to a project page's state. A field left `None` stays as it is;
/// `Some(None)` takes the key away; `Some(Some(value))` sets it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectState {
    /// Active, Paused or Done.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<Option<String>>,
    /// On track, At risk or Blocked.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub health: Option<Option<String>>,
    /// The `task` note the project does next: its path, id or title.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub next_action: Option<Option<String>>,
    /// The day of the last review, `YYYY-MM-DD`.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub reviewed: Option<Option<String>>,
    /// The day the next review is due, `YYYY-MM-DD`.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub review_after: Option<Option<String>>,
}

/// Whether `path` is a project's page: `projects/<folder>/_project.md`.
pub(crate) fn is_project_page(path: &str) -> bool {
    let mut parts = path.split('/');
    parts.next() == Some("projects")
        && parts.next().is_some_and(|folder| !folder.is_empty())
        && parts.next() == Some("_project.md")
        && parts.next().is_none()
}

/// `value` as spelled in `allowed`, whatever its case.
fn word(value: &str, allowed: &[&str], what: &str) -> Result<String> {
    allowed
        .iter()
        .find(|a| a.eq_ignore_ascii_case(value.trim()))
        .map(|a| (*a).to_owned())
        .ok_or_else(|| {
            Error::Invalid(format!(
                "A project's {what} is one of: {}",
                allowed.join(", ")
            ))
        })
}

fn day(value: &str, what: &str) -> Result<String> {
    let value = value.trim();
    if is_real_day(value) {
        Ok(value.to_owned())
    } else {
        Err(Error::Invalid(format!(
            "The {what} is a day written YYYY-MM-DD, not “{value}”"
        )))
    }
}

/// Where a change collects what it will set and what it will say in its commit.
type Collected<'a> = (&'a mut Map<String, Value>, &'a mut Vec<String>);

/// One field of a change: left alone, taken away (`gone` is what the commit
/// says) or set to the checked value (`line` is what the commit says).
fn field(
    (changes, said): &mut Collected<'_>,
    key: &str,
    value: &Option<Option<String>>,
    check: impl Fn(&str) -> Result<String>,
    line: impl Fn(&str) -> String,
    gone: &str,
) -> Result<()> {
    match value {
        None => {}
        Some(None) => {
            changes.insert(key.to_owned(), Value::Null);
            said.push(gone.to_owned());
        }
        Some(Some(v)) => {
            let checked = check(v)?;
            said.push(line(&checked));
            changes.insert(key.to_owned(), Value::String(checked));
        }
    }
    Ok(())
}

/// The task note a next action names.
struct Task {
    path: String,
    title: String,
}

/// A change that passed every check: what it will set, what its commit will
/// say, and the task note a next action names.
struct Checked {
    changes: Map<String, Value>,
    said: Vec<String>,
    task: Option<Task>,
}

impl Kasten {
    /// Whether `set_project_state` would take this change from an agent,
    /// without writing anything: the checks it makes before it writes, for a
    /// request that is refused (or kept for review) before it runs.
    pub(super) fn check_project_state(&self, page: &str, state: &ProjectState) -> Result<()> {
        let agent = Actor::Agent {
            client: String::new(),
            session: String::new(),
        };
        self.checked_state(&agent, page, state).map(|_| ())
    }

    /// Changes a project page's state in one commit, `project: <title> —
    /// Active, At risk`. Every value is checked first: the status and health
    /// are from their lists, days are real days, the next action is a note
    /// tagged `task`, and the page's own tags may not define these properties
    /// with other rules. A refused change writes nothing. Saying what is
    /// already so writes and commits nothing.
    pub fn set_project_state(
        &self,
        actor: &Actor,
        page: &str,
        state: &ProjectState,
        now: Instant,
    ) -> Result<NoteFile> {
        let Checked {
            changes,
            said,
            task,
        } = self.checked_state(actor, page, state)?;
        let title = self.vault.read(page)?.meta.title;
        self.apply(actor, "set_project_state", false, now.millis, |vault| {
            let mut changes = changes;
            let mut paths = vec![page.to_owned()];
            if let Some(task) = &task {
                let had = vault.read(&task.path)?.meta.id.is_some();
                let id = ensure_id(vault, &task.path, now)?;
                if !had {
                    paths.push(task.path.clone());
                }
                changes.insert("next_action".to_owned(), Value::String(id));
            }
            let current = vault.read(page)?;
            let parts = split(&current.text);
            let existing = props_of(parts.prefix);
            let same = changes.iter().all(|(key, value)| {
                if value.is_null() {
                    !existing.contains_key(key)
                } else {
                    existing.get(key) == Some(value)
                }
            });
            if same && paths.len() == 1 {
                return Ok(Change {
                    message: String::new(),
                    paths: vec![],
                    value: current,
                });
            }
            let eol = eol_of(&current.text);
            let prefix = set_props(parts.prefix, &changes, eol)?;
            let prefix = set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
            still_readable(parts.prefix, &prefix)?;
            write_atomic(
                &vault.path_of(page)?,
                join(&prefix, parts.body, eol).as_bytes(),
            )?;
            Ok(Change {
                message: format!("project: {title} — {}", said.join(", ")),
                paths,
                value: vault.read(page)?,
            })
        })
    }

    /// The checks of `set_project_state`, before anything is written.
    fn checked_state(&self, actor: &Actor, page: &str, state: &ProjectState) -> Result<Checked> {
        if !is_project_page(page) {
            return Err(Error::Invalid(format!(
                "Only a project page (projects/<name>/_project.md) has a status, a health and a next action, not {page}"
            )));
        }
        if actor.is_agent() {
            self.writable(page)?;
        }
        let mut changes = Map::new();
        let mut said: Vec<String> = Vec::new();
        let mut out = (&mut changes, &mut said);
        field(
            &mut out,
            "status",
            &state.status,
            |v| word(v, &STATUSES, "status"),
            |v| v.to_owned(),
            "no status",
        )?;
        field(
            &mut out,
            "health",
            &state.health,
            |v| word(v, &HEALTHS, "health"),
            |v| v.to_owned(),
            "no health",
        )?;
        field(
            &mut out,
            "last_review",
            &state.reviewed,
            |v| day(v, "last review"),
            |v| format!("reviewed {v}"),
            "no review date",
        )?;
        field(
            &mut out,
            "review_after",
            &state.review_after,
            |v| day(v, "next review"),
            |v| format!("review after {v}"),
            "no review due",
        )?;

        let task = match &state.next_action {
            Some(Some(reference)) => Some(self.find_task(actor, reference)?),
            _ => None,
        };
        match (&state.next_action, &task) {
            (Some(None), _) => {
                changes.insert("next_action".to_owned(), Value::Null);
                said.push("no next action".to_owned());
            }
            (_, Some(task)) => said.push(format!("next: {}", task.title)),
            _ => {}
        }

        // The page's own tags may define these properties (a `paper` tag has
        // its own `status`): their rules hold, and the tag is named.
        let current = self.vault.read(page)?;
        let schemas = load_schemas(&self.vault)?;
        let mut probe = changes.clone();
        if task.is_some() {
            probe.insert("next_action".to_owned(), Value::String("id".to_owned()));
        }
        for (key, value) in &probe {
            let one: Map<String, Value> = [(key.clone(), value.clone())].into_iter().collect();
            if let Err(err) = check_props(&schemas, &current.meta.tags, &one) {
                let owner = schemas.iter().find(|s| {
                    current
                        .meta
                        .tags
                        .iter()
                        .any(|t| t.eq_ignore_ascii_case(&s.name))
                        && s.properties.iter().any(|p| p.key == *key)
                });
                return Err(match (err, owner) {
                    (Error::Invalid(why), Some(tag)) => Error::Invalid(format!(
                        "{why}; the tag #{} gives “{key}” its own rules, and this page has that tag",
                        tag.name
                    )),
                    (err, _) => err,
                });
            }
        }

        Ok(Checked {
            changes,
            said,
            task,
        })
    }

    /// The `task` note a reference names (path, id or title).
    fn find_task(&self, actor: &Actor, reference: &str) -> Result<Task> {
        let path = self.resolve(reference)?;
        let note = self.vault.read(&path)?;
        let tagged = note
            .meta
            .tags
            .iter()
            .any(|t| t.eq_ignore_ascii_case("task"));
        if !tagged || crate::vault::in_templates(&path) {
            return Err(Error::Invalid(format!(
                "“{}” is not a task note: a project's next action is a note tagged #task",
                note.meta.title
            )));
        }
        // It may be given an id, which is a write to it.
        if actor.is_agent() {
            self.writable(&path)?;
        }
        Ok(Task {
            path,
            title: note.meta.title,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_project_page_is_projects_folder_project_md() {
        assert!(is_project_page("projects/trip/_project.md"));
        for no in [
            "projects/trip/pages/a.md",
            "projects/_project.md",
            "library/_project.md",
            "projects//_project.md",
            "projects/a/b/_project.md",
            "x/projects/a/_project.md",
        ] {
            assert!(!is_project_page(no), "{no}");
        }
    }

    #[test]
    fn a_key_sent_as_null_is_told_from_a_key_left_out() {
        let state: ProjectState =
            serde_json::from_str(r#"{"status": "Active", "health": null}"#).unwrap();
        assert_eq!(state.status, Some(Some("Active".to_owned())));
        assert_eq!(state.health, Some(None));
        assert_eq!(state.next_action, None);
        let camel: ProjectState =
            serde_json::from_str(r#"{"reviewAfter": "2026-01-01", "nextAction": null}"#).unwrap();
        assert_eq!(camel.review_after, Some(Some("2026-01-01".to_owned())));
        assert_eq!(camel.next_action, Some(None));
    }

    #[test]
    fn words_keep_the_lists_spelling() {
        assert_eq!(word(" at RISK ", &HEALTHS, "health").unwrap(), "At risk");
        assert!(word("Someday", &STATUSES, "status").is_err());
    }
}
