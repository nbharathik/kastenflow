//! The `batch` tool: many changes sent as one. Each item names one of the
//! write tools below and gives that tool's own arguments; the notes they name
//! are looked up first, then the core weighs the whole batch (all or nothing,
//! one commit, one undo, or one proposal when any change needs review).

use kasten_core::agent::AgentOp;
use kasten_core::batch::{MAX_BYTES, MAX_OPS};
use kasten_core::{Error, Result};
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::lookup::Lookup;
use super::*;
use crate::params::*;
use crate::params_pages::EditPageArgs;
use crate::params_structure::{
    ReorderChildrenArgs, SetParentArgs, SetTagViewsArgs, SetViewOrderArgs,
};

/// How a tool of the batch builds its op from its arguments.
type Build = fn(&dyn Lookup, Value) -> Result<AgentOp>;

fn args<T: DeserializeOwned>(value: Value) -> Result<T> {
    let value = match value {
        Value::Null => Value::Object(Default::default()),
        other => other,
    };
    serde_json::from_value(value)
        .map_err(|e| Error::Invalid(format!("failed to deserialize parameters: {e}")))
}

macro_rules! tool {
    ($name:literal, $params:ty, $build:path) => {
        (
            $name,
            (|k: &dyn Lookup, a: Value| $build(k, args::<$params>(a)?)) as Build,
        )
    };
}

/// The tools a batch may hold, with how each builds its op. A feature that
/// adds a tool a batch may carry appends a row here, and its op's name to
/// `kasten_core::batch::BATCHABLE` (the core refuses any other op).
pub(crate) const BATCHABLE: &[(&str, Build)] = &[
    tool!("capture", CaptureArgs, capture),
    tool!("create_note", CreateNoteArgs, create_note),
    tool!("append", AppendArgs, append),
    tool!("replace_section", ReplaceSectionArgs, replace_section),
    tool!("update_props", UpdatePropsArgs, update_props),
    tool!("add_tags", TagsArgs, add_tags),
    tool!("remove_tags", TagsArgs, remove_tags),
    tool!("rename_note", RenameArgs, rename_note),
    tool!("move_note", MoveArgs, move_note),
    tool!("journal_append", JournalAppendArgs, journal_append),
    tool!("create_board", CreateBoardArgs, create_board),
    tool!("add_to_board", AddToBoardArgs, add_to_board),
    tool!("connect", ConnectArgs, connect),
    tool!("group_on_board", GroupArgs, group_on_board),
    tool!("edit_page", EditPageArgs, edit_page),
    tool!("set_parent", SetParentArgs, set_parent),
    tool!("reorder_children", ReorderChildrenArgs, reorder_children),
    tool!("set_tag_views", SetTagViewsArgs, set_tag_views),
    tool!("set_view_order", SetViewOrderArgs, set_view_order),
    tool!("update_tag_schema", TagSchemaArgs, update_tag_schema),
];

/// The names a batch may hold, for the messages.
pub(crate) fn batchable_names() -> String {
    BATCHABLE
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(", ")
}

/// The batch as one op: every change built (and its notes looked up) first;
/// a change that cannot be built refuses the whole batch.
pub(crate) fn batch_op(k: &dyn Lookup, a: BatchArgs) -> Result<AgentOp> {
    let total = a.ops.len();
    if total == 0 {
        return Err(Error::Invalid(
            "A batch needs at least one change".to_owned(),
        ));
    }
    if total > MAX_OPS {
        return Err(Error::Invalid(format!(
            "A batch holds at most {MAX_OPS} changes; this one has {total}. Send it as smaller batches"
        )));
    }
    let sent = serde_json::to_string(&a.ops).map_or(0, |text| text.len());
    if sent > MAX_BYTES {
        return Err(Error::Invalid(format!(
            "A batch may send at most {} KB; this one sends {} KB. Send it as smaller batches",
            MAX_BYTES / 1024,
            sent / 1024
        )));
    }
    let mut ops = Vec::with_capacity(total);
    for (index, item) in a.ops.into_iter().enumerate() {
        let place = format!("Change {} of {total} ({})", index + 1, item.tool);
        let Some((_, build)) = BATCHABLE.iter().find(|(name, _)| *name == item.tool) else {
            return Err(Error::Invalid(format!(
                "{place} cannot be part of a batch. A batch holds: {}. Nothing in the batch was changed.",
                batchable_names()
            )));
        };
        let op = build(k, item.args).map_err(|err| {
            Error::Invalid(format!("{place}: {err}. Nothing in the batch was changed."))
        })?;
        ops.push(op);
    }
    Ok(AgentOp::Batch {
        ops,
        reason: a.reason,
    })
}
