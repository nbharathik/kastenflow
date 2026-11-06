//! `p:sp`: a text box, a preset shape, a placeholder's text, or (when a deck
//! cannot hold its geometry) a `raw` element.

use slides_core::{Element, LineEl, Route, ShapeEl, Text, TextEl, VAlign};

use super::base::{base_of, nv_of};
use super::frame::{self, Frame};
use super::ph::{self, PhMatch};
use super::text::text_of;
use super::{pic, raw, style};
use crate::import::cx::Cx;
use crate::import::dom::Node;
use crate::import::master::ph_element;

/// A preset name that is really a line.
pub fn line_route(prst: &str) -> Option<Route> {
    if prst.starts_with("bentConnector") {
        Some(Route::Elbow)
    } else if prst.starts_with("curvedConnector") {
        Some(Route::Curved)
    } else if matches!(prst, "line" | "lineInv" | "straightConnector1") {
        Some(Route::Straight)
    } else {
        None
    }
}

/// The shape's frame: its own box carried out of its groups, or the slot's.
fn frame_of(cx: &Cx, sp: &Node, slot: Option<&PhMatch>) -> Option<Frame> {
    if let Some(own) = sp.at(&["p:spPr", "a:xfrm"]).and_then(frame::read) {
        return Some(frame::place(&cx.groups, own));
    }
    let rect = slot.and_then(|s| {
        s.layout
            .and_then(|l| l.rect)
            .or_else(|| s.master.and_then(|m| m.rect))
    })?;
    Some(Frame {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        rot: 0.0,
        flip_h: false,
        flip_v: false,
    })
}

/// Whether a `p:txBody` shows no words at all (an empty paragraph or two).
fn body_is_blank(body: &Node) -> bool {
    body.children_named("a:p").all(|p| {
        p.elements().all(|n| match n.name.as_str() {
            "a:r" => n.child("a:t").is_none_or(|t| t.text().is_empty()),
            "a:fld" | "a:br" => false,
            _ => true,
        })
    })
}

fn is_blank(text: &Text) -> bool {
    text.paragraphs
        .iter()
        .all(|p| p.runs.iter().all(|r| r.t.is_empty() && r.field.is_none()))
}

pub fn convert(cx: &mut Cx, sp: &Node, out: &mut Vec<Element>) {
    let nv = nv_of(sp.at(&["p:nvSpPr", "p:cNvPr"]));
    let ph_node = ph_element(sp);
    let slot = ph_node
        .filter(|_| !cx.part.in_master)
        .map(|ph| ph::find(cx.env, cx.part.layout, ph));
    let geometry = sp.at(&["p:spPr", "a:prstGeom"]);
    let prst = geometry
        .and_then(|g| g.attr("prst"))
        .unwrap_or("rect")
        .to_owned();
    let frame = frame_of(cx, sp, slot.as_ref());

    if sp.at(&["p:spPr", "a:custGeom"]).is_some() {
        let base_frame = frame;
        raw::element(
            cx,
            sp,
            "pptx:custom-shape",
            &nv,
            base_frame.as_ref(),
            None,
            out,
        );
        return;
    }
    let Some(frame) = frame else {
        cx.warn_slide(format!(
            "a shape with no position ({}) was left out",
            nv.name
        ));
        return;
    };
    let tx_body = sp.child("p:txBody");
    let blip_fill = sp.at(&["p:spPr", "a:blipFill"]);
    if let Some(fill) = blip_fill
        && tx_body.is_none_or(body_is_blank)
        && line_route(&prst).is_none()
    {
        pic::from_shape(cx, sp, &nv, &frame, slot.as_ref(), fill, out);
        return;
    }
    let mut looks = style::read(cx, sp, geometry, &frame);
    if prst == "roundRect" && geometry.is_some_and(style::has_default_radius) {
        // A shape with the preset's own corners follows the preset, as one of a deck with no radius does.
        looks.radius = None;
    }
    let text_box = sp
        .at(&["p:nvSpPr", "p:cNvSpPr"])
        .and_then(|n| n.flag("txBox"))
        == Some(true);

    if let Some(route) = line_route(&prst) {
        let frame = frame::half_turn_as_flips(frame);
        let base = base_of(cx, &nv, Some(&frame), None, looks);
        out.push(Element::Line(LineEl {
            base,
            route: (route != Route::Straight).then_some(route),
            extra: slides_core::Extra::new(),
        }));
        return;
    }

    // A rectangle with words and neither fill nor outline is a text box, whatever it is called.
    let bare_words = prst == "rect"
        && looks.fill.is_none()
        && looks.stroke.is_none()
        && looks.shadow.is_none()
        && tx_body.is_some_and(|b| !body_is_blank(b));
    // Only a text element can be rounded by a radius of its own, so one with the preset's corners stays a shape.
    let as_text = (prst == "rect" || (prst == "roundRect" && looks.radius.is_some()))
        && (ph_node.is_some() || text_box || bare_words);
    let default_valign = if as_text {
        slot.as_ref()
            .and_then(|s| s.layout.and_then(|l| l.body.anchor.clone()))
            .unwrap_or(VAlign::Top)
    } else {
        VAlign::Middle
    };
    let text = tx_body.map(|body| text_of(cx, sp, body, slot.as_ref(), default_valign, None));

    // An empty slot on a slide is a prompt for an editor only.
    if slot.is_some()
        && text.as_ref().is_none_or(is_blank)
        && looks.fill.is_none()
        && looks.stroke.is_none()
    {
        return;
    }
    let role = slot.as_ref().and_then(PhMatch::role).filter(|_| as_text);
    let follows_layout = role.is_some() && sp.at(&["p:spPr", "a:xfrm"]).is_none();
    let mut base = base_of(cx, &nv, Some(&frame), role, looks);
    if follows_layout {
        // The layout's slot supplies the box, so the element leaves it out and follows the layout.
        base.x = None;
        base.y = None;
        base.w = None;
        base.h = None;
    }
    if as_text {
        out.push(Element::Text(TextEl {
            base,
            text: text.unwrap_or_else(|| Text::plain("")),
            columns: None,
            column_gap: None,
            extra: slides_core::Extra::new(),
        }));
    } else {
        out.push(Element::Shape(ShapeEl {
            base,
            shape: prst,
            text: text.filter(|t| !is_blank(t)),
            extra: slides_core::Extra::new(),
        }));
    }
}
