//! `p:graphicFrame`: a table, or (when it holds a chart, a SmartArt diagram or
//! an embedded object) a `raw` element.

use slides_core::{
    Element, Extra, Fill, MOST_TABLE_COLUMNS, MOST_TABLE_PLACES, MOST_TABLE_ROWS, Style, TableCell,
    TableEl, TableRow, VAlign,
};

use super::base::{base_of, nv_of};
use super::frame::{self, Frame};
use super::raw;
use super::text::text_of;
use crate::import::cx::Cx;
use crate::import::dom::Node;
use crate::import::tablestyle::{Flags, Given};
use crate::import::text::body::BodyProps;
use crate::import::units::{length, snapped};

const TABLE: &str = "http://schemas.openxmlformats.org/drawingml/2006/table";
const CHART: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DIAGRAM: &str = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const OLE: &str = "http://schemas.openxmlformats.org/presentationml/2006/ole";
const CHART_EX: &str = "http://schemas.microsoft.com/office/drawing/2014/chartex";

pub fn convert_frame(cx: &mut Cx, gf: &Node, out: &mut Vec<Element>) {
    let nv = nv_of(gf.at(&["p:nvGraphicFramePr", "p:cNvPr"]));
    let frame = gf
        .child("p:xfrm")
        .and_then(frame::read)
        .map(|f| frame::place(&cx.groups, f));
    let data = gf.at(&["a:graphic", "a:graphicData"]);
    let uri = data.and_then(|d| d.attr("uri")).unwrap_or("");
    match (uri, data.and_then(|d| d.child("a:tbl"))) {
        (TABLE, Some(tbl)) => match frame {
            Some(frame) => table(cx, gf, tbl, &nv, &frame, out),
            None => cx.warn_slide("a table with no position was left out"),
        },
        _ => {
            // A chart a deck can hold becomes one; the rest, and every chart when not asked, is kept as it was.
            if uri == CHART && super::chart::element(cx, gf, &nv, frame.as_ref(), out) {
                return;
            }
            let original = match uri {
                CHART | CHART_EX => "pptx:chart",
                DIAGRAM => "pptx:smartart",
                OLE => "pptx:ole-object",
                _ => "pptx:graphic-frame",
            };
            raw::element(cx, gf, original, &nv, frame.as_ref(), None, out);
        }
    }
}

fn cell_fill(cx: &mut Cx, tc_pr: Option<&Node>) -> Option<Fill> {
    let node = tc_pr?.elements().find(|n| n.name == "a:solidFill")?;
    let paint = cx.colors().first(node, None)?;
    Some(Fill {
        color: paint.value,
        alpha: paint.alpha,
        extra: Extra::new(),
    })
}

fn cell(cx: &mut Cx, tc: &Node) -> TableCell {
    let tc_pr = tc.child("a:tcPr");
    let mut text = match tc.child("a:txBody") {
        Some(body) => text_of(cx, tc, body, None, VAlign::Top, None),
        None => slides_core::Text::plain(""),
    };
    if let Some(pr) = tc_pr {
        let inset = |name: &str| pr.int(name).map(length);
        let props = BodyProps {
            insets: [inset("marL"), inset("marT"), inset("marR"), inset("marB")],
            ..BodyProps::default()
        };
        text.insets = props.insets();
        text.valign = match pr.attr("anchor") {
            Some("ctr") => Some(VAlign::Middle),
            Some("b") => Some(VAlign::Bottom),
            _ => None,
        };
    }
    let span = |name: &str| {
        tc.int(name)
            .filter(|n| *n > 1)
            .and_then(|n| u32::try_from(n.min(1000)).ok())
    };
    TableCell {
        text,
        fill: cell_fill(cx, tc_pr),
        col_span: span("gridSpan"),
        row_span: span("rowSpan"),
        borders: None,
        extra: Extra::new(),
    }
}

