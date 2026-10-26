//! The read tools: search, read_note, list_notes,
//! query_tag, get_journal, get_history and list_tags.

use kasten_core::frontmatter::split;
use kasten_core::tag_query::{apply_view, board_columns};
use kasten_core::tags::formula::Day;
use kasten_core::{Error, Kasten, NoteFile, NoteMeta, Result};
use serde_json::{Value, json};

use super::{as_json, today};
use crate::params::*;

/// A note's metadata as agents see it in lists.
fn row(meta: &NoteMeta) -> Value {
    json!({
        "path": meta.path,
        "id": meta.id,
        "title": meta.title,
        "type": meta.kind,
        "project": meta.project,
        "tags": meta.tags,
        "updated": meta.updated,
        "excerpt": meta.excerpt,
    })
}

fn full(kasten: &Kasten, path: &str, with_backlinks: bool) -> Result<Value> {
    let note = kasten.read(path)?;
    let mut out = note_json(&note);
    if with_backlinks {
        out["backlinks"] = json!(kasten.backlinks(&note.meta.path)?);
    }
    Ok(out)
}

/// A note as `read_note` tells it, without its backlinks.
pub(crate) fn note_json(note: &NoteFile) -> Value {
    let parts = split(&note.text);
    let yaml = parts
        .prefix
        .trim_start_matches('\u{feff}')
        .trim_start_matches("---")
        .trim_end()
        .trim_end_matches("---")
        .trim_matches(['\r', '\n']);
    json!({
        "path": note.meta.path,
        "id": note.meta.id,
        "title": note.meta.title,
        "type": note.meta.kind,
        "tags": note.meta.tags,
        "props": note.meta.props,
        "locked": note.meta.locked,
        "hash": note.hash,
        "created": note.meta.created,
        "updated": note.meta.updated,
        "frontmatter": yaml,
        "body": parts.body,
    })
}

pub(crate) fn search(k: &Kasten, args: SearchArgs) -> Result<Value> {
    let mut query = args.query;
    for (key, value) in [
        ("tag", args.tag),
        ("project", args.project),
        ("type", args.note_type),
        ("after", args.after),
        ("before", args.before),
    ] {
        if let Some(v) = value.filter(|v| !v.trim().is_empty()) {
            query.push_str(&format!(" {key}:{}", v.trim().replace(' ', "-")));
        }
    }
    let limit = args.limit.unwrap_or(20).clamp(1, 100);
    as_json(k.search(&query, limit)?)
}

pub(crate) fn read_note(k: &Kasten, args: ReadNoteArgs) -> Result<Value> {
    let path = k.resolve(&args.note)?;
    full(k, &path, args.with_backlinks)
}

pub(crate) fn list_notes(k: &Kasten, args: ListNotesArgs) -> Result<Value> {
    let mut notes: Vec<NoteMeta> = k
        .list()?
        .into_iter()
        .filter(|n| n.kind != "template")
        .filter(|n| {
            args.project
                .as_ref()
                .is_none_or(|p| n.project.as_deref() == Some(p.as_str()))
        })
        .filter(|n| {
            args.tag.as_ref().is_none_or(|t| {
                n.tags
                    .iter()
                    .any(|x| x.eq_ignore_ascii_case(t.trim_start_matches('#')))
            })
        })
        .filter(|n| args.note_type.as_ref().is_none_or(|t| n.kind == *t))
        .collect();
    match args.sort.as_deref().unwrap_or("updated") {
        "title" => notes.sort_by_key(|n| n.title.to_lowercase()),
        "created" => notes.sort_by(|a, b| b.created.cmp(&a.created)),
        _ => notes.sort_by_key(|n| std::cmp::Reverse(n.modified)),
    }
    let total = notes.len();
    let rows: Vec<Value> = notes
        .iter()
        .take(args.limit.unwrap_or(50).clamp(1, 500))
        .map(row)
        .collect();
    Ok(json!({ "total": total, "notes": rows }))
}

