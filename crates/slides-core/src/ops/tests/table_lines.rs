//! Rows and columns added to a table and taken away: how big the new ones are, how the box
//! follows, what happens to cells that stretch across the line, and the limits.

use serde_json::{Value, json};

use super::table_kit::{TABLE, done, expect, rect, refused, setup, table, table_json, with, words};
use crate::error::Error;

fn at(row: usize, col: usize) -> Value {
    json!({ "row": row, "col": col })
}

fn on(s: &str, mut input: Value) -> Value {
    input["slide"] = json!(s);
    input["id"] = json!(TABLE);
    input
}

fn heights(t: &crate::model::TableEl) -> Vec<f64> {
    t.rows.iter().map(|r| r.height.unwrap_or(0.0)).collect()
}

#[test]
fn rows_inserted_inside_a_merged_cell_make_it_longer() {
    let (mut e, s) = setup(3, 3);
    done(
        &mut e,
        &s,
        "merge_cells",
        json!({ "from": at(0, 1), "to": at(1, 1) }),
    );
    done(&mut e, &s, "insert_rows", json!({ "at": 1, "count": 2 }));
    let t = table(&e, &s);
    assert_eq!(t.rows.len(), 5);
    assert_eq!(
        t.rows[0].cells[1].row_span,
        Some(4),
        "the merged cell now covers the new rows"
    );
    // The merged cell covers the middle place of the two rows between its first row and its old last.
    assert_eq!(t.rows[1].cells.len(), 2);
    assert_eq!(t.rows[2].cells.len(), 2);
    assert_eq!(words(t)[3], ["r1c0", "r1c2"].map(String::from).to_vec());
    // Each new row is as tall as the row above it (100), and the box grows by that.
    assert_eq!(rect(&e, &s, TABLE), (40.0, 40.0, 600.0, 500.0));
    assert_eq!(heights(t), vec![100.0; 5]);
}

#[test]
fn rows_inserted_at_the_edge_of_a_merged_cell_leave_it_as_it_is() {
    let (mut e, s) = setup(3, 3);
    done(
        &mut e,
        &s,
        "merge_cells",
        json!({ "from": at(1, 0), "to": at(2, 0) }),
    );
    done(&mut e, &s, "insert_rows", json!({ "at": 1 }));
    let t = table(&e, &s);
    assert_eq!(
        t.rows[2].cells[0].row_span,
        Some(2),
        "it starts at the line and moves down"
    );
    assert_eq!(
        words(t)[1],
        vec![String::new(); 3],
        "a whole new row of empty cells"
    );
    // After the last row.
    done(&mut e, &s, "insert_rows", json!({ "at": 4 }));
    assert_eq!(table(&e, &s).rows.len(), 5);
}

#[test]
fn a_new_row_takes_the_height_of_the_row_above_and_the_box_stays_on_the_slide() {
    let mut json = table_json(2, 2);
    json["h"] = json!(100);
    json["rows"][0]["height"] = json!(40);
    json["rows"][1]["height"] = json!(60);
    let (mut e, s) = with(json);
    done(&mut e, &s, "insert_rows", json!({ "at": 1 }));
    assert_eq!(heights(table(&e, &s)), vec![40.0, 40.0, 60.0]);
    assert_eq!(rect(&e, &s, TABLE).3, 140.0);
    // Above the first row there is none above: the first row's height is used.
    done(&mut e, &s, "insert_rows", json!({ "at": 0, "count": 2 }));
    assert_eq!(heights(table(&e, &s)), vec![40.0, 40.0, 40.0, 40.0, 60.0]);
    assert_eq!(rect(&e, &s, TABLE).3, 220.0);

    // Ten rows more would take the table off the slide (540 less the 40 it starts at): the box
    // stops at the edge and the rows share what it has.
    let (mut e, s) = setup(3, 3);
    done(&mut e, &s, "insert_rows", json!({ "at": 3, "count": 10 }));
    let t = table(&e, &s);
    assert_eq!(t.rows.len(), 13);
    assert_eq!(rect(&e, &s, TABLE).3, 500.0);
    assert!((heights(t).iter().sum::<f64>() - 500.0).abs() < 0.2);
    assert!(
        t.rows[3..]
            .iter()
            .all(|r| r.cells.iter().all(|c| c.text.is_blank()))
    );
}

