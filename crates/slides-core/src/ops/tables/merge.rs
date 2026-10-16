//! Cells joined into one and split again.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Cx, edit};
use crate::error::{Error, Result};
use crate::model::{CellRect, Deck, Place};
use crate::ops::{Op, Scope, op_types};

op_types! {
    /// Joins a block of cells into one.
    pub struct MergeCells {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// One corner of the block, counted from 0.
        pub from: Place,
        /// The opposite corner.
        pub to: Place,
    }
}

impl Op for MergeCells {
    type Output = ();
    const NAME: &'static str = "merge_cells";
    const ABOUT: &'static str = "Join the cells of a table from `from` to `to` (opposite corners, counted from 0) into one cell at the block's top left. The words of the cells that have any become paragraphs of the one, in reading order. A block that takes in only part of a merged cell is refused, and so is a block of one cell.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let block = CellRect::new(self.from, self.to);
        edit(cx, Self::NAME, &self.slide, &self.id, |table, _| {
            let mut matrix = table.to_matrix().map_err(Error::refused)?;
            matrix.merge(block).map_err(Error::refused)?;
            table.from_matrix(matrix);
            Ok(())
        })
    }
}

op_types! {
    /// Splits a merged cell.
    pub struct UnmergeCells {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// Any place the merged cell covers, counted from 0.
        pub at: Place,
    }
}

impl Op for UnmergeCells {
    type Output = ();
    const NAME: &'static str = "unmerge_cells";
    const ABOUT: &'static str = "Split the merged cell of a table that covers `at` (counted from 0) back into cells of one place each. The words and the fill stay in the top left one; the others are empty. Refused for a cell that is not merged.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let at = self.at;
        edit(cx, Self::NAME, &self.slide, &self.id, |table, _| {
            let mut matrix = table.to_matrix().map_err(Error::refused)?;
            matrix.unmerge(at).map_err(Error::refused)?;
            table.from_matrix(matrix);
            Ok(())
        })
    }
}
