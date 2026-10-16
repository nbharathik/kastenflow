use serde_json::{Value, json};

use super::*;
use crate::model::TableEl;

pub(super) fn cell(label: &str, col: u32, row: u32) -> Value {
    let mut cell = json!({ "text": { "paragraphs": [{ "runs": [{ "t": label }] }] } });
    if col != 0 {
        cell["colSpan"] = json!(col);
    }
    if row != 0 {
        cell["rowSpan"] = json!(row);
    }
    cell
}

pub(super) fn table(columns: usize, rows: Vec<Vec<Value>>) -> TableEl {
    let rows: Vec<Value> = rows.into_iter().map(|c| json!({ "cells": c })).collect();
    serde_json::from_value(json!({ "id": "t", "columns": vec![10.0; columns], "rows": rows }))
        .unwrap_or_else(|e| panic!("a table: {e}"))
}

/// A 3 by 3 table of plain cells, labelled by their place: `00`, `01` ...
fn plain() -> TableEl {
    table(
        3,
        (0..3)
            .map(|r| (0..3).map(|c| cell(&format!("{r}{c}"), 0, 0)).collect())
            .collect(),
    )
}

/// The table of the notes below: a wide cell, a tall one, and a short last row.
///
/// ```text
/// a a b
/// c d e
/// c f g
/// ```
fn mixed() -> TableEl {
    table(
        3,
        vec![
            vec![cell("a", 2, 0), cell("b", 0, 0)],
            vec![cell("c", 0, 2), cell("d", 0, 0), cell("e", 0, 0)],
            vec![cell("f", 0, 0), cell("g", 0, 0)],
        ],
    )
}

/// Each cell as `words@row,col WxH`, in reading order.
fn cells(t: &TableEl) -> Vec<String> {
    let mut matrix = t.to_matrix().unwrap_or_else(|e| panic!("{e}"));
    matrix.cells.sort_by_key(|p| p.at);
    matrix
        .cells
        .iter()
        .map(|p| {
            format!(
                "{}@{},{} {}x{}",
                p.cell.text.plain_text().replace('\n', "+"),
                p.at.row,
                p.at.col,
                p.across,
                p.down
            )
        })
        .collect()
}

/// Changes the table through its matrix and writes it back, as the operations do.
fn edit(t: &mut TableEl, f: impl FnOnce(&mut Matrix) -> Result<(), String>) -> Result<(), String> {
    let mut m = t.to_matrix()?;
    f(&mut m)?;
    t.columns = vec![10.0; m.columns];
    t.from_matrix(m);
    assert_eq!(t.problem(), None, "{:?}", cells(t));
    Ok(())
}

#[test]
fn the_cells_of_a_table_are_placed_the_way_html_places_them() {
    let t = mixed();
    assert_eq!(
        cells(&t),
        [
            "a@0,0 2x1",
            "b@0,2 1x1",
            "c@1,0 1x2",
            "d@1,1 1x1",
            "e@1,2 1x1",
            "f@2,1 1x1",
            "g@2,2 1x1",
        ]
    );
    let m = t.to_matrix().unwrap_or_else(|e| panic!("{e}"));
    assert_eq!((m.columns, m.rows.len()), (3, 3));
    assert_eq!(m.anchors().len(), 7);
    let owners = m.owners();
    // Every place of the wide cell and of the tall one belongs to it.
    for (place, words) in [
        (Place::new(0, 1), "a"),
        (Place::new(2, 0), "c"),
        (Place::new(2, 2), "g"),
    ] {
        let at = owners.at(place).unwrap_or_else(|| panic!("{place:?}"));
        assert_eq!(m.cells[at].cell.text.plain_text(), words);
        assert_eq!(m.owner_at(place), Some(at));
    }
    assert_eq!(owners.at(Place::new(3, 0)), None, "outside the table");
}

#[test]
fn a_table_that_breaks_the_rules_has_no_grid() {
    let t = table(2, vec![vec![cell("x", 3, 0)]]);
    let err = t.to_matrix().expect_err("a span past the end");
    assert!(err.contains("colSpan is 3"), "{err}");
}

#[test]
fn cells_that_reach_over_each_other_have_no_grid_because_their_places_cannot_be_told_apart() {
    // The second cell of the first row stretches down over the place the wide cell below starts at.
    let t = table(
        2,
        vec![
            vec![cell("a", 0, 0), cell("b", 0, 2)],
            vec![cell("c", 2, 0)],
        ],
    );
    assert_eq!(t.problem(), None, "the rules let such a table be drawn");
    let err = t.to_matrix().expect_err("two cells over one place");
    assert!(
        err.contains("row 1, column 0 reaches over row 1, column 1")
            && err.contains("patch_elements"),
        "{err}"
    );
}