#[test]
fn columns_are_inserted_as_wide_as_the_one_to_their_left() {
    let mut json = table_json(3, 2);
    json["columns"] = json!([100, 200, 300]);
    let (mut e, s) = with(json);
    done(&mut e, &s, "insert_columns", json!({ "at": 3 }));
    assert_eq!(table(&e, &s).columns, vec![100.0, 200.0, 300.0, 300.0]);
    assert_eq!(rect(&e, &s, TABLE).2, 900.0);
    done(&mut e, &s, "insert_columns", json!({ "at": 0 }));
    // Five columns of 100, 100, 200, 300 and 300 would make a box 1000 wide; it stops at the
    // slide's edge (960 less the 40 it starts at), and the columns share that.
    assert_eq!(table(&e, &s).columns, vec![92.0, 92.0, 184.0, 276.0, 276.0]);
    assert_eq!(rect(&e, &s, TABLE).2, 920.0);
}

#[test]
fn a_column_inserted_inside_a_wide_cell_widens_it() {
    let (mut e, s) = setup(3, 2);
    done(
        &mut e,
        &s,
        "merge_cells",
        json!({ "from": at(0, 0), "to": at(0, 2) }),
    );
    done(&mut e, &s, "insert_columns", json!({ "at": 2 }));
    let t = table(&e, &s);
    assert_eq!(t.rows[0].cells[0].col_span, Some(4));
    assert_eq!(t.rows[0].cells.len(), 1);
    assert_eq!(t.rows[1].cells.len(), 4);
    assert_eq!(t.column_count(), 4);
}

#[test]
fn a_table_without_widths_gets_them_when_a_column_is_added() {
    let mut json = table_json(2, 2);
    json["columns"] = json!([]);
    let (mut e, s) = with(json);
    done(&mut e, &s, "insert_columns", json!({ "at": 1 }));
    let t = table(&e, &s);
    assert_eq!(
        t.columns,
        vec![300.0; 3],
        "every column is written out, as wide as the ones there were"
    );
    assert_eq!(words(t)[0], ["r0c0", "", "r0c1"].map(String::from).to_vec());
    assert_eq!(rect(&e, &s, TABLE).2, 900.0);
}

#[test]
fn a_table_with_no_rows_takes_new_rows_that_share_its_box() {
    let mut json = table_json(2, 1);
    json["rows"] = json!([]);
    let (mut e, s) = with(json);
    done(&mut e, &s, "insert_rows", json!({ "at": 0, "count": 2 }));
    let t = table(&e, &s);
    assert_eq!(heights(t), vec![150.0, 150.0]);
    assert_eq!(words(t), vec![vec![String::new(); 2]; 2]);
    assert_eq!(rect(&e, &s, TABLE).3, 300.0);
}

#[test]
fn deleting_the_row_a_merged_cell_starts_in_moves_its_origin_and_keeps_its_words() {
    let (mut e, s) = setup(3, 3);
    done(
        &mut e,
        &s,
        "merge_cells",
        json!({ "from": at(1, 0), "to": at(2, 0) }),
    );
    done(&mut e, &s, "delete_rows", json!({ "from": 1 }));
    let t = table(&e, &s);
    assert_eq!(
        words(t),
        vec![
            ["r0c0", "r0c1", "r0c2"].map(String::from).to_vec(),
            ["r1c0\nr2c0", "r2c1", "r2c2"].map(String::from).to_vec(),
        ]
    );
    assert_eq!(t.rows[1].cells[0].row_span, None, "one row is no span");
    assert_eq!(
        rect(&e, &s, TABLE).3,
        200.0,
        "the box is shorter by the row's height"
    );
    assert_eq!(heights(t), vec![100.0, 100.0]);
}

#[test]
fn deleting_rows_that_a_merged_cell_reaches_into_shortens_it() {
    let (mut e, s) = setup(3, 4);
    done(
        &mut e,
        &s,
        "merge_cells",
        json!({ "from": at(0, 1), "to": at(2, 1) }),
    );
    done(&mut e, &s, "delete_rows", json!({ "from": 2, "count": 2 }));
    let t = table(&e, &s);
    assert_eq!(t.rows[0].cells[1].row_span, Some(2));
    assert_eq!(t.rows.len(), 2);
    assert_eq!(rect(&e, &s, TABLE).3, 150.0);
}

