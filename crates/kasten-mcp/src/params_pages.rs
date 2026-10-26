//! Arguments of the page-block tools, with the descriptions agents see in
//! each tool's schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ReadPageBlocksArgs {
    /// The page's id, title or vault path.
    pub note: String,
    /// The number of the first block to list, from 1 (default 1). Ids stay
    /// those of the whole page.
    pub from: Option<usize>,
    /// At most this many blocks (default 300, at most 1000).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct EditPageArgs {
    /// The page's id, title or vault path.
    pub note: String,
    /// The steps, in order; all are made or none. Each is an object with an
    /// `op` and these fields, where a block is `{"block": "b3", "hash": "…"}`
    /// as `read_page_blocks` gave it:
    /// `insert` {before | after | at_end_of_heading: block, markdown};
    /// `replace` {block, markdown}; `move` {block, after | before: block};
    /// `delete` {block}; `set_todo` {block, line (from 0 in the block), done};
    /// `wrap_columns` {blocks: [block, …] (neighbours), columns?: [how many
    /// blocks in each column], ratio?: "40/60"}; `unwrap_columns` {block};
    /// `toggle` {blocks: [block, …], title}; `callout` {blocks: [block, …],
    /// kind (note, tip, warning, …), title?};
    /// `table_cells` {block, cells: [[row, column, text], …]} (rows and
    /// columns from 0, row 0 is the header);
    /// `table_rows` {block, insert_at: row, rows: [[cell, …], …]} or {block, delete: [row, …]};
    /// `table_columns` {block, insert_at: column, header, align?: left | center | right, cells?: [one per row]}
    /// or {block, delete: [column, …]};
    /// `embed` {after: block, target: page title, path or file, view?}.
    pub steps: Vec<Value>,
    /// Why, in a few words, for the person reviewing it.
    pub reason: Option<String>,
}
