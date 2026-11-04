//! Drawing a diagram: boxes for the things and arrows attached to them for
//! how they lead to one another, laid out in layers so that nothing overlaps
//! and everything fits. Agents use it to draw a flow without working out
//! coordinates; a person can use it to start a diagram and then move the
//! boxes, the arrows following.

mod build;
mod input;
mod layers;
mod plan;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::elements::validate;
use super::geometry::reroute;
use super::util::ids_on;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::ELEMENT;
use crate::model::{Deck, Element};
use build::{Flow, connector, node_element};
use input::{check, explicit, free_area, in_a_line};
use layers::Graph;

op_types! {
    /// Which way the diagram runs.
    #[derive(Copy, Eq)]
    pub enum Direction {
        /// The first boxes on the left, arrows going right.
        #[serde(alias = "lr")]
        LeftToRight,
        /// The first boxes on top, arrows going down.
        #[serde(alias = "td")]
        TopDown,
    }

    /// One box of the diagram.
    pub struct DiagramNode {
        /// A short name for the box that the edges use, such as `model`. Unique in the diagram.
        pub id: String,
        /// The words in the box. A new line is `\n`.
        pub label: String,
        /// A preset shape: `roundRect` (the default), `rect`, `ellipse`, `diamond` ...
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub shape: Option<String>,
        /// The fill: a theme colour (`accent2`, `bg2` ...) or `#rrggbb`. The words take whichever of the theme's light and dark reads better on it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<String>,
        /// Fills the box in the theme's accent colour. For the one box the eye should go to.
        #[serde(default, skip_serializing_if = "crate::model::is_false")]
        pub emphasis: bool,
    }

    /// An arrow from one box to another.
    pub struct DiagramEdge {
        /// The `id` of the box it leaves.
        pub from: String,
        /// The `id` of the box it points to.
        pub to: String,
        /// A word or two written on the arrow.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub label: Option<String>,
    }

    /// A place on the slide, in slide units.
    pub struct DiagramBox {
        pub x: f64,
        pub y: f64,
        pub w: f64,
        pub h: f64,
    }

    /// Draws a diagram on a slide.
    pub struct AddDiagram {
        pub slide: String,
        pub nodes: Vec<DiagramNode>,
        #[serde(default)]
        pub edges: Vec<DiagramEdge>,
        /// `leftToRight` (the default) or `topDown`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub direction: Option<Direction>,
        /// Where it goes. Left out, the free area under the slide's title, inside the margins.
        #[serde(default, rename = "box", skip_serializing_if = "Option::is_none")]
        pub area: Option<DiagramBox>,
    }

    pub struct AddedDiagram {
        /// The element id of each box, by the box's own `id`.
        pub nodes: BTreeMap<String, String>,
        /// The element ids of the arrows, in the order of the edges.
        pub connectors: Vec<String>,
        /// The type size the words were set at, in points.
        pub font: f64,
    }
}

impl Op for AddDiagram {
    type Output = AddedDiagram;
    const NAME: &'static str = "add_diagram";
    const ABOUT: &'static str = "Draw a diagram: a box for each of `nodes` and an arrow attached to the boxes for each of `edges`, laid out in layers, left to right (the default) or top down, inside `box` (default: the free area under the slide's title). Boxes never overlap, arrows stay attached when boxes move, the type is 14 pt or more, and a diagram that cannot fit is refused with advice. Use it instead of placing boxes and connectors by hand. Node `id`s are short names the edges use; `emphasis` fills one box in the accent colour; `color` sets a fill; `shape` picks a preset (roundRect, rect, ellipse, diamond ...). Returns the element ids of the boxes and arrows.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<AddedDiagram> {
        let Deck {
            theme,
            slides,
            size,
            ..
        } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let index = check(&self)?;
        let area = match &self.area {
            Some(b) => explicit(b, size.w, size.h)?,
            None => free_area(theme, slide, size.w, size.h)?,
        };
        let graph = Graph {
            nodes: self.nodes.len(),
            edges: self
                .edges
                .iter()
                .map(|e| (index[&e.from], index[&e.to]))
                .collect(),
        };
        let direction = self.direction.unwrap_or(Direction::LeftToRight);
        // Boxes that lead nowhere sit in a row (or a column), not stacked.
        let layering = if graph.edges.is_empty() {
            in_a_line(graph.nodes)
        } else {
            layers::layer(&graph)
        };
        let boxes: Vec<(String, String, bool)> = self
            .nodes
            .iter()
            .map(|n| {
                (
                    n.label.clone(),
                    n.shape.clone().unwrap_or_else(|| "roundRect".to_owned()),
                    n.emphasis,
                )
            })
            .collect();
        let arrows: Vec<plan::Arrow> = self
            .edges
            .iter()
            .map(|e| plan::Arrow {
                from: index[&e.from],
                to: index[&e.to],
                label: e.label.clone(),
            })
            .collect();
        let plan = plan::plan(theme, &boxes, &arrows, &layering, direction, area)?;

        let mut taken = ids_on(slide);
        let mut made: Vec<Element> = Vec::new();
        let mut ids: Vec<String> = Vec::new();
        for (node, rect) in self.nodes.iter().zip(&plan.rects) {
            let id = cx.ids.fresh(ELEMENT, |c| taken.contains(c));
            taken.insert(id.clone());
            made.push(node_element(theme, node, &id, *rect, plan.font));
            ids.push(id);
        }
        let mut connectors = Vec::new();
        for (e, edge) in self.edges.iter().enumerate() {
            let id = cx.ids.fresh(ELEMENT, |c| taken.contains(c));
            taken.insert(id.clone());
            let (from, to) = (index[&edge.from], index[&edge.to]);
            let flow = Flow {
                direction,
                back: layering.back[e],
                level: (plan.rects[from].y + plan.rects[from].h / 2.0
                    - (plan.rects[to].y + plan.rects[to].h / 2.0))
                    .abs()
                    < 0.5,
            };
            made.push(connector(
                &id,
                (&ids[from], &ids[to]),
                &flow,
                edge.label.as_deref(),
            ));
            connectors.push(id);
        }
        for element in &made {
            validate(element).map_err(|m| Error::bad_input(Self::NAME, m))?;
        }
        slide.elements.extend(made);
        reroute(theme, slide);
        Ok(AddedDiagram {
            nodes: self.nodes.iter().map(|n| n.id.clone()).zip(ids).collect(),
            connectors,
            font: plan.font,
        })
    }
}
