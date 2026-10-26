//! The steps of `edit_page`: what an agent may ask of a page, each naming
//! the blocks it works on by id and hash as `read_page_blocks` gave them.

use serde::{Deserialize, Serialize};

/// A block as the agent read it: its id, and the hash that proves the block
/// has not changed since.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockRef {
    pub block: String,
    pub hash: String,
}

fn note() -> String {
    "note".to_owned()
}

/// The names of the steps (`op` in their JSON), in the order the tool text
/// lists them. A test keeps this list equal to the enum's variants.
pub const STEP_NAMES: [&str; 13] = [
    "insert",
    "replace",
    "move",
    "delete",
    "set_todo",
    "wrap_columns",
    "unwrap_columns",
    "toggle",
    "callout",
    "table_cells",
    "table_rows",
    "table_columns",
    "embed",
];

/// One change to a page. Every step is worked out against the page as it was
/// read, and all of them are made together or none is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum PageStep {
    /// New Markdown before or after a block, or at the end of a heading's section.
    Insert {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        before: Option<BlockRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<BlockRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at_end_of_heading: Option<BlockRef>,
        markdown: String,
    },
    /// One block written again; the blocks around it keep their bytes.
    Replace {
        block: BlockRef,
        markdown: String,
    },
    /// A block moved to after (or before) another.
    Move {
        block: BlockRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<BlockRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        before: Option<BlockRef>,
    },
    Delete {
        block: BlockRef,
    },
    /// A task ticked or unticked: `line` is the task's line in the block, from 0.
    SetTodo {
        block: BlockRef,
        line: usize,
        done: bool,
    },
    /// Blocks side by side. `columns` says how many blocks go in each column
    /// (one each when left out); `ratio` the widths, such as `40/60`.
    WrapColumns {
        blocks: Vec<BlockRef>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        columns: Vec<usize>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ratio: Option<String>,
    },
    /// Columns taken apart: their blocks one under another.
    UnwrapColumns {
        block: BlockRef,
    },
    /// Blocks folded into a toggle with this title.
    Toggle {
        blocks: Vec<BlockRef>,
        #[serde(default)]
        title: String,
    },
    /// Blocks set in a callout (`note`, `tip`, `warning`, …).
    Callout {
        blocks: Vec<BlockRef>,
        #[serde(default = "note")]
        kind: String,
        #[serde(default)]
        title: String,
    },
    /// Table cells set: `[row, column, text]`, from 0, row 0 being the header.
    TableCells {
        block: BlockRef,
        cells: Vec<(usize, usize, String)>,
    },
    /// Rows added (`insert_at` the row number, `rows` their cells) or taken out (`delete`).
    TableRows {
        block: BlockRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        insert_at: Option<usize>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        rows: Vec<Vec<String>>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        delete: Vec<usize>,
    },
    /// A column added (`insert_at` the column number, with its `header`, `align`
    /// and one cell per row) or columns taken out (`delete`).
    TableColumns {
        block: BlockRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        insert_at: Option<usize>,
        #[serde(default)]
        header: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        align: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        cells: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        delete: Vec<usize>,
    },
    /// An embed (`![[target]]` or `![[target#view]]`) after a block.
    Embed {
        after: BlockRef,
        target: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view: Option<String>,
    },
}