pub(crate) fn query_tag(k: &Kasten, args: QueryTagArgs) -> Result<Value> {
    let tag = args.tag.trim().trim_start_matches('#').to_owned();
    let schema = k
        .tag_schemas()?
        .into_iter()
        .find(|s| s.name.eq_ignore_ascii_case(&tag));
    let everything = k.list()?;
    // How many sub-pages each page has, from the index's parent ids.
    let mut children: std::collections::HashMap<&str, usize> = Default::default();
    for parent in everything.iter().filter_map(|n| n.parent.as_deref()) {
        *children.entry(parent).or_default() += 1;
    }
    let child_counts: std::collections::HashMap<String, usize> = children
        .into_iter()
        .map(|(id, count)| (id.to_owned(), count))
        .collect();
    let mut tagged: Vec<NoteMeta> = everything
        .iter()
        .filter(|n| n.kind != "template" && n.tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)))
        .cloned()
        .collect();
    // Formula properties are worked out here, on these copies, and not stored.
    let problems = match &schema {
        Some(schema) => {
            let day = Day::parse(&today()).unwrap_or(Day(0));
            k.fill_formulas(schema, &mut tagged, &everything, day)?
        }
        None => Default::default(),
    };
    let views: Vec<Value> = schema.as_ref().map(|s| s.views.clone()).unwrap_or_default();
    let saved = match &args.view {
        Some(name) => Some(
            views
                .iter()
                .find(|v| {
                    v.get("name")
                        .and_then(Value::as_str)
                        .is_some_and(|n| n.eq_ignore_ascii_case(name.trim()))
                })
                .cloned()
                .ok_or_else(|| {
                    Error::Invalid(format!("#{tag} has no view called “{}”", name.trim()))
                })?,
        ),
        None => None,
    };
    // The saved view's filters and the ones given, all of them; the sort
    // given, else the view's.
    let mut filters: Vec<Value> = saved
        .as_ref()
        .and_then(|v| v.get("filter")?.as_array().cloned())
        .unwrap_or_default();
    filters.extend(
        args.filter
            .iter()
            .map(|(key, value)| json!({"key": key, "op": "is", "value": value})),
    );
    let sort = match &args.sort {
        Some(sort) => match sort.strip_prefix('-') {
            Some(key) => json!([{"key": key, "dir": "desc"}]),
            None => json!([{"key": sort, "dir": "asc"}]),
        },
        None => saved
            .as_ref()
            .and_then(|v| v.get("sort").cloned())
            .unwrap_or(json!([])),
    };
    let rows = apply_view(
        tagged,
        &json!({"filter": filters, "sort": sort}),
        schema.as_ref(),
    );
    let columns = saved
        .as_ref()
        .filter(|v| v.get("type").and_then(Value::as_str) == Some("kanban"))
        .and_then(|v| {
            let selects = schema
                .as_ref()?
                .properties
                .iter()
                .filter(|p| p.kind == "select");
            let group = v.get("group_by").and_then(Value::as_str);
            let def = selects
                .clone()
                .find(|p| Some(p.key.as_str()) == group)
                .or_else(|| selects.clone().next())?;
            Some(json!({"group_by": def.key, "columns": board_columns(&rows, def)}))
        });
    let total = rows.len();
    let limit = args.limit.unwrap_or(100).clamp(1, 500);
    let rows: Vec<Value> = rows
        .iter()
        .take(limit)
        .map(|n| {
            let mut row = json!({
                "path": n.path,
                "id": n.id,
                "title": n.title,
                "props": n.props,
                "parent": n.parent,
                "children": n.id.as_ref().and_then(|id| child_counts.get(id)).copied().unwrap_or(0),
            });
            // Why a formula cell is empty, by property.
            if let Some(why) = problems.get(&n.path) {
                row["problems"] = json!(why);
            }
            row
        })
        .collect();
    let names: Vec<&str> = views
        .iter()
        .filter_map(|v| v.get("name")?.as_str())
        .collect();
    let mut out =
        json!({ "tag": tag, "schema": schema, "views": names, "total": total, "rows": rows });
    if let Some(board) = columns {
        out["board"] = board;
    }
    Ok(out)
}

pub(crate) fn get_journal(k: &Kasten, args: JournalArgs) -> Result<Value> {
    let date = args.date.unwrap_or_else(today);
    let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
    if !k.vault().exists(&path) {
        return Ok(json!({ "date": date, "exists": false }));
    }
    full(k, &path, false)
}

pub(crate) fn get_history(k: &Kasten, args: HistoryArgs) -> Result<Value> {
    let path = k.resolve(&args.note)?;
    if !k.has_history() {
        return Err(Error::Invalid("This vault keeps no history".to_owned()));
    }
    as_json(k.log(Some(&path), args.limit.unwrap_or(20).clamp(1, 200))?)
}

pub(crate) fn list_tags(k: &Kasten) -> Result<Value> {
    let mut counts: std::collections::BTreeMap<String, usize> = Default::default();
    for note in k.list()?.into_iter().filter(|n| n.kind != "template") {
        for tag in note.tags {
            *counts.entry(tag.to_lowercase()).or_default() += 1;
        }
    }
    Ok(json!({ "tags": counts, "schemas": k.tag_schemas()? }))
}
