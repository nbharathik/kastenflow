use serde_json::json;
use slides_core::Element;

use super::*;
use crate::elements::xml_of;
use crate::testing::with_cx;

fn cell(t: &str) -> serde_json::Value {
    json!({ "text": { "paragraphs": [{ "runs": [{ "t": t }] }] } })
}

fn table(value: serde_json::Value) -> Element {
    let mut base = json!({ "type": "table", "id": "t", "x": 100, "y": 50, "w": 400, "h": 100 });
    if let (Some(b), Some(v)) = (base.as_object_mut(), value.as_object()) {
        b.extend(v.clone());
    }
    serde_json::from_value(base).unwrap_or_else(|e| panic!("a table: {e}"))
}

fn written(el: &Element) -> String {
    with_cx(|cx| xml_of(cx, el))
}

fn counts(xml: &str) -> (usize, usize) {
    (
        xml.matches("<a:tr ").count(),
        xml.matches("<a:tc>").count() + xml.matches("<a:tc ").count(),
    )
}

#[test]
fn a_table_is_a_grid_of_rows_and_cells_that_fills_its_box() {
    let el = table(json!({
        "columns": [100, 300], "headerRow": true,
        "rows": [{ "cells": [cell("Name"), cell("Value")] }, { "cells": [cell("alpha"), cell("1")] }]
    }));
    let out = written(&el);
    assert!(
        out.starts_with(concat!(
            r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table 2"/>"#,
            r#"<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>"#,
            r#"<p:xfrm><a:off x="952500" y="476250"/><a:ext cx="3810000" cy="952500"/></p:xfrm>"#,
            r#"<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>"#,
            r#"<a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="952500"/><a:gridCol w="2857500"/></a:tblGrid>"#,
            r#"<a:tr h="476250"><a:tc>"#
        )),
        "{out}"
    );
    assert_eq!(counts(&out), (2, 4));
}

