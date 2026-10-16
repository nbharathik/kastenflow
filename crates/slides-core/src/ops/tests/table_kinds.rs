//! More of the operations on the cells of a table: clearing and fill, what each refuses that is not
//! a table, and a table inside a group.

use serde_json::json;

use super::table_kit::{TABLE, done, rect, refused, setup, table, table_json, with, words};
use super::table_ops::{at, md, on};
use super::{add, engine, text_box};
use crate::error::Error;
use crate::model::{Element, VAlign};

#[test]
fn clearing_cells_keeps_their_alignment_insets_and_fill() {
    let mut json = table_json(2, 2);
    json["rows"][0]["cells"][0]["text"]["valign"] = json!("bottom");
    json["rows"][0]["cells"][0]["text"]["insets"] =
        json!({ "left": 4, "top": 4, "right": 4, "bottom": 4 });
    json["rows"][0]["cells"][0]["fill"] = json!({ "color": "accent3" });
    let (mut e, s) = with(json);
    done(
        &mut e,
        &s,
        "clear_cells",
        json!({ "from": at(0, 0), "to": at(0, 1) }),
    );
    let t = table(&e, &s);
    assert_eq!(words(t)[0], vec![String::new(); 2]);
    let cell = &t.rows[0].cells[0];
    assert_eq!(cell.text.valign, Some(VAlign::Bottom));
    assert!(cell.text.insets.is_some());
    assert_eq!(
        cell.fill.as_ref().map(|f| f.color.as_str()),
        Some("accent3")
    );
    assert_eq!(
        words(t)[1],
        ["r1c0", "r1c1"].map(String::from).to_vec(),
        "the rest is untouched"
    );
}

#[test]
fn a_fill_is_set_on_a_block_and_taken_away_again() {
    let (mut e, s) = setup(3, 3);
    let fill = json!({ "color": "accent2", "alpha": 0.5 });
    done(
        &mut e,
        &s,
        "set_cell_fill",
        json!({ "from": at(1, 1), "to": at(0, 0), "fill": fill }),
    );
    let t = table(&e, &s);
    let filled: Vec<bool> = t
        .rows
        .iter()
        .flat_map(|r| r.cells.iter().map(|c| c.fill.is_some()))
        .collect();
    assert_eq!(
        filled,
        [true, true, false, true, true, false, false, false, false]
    );
    assert_eq!(
        t.rows[0].cells[0].fill.as_ref().and_then(|f| f.alpha),
        Some(0.5)
    );
    done(
        &mut e,
        &s,
        "set_cell_fill",
        json!({ "from": at(0, 0), "to": at(2, 2) }),
    );
    assert!(
        table(&e, &s)
            .rows
            .iter()
            .flat_map(|r| &r.cells)
            .all(|c| c.fill.is_none())
    );
    let message = refused(
        &mut e,
        "set_cell_fill",
        on(
            &s,
            json!({ "from": at(0, 0), "to": at(0, 0), "fill": { "color": "blue" } }),
        ),
    );
    assert!(message.contains("not a theme colour"), "{message}");
    let message = refused(
        &mut e,
        "set_cell_fill",
        on(
            &s,
            json!({ "from": at(0, 0), "to": at(0, 0), "fill": { "color": "accent1", "alpha": 2 } }),
        ),
    );
    assert!(
        message.contains("fill alpha is between 0 and 1"),
        "{message}"
    );
}

#[test]
fn only_a_table_can_be_changed_with_these_operations() {
    let mut e = engine();
    let s = add(&mut e, "title-only", json!({ "title": "T" }));
    let id = text_box(&mut e, &s, 10.0, 10.0, 100.0, 40.0, "hi");
    let range = json!({ "from": at(0, 0), "to": at(0, 0) });
    let cases = [
        ("set_cells", json!({ "at": at(0, 0), "cells": [[md("x")]] })),
        ("clear_cells", range.clone()),
        ("insert_rows", json!({ "at": 0 })),
        ("delete_rows", json!({ "from": 0 })),
        ("insert_columns", json!({ "at": 0 })),
        ("delete_columns", json!({ "from": 0 })),
        ("merge_cells", range.clone()),
        ("unmerge_cells", json!({ "at": at(0, 0) })),
        ("set_cell_fill", range),
    ];
    for (op, mut input) in cases {
        input["slide"] = json!(s);
        input["id"] = json!(id);
        let message = refused(&mut e, op, input.clone());
        assert!(
            message.contains("is a text element, not a table"),
            "{op}: {message}"
        );
        input["id"] = json!("e-nope");
        assert!(
            matches!(e.apply(op, input), Err(Error::NoSuchElement { .. })),
            "{op}"
        );
    }
    // The text operations point at the cells.
    for op in ["set_text", "set_rich_text"] {
        let (mut e, s) = setup(2, 2);
        let input = on(&s, json!({ "markdown": "x", "text": { "paragraphs": [] } }));
        let message = refused(&mut e, op, input);
        assert!(message.contains("set_cells"), "{op}: {message}");
    }
}

#[test]
fn a_table_inside_a_group_is_changed_and_the_group_follows_its_box() {
    let (mut e, s) = setup(3, 3);
    let note = text_box(&mut e, &s, 700.0, 40.0, 100.0, 40.0, "note");
    let group = e
        .apply(
            "group_elements",
            json!({ "slide": s, "ids": [TABLE, note] }),
        )
        .unwrap_or_else(|err| panic!("{err}"))
        .output["group"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    assert_eq!(rect(&e, &s, &group), (40.0, 40.0, 760.0, 300.0));
    done(&mut e, &s, "insert_rows", json!({ "at": 3, "count": 1 }));
    assert_eq!(rect(&e, &s, TABLE), (40.0, 40.0, 600.0, 400.0));
    assert_eq!(
        rect(&e, &s, &group),
        (40.0, 40.0, 760.0, 400.0),
        "the group is as tall as its table now"
    );
    done(
        &mut e,
        &s,
        "set_cells",
        json!({ "at": at(0, 0), "cells": [[md("in a group")]] }),
    );
    let Element::Table(t) = e
        .deck()
        .slide(&s)
        .and_then(|sl| sl.element(TABLE))
        .expect("the table")
    else {
        panic!("a table")
    };
    assert_eq!(t.rows[0].cells[0].text.plain_text(), "in a group");
}
