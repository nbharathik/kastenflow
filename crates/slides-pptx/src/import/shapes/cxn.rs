//! `p:cxnSp`: a line or connector. One that names the shapes it joins is a
//! connector, whose ends are found once every shape has an element; any other
//! is a free line.

use slides_core::{ConnectorEl, Element, LineEl, Route, Text};

use super::base::{base_of, nv_of};
use super::frame;
use super::sp::line_route;
use super::style;
use crate::import::cx::{Cx, Pending};
use crate::import::dom::Node;
use crate::import::master::ph_element;

fn end(node: Option<&Node>) -> Option<(i64, i64)> {
    let n = node?;
    Some((n.int("id")?, n.int("idx").unwrap_or(0)))
}

/// Whether `next` is the text box the exporter puts on a connector's midpoint to label it: named after
/// the connector, and a plain rectangle of words (a program that saves the file again may drop `txBox`).
pub fn label_for<'n>(name: &str, next: Option<&'n Node>) -> Option<&'n Node> {
    let sp = next.filter(|n| n.name == "p:sp")?;
    let label = nv_of(sp.at(&["p:nvSpPr", "p:cNvPr"])).name;
    let is_box = sp
        .at(&["p:nvSpPr", "p:cNvSpPr"])
        .and_then(|n| n.flag("txBox"))
        == Some(true);
    let plain = ph_element(sp).is_none()
        && sp.child("p:txBody").is_some()
        && sp
            .at(&["p:spPr", "a:prstGeom"])
            .and_then(|g| g.attr("prst"))
            .is_none_or(|p| p == "rect");
    ((is_box || plain) && !name.is_empty() && label == format!("{name} label")).then_some(sp)
}

/// Converts a connector; returns whether the shape after it was its label and is used up.
pub fn convert(cx: &mut Cx, cxn: &Node, next: Option<&Node>, out: &mut Vec<Element>) -> bool {
    let nv = nv_of(cxn.at(&["p:nvCxnSpPr", "p:cNvPr"]));
    let Some(frame) = cxn
        .at(&["p:spPr", "a:xfrm"])
        .and_then(frame::read)
        .map(|f| frame::place(&cx.groups, f))
        .map(frame::half_turn_as_flips)
    else {
        cx.warn_slide("a line with no position was left out");
        return false;
    };
    let geometry = cxn.at(&["p:spPr", "a:prstGeom"]);
    let route = geometry
        .and_then(|g| g.attr("prst"))
        .and_then(line_route)
        .unwrap_or(Route::Straight);
    let looks = style::read(cx, cxn, geometry, &frame);
    let props = cxn.at(&["p:nvCxnSpPr", "p:cNvCxnSpPr"]);
    let start = end(props.and_then(|p| p.child("a:stCxn")));
    let finish = end(props.and_then(|p| p.child("a:endCxn")));
    let joined = start.is_some() || finish.is_some();
    let base = base_of(cx, &nv, Some(&frame), None, looks);
    if !joined {
        out.push(Element::Line(LineEl {
            base,
            route: (route != Route::Straight).then_some(route),
            extra: slides_core::Extra::new(),
        }));
        return false;
    }
    let label = label_for(&nv.name, next).and_then(|sp| {
        let body = sp.child("p:txBody")?;
        let mut words = super::text::text_of(
            cx,
            sp,
            body,
            None,
            slides_core::VAlign::Middle,
            Some("caption"),
        );
        // A label never wraps, and is as big as its words: that is how it is written, not a choice.
        words.wrap = None;
        words.fit = None;
        Some(words)
    });
    let used = label.is_some();
    cx.pending.push(Pending {
        element: base.id.clone(),
        start,
        end: finish,
    });
    out.push(Element::Connector(ConnectorEl {
        base,
        route,
        from: None,
        to: None,
        label: label.filter(|t: &Text| {
            t.paragraphs
                .iter()
                .any(|p| p.runs.iter().any(|r| !r.t.is_empty()))
        }),
        extra: slides_core::Extra::new(),
    }));
    used
}
