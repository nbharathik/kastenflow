//! Fitting elements to a new slide size (see the module above for the rule).

use super::{Fit, round2, scaled_length, scaled_size};
use crate::model::{Element, Style, Text};
use crate::ops::geometry::refit;

/// The sides of a shape counted as equal: a circle stays a circle.
const ROUND: f64 = 0.5;

/// Fits the elements of a list, and what groups hold, to the new size.
pub fn scale_elements(list: &mut [Element], fit: &Fit) {
    if fit.is_identity() {
        return;
    }
    for element in list {
        scale_one(element, fit);
    }
}

/// Whether the element is fitted inside its stretched box instead of being stretched: a picture,
/// anything turned, and a circle.
fn keeps_shape(element: &Element) -> bool {
    let base = element.base();
    if base.rotation.is_some_and(|degrees| degrees % 360.0 != 0.0) {
        return true;
    }
    match element {
        Element::Image(_) => true,
        Element::Shape(shape) => {
            shape.shape == "ellipse"
                && base
                    .rect()
                    .is_some_and(|(_, _, w, h)| (w - h).abs() < ROUND)
        }
        _ => false,
    }
}

fn scale_box(element: &mut Element, fit: &Fit) {
    let keeps = keeps_shape(element);
    let base = element.base_mut();
    if keeps && let (Some(x), Some(y), Some(w), Some(h)) = (base.x, base.y, base.w, base.h) {
        let u = fit.uniform();
        let (cx, cy) = ((x + w / 2.0) * fit.sx, (y + h / 2.0) * fit.sy);
        let (w, h) = (w * u, h * u);
        base.x = Some(round2(cx - w / 2.0));
        base.y = Some(round2(cy - h / 2.0));
        base.w = Some(round2(w));
        base.h = Some(round2(h));
        return;
    }
    base.x = base.x.map(|v| round2(v * fit.sx));
    base.y = base.y.map(|v| round2(v * fit.sy));
    base.w = base.w.map(|v| round2(v * fit.sx));
    base.h = base.h.map(|v| round2(v * fit.sy));
}

fn scale_looks(style: &mut Style, by: f64) {
    style.radius = style.radius.map(|v| scaled_length(v, by));
    if let Some(stroke) = style.stroke.as_mut() {
        stroke.width = stroke.width.map(|v| scaled_length(v, by));
    }
    if let Some(shadow) = style.shadow.as_mut() {
        shadow.blur = scaled_length(shadow.blur, by);
        shadow.dx = scaled_length(shadow.dx, by);
        shadow.dy = scaled_length(shadow.dy, by);
    }
}

fn scale_text(text: &mut Text, by: f64) {
    if let Some(insets) = text.insets.as_mut() {
        insets.left = scaled_length(insets.left, by);
        insets.top = scaled_length(insets.top, by);
        insets.right = scaled_length(insets.right, by);
        insets.bottom = scaled_length(insets.bottom, by);
    }
    for paragraph in &mut text.paragraphs {
        paragraph.space_before = paragraph.space_before.map(|v| scaled_size(v, by));
        paragraph.space_after = paragraph.space_after.map(|v| scaled_size(v, by));
        for run in &mut paragraph.runs {
            run.size = run.size.map(|v| scaled_size(v, by));
        }
    }
}

/// Everything in the element that is a length of its own, apart from its box.
fn scale_contents(element: &mut Element, fit: &Fit) {
    let by = fit.text();
    if let Some(style) = element.base_mut().style.as_mut() {
        scale_looks(style, by);
    }
    match element {
        Element::Text(e) => scale_text(&mut e.text, by),
        Element::Shape(e) => {
            if let Some(text) = e.text.as_mut() {
                scale_text(text, by);
            }
        }
        Element::Connector(e) => {
            if let Some(label) = e.label.as_mut() {
                scale_text(label, by);
            }
        }
        Element::Table(table) => {
            for width in &mut table.columns {
                *width = round2(*width * fit.sx);
            }
            for row in &mut table.rows {
                row.height = row.height.map(|v| round2(v * fit.sy));
                for cell in &mut row.cells {
                    scale_text(&mut cell.text, by);
                }
            }
        }
        Element::Code(e) => e.font_size = e.font_size.map(|v| scaled_size(v, by)),
        Element::Math(e) => e.font_size = e.font_size.map(|v| scaled_size(v, by)),
        _ => {}
    }
}

fn scale_one(element: &mut Element, fit: &Fit) {
    scale_box(element, fit);
    scale_contents(element, fit);
    if let Some(children) = element.children_mut() {
        for child in children.iter_mut() {
            scale_one(child, fit);
        }
    }
    // A group is the box that holds its children: fit it to them where one of them kept its shape.
    if keeps_inside(element) {
        refit(element);
    }
}

fn keeps_inside(element: &Element) -> bool {
    element
        .children()
        .iter()
        .any(|child| keeps_shape(child) || keeps_inside(child))
}