impl PageStep {
    /// What the step is called in a message.
    pub fn name(&self) -> &'static str {
        match self {
            PageStep::Insert { .. } => "insert",
            PageStep::Replace { .. } => "replace",
            PageStep::Move { .. } => "move",
            PageStep::Delete { .. } => "delete",
            PageStep::SetTodo { .. } => "set_todo",
            PageStep::WrapColumns { .. } => "wrap_columns",
            PageStep::UnwrapColumns { .. } => "unwrap_columns",
            PageStep::Toggle { .. } => "toggle",
            PageStep::Callout { .. } => "callout",
            PageStep::TableCells { .. } => "table_cells",
            PageStep::TableRows { .. } => "table_rows",
            PageStep::TableColumns { .. } => "table_columns",
            PageStep::Embed { .. } => "embed",
        }
    }

    /// What the step sends, for the size limit: its text, and a few bytes for
    /// each block, cell or number it names, so a long list of them counts.
    pub fn bytes(&self) -> usize {
        const NAMED: usize = 16;
        match self {
            PageStep::Insert { markdown, .. } | PageStep::Replace { markdown, .. } => {
                markdown.len()
            }
            PageStep::Toggle { blocks, title } => title.len() + NAMED * blocks.len(),
            PageStep::Callout {
                blocks,
                kind,
                title,
            } => kind.len() + title.len() + NAMED * blocks.len(),
            PageStep::WrapColumns {
                blocks, columns, ..
            } => NAMED * (blocks.len() + columns.len()),
            PageStep::TableCells { cells, .. } => {
                cells.iter().map(|(_, _, text)| text.len() + NAMED).sum()
            }
            PageStep::TableRows { rows, delete, .. } => {
                // A row with no cells still makes a line, so each row counts too.
                let cells: usize = rows.iter().flatten().map(|c| c.len() + NAMED).sum();
                cells + NAMED * (rows.len() + delete.len())
            }
            PageStep::TableColumns {
                header,
                cells,
                delete,
                ..
            } => {
                let cells: usize = cells.iter().map(|c| c.len() + NAMED).sum();
                header.len() + cells + NAMED * delete.len()
            }
            PageStep::Embed { target, view, .. } => {
                target.len() + view.as_ref().map_or(0, String::len)
            }
            _ => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_exported_names_are_exactly_the_variants_of_the_enum() {
        // Serde lists every variant it knows when it meets one it does not.
        let err = serde_json::from_str::<PageStep>(r#"{"op":"nope"}"#)
            .unwrap_err()
            .to_string();
        let mut known: Vec<&str> = err.split('`').skip(3).step_by(2).collect();
        known.sort_unstable();
        let mut exported = STEP_NAMES.to_vec();
        exported.sort_unstable();
        assert_eq!(known, exported, "{err}");
        // And each name is the name `name()` gives its step.
        for name in STEP_NAMES {
            let err = serde_json::from_str::<PageStep>(&format!(r#"{{"op":"{name}"}}"#))
                .unwrap_err()
                .to_string();
            assert!(!err.contains("unknown variant"), "{name}: {err}");
        }
    }

    #[test]
    fn steps_read_and_write_as_json() {
        let step: PageStep = serde_json::from_str(
            r#"{"op":"insert","after":{"block":"b2","hash":"ab"},"markdown":"x"}"#,
        )
        .unwrap();
        assert_eq!(step.name(), "insert");
        assert_eq!(step.bytes(), 1);
        let json = serde_json::to_value(&step).unwrap();
        assert_eq!(json["op"], "insert");
        assert!(json.get("before").is_none());
        let call: PageStep = serde_json::from_str(
            r#"{"op":"callout","blocks":[{"block":"b1","hash":"h"}],"title":"T"}"#,
        )
        .unwrap();
        assert!(matches!(call, PageStep::Callout { ref kind, .. } if kind == "note"));
        let cells: PageStep = serde_json::from_str(
            r#"{"op":"table_cells","block":{"block":"b1","hash":"h"},"cells":[[1,0,"a"]]}"#,
        )
        .unwrap();
        // A cell counts its text and a few bytes for being named.
        assert_eq!(cells.bytes(), 1 + 16);
        // Rows with no cells still make lines, so they count.
        let rows: PageStep = serde_json::from_str(
            r#"{"op":"table_rows","block":{"block":"b1","hash":"h"},"insert_at":1,"rows":[[],[],[]]}"#,
        )
        .unwrap();
        assert_eq!(rows.bytes(), 3 * 16);
        assert!(serde_json::from_str::<PageStep>(r#"{"op":"explode"}"#).is_err());
        assert!(
            serde_json::from_str::<PageStep>(
                r#"{"op":"delete","block":{"block":"b1","hash":"h"},"extra":1}"#
            )
            .is_err()
        );
    }
}
