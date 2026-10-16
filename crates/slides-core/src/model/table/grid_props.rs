//! Properties of the grid: a table goes through its matrix and comes back the same, and whatever is
//! done to the grid, the table that comes out follows the rules.

use proptest::prelude::*;

use super::grid_tests::{cell, table};
use super::*;
use crate::model::TableEl;

/// A random table that follows the rules: up to five columns and five rows of plain cells, some of
/// them merged, some rows stopping short, and some spans of 1 written out as a file may.
fn random_table() -> impl Strategy<Value = TableEl> {
    (
        1usize..6,
        1usize..6,
        proptest::collection::vec((0usize..6, 0usize..6, 0usize..6, 0usize..6), 0..5),
        proptest::collection::vec(any::<bool>(), 6),
        proptest::collection::vec(any::<bool>(), 6),
    )
        .prop_map(|(columns, rows, merges, short, written)| {
            let mut n = 0;
            let body = (0..rows)
                .map(|_| {
                    (0..columns)
                        .map(|_| {
                            n += 1;
                            cell(&format!("w{n}"), 0, 0)
                        })
                        .collect()
                })
                .collect();
            let mut t = table(columns, body);
            for (a, b, c, d) in merges {
                let Ok(mut m) = t.to_matrix() else {
                    continue;
                };
                let block = CellRect::new(
                    Place::new(a % rows, b % columns),
                    Place::new(c % rows, d % columns),
                );
                if m.merge(block).is_ok() {
                    t.from_matrix(m);
                }
            }
            for (r, row) in t.rows.iter_mut().enumerate() {
                // A row may stop short: its last cell goes when it stretches over no row below.
                if short[r] && row.cells.last().is_some_and(|c| c.row_span.is_none()) {
                    row.cells.pop();
                }
                if written[r]
                    && let Some(first) = row.cells.first_mut()
                    && first.col_span.is_none()
                {
                    first.col_span = Some(1);
                }
            }
            t
        })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]

    #[test]
    fn a_fitted_table_goes_through_its_matrix_and_comes_back_the_same(t in random_table()) {
        prop_assert_eq!(t.problem(), None);
        let mut again = t.clone();
        let m = t.to_matrix().map_err(TestCaseError::fail)?;
        again.from_matrix(m);
        prop_assert_eq!(&again, &t);
    }

    #[test]
    fn whatever_is_done_to_the_grid_the_table_still_follows_the_rules(
        t in random_table(),
        edits in proptest::collection::vec((0u8..6, 0usize..8, 0usize..8, 0usize..8, 0usize..8), 1..12),
    ) {
        let mut t = t;
        for (kind, a, b, c, d) in edits {
            let mut m = t.to_matrix().map_err(TestCaseError::fail)?;
            let (rows, columns) = (m.rows.len(), m.columns);
            let done = match kind {
                0 => { m.insert_lines(Along::Rows, a % (rows + 1), 1 + b % 3); Ok(()) }
                1 => { m.insert_lines(Along::Columns, a % (columns + 1), 1 + b % 3); Ok(()) }
                2 if rows > 0 => m.delete_lines(Along::Rows, a % rows, 1 + b % 2),
                3 if columns > 0 => m.delete_lines(Along::Columns, a % columns, 1 + b % 2),
                4 if rows > 0 && columns > 0 => m.merge(CellRect::new(
                    Place::new(a % rows, b % columns),
                    Place::new(c % rows, d % columns),
                )),
                5 if rows > 0 && columns > 0 => m.unmerge(Place::new(a % rows, b % columns)),
                _ => Err(String::new()),
            };
            if done.is_err() {
                continue;
            }
            // No two cells cover one place, and every cell is inside the grid.
            let mut seen = std::collections::HashSet::new();
            for placed in &m.cells {
                prop_assert!(placed.at.row + placed.down <= m.rows.len());
                prop_assert!(placed.at.col + placed.across <= m.columns);
                for place in placed.rect().places() {
                    prop_assert!(seen.insert(place), "{place:?} is covered twice");
                }
            }
            t.columns = vec![10.0; m.columns];
            let kept: Vec<(Place, usize, usize)> = m.cells.iter().map(|p| (p.at, p.across, p.down)).collect();
            t.from_matrix(m);
            prop_assert_eq!(t.problem(), None);
            let back = t.to_matrix().map_err(TestCaseError::fail)?;
            for (at, across, down) in kept {
                let found = back.cells.iter().any(|p| p.at == at && p.across == across && p.down == down);
                prop_assert!(found, "the cell at {at:?} is not where it was");
            }
        }
    }
}
