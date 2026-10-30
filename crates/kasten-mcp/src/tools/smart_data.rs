//! What a smart page's named queries return now, by the code `query_tag`
//! uses (the tag's notes, formulas worked out, the view's filters and sorts),
//! cut to a size a model can read.

use kasten_core::smart::{FilterOp, QuerySpec, SmartManifest, SortDir};
use kasten_core::tag_query::apply_view;
use kasten_core::tags::TagSchema;
use kasten_core::tags::formula::Day;
use kasten_core::{Kasten, NoteMeta, Result};
use serde_json::{Value, json};

use super::today;

/// The most rows of one query that `smart_read` shows.
const SHOWN: usize = 25;
/// The most text of all the queries' rows together.
const BUDGET: usize = 16_000;

/// The tag's notes as the query asks for them, and the tag's schema if it has one.
pub(super) fn rows(k: &Kasten, spec: &QuerySpec) -> Result<(Option<TagSchema>, Vec<NoteMeta>)> {
    let tag = spec.tag.trim().trim_start_matches('#').to_owned();
    let schema = k
        .tag_schemas()?
        .into_iter()
        .find(|s| s.name.eq_ignore_ascii_case(&tag));
    let everything = k.list()?;
    let mut tagged: Vec<NoteMeta> = everything
        .iter()
        .filter(|n| n.kind != "template" && n.tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)))
        .cloned()
        .collect();
    if let Some(schema) = &schema {
        let day = Day::parse(&today()).unwrap_or(Day(0));
        k.fill_formulas(schema, &mut tagged, &everything, day)?;
    }
    let filter: Vec<Value> = spec
        .filter
        .iter()
        .map(|f| {
            let op = match f.op {
                FilterOp::Is => "is",
                FilterOp::IsNot => "is_not",
                FilterOp::Contains => "contains",
                FilterOp::Empty => "empty",
                FilterOp::NotEmpty => "not_empty",
                FilterOp::Before => "before",
                FilterOp::After => "after",
            };
            json!({"key": f.key, "op": op, "value": f.value})
        })
        .collect();
    let sort: Vec<Value> = spec
        .sort
        .iter()
        .map(|s| {
            let dir = if s.dir == SortDir::Desc {
                "desc"
            } else {
                "asc"
            };
            json!({"key": s.key, "dir": dir})
        })
        .collect();
    let found = apply_view(
        tagged,
        &json!({"filter": filter, "sort": sort}),
        schema.as_ref(),
    );
    Ok((schema, found))
}

fn row(n: &NoteMeta) -> Value {
    json!({"path": n.path, "id": n.id, "title": n.title, "props": n.props})
}

/// What each query of the manifest returns now: how many notes, and the first
/// few. Rows that would not fit in the size left are not shown, and it says so.
pub(super) fn data(k: &Kasten, manifest: &SmartManifest) -> Value {
    let mut out = serde_json::Map::new();
    let mut left = BUDGET;
    for (name, spec) in &manifest.queries {
        let entry = match rows(k, spec) {
            Err(err) => json!({"tag": spec.tag, "error": err.to_string()}),
            Ok((_, found)) => {
                let wanted = spec
                    .limit
                    .map_or(found.len(), |l| found.len().min(l as usize));
                let mut shown: Vec<Value> = found.iter().take(wanted.min(SHOWN)).map(row).collect();
                while !shown.is_empty()
                    && serde_json::to_string(&shown).map_or(0, |s| s.len()) > left
                {
                    shown.pop();
                }
                left = left.saturating_sub(serde_json::to_string(&shown).map_or(0, |s| s.len()));
                json!({
                    "tag": spec.tag,
                    "total": wanted,
                    "shown": shown.len(),
                    "rows": shown,
                    "truncated": shown.len() < wanted,
                })
            }
        };
        out.insert(name.clone(), entry);
    }
    Value::Object(out)
}
