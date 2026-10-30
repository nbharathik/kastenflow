//! Batches: many agent changes sent as one. A batch is all or nothing: every
//! change is checked against the vault as it is, and if any is refused none is
//! made; if any waits for review the whole batch waits as one proposal; else
//! the changes are made under one hold of the write lock and committed once,
//! so one undo takes them all back. The engine runs it
//! (engine/batch_apply.rs); this module is what a batch may hold and how it is
//! told in words.

mod plan;
pub mod refs;

pub use plan::{describe, worst};

use crate::agent::AgentOp;
use crate::error::{Error, Result};

/// The most changes one batch holds.
pub const MAX_OPS: usize = 100;
/// The most text one batch sends, counted as the single-write limit counts.
pub const MAX_BYTES: usize = 1024 * 1024;

/// The ops (by `AgentOp::name`) a batch may hold. A feature that adds an op a
/// batch may carry appends its name here; the MCP side has the matching table
/// of tool names (kasten-mcp, tools/batch.rs).
pub const BATCHABLE: &[&str] = &[
    "capture",
    "create_note",
    "append",
    "replace_section",
    "update_props",
    "tags",
    "rename_note",
    "move_note",
    "journal_append",
    "create_board",
    "add_to_board",
    "connect",
    "group_on_board",
    "edit_page",
    "set_parent",
    "reorder_children",
    "set_tag_views",
    "set_view_order",
    // Only the schema of a tag that has none yet (engine/batch_person.rs).
    "update_tag_schema",
];

/// Where change `index` (from 0) stands, for a message: "Change 3 of 12 (append)".
pub fn position(index: usize, total: usize, op: &AgentOp) -> String {
    format!("Change {} of {total} ({})", index + 1, op.name())
}

/// `err` as it is told for a batch: which change it was, and that nothing was
/// changed.
pub fn refused(index: usize, total: usize, op: &AgentOp, err: &Error) -> Error {
    Error::Invalid(format!(
        "{}: {err}. Nothing in the batch was changed.",
        position(index, total, op)
    ))
}

/// Whether `ops` may be an agent's batch at all: some changes, not too many,
/// not too much text, only changes a batch may carry, and no change naming a
/// note another change of the batch makes (that is for a person's batch).
pub fn check_shape(ops: &[AgentOp]) -> Result<()> {
    check_kinds(ops)?;
    if refs::any(ops) {
        return Err(Error::Invalid(
            "A change cannot name a note made by an earlier change of the same batch. Make the notes in one batch and change them in the next. Nothing in the batch was changed.".to_owned(),
        ));
    }
    Ok(())
}

/// `check_shape` for a batch a person runs from the app, where a change may
/// name a note an earlier change makes (`refs`).
pub fn check_shape_person(ops: &[AgentOp]) -> Result<()> {
    check_kinds(ops)?;
    refs::check(ops)
}

fn check_kinds(ops: &[AgentOp]) -> Result<()> {
    if ops.is_empty() {
        return Err(Error::Invalid(
            "A batch needs at least one change".to_owned(),
        ));
    }
    if ops.len() > MAX_OPS {
        return Err(Error::Invalid(format!(
            "A batch holds at most {MAX_OPS} changes; this one has {}. Send it as smaller batches",
            ops.len()
        )));
    }
    let bytes: usize = ops.iter().map(AgentOp::bytes).sum();
    if bytes > MAX_BYTES {
        return Err(Error::Invalid(format!(
            "A batch may send at most {} KB of text; this one sends {} KB. Send it as smaller batches",
            MAX_BYTES / 1024,
            bytes / 1024
        )));
    }
    for (index, op) in ops.iter().enumerate() {
        if !BATCHABLE.contains(&op.name()) {
            return Err(Error::Invalid(format!(
                "{} cannot be part of a batch: only plain note, tag, board and journal changes can. Nothing in the batch was changed.",
                position(index, ops.len(), op)
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn append(n: usize) -> AgentOp {
        AgentOp::Append {
            path: format!("n{n}.md"),
            markdown: "x".into(),
            heading: None,
        }
    }

    #[test]
    fn a_batch_has_one_to_a_hundred_changes_of_a_kind_it_may_carry() {
        assert!(check_shape(&[]).is_err());
        let hundred: Vec<AgentOp> = (0..100).map(append).collect();
        assert!(check_shape(&hundred).is_ok());
        let many: Vec<AgentOp> = (0..101).map(append).collect();
        let why = check_shape(&many).unwrap_err().to_string();
        assert!(why.contains("at most 100"), "{why}");
        let trash = AgentOp::Trash {
            path: "a.md".into(),
            reason: None,
        };
        let why = check_shape(&[append(1), trash]).unwrap_err().to_string();
        assert!(why.contains("Change 2 of 2 (trash_note)"), "{why}");
        let nested = AgentOp::Batch {
            ops: vec![append(1)],
            reason: None,
        };
        assert!(check_shape(&[nested]).is_err());
    }

    #[test]
    fn more_than_a_megabyte_is_too_much() {
        let big = AgentOp::Append {
            path: "a.md".into(),
            markdown: "x".repeat(MAX_BYTES / 2 + 1),
            heading: None,
        };
        let why = check_shape(&[big.clone(), big]).unwrap_err().to_string();
        assert!(why.contains("at most 1024 KB"), "{why}");
    }
}