#[test]
fn deleting_columns_narrows_the_box_and_drops_the_cells_in_them() {
    let (mut e, s) = setup(3, 3);
    done(
        &mut e,
        &s,
        "delete_columns",
        json!({ "from": 1, "count": 2 }),
    );
    let t = table(&e, &s);
    assert_eq!(words(t), expect(&[&["r0c0"], &["r1c0"], &["r2c0"]]));
    assert_eq!(t.columns, vec![200.0]);
    assert_eq!(rect(&e, &s, TABLE).2, 200.0);
}

#[test]
fn deleting_every_row_or_column_or_ones_that_are_not_there_is_refused() {
    let (mut e, s) = setup(3, 3);
    let rows = refused(
        &mut e,
        "delete_rows",
        on(&s, json!({ "from": 0, "count": 3 })),
    );
    assert!(
        rows.contains("every row") && rows.contains("delete the table instead"),
        "{rows}"
    );
    let columns = refused(
        &mut e,
        "delete_columns",
        on(&s, json!({ "from": 0, "count": 4 })),
    );
    assert!(
        columns.contains("3 columns") && columns.contains("not all there"),
        "{columns}"
    );
    let columns = refused(
        &mut e,
        "delete_columns",
        on(&s, json!({ "from": 0, "count": 3 })),
    );
    assert!(columns.contains("delete the table instead"), "{columns}");
    let past = refused(
        &mut e,
        "delete_rows",
        on(&s, json!({ "from": 2, "count": 2 })),
    );
    assert!(
        past.contains("3 rows") && past.contains("from 2 to 3"),
        "{past}"
    );
    let far = refused(&mut e, "insert_rows", on(&s, json!({ "at": 9 })));
    assert!(far.contains("added at 0 to 3, not 9"), "{far}");
}

#[test]
fn how_many_rows_or_columns_is_between_one_and_five_hundred() {
    let (mut e, s) = setup(3, 3);
    for count in [0, 501] {
        for (op, key) in [
            ("insert_rows", "at"),
            ("delete_columns", "from"),
            ("insert_columns", "at"),
            ("delete_rows", "from"),
        ] {
            let message = refused(&mut e, op, on(&s, json!({ key: 0, "count": count })));
            assert!(
                message.contains("between 1 and 500"),
                "{op} {count}: {message}"
            );
        }
    }
    assert!(matches!(
        e.apply("insert_rows", on(&s, json!({ "at": 0, "count": -1 }))),
        Err(Error::BadInput { .. })
    ));
    done(&mut e, &s, "insert_rows", json!({ "at": 3, "count": 500 }));
    assert_eq!(table(&e, &s).rows.len(), 503);
}

#[test]
fn a_table_cannot_get_more_rows_columns_or_places_than_a_table_may_have() {
    let tight = |columns: usize, rows: usize| {
        let cell = json!({ "text": { "paragraphs": [] } });
        let line = json!({ "cells": vec![cell; columns] });
        let mut json = table_json(1, 1);
        json["columns"] = json!(vec![1; columns]);
        json["rows"] = json!(vec![line; rows]);
        with(json)
    };
    // 100 by 500 is 50000 places, all there may be: one more of either is too many.
    let (mut e, s) = tight(100, 500);
    let message = refused(&mut e, "insert_rows", on(&s, json!({ "at": 0 })));
    assert!(
        message.contains("50000 places") && message.contains("100 columns and 501 rows"),
        "{message}"
    );
    let message = refused(&mut e, "insert_columns", on(&s, json!({ "at": 0 })));
    assert!(
        message.contains("50000 places") && message.contains("101 columns and 500 rows"),
        "{message}"
    );
    let message = refused(
        &mut e,
        "set_cells",
        on(
            &s,
            json!({ "at": at(500, 0), "cells": [[{ "markdown": "x" }]] }),
        ),
    );
    assert!(message.contains("50000 places"), "{message}");
    let (mut e, s) = tight(1000, 1);
    let message = refused(&mut e, "insert_columns", on(&s, json!({ "at": 0 })));
    assert!(
        message.contains("at most 1000 columns") && message.contains("1001"),
        "{message}"
    );
    let (mut e, s) = tight(1, 10_000);
    let message = refused(&mut e, "insert_rows", on(&s, json!({ "at": 0 })));
    assert!(
        message.contains("at most 10000 rows") && message.contains("10001"),
        "{message}"
    );
    // Taking one away makes room for one.
    done(&mut e, &s, "delete_rows", json!({ "from": 0 }));
    done(&mut e, &s, "insert_rows", json!({ "at": 0 }));
}
