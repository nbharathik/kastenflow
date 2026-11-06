//! Charts as charts. A bar, line or pie chart of a deck goes out as a `c:chart` part with a workbook of its numbers, so
//! PowerPoint draws it from data and opens "Edit data". It is handed to the writer as a `raw` element that keeps those
//! two parts, the way an imported chart is, so the writer's rules for kept parts (what may be written back) apply to it.

mod data;
mod write;
mod xlsx;

use serde_json::Map;
use slides_core::{ChartEl, Deck, Element, Extra, RawEl};

use crate::rawpart::{Kept, Link, Part, Target};
use data::{Table, esc};

const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_CHART: &str = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const CT_WORKBOOK: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/// The `p:graphicFrame` that shows a chart part by relationship `rId1` (the position is the writer's to fill in).
fn frame_xml(name: &str, alt: &str) -> String {
    format!(
        r#"<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="{REL}"><p:nvGraphicFramePr><p:cNvPr id="2" name="{}" descr="{}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></p:graphicFrame>"#,
        esc(name),
        esc(alt)
    )
}

/// A chart as the `raw` element that holds its parts. None for a chart with nothing to draw.
pub fn as_raw(chart: &ChartEl) -> Option<Element> {
    let table = Table::of(chart)?;
    let record = Kept {
        links: vec![Link {
            id: "rId1".to_owned(),
            kind: format!("{REL}/chart"),
            to: Target::Part(0),
        }],
        parts: vec![
            Part {
                name: "ppt/charts/chart1.xml".to_owned(),
                content_type: CT_CHART.to_owned(),
                data: write::chart_xml(chart, &table, "rId1").into_bytes(),
                links: vec![Link {
                    id: "rId1".to_owned(),
                    kind: format!("{REL}/package"),
                    to: Target::Part(1),
                }],
            },
            Part {
                name: "ppt/embeddings/Microsoft_Excel_Sheet1.xlsx".to_owned(),
                content_type: CT_WORKBOOK.to_owned(),
                data: xlsx::workbook(&table),
                links: Vec::new(),
            },
        ],
    };
    let mut extra: Extra = Map::new();
    record.store(&mut extra);
    let alt = chart.base.alt.clone().unwrap_or_else(|| {
        let kind = match chart.kind {
            slides_core::ChartKind::Bar => "Bar chart",
            slides_core::ChartKind::Line => "Line chart",
            slides_core::ChartKind::Pie => "Pie chart",
        };
        match chart
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            Some(title) => format!("{kind}: {title}"),
            None => kind.to_owned(),
        }
    });
    Some(Element::Raw(RawEl {
        base: chart.base.clone(),
        original: Some("kasten:chart".to_owned()),
        xml: Some(frame_xml(
            chart.base.name.as_deref().unwrap_or("Chart"),
            &alt,
        )),
        preview: None,
        extra,
    }))
}

fn swap(elements: &mut [Element]) {
    for el in elements {
        if let Element::Chart(chart) = el
            && let Some(raw) = as_raw(chart)
        {
            *el = raw;
        } else if let Some(children) = el.children_mut() {
            swap(children);
        }
    }
}

/// The deck with each chart that has numbers swapped for the element that writes it as a PowerPoint chart.
pub fn native(deck: &Deck) -> Deck {
    let mut out = deck.clone();
    for slide in &mut out.slides {
        swap(&mut slide.elements);
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn deck_with_chart(series: serde_json::Value) -> Deck {
        let mut e = slides_core::Engine::create("t", "Light", 3).unwrap_or_else(|x| panic!("{x}"));
        let slide = e
            .apply("add_slide", json!({ "layout": "blank" }))
            .unwrap_or_else(|x| panic!("{x}"))
            .output["slide"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        e.apply(
            "add_elements",
            json!({ "slide": slide, "elements": [{ "type": "chart", "kind": "bar", "x": 40, "y": 40, "w": 600, "h": 360,
                "categories": ["A", "B"], "series": series }] }),
        )
        .unwrap_or_else(|x| panic!("{x}"));
        e.into_deck()
    }

    #[test]
    fn a_chart_with_numbers_is_swapped_for_an_element_that_keeps_its_two_parts() {
        let deck = deck_with_chart(json!([{ "name": "N", "values": [1, 2] }]));
        let out = native(&deck);
        let found = out
            .slides
            .iter()
            .flat_map(|s| &s.elements)
            .find_map(|e| match e {
                Element::Raw(r) => Some(r),
                _ => None,
            });
        let raw = found.unwrap_or_else(|| panic!("a raw element"));
        let record = Kept::load(&raw.extra).unwrap_or_else(|| panic!("a record"));
        assert_eq!(record.parts.len(), 2);
        assert!(raw.xml.as_deref().is_some_and(|x| x.contains("c:chart")));
    }

    #[test]
    fn a_chart_with_nothing_to_draw_is_left_as_it_is() {
        let deck = deck_with_chart(json!([]));
        let out = native(&deck);
        assert!(
            out.slides
                .iter()
                .flat_map(|s| &s.elements)
                .all(|e| !matches!(e, Element::Raw(_)))
        );
    }
}
