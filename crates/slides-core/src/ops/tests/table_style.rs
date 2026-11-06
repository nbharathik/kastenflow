//! Table styles, the lines around cells, and the sizes of columns and rows: each is one step of
//! undo, and a refusal leaves the table as it was.

use serde_json::json;

use super::table_kit::{TABLE, done, rect, refused, setup, table};

/// The rest of an operation's input; `done` adds the slide and the table.
fn input(extra: serde_json::Value) -> serde_json::Value {
    extra
}

#[test]
fn a_style_shades_alternate_rows_until_told_otherwise() {
    let (mut e, slide) = setup(3, 4);
    done(
        &mut e,
        &slide,
        "set_table_style",
        input(json!({ "preset": "accent", "headerRow": true })),
    );
    let t = table(&e, &slide);
    let style = t.table_style.clone().expect("a style");
    assert_eq!((style.preset.as_str(), style.banded_rows), ("accent", true));
    assert!(t.header_row);
    done(
        &mut e,
        &slide,
        "set_table_style",
        input(json!({ "bandedRows": false, "firstColumn": true, "lastRow": true })),
    );
    let style = table(&e, &slide).table_style.clone().unwrap();
    assert!(!style.banded_rows && style.first_column && style.last_row);
    assert_eq!(
        style.preset, "accent",
        "the style is kept when only the flags change"
    );
}

#[test]
fn none_takes_the_style_away_and_an_unknown_one_is_refused() {
    let (mut e, slide) = setup(2, 2);
    e.apply(
        "set_table_style",
        json!({ "slide": slide, "id": TABLE, "preset": "rules" }),
    )
    .unwrap();
    let said = refused(
        &mut e,
        "set_table_style",
        json!({ "slide": slide, "id": TABLE, "preset": "neon" }),
    );
    assert!(said.contains("neon") && said.contains("accent"), "{said}");
    done(
        &mut e,
        &slide,
        "set_table_style",
        input(json!({ "preset": "none" })),
    );
    assert!(table(&e, &slide).table_style.is_none());
}

#[test]
fn borders_go_on_the_outside_of_a_block_and_on_the_neighbours_that_share_them() {
    let (mut e, slide) = setup(3, 3);
    let stroke = json!({ "color": "accent1", "width": 2 });
    done(
        &mut e,
        &slide,
        "set_cell_borders",
        input(
            json!({ "from": { "row": 0, "col": 0 }, "to": { "row": 1, "col": 1 }, "sides": ["outer"], "stroke": stroke }),
        ),
    );
    let t = table(&e, &slide);
    let cell = |r: usize, c: usize| t.rows[r].cells[c].borders.clone();
    let corner = cell(0, 0).expect("borders");
    assert!(
        corner.top.is_some()
            && corner.left.is_some()
            && corner.right.is_none()
            && corner.bottom.is_none()
    );
    let far = cell(1, 1).expect("borders");
    assert!(far.right.is_some() && far.bottom.is_some() && far.top.is_none());
    // The cells outside the block share its lines.
    assert!(cell(2, 1).expect("below").top.is_some());
    assert!(cell(1, 2).expect("beside").left.is_some());
    assert!(
        cell(2, 2).is_none(),
        "a cell that touches no line is left alone"
    );
}

#[test]
fn inner_lines_run_between_the_cells_and_no_stroke_gives_them_back_to_the_style() {
    let (mut e, slide) = setup(2, 2);
    let block = json!({ "from": { "row": 0, "col": 0 }, "to": { "row": 1, "col": 1 } });
    let mut with = block.clone();
    with["sides"] = json!(["inner"]);
    with["stroke"] = json!({ "color": "text1", "width": 1 });
    done(&mut e, &slide, "set_cell_borders", with);
    let t = table(&e, &slide);
    assert!(t.rows[0].cells[0].borders.as_ref().unwrap().right.is_some());
    assert!(t.rows[0].cells[1].borders.as_ref().unwrap().left.is_some());
    assert!(t.rows[0].cells[0].borders.as_ref().unwrap().left.is_none());

    let mut without = block;
    without["sides"] = json!(["all"]);
    done(&mut e, &slide, "set_cell_borders", input(without));
    assert!(
        table(&e, &slide)
            .rows
            .iter()
            .flat_map(|r| &r.cells)
            .all(|c| c.borders.is_none()),
        "every override is gone"
    );
}

#[test]
fn a_border_needs_a_side_and_a_sane_line() {
    let (mut e, slide) = setup(2, 2);
    let block = |sides: serde_json::Value, width: f64| {
        json!({ "slide": slide, "id": TABLE, "from": { "row": 0, "col": 0 }, "to": { "row": 0, "col": 0 },
                "sides": sides, "stroke": { "color": "text1", "width": width } })
    };
    assert!(refused(&mut e, "set_cell_borders", block(json!([]), 1.0)).contains("side"));
    assert!(refused(&mut e, "set_cell_borders", block(json!(["all"]), 500.0)).contains("width"));
}

#[test]
fn dragging_a_column_edge_moves_the_next_column_and_keeps_the_width() {
    let (mut e, slide) = setup(3, 3);
    done(
        &mut e,
        &slide,
        "resize_table_column",
        input(json!({ "index": 0, "width": 300 })),
    );
    assert_eq!(table(&e, &slide).columns, vec![300.0, 100.0, 200.0]);
    assert_eq!(rect(&e, &slide, TABLE).2, 600.0);
    // The next column is never squeezed under the narrowest.
    e.apply(
        "resize_table_column",
        json!({ "slide": slide, "id": TABLE, "index": 0, "width": 590 }),
    )
    .unwrap();
    assert_eq!(table(&e, &slide).columns, vec![388.0, 12.0, 200.0]);
}

#[test]
fn the_last_column_changes_the_width_of_the_table() {
    let (mut e, slide) = setup(3, 3);
    done(
        &mut e,
        &slide,
        "resize_table_column",
        input(json!({ "index": 2, "width": 300 })),
    );
    assert_eq!(table(&e, &slide).columns, vec![200.0, 200.0, 300.0]);
    assert_eq!(rect(&e, &slide, TABLE).2, 700.0);
    let said = refused(
        &mut e,
        "resize_table_column",
        json!({ "slide": slide, "id": TABLE, "index": 9, "width": 50 }),
    );
    assert!(said.contains("no column 9"), "{said}");
}

#[test]
fn distributing_makes_the_columns_or_the_rows_even() {
    let (mut e, slide) = setup(3, 3);
    e.apply(
        "resize_table_column",
        json!({ "slide": slide, "id": TABLE, "index": 0, "width": 350 }),
    )
    .unwrap();
    done(
        &mut e,
        &slide,
        "distribute_table",
        input(json!({ "lines": "columns" })),
    );
    assert_eq!(table(&e, &slide).columns, vec![200.0, 200.0, 200.0]);
    done(
        &mut e,
        &slide,
        "distribute_table",
        input(json!({ "lines": "rows" })),
    );
    assert!(
        table(&e, &slide)
            .rows
            .iter()
            .all(|r| r.height == Some(100.0))
    );
}
