//! Comments, saved searches and references: the tools that list them and the
//! ops that make them.

use kasten_core::agent::AgentOp;
use kasten_core::comments::Anchor;
use kasten_core::{Error, Kasten, Result};
use serde_json::{Map, Value, json};

use super::as_json;
use super::lookup::Lookup;
use crate::params_parity::*;

pub(crate) fn add_comment(k: &dyn Lookup, a: AddCommentArgs) -> Result<AgentOp> {
    Ok(AgentOp::AddComment {
        path: k.resolve(&a.note)?,
        anchor: Anchor {
            section: a.section.unwrap_or_default(),
            nth: a.nth.unwrap_or(1),
            quote: a.quote.filter(|q| !q.trim().is_empty()),
            prefix: None,
            suffix: None,
        },
        text: a.text,
    })
}

pub(crate) fn resolve_comment(k: &dyn Lookup, a: ResolveCommentArgs) -> Result<AgentOp> {
    Ok(AgentOp::ResolveComment {
        path: k.resolve(&a.note)?,
        id: a.id,
        resolved: a.resolved.unwrap_or(true),
    })
}

pub(crate) fn list_comments(k: &Kasten, a: ListCommentsArgs) -> Result<Value> {
    let path = k.resolve(&a.note)?;
    let open_only = a.open_only.unwrap_or(false);
    let comments: Vec<_> = k
        .comments(&path)?
        .into_iter()
        .filter(|c| !open_only || c.resolved.is_none())
        .collect();
    Ok(json!({ "note": path, "total": comments.len(), "comments": as_json(comments)? }))
}

pub(crate) fn list_collections(k: &Kasten) -> Result<Value> {
    let all = k.collections()?;
    Ok(json!({ "total": all.len(), "collections": as_json(all)? }))
}

pub(crate) fn create_collection(_: &dyn Lookup, a: CreateCollectionArgs) -> Result<AgentOp> {
    Ok(AgentOp::CreateCollection {
        name: a.name,
        edits: a.settings,
    })
}

pub(crate) fn update_collection(k: &dyn Lookup, a: UpdateCollectionArgs) -> Result<AgentOp> {
    if a.settings.is_empty() {
        return Err(Error::Invalid(
            "Say what to change: query, when, filter, sort, display or icon".to_owned(),
        ));
    }
    let edits: Map<String, Value> = a.settings;
    Ok(AgentOp::UpdateCollection {
        path: k.resolve_collection(&a.collection)?,
        edits,
        base: a.hash,
    })
}

pub(crate) fn add_reference(_: &dyn Lookup, a: AddReferenceArgs) -> Result<AgentOp> {
    Ok(AgentOp::AddReference {
        kind: a.kind,
        key: a.key,
        fields: a.fields,
        allow_duplicate: a.allow_duplicate,
    })
}

/// The bibliography's entries, filtered by words, with the managed file's hash.
pub(crate) fn list_references(k: &Kasten, a: ListReferencesArgs) -> Result<Value> {
    let bibliography = k.bibliography()?;
    let words: Vec<String> = a
        .query
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .map(str::to_lowercase)
        .collect();
    let mut found = Vec::new();
    for file in std::iter::once(&bibliography.managed).chain(&bibliography.external) {
        for entry in &file.entries {
            let hay = format!(
                "{} {}",
                entry.key,
                entry.fields.values().cloned().collect::<Vec<_>>().join(" ")
            )
            .to_lowercase();
            if words.iter().all(|w| hay.contains(w)) {
                found.push(json!({
                    "key": entry.key,
                    "type": entry.kind,
                    "file": file.path,
                    "managed": file.managed,
                    "fields": entry.fields,
                }));
            }
        }
    }
    let total = found.len();
    found.truncate(a.limit.unwrap_or(50).clamp(1, 200));
    Ok(json!({
        "total": total,
        "references": found,
        "managedFile": { "path": bibliography.managed.path, "hash": bibliography.managed.hash, "exists": bibliography.managed.exists },
        "duplicates": as_json(&bibliography.duplicates)?,
    }))
}