#[test]
fn a_short_row_stays_short_and_an_unwritten_span_of_one_stays_unwritten() {
    let mut t = table(
        3,
        vec![
            vec![cell("a", 1, 1)],
            vec![cell("b", 0, 0), cell("c", 0, 0)],
        ],
    );
    let before = t.clone();
    let m = t.to_matrix().unwrap_or_else(|e| panic!("{e}"));
    t.from_matrix(m);
    assert_eq!(t, before);
    assert_eq!(t.rows[0].cells[0].col_span, Some(1), "a written 1 stays");
    assert_eq!(t.rows[1].cells[0].col_span, None);
}

#[test]
fn a_gap_in_a_row_is_filled_because_a_row_cannot_leave_one() {
    let mut t = plain();
    let result = edit(&mut t, |m| {
        // Take the middle cell of the first row away: the cell to its right would slide left.
        m.cells.retain(|p| p.at != Place::new(0, 1));
        Ok(())
    });
    assert_eq!(result, Ok(()));
    assert_eq!(cells(&t)[..3], ["00@0,0 1x1", "@0,1 1x1", "02@0,2 1x1"]);
}

#[test]
fn a_line_inserted_inside_a_cell_makes_it_longer_and_one_at_its_edge_does_not() {
    let mut t = mixed();
    // Between the two rows the tall cell covers.
    let result = edit(&mut t, |m| {
        m.insert_lines(Along::Rows, 2, 1);
        Ok(())
    });
    assert_eq!(result, Ok(()));
    assert_eq!(
        cells(&t),
        [
            "a@0,0 2x1",
            "b@0,2 1x1",
            "c@1,0 1x3",
            "d@1,1 1x1",
            "e@1,2 1x1",
            "@2,1 1x1",
            "@2,2 1x1",
            "f@3,1 1x1",
            "g@3,2 1x1",
        ]
    );
    // Above the tall cell: nothing is stretched, the new row is empty.
    let mut t = mixed();
    let result = edit(&mut t, |m| {
        m.insert_lines(Along::Rows, 1, 2);
        Ok(())
    });
    assert_eq!(result, Ok(()));
    assert_eq!(cells(&t)[2..5], ["@1,0 1x1", "@1,1 1x1", "@1,2 1x1"]);
    assert_eq!(t.rows.len(), 5);
    assert!(cells(&t).contains(&"c@3,0 1x2".to_owned()));
}

#[test]
fn a_column_inserted_inside_a_wide_cell_widens_it() {
    let mut t = mixed();
    let result = edit(&mut t, |m| {
        m.insert_lines(Along::Columns, 1, 1);
        Ok(())
    });
    assert_eq!(result, Ok(()));
    let list = cells(&t);
    assert!(list.contains(&"a@0,0 3x1".to_owned()), "{list:?}");
    assert!(list.contains(&"b@0,3 1x1".to_owned()), "{list:?}");
    assert!(list.contains(&"@1,1 1x1".to_owned()), "{list:?}");
    // The new column has no place in the first row to fill: the wide cell covers it.
    assert_eq!(t.rows[0].cells.len(), 2);
    assert_eq!(t.column_count(), 4);
}

#[test]
fn deleting_the_row_a_tall_cell_starts_in_moves_its_origin_and_keeps_its_words() {
    let mut t = mixed();
    assert_eq!(edit(&mut t, |m| m.delete_lines(Along::Rows, 1, 1)), Ok(()));
    assert_eq!(
        cells(&t),
        [
            "a@0,0 2x1",
            "b@0,2 1x1",
            "c@1,0 1x1",
            "f@1,1 1x1",
            "g@1,2 1x1"
        ]
    );
}

#[test]
fn deleting_a_column_shortens_the_cells_that_reach_into_it_and_drops_the_ones_inside() {
    let mut t = mixed();
    assert_eq!(
        edit(&mut t, |m| m.delete_lines(Along::Columns, 1, 1)),
        Ok(())
    );
    let list = cells(&t);
    assert!(list.contains(&"a@0,0 1x1".to_owned()), "{list:?}");
    assert!(list.contains(&"b@0,1 1x1".to_owned()), "{list:?}");
    assert!(list.contains(&"e@1,1 1x1".to_owned()), "{list:?}");
    assert!(
        list.iter()
            .all(|c| !c.starts_with("d@") && !c.starts_with("f@"))
    );
    // The column the wide cell starts in: it starts at the first place that stays.
    let mut t = mixed();
    assert_eq!(
        edit(&mut t, |m| m.delete_lines(Along::Columns, 0, 1)),
        Ok(())
    );
    let list = cells(&t);
    assert!(list.contains(&"a@0,0 1x1".to_owned()), "{list:?}");
    assert!(list.iter().all(|c| !c.starts_with("c@")), "{list:?}");
}

