//! What the tests of the table operations share: a slide with a table on it, and ways to look at it.

use serde_json::{Value, json};

use super::{add, bytes, element, engine};
use crate::model::{Element, TableEl};
use crate::ops::Engine;

/// The id of the table that `setup` makes.
pub(super) const TABLE: &str = "e-table";

/// A table of `rows` by `columns` plain cells labelled `r<row>c<column>`, in a box of 600 by 300
/// at (40, 40), so each cell of a 3 by 3 table is 200 by 100.
pub(super) fn table_json(columns: usize, rows: usize) -> Value {
    let rows: Vec<Value> = (0..rows)
        .map(|r| {
            let cells: Vec<Value> = (0..columns)
                .map(|c| json!({ "text": { "paragraphs": [{ "runs": [{ "t": format!("r{r}c{c}") }] }] } }))
                .collect();
            json!({ "cells": cells })
        })
        .collect();
    json!({
        "type": "table", "id": TABLE, "x": 40, "y": 40, "w": 600, "h": 300,
        "columns": vec![600.0 / columns.max(1) as f64; columns], "rows": rows,
    })
}

/// An engine with one slide that has a table of `rows` by `columns` on it: the engine and the slide's id.
pub(super) fn setup(columns: usize, rows: usize) -> (Engine, String) {
    with(table_json(columns, rows))
}

/// An engine with one slide that has the element on it.
pub(super) fn with(table: Value) -> (Engine, String) {
    let mut e = engine();
    let slide = add(&mut e, "title-only", json!({ "title": "T" }));
    e.apply(
        "add_elements",
        json!({ "slide": slide, "elements": [table] }),
    )
    .unwrap_or_else(|err| panic!("a table: {err}"));
    (e, slide)
}

pub(super) fn table<'a>(e: &'a Engine, slide: &str) -> &'a TableEl {
    match element(e, slide, TABLE) {
        Element::Table(t) => t,
        other => panic!("a table, found a {}", other.kind()),
    }
}

/// The words of each cell, row by row, as the rows list them.
pub(super) fn words(t: &TableEl) -> Vec<Vec<String>> {
    t.rows
        .iter()
        .map(|r| r.cells.iter().map(|c| c.text.plain_text()).collect())
        .collect()
}

/// The words of a table as a list of rows, to compare with.
pub(super) fn expect(rows: &[&[&str]]) -> Vec<Vec<String>> {
    rows.iter()
        .map(|r| r.iter().map(|w| (*w).to_owned()).collect())
        .collect()
}

pub(super) fn rect(e: &Engine, slide: &str, id: &str) -> (f64, f64, f64, f64) {
    element(e, slide, id)
        .base()
        .rect()
        .unwrap_or_else(|| panic!("`{id}` has a box"))
}

/// Why the operation was refused, with the deck checked to be as it was and nothing left to redo.
pub(super) fn refused(e: &mut Engine, op: &str, input: Value) -> String {
    let before = bytes(e.deck());
    let can_undo = e.can_undo();
    let err = e
        .apply(op, input)
        .expect_err("the operation is refused")
        .to_string();
    assert_eq!(bytes(e.deck()), before, "{op} changed the deck");
    assert_eq!(e.can_undo(), can_undo, "{op} left a step to undo");
    assert!(!e.can_redo());
    err
}

/// Applies the operation and checks the table still follows the rules and undo takes it back.
pub(super) fn done(e: &mut Engine, slide: &str, op: &str, mut input: Value) -> Value {
    let before = bytes(e.deck());
    input["slide"] = json!(slide);
    input["id"] = json!(TABLE);
    let out = e
        .apply(op, input)
        .unwrap_or_else(|err| panic!("{op}: {err}"));
    assert_eq!(
        table(e, slide).problem(),
        None,
        "{op} left a table with a problem"
    );
    let after = bytes(e.deck());
    e.undo().unwrap_or_else(|| panic!("{op} can be undone"));
    assert_eq!(bytes(e.deck()), before, "undo of {op} restores the bytes");
    e.redo().unwrap_or_else(|| panic!("{op} can be redone"));
    assert_eq!(bytes(e.deck()), after, "redo of {op} restores the bytes");
    out.output
}
