//! Lines and connectors: a `p:cxnSp` from the top left of the box to the bottom
//! right, turned by the flips. A connector also names the shapes it joins and
//! the connection site on each, so it follows them when they move in PowerPoint;
//! its label is a text box on its midpoint.

use slides_core::resolve::Rect;
use slides_core::{Anchor, Base, ConnectorEl, Element, LineEl, Route, Side, Text, Theme};

use super::Site;
use super::common::{Frame, name_of, write_c_nv_pr, write_xfrm};
use super::presets::{is_preset, site};
use crate::cx::Cx;
use crate::style::{combined, write_effects, write_line as write_outline};
use crate::text::metrics::DEFAULT_INSETS;
use crate::text::{self, Look};
use crate::units::angle;
use crate::xml::Xml;

/// The connection site a connector end is written to: a shape's number and the site on it.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Attach {
    id: u32,
    idx: u32,
}

/// The preset for a route. A free line is `line`; joined shapes use a connector.
fn preset(route: Option<&Route>, connector: bool) -> &'static str {
    match route {
        Some(Route::Elbow) => "bentConnector3",
        Some(Route::Curved) => "curvedConnector3",
        _ if connector => "straightConnector1",
        _ => "line",
    }
}

fn mirrored(side: Side, flip_h: bool, flip_v: bool) -> Side {
    match side {
        Side::Left if flip_h => Side::Right,
        Side::Right if flip_h => Side::Left,
        Side::Top if flip_v => Side::Bottom,
        Side::Bottom if flip_v => Side::Top,
        other => other,
    }
}

/// The connection site the end of a connector is on, or None when the shape
/// has no site at that side; the connector then keeps its place unattached.
fn attach(cx: &mut Cx, anchor: Option<&Anchor>, which: &str) -> Option<Attach> {
    let anchor = anchor?;
    let slide = cx.deck.slide(cx.slide.as_deref()?)?;
    let target = slide.element(&anchor.el)?;
    let id = cx.ids.of(&anchor.el)?;
    let base = target.base();
    let geometry = match target {
        Element::Text(_) => "rect",
        Element::Shape(s) if is_preset(&s.shape) => s.shape.as_str(),
        Element::Shape(_) => "rect",
        Element::Image(i) => match i.mask {
            Some(slides_core::Mask::Ellipse) => "ellipse",
            Some(slides_core::Mask::RoundRect) => "roundRect",
            _ => "rect",
        },
        other => {
            cx.warn(format!(
                "the {which} of a connector is on a {}, which has no connection points; it is not attached",
                other.kind()
            ));
            return None;
        }
    };
    if angle(base.rotation.unwrap_or(0.0)) != 0 {
        cx.warn(format!(
            "the {which} of a connector is on a turned shape; it is not attached"
        ));
        return None;
    }
    let side = mirrored(anchor.side.clone(), base.flip_h, base.flip_v);
    let Some(idx) = site(geometry, side) else {
        cx.warn(format!(
            "the {which} of a connector is on a `{geometry}`, whose connection points are not used; it is not attached"
        ));
        return None;
    };
    Some(Attach { id, idx })
}

fn write_cxn(
    x: &mut Xml,
    cx: &mut Cx,
    base: &Base,
    site: &Site,
    route: Option<&Route>,
    ends: [Option<Attach>; 2],
    connector: bool,
) {
    let Site {
        id, frame, opacity, ..
    } = site;
    x.open("p:cxnSp");
    x.open("p:nvCxnSpPr");
    let label = if connector { "Connector" } else { "Line" };
    write_c_nv_pr(x, cx, *id, &name_of(base, label, *id), base);
    x.open("p:cNvCxnSpPr");
    for (tag, end) in [("a:stCxn", ends[0]), ("a:endCxn", ends[1])] {
        if let Some(end) = end {
            x.open(tag)
                .int("id", i64::from(end.id))
                .int("idx", i64::from(end.idx))
                .close();
        }
    }
    x.close();
    x.open("p:nvPr").close();
    x.close();
    x.open("p:spPr");
    write_xfrm(x, "a:xfrm", frame);
    x.open("a:prstGeom").attr("prst", preset(route, connector));
    x.open("a:avLst").close();
    x.close();
    write_outline(x, cx, base.style.as_ref(), *opacity, true, true);
    write_effects(x, cx, base.style.as_ref(), *opacity);
    x.close();
    x.close();
}

