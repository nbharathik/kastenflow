//! The order a person put a table's rows in by dragging, kept in the view's
//! own YAML in the tag file (`order: [id, id, …]`; used only when the view has
//! no sort). One file changes per drag and no note is touched. The edit is to
//! that view's line and nothing else: the file's comments, its other keys and
//! its other views stay as written, and so do the view's other settings.

use std::fs;

use serde_json::{Value, json};

use super::tag_lists::shown;
use super::{Change, Kasten};
use crate::agent::AgentOp;
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::tag_yaml::{replace_list_item, set_list};
use crate::tags::view_order::{clean_ids, with_order};
use crate::tags::{TagSchema, parse_schema};
use crate::time::Instant;

fn tag_name(tag: &str) -> &str {
    tag.trim().trim_start_matches('#').trim()
}

fn view_called(view: &Value, name: &str) -> bool {
    shown(view)
        && view
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|n| n.trim().eq_ignore_ascii_case(name.trim()))
}

/// The yaml of a tag file with the order of `view` set to `ids`: `None` when
/// the view already has it. Only the view's own line changes when it is
/// written as one flow mapping; a view written any other way makes the views
/// list be written again (`set_list`, the way every views change writes it).
fn order_text(path: &str, yaml: &str, view: &str, ids: &[String]) -> Result<Option<String>> {
    let schema = parse_schema(path, yaml)?;
    let name = schema.name.clone();
    let at = schema
        .views
        .iter()
        .position(|v| view_called(v, view))
        .ok_or_else(|| {
            Error::Invalid(format!(
                "The tag “{name}” has no view called “{}”",
                view.trim()
            ))
        })?;
    let Some(changed) = with_order(&schema.views[at], ids) else {
        return Ok(None);
    };
    let mut views = schema.views.clone();
    views[at] = changed.clone();
    // The line edit is used only if the file reads back as the same views
    // with the one change.
    if let Some(text) = replace_list_item(yaml, "views", at, &changed)
        && parse_schema(path, &text).is_ok_and(|s| s.views == views)
    {
        return Ok(Some(text));
    }
    Ok(Some(set_list(yaml, "views", &views)))
}

impl Kasten {
    /// What an agent or a person may ask: the ids are fine, the tag has a
    /// schema and the schema a view of that name. Nothing is written.
    pub(super) fn check_view_order(
        &self,
        tag: &str,
        view: &str,
        ids: &[String],
    ) -> Result<TagSchema> {
        let name = tag_name(tag);
        clean_ids(ids).map_err(|why| {
            Error::Invalid(format!("The order of “{}” in “{name}”: {why}", view.trim()))
        })?;
        let schema = self
            .tag_schemas()?
            .into_iter()
            .find(|s| s.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| {
                Error::Invalid(format!(
                    "There is no schema for the tag “{name}”, so it has no views to put in order"
                ))
            })?;
        if !schema.views.iter().any(|v| view_called(v, view)) {
            let names: Vec<String> = schema
                .views
                .iter()
                .filter(|v| shown(v))
                .filter_map(|v| v.get("name").and_then(Value::as_str))
                .map(|n| format!("“{}”", n.trim()))
                .collect();
            return Err(Error::Invalid(format!(
                "The tag “{name}” has no view called “{}”{}",
                view.trim(),
                if names.is_empty() {
                    String::new()
                } else {
                    format!("; its views are {}", names.join(", "))
                }
            )));
        }
        Ok(schema)
    }

    /// Puts the rows of a tag's view in the order of `ids` (note ids, first to
    /// last): the ids are stored in the view as `order`. Ids no row has are
    /// ignored when it is read, and rows left out follow at the end. An empty
    /// list takes the order away. One commit; none when it is already so.
    pub fn set_view_order(
        &self,
        actor: &Actor,
        tag: &str,
        view: &str,
        ids: &[String],
        now: Instant,
    ) -> Result<TagSchema> {
        let schema = self.check_view_order(tag, view, ids)?;
        let ids = clean_ids(ids).map_err(Error::Invalid)?;
        let path = schema.path;
        self.apply(actor, "set_view_order", false, now.millis, |vault| {
            let file = vault.file_of(&path, &[".yaml"])?;
            let before = fs::read_to_string(&file)?;
            let Some(after) = order_text(&path, &before, view, &ids)? else {
                return Ok(Change {
                    message: String::new(),
                    paths: vec![],
                    value: parse_schema(&path, &before)?,
                });
            };
            let schema = parse_schema(&path, &after)?;
            write_atomic(&file, after.as_bytes())?;
            Ok(Change {
                message: format!("order: #{} {}", schema.name, view.trim()),
                paths: vec![path.clone()],
                value: schema,
            })
        })
    }

    /// The refusal for an agent's `set_view_order`: checked in full before
    /// anything waits or runs.
    pub(super) fn view_order_refusals(&self, op: &AgentOp) -> Result<()> {
        let AgentOp::SetViewOrder { tag, view, ids } = op else {
            return Ok(());
        };
        self.check_view_order(tag, view, ids).map(|_| ())
    }

    /// Runs an agent's `set_view_order`: what the agent is told.
    pub(super) fn view_order_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let AgentOp::SetViewOrder { tag, view, ids } = op else {
            return Err(Error::Invalid(format!("{} is not a view order", op.name())));
        };
        let schema = self.set_view_order(actor, tag, view, ids, now)?;
        Ok(json!({ "path": schema.path, "view": view.trim(), "order": ids.len() }))
    }

    /// What a reviewer reads of a view order.
    pub(super) fn view_order_words(&self, op: &AgentOp) -> String {
        match op {
            AgentOp::SetViewOrder { tag, view, ids } if ids.is_empty() => format!(
                "Take the hand-made row order off the view “{}” of #{}",
                view.trim(),
                tag_name(tag)
            ),
            AgentOp::SetViewOrder { tag, view, ids } => format!(
                "Put {} rows first in the view “{}” of #{}, in the order given",
                ids.len(),
                view.trim(),
                tag_name(tag)
            ),
            _ => String::new(),
        }
    }
}
