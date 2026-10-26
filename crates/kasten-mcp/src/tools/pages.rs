//! The page-block tools: `read_page_blocks` lists a page as blocks with ids
//! and hashes, and `edit_page` changes it with steps that name them. The core
//! cuts the bytes (kasten_core::pages); nothing here touches a file.

use kasten_core::agent::AgentOp;
use kasten_core::pages::PageStep;
use kasten_core::{Error, Kasten, Result};
use serde_json::Value;

use super::as_json;
use super::lookup::Lookup;
use crate::params_pages::*;

/// The blocks a read lists when it is not asked for more or fewer.
pub(super) const DEFAULT_BLOCKS: usize = 300;
pub(super) const MOST_BLOCKS: usize = 1000;

pub(crate) fn read_page_blocks(k: &Kasten, a: ReadPageBlocksArgs) -> Result<Value> {
    let path = k.resolve(&a.note)?;
    let limit = a.limit.unwrap_or(DEFAULT_BLOCKS).clamp(1, MOST_BLOCKS);
    as_json(k.read_page_blocks(&path, a.from.unwrap_or(1).max(1), limit)?)
}

pub(crate) fn edit_page(k: &dyn Lookup, a: EditPageArgs) -> Result<AgentOp> {
    let path = k.resolve(&a.note)?;
    let mut steps = Vec::with_capacity(a.steps.len());
    for (n, step) in a.steps.into_iter().enumerate() {
        let op = step
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or("(none)")
            .to_owned();
        steps.push(serde_json::from_value::<PageStep>(step).map_err(|err| {
            Error::Invalid(format!(
                "Step {} ({op}) is not a step edit_page knows: {err}. Nothing was written",
                n + 1
            ))
        })?);
    }
    Ok(AgentOp::EditPage {
        path,
        steps,
        reason: a.reason,
    })
}
