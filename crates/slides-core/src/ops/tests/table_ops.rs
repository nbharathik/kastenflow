//! The operations on the cells of a table: words, fill, merging, and what is refused. A refused
//! operation changes nothing; every other one leaves a table that follows the rules and can be
//! undone and redone exactly.

use serde_json::{Value, json};

use super::table_kit::{TABLE, done, expect, rect, refused, setup, table, table_json, with, words};
use crate::model::VAlign;

pub(super) fn at(row: usize, col: usize) -> Value {
    json!({ "row": row, "col": col })
}

pub(super) fn md(words: &str) -> Value {
    json!({ "markdown": words })
}

/// The input of an operation on the table of `s`.
pub(super) fn on(s: &str, mut input: Value) -> Value {
    input["slide"] = json!(s);
    input["id"] = json!(TABLE);
    input
}

#[test]
fn set_cells_puts_words_in_a_block_and_keeps_the_rest_of_the_cell() {
    let mut json = table_json(3, 3);
    json["rows"][1]["cells"][1]["text"]["valign"] = json!("middle");
    let (mut e, s) = with(json);
    let one = json!({ "text": { "paragraphs": [{ "runs": [{ "t": "t" }] }] } });
    let out = done(
        &mut e,
        &s,
        "set_cells",
        json!({ "at": at(1, 1), "cells": [[md("**x**"), one], [md("y"), {}]] }),
    );
    assert_eq!(out, json!({ "rows": 3, "columns": 3 }));
    let t = table(&e, &s);
    assert_eq!(
        words(t),
        expect(&[
            &["r0c0", "r0c1", "r0c2"],
            &["r1c0", "x", "t"],
            &["r2c0", "y", "r2c2"]
        ])
    );
    let cell = &t.rows[1].cells[1];
    assert!(cell.text.paragraphs[0].runs[0].bold, "Markdown became runs");
    assert_eq!(
        cell.text.valign,
        Some(VAlign::Middle),
        "the cell kept its alignment"
    );
    assert_eq!(rect(&e, &s, TABLE), (40.0, 40.0, 600.0, 300.0));
}

#[test]
fn set_cells_grows_the_table_at_the_bottom_and_right() {
    let (mut e, s) = setup(2, 2);
    let values = json!([[md("a"), md("b"), md("c")], [md("d"), md("e"), md("f")]]);
    let out = done(
        &mut e,
        &s,
        "set_cells",
        json!({ "at": at(1, 1), "cells": values }),
    );
    assert_eq!(out, json!({ "rows": 3, "columns": 4 }));
    let t = table(&e, &s);
    assert_eq!(
        words(t),
        expect(&[
            &["r0c0", "r0c1", "", ""],
            &["r1c0", "a", "b", "c"],
            &["", "d", "e", "f"]
        ])
    );
    // A new row is as tall as the last one (150), so the box is 450 tall; the two new columns would
    // make it 1200 wide, and it stops at the slide's edge: 960 less the 40 it starts at.
    assert_eq!(rect(&e, &s, TABLE), (40.0, 40.0, 920.0, 450.0));
    assert_eq!(t.columns, vec![230.0; 4]);
    assert_eq!(
        t.rows.iter().map(|r| r.height).collect::<Vec<_>>(),
        vec![Some(150.0); 3]
    );
}

#[test]
fn values_past_the_table_are_refused_when_it_may_not_grow() {
    let (mut e, s) = setup(2, 2);
    let values = json!([[md("a"), md("b"), md("c")], [md("d"), md("e"), md("f")]]);
    let message = refused(
        &mut e,
        "set_cells",
        on(
            &s,
            json!({ "at": at(1, 1), "cells": values, "grow": false }),
        ),
    );
    assert!(
        message.contains("reach row 2 and column 3") && message.contains("2 rows and 2 columns"),
        "{message}"
    );
    assert!(
        message.contains("`grow`"),
        "it says how to allow it: {message}"
    );
}

#[test]
fn a_table_never_grows_past_its_limits_whatever_the_values_ask_for() {
    let (mut e, s) = setup(3, 3);
    let one = json!([[md("x")]]);
    let tall = refused(
        &mut e,
        "set_cells",
        on(
            &s,
            json!({ "at": at(9999, 0), "cells": [[md("x")], [md("y")]] }),
        ),
    );
    assert!(
        tall.contains("at most 10000 rows") && tall.contains("10001"),
        "{tall}"
    );
    let far = refused(
        &mut e,
        "set_cells",
        on(&s, json!({ "at": at(4_000_000_000, 0), "cells": one })),
    );
    assert!(far.contains("at most 10000 rows"), "{far}");
    let wide: Vec<Value> = (0..1001).map(|_| json!({})).collect();
    let wide = refused(
        &mut e,
        "set_cells",
        on(&s, json!({ "at": at(0, 0), "cells": [wide] })),
    );
    assert!(
        wide.contains("at most 1000 columns") && wide.contains("1001"),
        "{wide}"
    );
    let big = refused(
        &mut e,
        "set_cells",
        on(&s, json!({ "at": at(299, 199), "cells": one })),
    );
    assert!(
        big.contains("50000 places") && big.contains("200 columns and 300 rows"),
        "{big}"
    );
}

