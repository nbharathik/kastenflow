//! What a smart page may read: notes by tag (with filters and sorts), lists,
//! one note, search, a journal day, its project, to-dos and boards. The
//! shapes are those of the tools agents read with, so a page sees what an
//! agent sees: a note's `props` hold its tag properties.

use std::collections::HashSet;

use kasten_core::smart::{MAX_QUERY_LIMIT, QuerySpec};
use kasten_core::tag_query::apply_view;
use kasten_core::{Instant, Kasten, NoteFile, NoteMeta};
use serde_json::{Value, json};

/// Notes a plain list gives at most.
const LIST_LIMIT: usize = 1_000;
/// Notes a query gives when it names no limit.
const QUERY_DEFAULT: usize = 1_000;
/// To-dos a call gives at most.
const TASK_LIMIT: usize = 2_000;

fn err(error: kasten_core::Error) -> String {
    error.to_string()
}

fn tag_of(tag: &str) -> &str {
    tag.trim().trim_start_matches('#')
}

fn has_tag(note: &NoteMeta, tag: &str) -> bool {
    note.tags.iter().any(|t| t.eq_ignore_ascii_case(tag))
}

/// A note as a page reads it in a list.
pub fn row(note: &NoteMeta) -> Value {
    json!({
        "id": note.id,
        "path": note.path,
        "title": note.title,
        "type": note.kind,
        "project": note.project,
        "tags": note.tags,
        "props": note.props,
        "created": note.created,
        "updated": note.updated,
        "excerpt": note.excerpt,
    })
}

/// The notes tagged `spec.tag`, filtered and sorted as a database view would.
pub fn query(kasten: &Kasten, spec: &QuerySpec) -> Result<Value, String> {
    let tag = tag_of(&spec.tag);
    let schema = kasten
        .tag_schemas()
        .map_err(err)?
        .into_iter()
        .find(|s| s.name.eq_ignore_ascii_case(tag));
    let tagged: Vec<NoteMeta> = kasten
        .list()
        .map_err(err)?
        .into_iter()
        .filter(|n| n.kind != "template" && has_tag(n, tag))
        .collect();
    let view = json!({
        "filter": serde_json::to_value(&spec.filter).map_err(|e| e.to_string())?,
        "sort": serde_json::to_value(&spec.sort).map_err(|e| e.to_string())?,
    });
    let limit = spec
        .limit
        .map_or(QUERY_DEFAULT, |n| n.min(MAX_QUERY_LIMIT) as usize);
    let rows: Vec<Value> = apply_view(tagged, &view, schema.as_ref())
        .iter()
        .take(limit)
        .map(row)
        .collect();
    Ok(Value::Array(rows))
}

/// Notes by project, tag and type, the newest first.
pub fn list(
    kasten: &Kasten,
    project: Option<&str>,
    tag: Option<&str>,
    note_type: Option<&str>,
) -> Result<Value, String> {
    let mut notes: Vec<NoteMeta> = kasten
        .list()
        .map_err(err)?
        .into_iter()
        .filter(|n| n.kind != "template")
        .filter(|n| project.is_none_or(|p| n.project.as_deref() == Some(p)))
        .filter(|n| tag.is_none_or(|t| has_tag(n, tag_of(t))))
        .filter(|n| note_type.is_none_or(|t| n.kind == t))
        .collect();
    notes.sort_by_key(|n| std::cmp::Reverse(n.modified));
    Ok(Value::Array(
        notes.iter().take(LIST_LIMIT).map(row).collect(),
    ))
}

/// To-dos, open or done, by project and tag.
pub fn tasks(
    kasten: &Kasten,
    project: Option<&str>,
    tag: Option<&str>,
    done: Option<bool>,
) -> Result<Value, String> {
    let notes = kasten.list().map_err(err)?;
    let tagged: Option<HashSet<&str>> = tag.map(|t| {
        notes
            .iter()
            .filter(|n| has_tag(n, tag_of(t)))
            .map(|n| n.path.as_str())
            .collect()
    });
    let rows: Vec<Value> = kasten
        .tasks()
        .map_err(err)?
        .into_iter()
        .filter(|r| done.is_none_or(|d| r.done == d))
        .filter(|r| {
            project.is_none_or(|p| {
                r.path
                    .strip_prefix("projects/")
                    .and_then(|rest| rest.split_once('/'))
                    .is_some_and(|(folder, _)| folder == p)
            })
        })
        .filter(|r| {
            tagged
                .as_ref()
                .is_none_or(|set| set.contains(r.path.as_str()))
        })
        .take(TASK_LIMIT)
        .map(|r| {
            let id = notes
                .iter()
                .find(|n| n.path == r.path)
                .and_then(|n| n.id.clone());
            json!({
                "id": id,
                "path": r.path,
                "title": r.title,
                "line": r.line,
                "done": r.done,
                "text": r.text,
                "due": r.due,
                "at": r.at,
            })
        })
        .collect();
    Ok(Value::Array(rows))
}

/// The project the page lives in, or nothing for a page that is in none.
pub fn project(kasten: &Kasten, page: &NoteFile, now: Instant) -> Result<Value, String> {
    let Some(slug) = page.meta.project.as_deref() else {
        return Ok(Value::Null);
    };
    let title = kasten
        .list()
        .map_err(err)?
        .into_iter()
        .find(|n| n.kind == "project" && n.project.as_deref() == Some(slug))
        .map_or_else(|| slug.to_owned(), |n| n.title);
    Ok(json!({
        "slug": slug,
        "title": title,
        "folder": format!("projects/{slug}"),
        "mode": kasten.agent_mode(Some(slug), now),
    }))
}

/// The path a note id, title or page path leads to, for the window to open.
pub fn open(kasten: &Kasten, target: &str) -> Result<Value, String> {
    let target = target.trim();
    if let Ok(path) = kasten.resolve(target) {
        return Ok(json!({ "path": path }));
    }
    // A file that is not a note (a board, a deck, a diagram): its path, when it is plainly inside the vault.
    let plain = !target.starts_with('/')
        && !target.contains(['\\', ':'])
        && target
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.'));
    let kinds = [".canvas", ".deck", ".drawio", ".drawio.svg"];
    if plain
        && kasten
            .vault()
            .file_of(target, &kinds)
            .is_ok_and(|file| file.is_file())
    {
        return Ok(json!({ "path": target }));
    }
    Err(format!("There is nothing called “{target}” to open."))
}
