//! Shapes: the objects on a slide, layout or master, each converted into the
//! element of a deck it is (or into `raw`, when it is something a deck cannot
//! hold).

mod base;
mod chart;
mod cxn;
pub mod frame;
mod group;
mod links;
mod ph;
mod pic;
mod raw;
mod sp;
pub mod style;
mod table;
mod text;

use slides_core::{Anchor, Element, Side};

use crate::import::cx::Cx;
use crate::import::dom::Node;

/// Converts what a shape tree (or group, or alternate content) holds, in order.
pub fn children(cx: &mut Cx, parent: &Node) -> Vec<Element> {
    let items: Vec<&Node> = parent.elements().collect();
    let mut out = Vec::new();
    let mut at = 0;
    while at < items.len() {
        let used = one(cx, &items, at, &mut out);
        at += used;
    }
    out
}

/// Converts the shape at `items[at]`; returns how many items it used up.
fn one(cx: &mut Cx, items: &[&Node], at: usize, out: &mut Vec<Element>) -> usize {
    let node = items[at];
    match node.name.as_str() {
        "p:sp" => sp::convert(cx, node, out),
        "p:pic" => pic::convert(cx, node, out),
        "p:grpSp" => group::convert(cx, node, out),
        "p:graphicFrame" => table::convert_frame(cx, node, out),
        "p:cxnSp" => {
            if cxn::convert(cx, node, items.get(at + 1).copied(), out) {
                return 2;
            }
        }
        "mc:AlternateContent" => {
            // The fallback is what a program that knows no extensions shows; the choice is used when there is none.
            let chosen = node
                .child("mc:Fallback")
                .filter(|f| f.elements().next().is_some())
                .or_else(|| node.child("mc:Choice"));
            if let Some(chosen) = chosen {
                cx.warn_slide("an object that only newer PowerPoint draws in full was replaced by the picture it falls back to");
                let inner = children(cx, chosen);
                out.extend(inner);
            }
        }
        "p:nvGrpSpPr" | "p:grpSpPr" | "p:extLst" => {}
        other => cx.warn_slide(format!(
            "an element `{other}` is not one this import knows and was left out"
        )),
    }
    1
}

/// Which side of a shape a connection site is on. The numbering is the preset's: a rectangle counts its
/// sites top, left, bottom, right, an ellipse goes round in eight.
pub fn side_of_site(preset: &str, idx: i64) -> Option<Side> {
    let boxy = |i| match i {
        0 => Some(Side::Top),
        1 => Some(Side::Left),
        2 => Some(Side::Bottom),
        3 => Some(Side::Right),
        _ => None,
    };
    match preset {
        "ellipse" | "flowChartConnector" => match idx {
            0 => Some(Side::Top),
            2 => Some(Side::Left),
            4 => Some(Side::Bottom),
            6 => Some(Side::Right),
            _ => None,
        },
        _ => boxy(idx),
    }
}

/// The side of a box that a point is nearest the middle of.
fn nearest_side(rect: (f64, f64, f64, f64), point: (f64, f64)) -> Side {
    let (x, y, w, h) = rect;
    let dist = |(px, py): (f64, f64)| (px - point.0).hypot(py - point.1);
    let sides = [
        (Side::Top, (x + w / 2.0, y)),
        (Side::Left, (x, y + h / 2.0)),
        (Side::Bottom, (x + w / 2.0, y + h)),
        (Side::Right, (x + w, y + h / 2.0)),
    ];
    sides
        .into_iter()
        .min_by(|a, b| dist(a.1).total_cmp(&dist(b.1)))
        .map_or(Side::Right, |(side, _)| side)
}

/// Where the ends of a connector are: the box's corners, as its flips turn them.
fn ends(rect: (f64, f64, f64, f64), flip_h: bool, flip_v: bool) -> ((f64, f64), (f64, f64)) {
    let (x, y, w, h) = rect;
    let start = (
        if flip_h { x + w } else { x },
        if flip_v { y + h } else { y },
    );
    let end = (
        if flip_h { x } else { x + w },
        if flip_v { y } else { y + h },
    );
    (start, end)
}

fn find<'e>(list: &'e [Element], id: &str) -> Option<&'e Element> {
    for e in list {
        if e.id() == id {
            return Some(e);
        }
        if let Some(found) = find(e.children(), id) {
            return Some(found);
        }
    }
    None
}

fn preset_of(e: &Element) -> &str {
    match e {
        Element::Shape(s) => s.shape.as_str(),
        _ => "rect",
    }
}

/// Fills in the shapes that connectors join, now that every shape has an element.
pub fn join_connectors(cx: &mut Cx, elements: &mut [Element]) {
    let pending = std::mem::take(&mut cx.pending);
    for p in pending {
        let mut anchors: [Option<Anchor>; 2] = [None, None];
        let Some((rect, flips)) = find(elements, &p.element).and_then(|e| {
            e.base()
                .rect()
                .map(|r| (r, (e.base().flip_h, e.base().flip_v)))
        }) else {
            continue;
        };
        let points = ends(rect, flips.0, flips.1);
        for (n, wanted) in [(0, p.start), (1, p.end)] {
            let Some((shape, idx)) = wanted else { continue };
            let Some(target_id) = cx.shape_ids.get(&shape) else {
                continue;
            };
            let Some(target) = find(elements, target_id) else {
                continue;
            };
            let side = side_of_site(preset_of(target), idx).unwrap_or_else(|| {
                let point = if n == 0 { points.0 } else { points.1 };
                target
                    .base()
                    .rect()
                    .map_or(Side::Right, |r| nearest_side(r, point))
            });
            anchors[n] = Some(Anchor {
                el: target_id.clone(),
                side,
                extra: slides_core::Extra::new(),
            });
        }
        let [from, to] = anchors;
        if let Some(Element::Connector(c)) = find_mut(elements, &p.element) {
            c.from = from;
            c.to = to;
        }
    }
}

fn find_mut<'e>(list: &'e mut [Element], id: &str) -> Option<&'e mut Element> {
    for e in list {
        if e.id() == id {
            return Some(e);
        }
        if let Some(children) = e.children_mut()
            && let Some(found) = find_mut(children, id)
        {
            return Some(found);
        }
    }
    None
}
