//! More tools for notes: a copy, a note back from the trash, a page's
//! header, a template, a journal day, projects at a glance, and to-dos.

use std::collections::HashMap;

use kasten_core::agent::AgentOp;
use kasten_core::{Error, Instant, Kasten, Result};
use serde_json::{Value, json};

use super::lookup::Lookup;
use super::{as_json, today};
use crate::params_parity::*;

pub(crate) fn duplicate_note(k: &dyn Lookup, a: DuplicateNoteArgs) -> Result<AgentOp> {
    Ok(AgentOp::DuplicateNote {
        path: k.resolve(&a.note)?,
    })
}

pub(crate) fn restore_note(k: &dyn Lookup, a: RestoreNoteArgs) -> Result<AgentOp> {
    Ok(AgentOp::RestoreNote {
        path: k.resolve_trashed(&a.note)?,
    })
}

pub(crate) fn set_note_meta(k: &dyn Lookup, a: SetNoteMetaArgs) -> Result<AgentOp> {
    Ok(AgentOp::SetNoteMeta {
        path: k.resolve(&a.note)?,
        key: a.key.trim().to_lowercase(),
        value: a.value.filter(|v| !v.trim().is_empty()),
    })
}

pub(crate) fn apply_template(k: &dyn Lookup, a: ApplyTemplateArgs) -> Result<AgentOp> {
    Ok(AgentOp::ApplyTemplate {
        path: k.resolve(&a.note)?,
        template: a.template,
        date: a.date,
    })
}

pub(crate) fn journal_day(_: &dyn Lookup, a: JournalDayArgs) -> Result<AgentOp> {
    Ok(AgentOp::JournalDay {
        date: a.date.unwrap_or_else(today),
    })
}

pub(crate) fn set_task(k: &dyn Lookup, a: SetTaskArgs) -> Result<AgentOp> {
    Ok(AgentOp::SetTask {
        path: k.resolve(&a.note)?,
        line: a.line,
        done: a.done,
        base: a.hash,
    })
}

pub(crate) fn list_trash(k: &Kasten) -> Result<Value> {
    let notes: Vec<_> = k
        .list_trash()?
        .into_iter()
        .filter(|t| t.original.ends_with(".md"))
        .collect();
    Ok(json!({ "total": notes.len(), "trash": as_json(notes)? }))
}

pub(crate) fn list_projects(k: &Kasten, a: ListProjectsArgs) -> Result<Value> {
    let day = a.today.unwrap_or_else(today);
    let projects = k.project_summaries(&day)?;
    Ok(json!({ "today": day, "total": projects.len(), "projects": as_json(projects)? }))
}

/// The day seven days after `day`.
fn week_after(day: &str) -> Option<String> {
    let start = kasten_core::policy::parse_time(day)?;
    Some(
        Instant {
            millis: start + 7 * 86_400_000,
        }
        .rfc3339()[..10]
            .to_owned(),
    )
}

/// Where a to-do lives, as the Tasks view names places.
fn place_of(path: &str) -> String {
    if let Some(folder) = path
        .strip_prefix("projects/")
        .and_then(|rest| rest.split_once('/'))
    {
        return format!("project:{}", folder.0);
    }
    if path.starts_with("journal/") {
        "journal".to_owned()
    } else {
        "other".to_owned()
    }
}

fn choice<'a>(
    given: &'a Option<String>,
    ok: &[&str],
    default: &'a str,
    what: &str,
) -> Result<&'a str> {
    let value = given.as_deref().map_or(default, str::trim);
    if ok.contains(&value) {
        Ok(value)
    } else {
        Err(Error::Invalid(format!(
            "{what} is one of: {}",
            ok.join(", ")
        )))
    }
}

/// The to-dos of the vault as the Tasks view lists them: open ones first,
/// overdue before dated before undated.
pub(crate) fn list_tasks(k: &Kasten, a: ListTasksArgs) -> Result<Value> {
    let status = choice(&a.status, &["open", "done", "all"], "open", "status")?;
    let due = choice(
        &a.due,
        &["any", "overdue", "today", "week", "none"],
        "any",
        "due",
    )?;
    let place = a.place.as_deref().map_or("all", str::trim);
    let day = a.today.clone().unwrap_or_else(today);
    let week = week_after(&day)
        .ok_or_else(|| Error::Invalid(format!("Today is a day written YYYY-MM-DD, not “{day}”")))?;
    let words: Vec<String> = a
        .text
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .map(str::to_lowercase)
        .collect();
    let mut rows: Vec<_> = k
        .tasks()?
        .into_iter()
        .filter(|r| match status {
            "open" => !r.done,
            "done" => r.done,
            _ => true,
        })
        .filter(|r| place == "all" || place_of(&r.path) == place)
        .filter(|r| match due {
            "overdue" => !r.done && r.due.as_deref().is_some_and(|d| d < day.as_str()),
            "today" => r.due.as_deref() == Some(day.as_str()),
            "week" => r
                .due
                .as_deref()
                .is_some_and(|d| d >= day.as_str() && d <= week.as_str()),
            "none" => r.due.is_none(),
            _ => true,
        })
        .filter(|r| {
            let hay = format!("{} {}", r.text, r.title).to_lowercase();
            words.iter().all(|w| hay.contains(w))
        })
        .collect();
    rows.sort_by(|x, y| {
        x.done
            .cmp(&y.done)
            .then_with(|| match (&x.due, &y.due) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(p), Some(q)) => p.cmp(q),
            })
            .then_with(|| x.path.cmp(&y.path))
            .then_with(|| x.line.cmp(&y.line))
    });
    let total = rows.len();
    let limit = a.limit.unwrap_or(100).clamp(1, 500);
    // Each page's hash, which set_task needs, read once.
    // A page that cannot be read (moved or deleted since the index looked) is
    // left out, not a failure of the whole list.
    let mut hashes: HashMap<String, Option<String>> = HashMap::new();
    let mut tasks = Vec::new();
    let mut left_out = 0usize;
    for row in rows.into_iter().take(limit) {
        let hash = hashes
            .entry(row.path.clone())
            .or_insert_with(|| k.read(&row.path).ok().map(|note| note.hash))
            .clone();
        let Some(hash) = hash else {
            left_out += 1;
            continue;
        };
        let mut one = as_json(&row)?;
        one["hash"] = json!(hash);
        one["where"] = json!(place_of(&row.path));
        tasks.push(one);
    }
    let mut answer = json!({ "today": day, "total": total, "tasks": tasks });
    if left_out > 0 {
        answer["left_out"] = json!(left_out);
        answer["note"] = json!(format!(
            "{left_out} to-dos are left out because their page could not be read (it may have been moved or deleted a moment ago); ask again"
        ));
    }
    Ok(answer)
}