/// A free line or arrow.
pub fn write_line(x: &mut Xml, cx: &mut Cx, el: &LineEl, site: &Site) {
    write_cxn(
        x,
        cx,
        &el.base,
        site,
        el.route.as_ref(),
        [None, None],
        false,
    );
}

/// The size of a label's chip: about as the editor works it out from the text, without measuring it.
fn label_box(theme: &Theme, text: &Text) -> (f64, f64) {
    const CHAR_WIDTH: f64 = 0.55;
    const LINE_HEIGHT: f64 = 1.25;
    let insets = text.insets.as_ref().unwrap_or(&DEFAULT_INSETS);
    let tallest = text
        .paragraphs
        .iter()
        .flat_map(|p| p.runs.iter().map(|r| r.size.unwrap_or(0.0)))
        .fold(0.0, f64::max);
    let points = if tallest > 0.0 {
        tallest
    } else {
        theme.text_style("caption").map_or(14.0, |s| s.size)
    };
    let size = slides_core::units::points_to_units(points);
    let lines: Vec<usize> = text
        .paragraphs
        .iter()
        .flat_map(|p| {
            p.runs
                .iter()
                .map(|r| r.t.as_str())
                .collect::<String>()
                .split('\n')
                .map(|l| l.chars().count())
                .collect::<Vec<_>>()
        })
        .collect();
    let widest = lines.iter().copied().max().unwrap_or(1).max(1);
    (
        (widest as f64 * size * CHAR_WIDTH + insets.left + insets.right).clamp(24.0, 320.0),
        lines.len().max(1) as f64 * size * LINE_HEIGHT + insets.top + insets.bottom,
    )
}

/// Whether the label shows anything.
fn is_blank(text: &Text) -> bool {
    text.paragraphs.iter().all(|p| {
        p.runs
            .iter()
            .all(|r| r.field.is_none() && r.t.trim().is_empty())
    })
}

/// The label on the midpoint of a connector, on a chip of the slide's colour so
/// the line does not run through the words.
fn write_label(x: &mut Xml, cx: &mut Cx, el: &ConnectorEl, site: &Site) {
    let Some(label) = el.label.as_ref().filter(|l| !is_blank(l)) else {
        return;
    };
    let (w, h) = label_box(&cx.deck.theme, label);
    let Rect {
        x: left,
        y: top,
        w: across,
        h: down,
    } = site.frame.rect;
    let centre = (left + across / 2.0, top + down / 2.0);
    let frame = Frame {
        rect: Rect {
            x: centre.0 - w / 2.0,
            y: centre.1 - h / 2.0,
            w,
            h,
        },
        rotation: site.frame.rotation,
        flip_h: false,
        flip_v: false,
    };
    let mut words = label.clone();
    for p in &mut words.paragraphs {
        p.align.get_or_insert(slides_core::Align::Center);
    }
    let id = cx.ids.fresh();
    x.open("p:sp");
    x.open("p:nvSpPr");
    x.open("p:cNvPr")
        .int("id", i64::from(id))
        .attr(
            "name",
            &format!("{} label", name_of(&el.base, "Connector", site.id)),
        )
        .close();
    x.open("p:cNvSpPr").attr("txBox", "1").close();
    x.open("p:nvPr").close();
    x.close();
    x.open("p:spPr");
    write_xfrm(x, "a:xfrm", &frame);
    x.open("a:prstGeom").attr("prst", "rect");
    x.open("a:avLst").close();
    x.close();
    cx.color("bg1").solid_fill(x, combined(None, site.opacity));
    x.open("a:ln");
    x.open("a:noFill").close();
    x.close();
    x.close();
    let look = Look {
        style: "caption",
        valign: slides_core::VAlign::Middle,
        wrap: false,
        opacity: site.opacity,
        flipped: false,
        area: None,
    };
    text::write_body(x, cx, "p:txBody", &words, &look);
    x.close();
}

/// A line attached to two elements, and its label.
pub fn write_connector(x: &mut Xml, cx: &mut Cx, el: &ConnectorEl, site: &Site) {
    let ends = [
        attach(cx, el.from.as_ref(), "start"),
        attach(cx, el.to.as_ref(), "end"),
    ];
    write_cxn(x, cx, &el.base, site, Some(&el.route), ends, true);
    write_label(x, cx, el, site);
}

#[cfg(test)]
mod tests;
