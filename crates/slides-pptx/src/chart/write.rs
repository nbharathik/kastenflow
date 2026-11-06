//! A chart as `c:chartSpace`: a bar, line or pie chart whose numbers are in a workbook the chart points at, so that
//! PowerPoint draws it, restyles it and opens its data.

use slides_core::{ChartEl, ChartKind};

use super::data::{Table, column, esc};
use crate::color::Color;
use crate::xml::Xml;

const NS_C: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CAT_AXIS: u32 = 111_111;
const VAL_AXIS: u32 = 222_222;

/// A solid fill of a colour token or hex value; accent 1 for anything else.
fn solid(color: &str) -> String {
    let mut x = Xml::fragment();
    Color::parse(color)
        .unwrap_or(Color::Scheme("accent1"))
        .solid_fill(&mut x, None);
    x.into_string()
}

fn string_cache(items: &[String]) -> String {
    let points: String = items
        .iter()
        .enumerate()
        .map(|(i, t)| format!(r#"<c:pt idx="{i}"><c:v>{}</c:v></c:pt>"#, esc(t)))
        .collect();
    format!(
        r#"<c:strCache><c:ptCount val="{}"/>{points}</c:strCache>"#,
        items.len()
    )
}

fn series(table: &Table, j: usize, kind: &ChartKind) -> String {
    let s = &table.series[j];
    let col = column(j + 1);
    let last = table.categories.len() + 1;
    let paint = match kind {
        ChartKind::Line => format!(
            r#"<c:spPr><a:ln w="38100" cap="rnd">{}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr>{}</c:spPr></c:marker>"#,
            solid(&s.color),
            solid(&s.color)
        ),
        ChartKind::Pie => {
            let slices: String = (0..table.categories.len())
                .map(|n| {
                    format!(
                        r#"<c:dPt><c:idx val="{n}"/><c:bubble3D val="0"/><c:spPr>{}</c:spPr></c:dPt>"#,
                        solid(Table::slice_color(n))
                    )
                })
                .collect();
            slices
        }
        ChartKind::Bar => format!(
            r#"<c:spPr>{}</c:spPr><c:invertIfNegative val="0"/>"#,
            solid(&s.color)
        ),
    };
    let numbers: String = s
        .values
        .iter()
        .enumerate()
        .map(|(i, v)| format!(r#"<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>"#))
        .collect();
    format!(
        r#"<c:ser><c:idx val="{j}"/><c:order val="{j}"/><c:tx><c:strRef><c:f>Sheet1!${col}$1</c:f>{}</c:strRef></c:tx>{paint}<c:cat><c:strRef><c:f>Sheet1!$A$2:$A${last}</c:f>{}</c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!${col}$2:${col}${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="{}"/>{numbers}</c:numCache></c:numRef></c:val></c:ser>"#,
        string_cache(std::slice::from_ref(&s.name)),
        string_cache(&table.categories),
        table.categories.len()
    )
}

fn labels(on: bool, pie: bool) -> String {
    let (value, percent) = if pie { (0, 1) } else { (1, 0) };
    if on {
        format!(
            r#"<c:dLbls><c:showLegendKey val="0"/><c:showVal val="{value}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="{percent}"/><c:showBubbleSize val="0"/></c:dLbls>"#
        )
    } else {
        String::new()
    }
}

fn axes() -> String {
    format!(
        r#"<c:catAx><c:axId val="{CAT_AXIS}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="{VAL_AXIS}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="{VAL_AXIS}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="{CAT_AXIS}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>"#
    )
}

/// The chart part. `rid` is the relationship id of its workbook.
pub fn chart_xml(chart: &ChartEl, table: &Table, rid: &str) -> String {
    let all: String = (0..table.series.len())
        .map(|j| series(table, j, &chart.kind))
        .collect();
    let shows = labels(chart.labels, chart.kind == ChartKind::Pie);
    let plot = match chart.kind {
        ChartKind::Bar => format!(
            r#"<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>{all}{shows}<c:gapWidth val="80"/><c:axId val="{CAT_AXIS}"/><c:axId val="{VAL_AXIS}"/></c:barChart>{}"#,
            axes()
        ),
        ChartKind::Line => format!(
            r#"<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{all}{shows}<c:marker val="1"/><c:axId val="{CAT_AXIS}"/><c:axId val="{VAL_AXIS}"/></c:lineChart>{}"#,
            axes()
        ),
        ChartKind::Pie => format!(
            r#"<c:pieChart><c:varyColors val="1"/>{}{shows}<c:firstSliceAng val="0"/></c:pieChart>"#,
            // A pie draws the first series only.
            series(table, 0, &chart.kind)
        ),
    };
    let title = chart
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map_or_else(
            || r#"<c:autoTitleDeleted val="1"/>"#.to_owned(),
            |t| {
                format!(
                    r#"<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>{}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>"#,
                    esc(t)
                )
            },
        );
    let legend = chart
        .legend
        .unwrap_or(table.series.len() > 1 || chart.kind == ChartKind::Pie);
    let legend = if legend {
        r#"<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>"#
    } else {
        ""
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="{NS_C}" xmlns:a="{NS_A}" xmlns:r="{NS_R}"><c:roundedCorners val="0"/><c:chart>{title}<c:plotArea><c:layout/>{plot}</c:plotArea>{legend}<c:plotVisOnly val="1"/></c:chart><c:externalData r:id="{rid}"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>"#
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn chart(kind: &str) -> ChartEl {
        serde_json::from_value(json!({
            "id": "e-1", "kind": kind, "title": "Sales & more", "labels": true,
            "categories": ["Q1", "Q2"],
            "series": [{ "name": "North", "values": [1.0, 2.5] }, { "name": "South", "values": [3.0, 4.0], "color": "#ff0000" }]
        }))
        .unwrap()
    }

    fn xml(kind: &str) -> String {
        let c = chart(kind);
        chart_xml(&c, &Table::of(&c).unwrap(), "rId1")
    }

    #[test]
    fn a_bar_chart_has_its_series_categories_numbers_and_workbook() {
        let out = xml("bar");
        assert!(
            out.contains(r#"<c:barDir val="col"/><c:grouping val="clustered"/>"#),
            "{out}"
        );
        assert!(
            out.contains("<c:f>Sheet1!$B$1</c:f>") && out.contains("<c:f>Sheet1!$C$2:$C$3</c:f>"),
            "{out}"
        );
        assert!(
            out.contains(r#"<c:pt idx="1"><c:v>2.5</c:v></c:pt>"#),
            "{out}"
        );
        assert!(out.contains("<a:t>Sales &amp; more</a:t>"), "{out}");
        assert!(
            out.contains(r#"<a:srgbClr val="FF0000"/>"#),
            "the series colour"
        );
        assert!(out.contains(r#"<c:externalData r:id="rId1">"#));
        assert!(out.contains(r#"<c:showVal val="1"/>"#));
        assert!(out.contains("<c:legend>"), "two series have a legend");
    }

    #[test]
    fn a_line_has_markers_and_a_pie_draws_the_first_series_in_slices() {
        let line = xml("line");
        assert!(
            line.contains("<c:lineChart>") && line.contains(r#"<c:symbol val="circle"/>"#),
            "{line}"
        );
        let pie = xml("pie");
        assert!(
            pie.contains("<c:pieChart>") && pie.contains(r#"<c:showPercent val="1"/>"#),
            "{pie}"
        );
        assert_eq!(pie.matches("<c:ser>").count(), 1);
        assert_eq!(pie.matches("<c:dPt>").count(), 2);
        assert!(!pie.contains("<c:catAx>"));
    }
}