#[test]
fn widths_and_heights_are_scaled_to_the_box() {
    let el = table(json!({
        "columns": [50, 50], "w": 400, "h": 90,
        "rows": [{ "height": 10, "cells": [cell("a"), cell("b")] }, { "cells": [cell("c"), cell("d")] }]
    }));
    let out = written(&el);
    // Two columns of 200 units, and rows of 10 and 80 scaled to 90 stay 10 and 80.
    assert!(
        out.contains(r#"<a:gridCol w="1905000"/><a:gridCol w="1905000"/>"#),
        "{out}"
    );
    assert!(
        out.contains(r#"<a:tr h="95250">"#) && out.contains(r#"<a:tr h="762000">"#),
        "{out}"
    );
}

#[test]
fn the_first_row_is_bold_when_it_is_the_header_and_only_then() {
    let rows = json!([{ "cells": [cell("H")] }, { "cells": [cell("B")] }]);
    let header = written(&table(
        json!({ "columns": [100], "rows": rows, "headerRow": true }),
    ));
    let (head, body) = header
        .split_once("<a:tr ")
        .and_then(|(_, rest)| rest.split_once("<a:tr "))
        .unwrap_or_default();
    assert!(
        head.contains(r#"b="1""#) && !head.contains(r#"b="0""#),
        "{head}"
    );
    assert!(
        body.contains(r#"b="0""#) && !body.contains(r#"b="1""#),
        "{body}"
    );
    let plain = written(&table(json!({ "columns": [100], "rows": rows })));
    assert!(
        !plain.contains(r#"b="1""#) && !plain.contains("firstRow"),
        "{plain}"
    );
}

#[test]
fn a_table_style_dresses_the_header_and_leaves_the_other_lines_out() {
    let rows = json!([{ "cells": [cell("H")] }, { "cells": [cell("B")] }]);
    let out = written(&table(json!({
        "columns": [100], "rows": rows, "headerRow": true,
        "tableStyle": { "preset": "accent", "bandedRows": true }
    })));
    let (head, body) = out
        .split_once("<a:tr ")
        .and_then(|(_, rest)| rest.split_once("<a:tr "))
        .unwrap_or_default();
    // The header takes the first accent as its fill, and its words the paper colour.
    assert!(head.contains(r#"<a:schemeClr val="accent1"/>"#), "{head}");
    assert!(
        head.contains(r#"b="1""#) && head.contains(r#"val="bg1""#),
        "{head}"
    );
    // The lines are the style's (the accent), not the plain grid's second text colour.
    assert!(!body.contains("tx2") && body.contains("accent1"), "{body}");
}

#[test]
fn a_cells_own_borders_win_and_a_width_of_nothing_is_no_line() {
    let mut c = cell("x");
    c["borders"] = json!({
        "top": { "color": "accent2", "width": 3 },
        "left": { "color": "text1", "width": 0 }
    });
    let out = written(&table(
        json!({ "columns": [100], "rows": [{ "cells": [c] }] }),
    ));
    assert!(out.contains(r#"<a:lnL w="0"><a:noFill/></a:lnL>"#), "{out}");
    assert!(
        out.contains(r#"<a:lnT w="28575"><a:solidFill><a:schemeClr val="accent2"/>"#),
        "{out}"
    );
    // The sides it does not name stay the thin grid.
    assert!(out.contains(r#"<a:lnR w="9525">"#), "{out}");
}

#[test]
fn every_cell_has_thin_borders_of_the_second_text_colour_and_its_own_fill() {
    let mut c = cell("x");
    c["fill"] = json!({ "color": "accent1", "alpha": 0.2 });
    let out = written(&table(
        json!({ "columns": [100], "rows": [{ "cells": [c] }] }),
    ));
    assert!(
        out.contains(concat!(
            r#"<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="t">"#,
            r#"<a:lnL w="9525"><a:solidFill><a:schemeClr val="tx2"><a:alpha val="30000"/></a:schemeClr></a:solidFill></a:lnL>"#,
            r#"<a:lnR w="9525">"#
        )),
        "{out}"
    );
    assert!(
        out.ends_with(r#"</a:lnB><a:solidFill><a:schemeClr val="accent1"><a:alpha val="20000"/></a:schemeClr></a:solidFill></a:tcPr></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#),
        "{out}"
    );
}

#[test]
fn a_cell_that_spans_columns_is_followed_by_the_cell_it_covers() {
    let mut wide = cell("wide");
    wide["colSpan"] = json!(2);
    let el = table(
        json!({ "columns": [100, 100, 100], "rows": [{ "cells": [wide, cell("c")] }, { "cells": [cell("1"), cell("2"), cell("3")] }] }),
    );
    let out = written(&el);
    assert_eq!(counts(&out), (2, 6));
    assert!(out.contains(r#"<a:tc gridSpan="2">"#), "{out}");
    assert!(out.contains(r#"<a:tc hMerge="1">"#), "{out}");
    assert_eq!(out.matches("hMerge").count(), 1);
}

#[test]
fn a_cell_that_spans_rows_leaves_a_cell_under_it_and_a_block_leaves_both() {
    let mut block = cell("block");
    block["colSpan"] = json!(2);
    block["rowSpan"] = json!(2);
    let el = table(json!({
        "columns": [100, 100, 100],
        "rows": [{ "cells": [block, cell("a")] }, { "cells": [cell("b")] }, { "cells": [cell("x"), cell("y"), cell("z")] }]
    }));
    let out = written(&el);
    assert_eq!(counts(&out), (3, 9));
    assert!(out.contains(r#"<a:tc gridSpan="2" rowSpan="2">"#), "{out}");
    assert_eq!(out.matches(r#"<a:tc hMerge="1">"#).count(), 1, "{out}");
    assert_eq!(out.matches(r#"<a:tc vMerge="1">"#).count(), 1, "{out}");
    assert_eq!(
        out.matches(r#"<a:tc hMerge="1" vMerge="1">"#).count(),
        1,
        "{out}"
    );
}

#[test]
fn a_short_row_is_filled_out_with_empty_cells_and_a_span_is_held_to_the_grid() {
    let mut too_wide = cell("w");
    too_wide["colSpan"] = json!(9);
    let el = table(
        json!({ "columns": [100, 100], "rows": [{ "cells": [cell("only")] }, { "cells": [too_wide] }] }),
    );
    let out = written(&el);
    assert_eq!(counts(&out), (2, 4));
    assert!(out.contains(r#"<a:tc gridSpan="2">"#), "{out}");
}

#[test]
fn a_table_with_nothing_in_it_is_left_out_with_a_warning() {
    let (out, warnings) = with_cx(|cx| {
        (
            xml_of(cx, &table(json!({ "columns": [], "rows": [] }))),
            cx.shared.warnings.len(),
        )
    });
    assert_eq!((out.as_str(), warnings), ("", 1));
}

#[test]
fn the_columns_add_up_to_the_frame_whatever_rounding_does() {
    let sizes = scaled(&[1.0, 1.0, 1.0], 100.0);
    let e = emus(&sizes, 100.0);
    assert_eq!(e.iter().sum::<i64>(), 952_500);
    let rows = emus(&scaled(&[3.0, 3.0, 3.0], 10.0), 10.0);
    assert_eq!(rows.iter().sum::<i64>(), 95_250);
}

#[test]
fn a_column_or_row_of_no_size_keeps_a_hair_and_the_others_are_not_moved() {
    let el = table(json!({
        "columns": [100, 0, 100], "w": 200, "h": 40,
        "rows": [{ "cells": [cell("a"), cell("b"), cell("c")] }]
    }));
    let out = written(&el);
    assert!(
        out.contains(r#"<a:gridCol w="952500"/><a:gridCol w="1"/><a:gridCol w="952499"/>"#),
        "{out}"
    );
    let flat =
        table(json!({ "columns": [10], "w": 0, "h": 0, "rows": [{ "cells": [cell("a")] }] }));
    let out = written(&flat);
    assert!(
        out.contains(r#"<a:gridCol w="1"/>"#) && out.contains(r#"<a:tr h="1">"#),
        "{out}"
    );
}

#[test]
fn a_big_table_is_laid_out_in_one_pass() {
    // A hundred by a hundred places: looking through every cell for every place would take seconds.
    let row = json!({ "cells": vec![cell("x"); 100] });
    let el = table(json!({
        "columns": vec![1; 100], "w": 1000, "h": 1000,
        "rows": vec![row; 100]
    }));
    let started = std::time::Instant::now();
    let out = written(&el);
    assert_eq!(counts(&out), (100, 10_000));
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "{:?}",
        started.elapsed()
    );
}

fn table_of(el: &Element) -> &slides_core::TableEl {
    match el {
        Element::Table(t) => t,
        other => panic!("not a table: {other:?}"),
    }
}

#[test]
fn a_span_of_four_billion_columns_costs_no_more_than_the_widest_table_there_may_be() {
    // A span is a number a file can make as big as it likes; two of them together are more than
    // fits in 32 bits, which is what a browser's numbers are.
    for cells in [1, 2] {
        let big = json!({ "text": { "paragraphs": [] }, "colSpan": u32::MAX });
        let el = table(json!({ "columns": [], "rows": [{ "cells": vec![big; cells] }] }));
        let started = std::time::Instant::now();
        let (out, warnings) = with_cx(|cx| (xml_of(cx, &el), cx.shared.warnings.clone()));
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(out.matches("<a:gridCol ").count(), MOST_TABLE_COLUMNS);
        assert!(
            out.contains(r#"<a:tc gridSpan="1000">"#),
            "the span stops at the last column"
        );
        // One warning for the size, one for the span that went past the last column.
        assert_eq!(warnings.len(), 2, "{warnings:?}");
        let said = &warnings[0].message;
        assert!(
            said.contains(&format!(
                "{} columns and 1 rows",
                u64::from(u32::MAX) * cells as u64
            )) && said.contains("cut to 1000 columns and 1 rows"),
            "{said}"
        );
        assert!(
            warnings[1]
                .message
                .contains("span further than the table goes"),
            "{warnings:?}"
        );
    }
}

#[test]
fn a_table_beyond_the_limits_is_cut_back_to_them_and_the_warning_says_how() {
    let el = table(json!({ "columns": vec![1; 1200], "rows": [{ "cells": [cell("a")] }] }));
    let (out, warnings) = with_cx(|cx| (xml_of(cx, &el), cx.shared.warnings.clone()));
    assert_eq!(out.matches("<a:gridCol ").count(), 1000);
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(
        warnings[0].message.contains("1200 columns")
            && warnings[0]
                .message
                .contains("cut to 1000 columns and 1 rows"),
        "{warnings:?}"
    );
}

#[test]
fn a_table_within_the_limits_is_written_whole_and_without_a_word() {
    let el = table(json!({
        "columns": [100, 100],
        "rows": [{ "cells": [cell("a"), cell("b")] }, { "cells": [cell("c")] }]
    }));
    let (out, warnings) = with_cx(|cx| (xml_of(cx, &el), cx.shared.warnings.len()));
    assert_eq!((counts(&out), warnings), ((2, 4), 0));
}

#[test]
fn the_places_of_a_table_are_bounded_as_well_as_its_columns_and_rows() {
    let many = |columns: usize, rows: usize| {
        table(json!({ "columns": vec![1; columns], "rows": vec![json!({ "cells": [] }); rows] }))
    };
    assert_eq!(extent(table_of(&many(1000, 100))), (1000, 50));
    assert_eq!(extent(table_of(&many(1, 100_000))), (1, MOST_TABLE_ROWS));
    assert_eq!(
        extent(table_of(&many(200, 250))),
        (200, 250),
        "50000 places exactly"
    );
    assert_eq!(extent(table_of(&many(3, 4))), (3, 4));
    assert_eq!(extent(table_of(&many(0, 4))), (0, 4));
}

#[test]
fn cells_that_do_not_fit_the_table_are_cut_back_and_the_warning_counts_them() {
    let el = table(json!({
        "columns": [100, 100],
        "rows": [
            { "cells": [{ "text": { "paragraphs": [] }, "colSpan": 5, "rowSpan": 9 }] },
            { "cells": [cell("a"), cell("b"), cell("c"), cell("d")] }
        ]
    }));
    let (out, warnings) = with_cx(|cx| (xml_of(cx, &el), cx.shared.warnings.clone()));
    assert!(out.contains(r#"<a:tc gridSpan="2" rowSpan="2">"#), "{out}");
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    let said = &warnings[0].message;
    assert!(
        said.contains("1 span further than the table goes")
            && said.contains("4 have no place left in their row"),
        "{said}"
    );
}
