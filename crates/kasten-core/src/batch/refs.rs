//! Naming a note a batch makes: a change may refer to a note made by an
//! earlier change of the same batch with `{"$ref": 0}` (the index of that
//! change, from 0), which stands for the note's path once it exists. Only a
//! person's batch (run from the app) may do this; an agent's batch names
//! notes that exist already.
//!
//! A reference is the text `$ref:<n>` in a field that holds a note's path
//! (`path`, `parent`, a board's `notes`). A vault path never holds a colon, so
//! the text cannot be mistaken for a note. The earlier change must be a
//! `create_note`; a change may not name itself or a later change, which also
//! rules out cycles.

use std::borrow::Cow;

use serde_json::Value;

use crate::agent::AgentOp;
use crate::error::{Error, Result};

/// The start of a reference in a path field.
pub const PREFIX: &str = "$ref:";

/// The fields of a change that name notes and may hold a reference.
fn fields(op: &AgentOp) -> Vec<&String> {
    match op {
        AgentOp::Append { path, .. }
        | AgentOp::ReplaceSection { path, .. }
        | AgentOp::UpdateProps { path, .. }
        | AgentOp::Tags { path, .. }
        | AgentOp::Rename { path, .. }
        | AgentOp::Move { path, .. }
        | AgentOp::EditPage { path, .. } => vec![path],
        AgentOp::SetParent { path, parent } => {
            let mut all = vec![path];
            all.extend(parent.as_ref());
            all
        }
        AgentOp::CreateNote { parent, .. } => parent.iter().collect(),
        AgentOp::ReorderChildren { parent, .. } => vec![parent],
        AgentOp::AddToBoard { notes, .. } => notes.iter().collect(),
        _ => vec![],
    }
}

fn fields_mut(op: &mut AgentOp) -> Vec<&mut String> {
    match op {
        AgentOp::Append { path, .. }
        | AgentOp::ReplaceSection { path, .. }
        | AgentOp::UpdateProps { path, .. }
        | AgentOp::Tags { path, .. }
        | AgentOp::Rename { path, .. }
        | AgentOp::Move { path, .. }
        | AgentOp::EditPage { path, .. } => vec![path],
        AgentOp::SetParent { path, parent } => {
            let mut all = vec![path];
            all.extend(parent.as_mut());
            all
        }
        AgentOp::CreateNote { parent, .. } => parent.iter_mut().collect(),
        AgentOp::ReorderChildren { parent, .. } => vec![parent],
        AgentOp::AddToBoard { notes, .. } => notes.iter_mut().collect(),
        _ => vec![],
    }
}

/// The change a field names, if it is a reference: `None` for an ordinary
/// path, an error for text that starts like a reference and is not one.
fn target(field: &str) -> Result<Option<usize>> {
    let Some(rest) = field.strip_prefix(PREFIX) else {
        return Ok(None);
    };
    rest.parse::<usize>().map(Some).map_err(|_| {
        Error::Invalid(format!(
            "“{field}” is not a note made by an earlier change; write a reference as {{\"$ref\": 0}}, the number of the change from 0"
        ))
    })
}

/// Whether any change of `ops` holds a reference.
pub fn any(ops: &[AgentOp]) -> bool {
    ops.iter()
        .any(|op| fields(op).iter().any(|f| f.starts_with(PREFIX)))
}

/// The references of `ops` are all allowed: each names an earlier change
/// that makes a note. The error is told for the change that holds it.
pub fn check(ops: &[AgentOp]) -> Result<()> {
    for (index, op) in ops.iter().enumerate() {
        for field in fields(op) {
            let place = crate::batch::position(index, ops.len(), op);
            let Some(n) = target(field).map_err(|err| {
                Error::Invalid(format!("{place}: {err}. Nothing in the batch was changed."))
            })?
            else {
                continue;
            };
            if n >= index {
                return Err(Error::Invalid(format!(
                    "{place} names change {}, but a change can only name one before it. Nothing in the batch was changed.",
                    n.saturating_add(1)
                )));
            }
            if !matches!(ops[n], AgentOp::CreateNote { .. }) {
                return Err(Error::Invalid(format!(
                    "{place} names change {} ({}), which does not make a note. Nothing in the batch was changed.",
                    n + 1,
                    ops[n].name()
                )));
            }
        }
    }
    Ok(())
}

/// `op` with each reference put by the path of the note it names; `made` has
/// what each earlier change answered (a `create_note` answers its note's
/// path). An op without a reference is returned as it is.
pub fn resolve<'a>(op: &'a AgentOp, made: &[Value]) -> Result<Cow<'a, AgentOp>> {
    if !fields(op).iter().any(|f| f.starts_with(PREFIX)) {
        return Ok(Cow::Borrowed(op));
    }
    let mut op = op.clone();
    for field in fields_mut(&mut op) {
        let Some(n) = target(field)? else {
            continue;
        };
        let path = made
            .get(n)
            .and_then(|answer| answer.get("path"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                Error::Invalid(format!("change {} has not made a note to name", n + 1))
            })?;
        *field = path.to_owned();
    }
    Ok(Cow::Owned(op))
}

