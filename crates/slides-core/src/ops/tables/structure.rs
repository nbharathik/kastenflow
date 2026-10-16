//! Rows and columns added to a table and taken away from it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Cx, count_ok, edit, size};
use crate::error::{Error, Result};
use crate::model::{Along, Deck};
use crate::ops::{Op, Scope, op_types};

fn one() -> usize {
    1
}

fn is_one(n: &usize) -> bool {
    *n == 1
}

/// Adds `count` rows or columns at `at` to the table.
fn insert(
    cx: &mut Cx,
    op: &str,
    slide: &str,
    id: &str,
    along: Along,
    at: usize,
    count: usize,
) -> Result<()> {
    count_ok(op, count)?;
    edit(cx, op, slide, id, |table, frame| {
        size::insert(table, frame, along, at, count).map_err(Error::refused)
    })
}

/// Takes `count` rows or columns from `from` away from the table.
fn remove(
    cx: &mut Cx,
    op: &str,
    slide: &str,
    id: &str,
    along: Along,
    from: usize,
    count: usize,
) -> Result<()> {
    count_ok(op, count)?;
    edit(cx, op, slide, id, |table, frame| {
        size::remove(table, frame, along, from, count).map_err(Error::refused)
    })
}

op_types! {
    /// Adds rows to a table.
    pub struct InsertRows {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// The new rows go in front of this row, counted from 0: 0 puts them above the first row, and the number of rows puts them after the last.
        pub at: usize,
        /// How many rows, 1 to 500; 1 when left out.
        #[serde(default = "one", skip_serializing_if = "is_one")]
        pub count: usize,
    }
}

impl Op for InsertRows {
    type Output = ();
    const NAME: &'static str = "insert_rows";
    const ABOUT: &'static str = "Insert rows into a table in front of row `at` (counted from 0: 0 puts them above the first row, the number of rows after the last). Each new row is as tall as the row above it (the first row, when there is none), the table's box grows by that much while it stays on the slide, and a merged cell that stretches across the new rows gets longer. The new cells are empty. A table has at most 10000 rows, 1000 columns and 50000 places.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        insert(
            cx,
            Self::NAME,
            &self.slide,
            &self.id,
            Along::Rows,
            self.at,
            self.count,
        )
    }
}

op_types! {
    /// Takes rows away from a table.
    pub struct DeleteRows {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// The first row to delete, counted from 0.
        pub from: usize,
        /// How many rows, 1 to 500; 1 when left out.
        #[serde(default = "one", skip_serializing_if = "is_one")]
        pub count: usize,
    }
}

impl Op for DeleteRows {
    type Output = ();
    const NAME: &'static str = "delete_rows";
    const ABOUT: &'static str = "Delete rows of a table, `count` of them from row `from` (counted from 0). The table's box gets shorter by their height. A merged cell that reaches into them gets shorter; one whose first row is deleted keeps its words and starts at the first row that stays. A table keeps at least one row: to remove the whole table, use delete_elements.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        remove(
            cx,
            Self::NAME,
            &self.slide,
            &self.id,
            Along::Rows,
            self.from,
            self.count,
        )
    }
}

op_types! {
    /// Adds columns to a table.
    pub struct InsertColumns {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// The new columns go in front of this column, counted from 0: 0 puts them left of the first column, and the number of columns puts them after the last.
        pub at: usize,
        /// How many columns, 1 to 500; 1 when left out.
        #[serde(default = "one", skip_serializing_if = "is_one")]
        pub count: usize,
    }
}

impl Op for InsertColumns {
    type Output = ();
    const NAME: &'static str = "insert_columns";
    const ABOUT: &'static str = "Insert columns into a table in front of column `at` (counted from 0: 0 puts them left of the first column, the number of columns after the last). Each new column is as wide as the column to its left (the first column, when there is none), the table's box grows by that much while it stays on the slide, and a merged cell that stretches across the new columns gets wider. The new cells are empty. A table has at most 10000 rows, 1000 columns and 50000 places.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        insert(
            cx,
            Self::NAME,
            &self.slide,
            &self.id,
            Along::Columns,
            self.at,
            self.count,
        )
    }
}

op_types! {
    /// Takes columns away from a table.
    pub struct DeleteColumns {
        pub slide: String,
        /// The table's id.
        pub id: String,
        /// The first column to delete, counted from 0.
        pub from: usize,
        /// How many columns, 1 to 500; 1 when left out.
        #[serde(default = "one", skip_serializing_if = "is_one")]
        pub count: usize,
    }
}

impl Op for DeleteColumns {
    type Output = ();
    const NAME: &'static str = "delete_columns";
    const ABOUT: &'static str = "Delete columns of a table, `count` of them from column `from` (counted from 0). The table's box gets narrower by their width. A merged cell that reaches into them gets narrower; one whose first column is deleted keeps its words and starts at the first column that stays. A table keeps at least one column: to remove the whole table, use delete_elements.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        remove(
            cx,
            Self::NAME,
            &self.slide,
            &self.id,
            Along::Columns,
            self.from,
            self.count,
        )
    }
}