#[test]
fn deleting_every_line_or_lines_that_are_not_there_is_refused() {
    let t = plain();
    let mut m = t.to_matrix().unwrap_or_else(|e| panic!("{e}"));
    let err = m.delete_lines(Along::Rows, 0, 3).expect_err("every row");
    assert!(err.contains("delete the table instead"), "{err}");
    let err = m
        .delete_lines(Along::Columns, 0, 3)
        .expect_err("every column");
    assert!(
        err.contains("every column") && err.contains("delete the table"),
        "{err}"
    );
    let err = m.delete_lines(Along::Rows, 2, 2).expect_err("past the end");
    assert!(
        err.contains("3 rows") && err.contains("from 2 to 3"),
        "{err}"
    );
    assert!(m.delete_lines(Along::Rows, 0, 0).is_err());
    assert_eq!(m, t.to_matrix().unwrap_or_else(|e| panic!("{e}")));
}

#[test]
fn merging_joins_the_words_that_are_there_as_paragraphs() {
    let mut t = plain();
    t.rows[0].cells[1].text = crate::model::Text::plain("  ");
    let block = CellRect::new(Place::new(1, 1), Place::new(0, 0));
    assert_eq!(edit(&mut t, |m| m.merge(block)), Ok(()));
    let list = cells(&t);
    assert_eq!(list[0], "00+10+11@0,0 2x2", "{list:?}");
    assert_eq!(list.len(), 6, "{list:?}");
    assert_eq!(t.rows[0].cells.len(), 2);
    assert_eq!(
        t.rows[1].cells.len(),
        1,
        "the row below has the merged cell above it"
    );
    assert_eq!(t.rows[0].cells[0].col_span, Some(2));
    assert_eq!(t.rows[0].cells[0].row_span, Some(2));
}

#[test]
fn merging_empty_cells_keeps_the_first_ones_words() {
    let mut t = plain();
    for c in &mut t.rows[1].cells {
        c.text = crate::model::Text::plain("");
    }
    let block = CellRect::new(Place::new(0, 0), Place::new(1, 0));
    assert_eq!(edit(&mut t, |m| m.merge(block)), Ok(()));
    assert_eq!(cells(&t)[0], "00@0,0 1x2");
}

#[test]
fn a_block_that_cuts_a_merged_cell_is_refused_in_words_that_name_it() {
    let mut t = plain();
    let block = CellRect::new(Place::new(0, 0), Place::new(1, 1));
    assert_eq!(edit(&mut t, |m| m.merge(block)), Ok(()));
    let before = cells(&t);
    let cut = CellRect::new(Place::new(1, 1), Place::new(2, 2));
    let err = edit(&mut t, |m| m.merge(cut)).expect_err("cuts the merged cell");
    assert_eq!(
        err,
        "The cells from row 1, column 1 to row 2, column 2 cut through the merged cell at row 0, column 0 (2 columns by 2 rows). Unmerge it, or take in all of it."
    );
    assert_eq!(cells(&t), before, "nothing changed");
    // A block that takes in all of it is fine, and so is one that takes none of it.
    let all = CellRect::new(Place::new(0, 0), Place::new(2, 2));
    assert_eq!(edit(&mut t, |m| m.merge(all)), Ok(()));
    assert_eq!(cells(&t).len(), 1);
}

#[test]
fn one_cell_is_nothing_to_merge_and_a_block_off_the_table_is_refused() {
    let t = plain();
    let m = t.to_matrix().unwrap_or_else(|e| panic!("{e}"));
    let one = CellRect::at(Place::new(1, 1));
    let err = m.clone().merge(one).expect_err("one cell");
    assert!(err.contains("one cell already"), "{err}");
    let off = CellRect::new(Place::new(2, 2), Place::new(3, 4));
    let err = m.clone().merge(off).expect_err("off the table");
    assert!(
        err.contains("reach past the table") && err.contains("3 rows and 3 columns"),
        "{err}"
    );
}

#[test]
fn unmerging_leaves_empty_cells_and_refuses_a_cell_that_is_not_merged() {
    let mut t = plain();
    let block = CellRect::new(Place::new(0, 1), Place::new(1, 2));
    assert_eq!(edit(&mut t, |m| m.merge(block)), Ok(()));
    // Any place of the merged cell finds it.
    assert_eq!(edit(&mut t, |m| m.unmerge(Place::new(1, 2))), Ok(()));
    let list = cells(&t);
    assert_eq!(list.len(), 9);
    assert!(list.contains(&"01+02+11+12@0,1 1x1".to_owned()), "{list:?}");
    assert!(list.contains(&"@0,2 1x1".to_owned()), "{list:?}");
    let err = edit(&mut t, |m| m.unmerge(Place::new(0, 0))).expect_err("not merged");
    assert!(err.contains("row 0, column 0 is not merged"), "{err}");
    let err = edit(&mut t, |m| m.unmerge(Place::new(5, 0))).expect_err("no cell");
    assert!(err.contains("no cell at row 5"), "{err}");
}
