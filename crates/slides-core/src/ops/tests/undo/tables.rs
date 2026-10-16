//! The table actions of the property test: a table added, its words and fill set, rows and columns
//! added and taken away, cells merged and split. Each names its table as "the first one on the
//! slide", so it means something on whatever deck the run has reached, and most of what they ask
//! is sometimes refused, which the test checks changes nothing.

use serde_json::{Value, json};

use super::actions::Action;
use crate::model::{Deck, Element, Slide};

/// A table of three columns and three rows whose top left four cells are one.
fn table() -> Value {
    let cell = |words: &str| json!({ "text": { "paragraphs": [{ "runs": [{ "t": words }] }] } });
    let mut merged = cell("a");
    merged["colSpan"] = json!(2);
    merged["rowSpan"] = json!(2);
    json!({
        "type": "table", "x": 60, "y": 120, "w": 450, "h": 270,
        "columns": [150, 150, 150],
        "rows": [
            { "cells": [merged, cell("b")] },
            { "cells": [cell("c")] },
            { "cells": [cell("d"), cell("e"), cell("f")] },
        ],
    })
}

/// The first table on the slide, in a group too.
fn first_table(list: &[Element]) -> Option<String> {
    list.iter().find_map(|e| match e {
        Element::Table(t) => Some(t.base.id.clone()),
        other => first_table(other.children()),
    })
}

/// Values for `set_cells`: where they go and what they say. The later ones reach past a 3 by 3 table.
fn values(n: u8) -> (Value, Value) {
    let md = |words: &str| json!({ "markdown": words });
    match n % 5 {
        0 => (json!({ "row": 0, "col": 0 }), json!([[md("**one**")]])),
        1 => (
            json!({ "row": 1, "col": 1 }),
            json!([[md("x"), md("y")], [md("z"), json!({})]]),
        ),
        2 => (
            json!({ "row": 2, "col": 2 }),
            json!([[md("- a\n- b"), md("c")], [md("d"), md("e")]]),
        ),
        3 => (json!({ "row": 4, "col": 0 }), json!([[md("below")]])),
        _ => (
            json!({ "row": 0, "col": 1 }),
            json!([[{ "text": { "paragraphs": [{ "runs": [{ "t": "rich", "b": true }] }] } }]]),
        ),
    }
}

fn place(row: u8, col: u8) -> Value {
    json!({ "row": row % 5, "col": col % 5 })
}

/// The operation a table action stands for on this deck, if it names a slide and a table that are there.
pub(super) fn plan(deck: &Deck, action: &Action) -> Option<(&'static str, Value)> {
    let slide = |i: usize| -> Option<&Slide> { deck.slides.get(i % deck.slides.len().max(1)) };
    let on = |s: usize| -> Option<(String, String)> {
        let sl = slide(s)?;
        Some((sl.id.clone(), first_table(&sl.elements)?))
    };
    Some(match action {
        Action::TableAdd { slide: s } => (
            "add_elements",
            json!({ "slide": slide(*s)?.id, "elements": [table()] }),
        ),
        Action::CellsSet { slide: s, n } => {
            let (sl, id) = on(*s)?;
            let (at, cells) = values(*n);
            let grow = n % 7 != 6;
            (
                "set_cells",
                json!({ "slide": sl, "id": id, "at": at, "cells": cells, "grow": grow }),
            )
        }
        Action::CellsClear {
            slide: s,
            a,
            b,
            c,
            d,
        } => {
            let (sl, id) = on(*s)?;
            (
                "clear_cells",
                json!({ "slide": sl, "id": id, "from": place(*a, *b), "to": place(*c, *d) }),
            )
        }
        Action::RowsInsert {
            slide: s,
            at,
            count,
        } => {
            let (sl, id) = on(*s)?;
            (
                "insert_rows",
                json!({ "slide": sl, "id": id, "at": at % 6, "count": count % 4 + 1 }),
            )
        }
        Action::RowsDelete {
            slide: s,
            from,
            count,
        } => {
            let (sl, id) = on(*s)?;
            (
                "delete_rows",
                json!({ "slide": sl, "id": id, "from": from % 6, "count": count % 3 + 1 }),
            )
        }
        Action::ColsInsert {
            slide: s,
            at,
            count,
        } => {
            let (sl, id) = on(*s)?;
            (
                "insert_columns",
                json!({ "slide": sl, "id": id, "at": at % 6, "count": count % 4 + 1 }),
            )
        }
        Action::ColsDelete {
            slide: s,
            from,
            count,
        } => {
            let (sl, id) = on(*s)?;
            (
                "delete_columns",
                json!({ "slide": sl, "id": id, "from": from % 6, "count": count % 3 + 1 }),
            )
        }
        Action::Merge {
            slide: s,
            a,
            b,
            c,
            d,
        } => {
            let (sl, id) = on(*s)?;
            (
                "merge_cells",
                json!({ "slide": sl, "id": id, "from": place(*a, *b), "to": place(*c, *d) }),
            )
        }
        Action::Unmerge { slide: s, a, b } => {
            let (sl, id) = on(*s)?;
            (
                "unmerge_cells",
                json!({ "slide": sl, "id": id, "at": place(*a, *b) }),
            )
        }
        Action::CellFill {
            slide: s,
            a,
            b,
            c,
            d,
            n,
        } => {
            let (sl, id) = on(*s)?;
            let fill = [
                json!({ "color": "accent2" }),
                json!({ "color": "#336699", "alpha": 0.5 }),
                Value::Null,
            ][usize::from(*n) % 3]
                .clone();
            (
                "set_cell_fill",
                json!({ "slide": sl, "id": id, "from": place(*a, *b), "to": place(*c, *d), "fill": fill }),
            )
        }
        _ => return None,
    })
}