/// The look a table's style gives a cell that does not set its own: its fill, and the weight and colour of its words.
fn dress(cx: &mut Cx, cell: &mut TableCell, tc: &Node, given: &Given) {
    let own_fill = tc.child("a:tcPr").is_some_and(|p| {
        p.elements().any(|n| {
            matches!(
                n.name.as_str(),
                "a:solidFill" | "a:noFill" | "a:gradFill" | "a:blipFill" | "a:pattFill"
            )
        })
    });
    if !own_fill
        && let Some(node) = given.fill.filter(|n| n.name == "a:solidFill")
        && let Some(paint) = cx.colors().first(node, None)
    {
        cell.fill = Some(Fill {
            color: paint.value,
            alpha: paint.alpha,
            extra: Extra::new(),
        });
    }
    let color = given
        .color
        .and_then(|c| cx.colors().resolve(c, None))
        .map(|p| p.value);
    for run in cell
        .text
        .paragraphs
        .iter_mut()
        .flat_map(|p| p.runs.iter_mut())
    {
        run.bold |= given.bold;
        if run.color.is_none()
            && let Some(color) = color.as_ref().filter(|c| c.as_str() != "text1")
        {
            run.color = Some(color.clone());
        }
    }
}

fn table(
    cx: &mut Cx,
    gf: &Node,
    tbl: &Node,
    nv: &super::base::Nv,
    frame: &Frame,
    out: &mut Vec<Element>,
) {
    // A table has a size a deck can hold; a file can claim any. One beyond it stays as it was.
    let (wide, tall) = (
        tbl.child("a:tblGrid")
            .map_or(0, |g| g.children_named("a:gridCol").count()),
        tbl.children_named("a:tr").count(),
    );
    if wide > MOST_TABLE_COLUMNS
        || tall > MOST_TABLE_ROWS
        || wide.saturating_mul(tall) > MOST_TABLE_PLACES
    {
        cx.warn_slide(format!(
            "a table of {wide} columns and {tall} rows is bigger than a table here may be ({MOST_TABLE_COLUMNS} columns, {MOST_TABLE_ROWS} rows and {MOST_TABLE_PLACES} places in all): it was kept as it was and cannot be edited"
        ));
        raw::element(cx, gf, "pptx:table", nv, Some(frame), None, out);
        return;
    }
    let columns: Vec<f64> = tbl
        .child("a:tblGrid")
        .map(|g| {
            g.children_named("a:gridCol")
                .map(|c| snapped(length(c.int("w").unwrap_or(0))))
                .collect()
        })
        .unwrap_or_default();
    let tbl_pr = tbl.child("a:tblPr");
    let style = tbl_pr
        .and_then(|p| p.child("a:tableStyleId"))
        .and_then(|id| cx.env.table_styles.get(&id.text()));
    let flags = Flags::of(tbl_pr);
    let trs: Vec<&Node> = tbl.children_named("a:tr").collect();
    let size = (trs.len(), columns.len());
    let mut rows: Vec<TableRow> = Vec::with_capacity(trs.len());
    let mut trimmed = false;
    for (r, tr) in trs.iter().enumerate() {
        let mut cells = Vec::new();
        for (c, tc) in tr.children_named("a:tc").enumerate() {
            if tc.flag("hMerge") == Some(true) || tc.flag("vMerge") == Some(true) {
                continue;
            }
            // A row cannot hold more cells than the table has columns; the rest is not read.
            if cells.len() >= columns.len() {
                trimmed = true;
                break;
            }
            let mut made = cell(cx, tc);
            if let Some(style) = &style {
                dress(cx, &mut made, tc, &style.given((r, c), size, flags));
            }
            cells.push(made);
        }
        rows.push(TableRow {
            height: tr.int("h").map(|h| snapped(length(h))).filter(|h| *h > 0.0),
            cells,
            extra: Extra::new(),
        });
    }
    if columns.is_empty() || rows.is_empty() {
        cx.warn_slide("a table with no rows or columns was left out");
        return;
    }
    let header_row = tbl.child("a:tblPr").and_then(|p| p.flag("firstRow")) == Some(true);
    let base = base_of(cx, nv, Some(frame), None, Style::default());
    let mut el = TableEl {
        base,
        columns,
        rows,
        header_row,
        table_style: None,
        extra: Extra::new(),
    };
    // Cells are placed the way HTML places them; one that reaches past the table is cut back to it.
    if el.fit() || trimmed {
        cx.warn_slide("a table had cells that reached past its last column or row: they were cut back to the table");
    }
    out.push(Element::Table(el));
}