#[test]
fn a_cell_takes_either_text_or_markdown_but_not_both() {
    let (mut e, s) = setup(2, 2);
    let both = json!({ "text": { "paragraphs": [] }, "markdown": "x" });
    let message = refused(
        &mut e,
        "set_cells",
        on(&s, json!({ "at": at(0, 0), "cells": [[both]] })),
    );
    assert!(
        message.contains("`text` or `markdown`, not both"),
        "{message}"
    );
}

/// A 4 by 4 table whose middle four cells are one.
fn merged_in_the_middle() -> (crate::ops::Engine, String) {
    let (mut e, s) = setup(4, 4);
    e.apply(
        "merge_cells",
        on(&s, json!({ "from": at(1, 1), "to": at(2, 2) })),
    )
    .unwrap_or_else(|err| panic!("{err}"));
    (e, s)
}

#[test]
fn a_block_that_cuts_a_merged_cell_is_refused_in_words_that_name_it_and_changes_nothing() {
    let (mut e, s) = merged_in_the_middle();
    let cut = "cut through the merged cell at row 1, column 1 (2 columns by 2 rows). Unmerge it, or take in all of it.";
    let set = refused(
        &mut e,
        "set_cells",
        on(&s, json!({ "at": at(1, 1), "cells": [[md("a"), md("b")]] })),
    );
    assert_eq!(
        set,
        format!("The cells from row 1, column 1 to row 1, column 2 {cut}")
    );
    let clear = refused(
        &mut e,
        "clear_cells",
        on(&s, json!({ "from": at(0, 0), "to": at(1, 1) })),
    );
    assert_eq!(
        clear,
        format!("The cells from row 0, column 0 to row 1, column 1 {cut}")
    );
    let merge = refused(
        &mut e,
        "merge_cells",
        on(&s, json!({ "from": at(3, 3), "to": at(2, 2) })),
    );
    assert_eq!(
        merge,
        format!("The cells from row 2, column 2 to row 3, column 3 {cut}")
    );
    let fill = json!({ "color": "accent1" });
    let paint = refused(
        &mut e,
        "set_cell_fill",
        on(
            &s,
            json!({ "from": at(0, 1), "to": at(1, 1), "fill": fill }),
        ),
    );
    assert_eq!(
        paint,
        format!("The cells from row 0, column 1 to row 1, column 1 {cut}")
    );
    let off = refused(
        &mut e,
        "clear_cells",
        on(&s, json!({ "from": at(0, 0), "to": at(4, 0) })),
    );
    assert!(
        off.contains("reach past the table") && off.contains("4 rows and 4 columns"),
        "{off}"
    );
}

#[test]
fn a_value_on_a_place_a_merged_cell_covers_is_refused_unless_it_is_empty() {
    let (mut e, s) = merged_in_the_middle();
    // Editing the merged cell itself is one value at its own place.
    done(
        &mut e,
        &s,
        "set_cells",
        json!({ "at": at(1, 1), "cells": [[md("whole")]] }),
    );
    // A block that takes in all of it: empty values and skipped ones on the covered places are ignored.
    let block = json!([[md("m"), md(""), md("x")], [{}, md("  "), md("y")]]);
    done(
        &mut e,
        &s,
        "set_cells",
        json!({ "at": at(1, 1), "cells": block }),
    );
    let t = table(&e, &s);
    assert_eq!(words(t)[1], ["r1c0", "m", "x"].map(String::from).to_vec());
    assert_eq!(words(t)[2], ["r2c0", "y"].map(String::from).to_vec());
    // A value with words on a covered place is refused.
    let message = refused(
        &mut e,
        "set_cells",
        on(
            &s,
            json!({ "at": at(1, 1), "cells": [[md("m"), md("no")], [{}, {}]] }),
        ),
    );
    assert!(
        message.contains(
            "row 1, column 2 is covered by the merged cell at row 1, column 1 (2 columns by 2 rows)"
        ),
        "{message}"
    );
}

#[test]
fn merging_joins_the_words_and_unmerging_leaves_empty_cells() {
    let (mut e, s) = setup(3, 3);
    done(
        &mut e,
        &s,
        "merge_cells",
        json!({ "from": at(0, 1), "to": at(0, 0) }),
    );
    let t = table(&e, &s);
    assert_eq!(
        words(t)[0],
        vec!["r0c0\nr0c1".to_owned(), "r0c2".to_owned()]
    );
    assert_eq!(t.rows[0].cells[0].col_span, Some(2));
    done(&mut e, &s, "unmerge_cells", json!({ "at": at(0, 1) }));
    let t = table(&e, &s);
    assert_eq!(
        words(t)[0],
        ["r0c0\nr0c1", "", "r0c2"].map(String::from).to_vec()
    );
    assert_eq!(t.rows[0].cells[0].col_span, None);
    let message = refused(&mut e, "unmerge_cells", on(&s, json!({ "at": at(1, 1) })));
    assert!(
        message.contains("row 1, column 1 is not merged"),
        "{message}"
    );
    let message = refused(
        &mut e,
        "merge_cells",
        on(&s, json!({ "from": at(1, 1), "to": at(1, 1) })),
    );
    assert!(message.contains("one cell already"), "{message}");
}