/// Keeps what earlier changes answered pointing at the notes where they are:
/// a change that moved or renamed a note made earlier (`op`, and what it
/// answered) puts the note's new path in that answer, so a later reference
/// finds it and the batch's answer tells where it ended up.
pub fn follow(results: &mut [Value], op: &AgentOp, answer: &Value) {
    let mut moved: Vec<(String, String)> = Vec::new();
    match op {
        AgentOp::SetParent { .. } => {
            if let Some(Value::Array(pairs)) = answer.get("moved") {
                for pair in pairs {
                    if let (Some(from), Some(to)) = (
                        pair.get(0).and_then(Value::as_str),
                        pair.get(1).and_then(Value::as_str),
                    ) {
                        moved.push((from.to_owned(), to.to_owned()));
                    }
                }
            }
        }
        AgentOp::Rename { path, .. } | AgentOp::Move { path, .. } => {
            let now = answer
                .get("note")
                .unwrap_or(answer)
                .get("path")
                .and_then(Value::as_str);
            if let Some(now) = now {
                moved.push((path.clone(), now.to_owned()));
            }
        }
        _ => {}
    }
    for (from, to) in moved {
        for result in results.iter_mut() {
            if result.get("path").and_then(Value::as_str) == Some(from.as_str()) {
                result["path"] = Value::String(to.clone());
            }
        }
    }
}

/// The changes as JSON a person's batch carries, with `{"$ref": n}` written
/// as the text `$ref:n` in the fields that name notes, then read as ops.
pub fn ops_from_json(changes: Vec<Value>) -> Result<Vec<AgentOp>> {
    changes
        .into_iter()
        .enumerate()
        .map(|(index, mut change)| {
            flatten(&mut change);
            serde_json::from_value::<AgentOp>(change).map_err(|err| {
                Error::Invalid(format!(
                    "Change {} is not one a batch understands: {err}",
                    index + 1
                ))
            })
        })
        .collect()
}

fn flatten(change: &mut Value) {
    let Some(map) = change.as_object_mut() else {
        return;
    };
    let text = |value: &Value| -> Option<Value> {
        let n = value.as_object().filter(|m| m.len() == 1)?.get("$ref")?;
        Some(Value::String(format!("{PREFIX}{}", n.as_u64()?)))
    };
    for key in ["path", "parent"] {
        if let Some(one) = map.get(key).and_then(text) {
            map.insert(key.to_owned(), one);
        }
    }
    if let Some(Value::Array(notes)) = map.get_mut("notes") {
        for note in notes {
            if let Some(one) = text(note) {
                *note = one;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn create(title: &str) -> Value {
        json!({"kind": "create_note", "type": "page", "title": title})
    }

    #[test]
    fn a_reference_is_read_from_json_and_put_by_the_path() {
        let ops = ops_from_json(vec![
            create("A"),
            json!({"kind": "update_props", "path": {"$ref": 0}, "props": {"x": 1}}),
            json!({"kind": "set_parent", "path": {"$ref": 0}, "parent": "p.md"}),
            json!({"kind": "create_note", "type": "page", "title": "B", "parent": {"$ref": 0}}),
        ])
        .unwrap();
        assert!(any(&ops));
        check(&ops).unwrap();
        let made = vec![json!({"path": "library/a.md"})];
        let AgentOp::UpdateProps { path, .. } = resolve(&ops[1], &made).unwrap().into_owned()
        else {
            panic!("not props");
        };
        assert_eq!(path, "library/a.md");
        let AgentOp::CreateNote { parent, .. } = resolve(&ops[3], &made).unwrap().into_owned()
        else {
            panic!("not a note");
        };
        assert_eq!(parent.as_deref(), Some("library/a.md"));
        // Without a reference the op is not copied.
        assert!(matches!(resolve(&ops[0], &made).unwrap(), Cow::Borrowed(_)));
    }

    #[test]
    fn only_an_earlier_create_note_can_be_named() {
        let props = |n: u64| json!({"kind": "update_props", "path": {"$ref": n}, "props": {}});
        let tags = json!({"kind": "tags", "path": "x.md", "add": ["a"]});
        let said = |changes: Vec<Value>| {
            check(&ops_from_json(changes).unwrap())
                .unwrap_err()
                .to_string()
        };
        // Itself, a later change, one that does not exist.
        assert!(said(vec![create("A"), props(1)]).contains("only name one before it"));
        assert!(said(vec![props(1), create("A")]).contains("Change 1 of 2 (update_props)"));
        assert!(said(vec![create("A"), props(5)]).contains("names change 6"));
        // A change that makes no note.
        assert!(said(vec![tags, props(0)]).contains("does not make a note"));
        // Text that only looks like a reference.
        let odd = json!({"kind": "update_props", "path": "$ref:x", "props": {}});
        assert!(said(vec![create("A"), odd]).contains("not a note made by an earlier change"));
        // A path with a colon is no note's path, so nothing else can be mistaken for one.
        assert!(!any(&ops_from_json(vec![create("$ref:0")]).unwrap()));
    }

    #[test]
    fn a_change_is_not_read_when_it_is_not_one() {
        let why = ops_from_json(vec![json!({"kind": "nope"})])
            .unwrap_err()
            .to_string();
        assert!(
            why.contains("Change 1 is not one a batch understands"),
            "{why}"
        );
    }
}
