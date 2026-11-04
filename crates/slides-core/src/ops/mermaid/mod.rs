//! A Mermaid flowchart written as text, drawn as shapes and arrows that stay attached. The boxes and
//! arrows are made by the same layout as `add_diagram` and held in one group that keeps the source, so
//! the chart can be edited as text and laid out again (`update_mermaid`) or moved and styled by hand.

mod parse;
#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::diagram::{AddDiagram, DiagramBox};
use super::geometry::{refit, union};
use super::util::{ids_on, slide_mut};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::ELEMENT;
use crate::model::{Base, Element, Extra, GroupEl};
use crate::resolve::Rect;

/// The key on the group that holds the source text.
pub const SOURCE_KEY: &str = "mermaid";

/// The Mermaid source a group was made from, if it is one made by `add_mermaid`.
pub fn source_of(element: &Element) -> Option<&str> {
    match element {
        Element::Group(group) => group.extra.get(SOURCE_KEY).and_then(Value::as_str),
        _ => None,
    }
}

op_types! {
    /// Draws a Mermaid flowchart on a slide.
    pub struct AddMermaid {
        pub slide: String,
        /// The flowchart: `flowchart TD` or `flowchart LR`, then boxes and arrows.
        pub source: String,
        /// Where it goes. Left out, the free area under the slide's title, inside the margins.
        #[serde(default, rename = "box", skip_serializing_if = "Option::is_none")]
        pub area: Option<DiagramBox>,
    }

    /// Writes a Mermaid flowchart again and draws it in the place of the one there.
    pub struct UpdateMermaid {
        pub slide: String,
        /// The group `add_mermaid` made.
        pub id: String,
        pub source: String,
    }

    pub struct AddedMermaid {
        /// The group that holds the chart.
        pub group: String,
        /// The element id of each box, by the name it has in the source.
        pub nodes: BTreeMap<String, String>,
        /// The element ids of the arrows, in the order they are written.
        pub connectors: Vec<String>,
    }
}

/// Draws `source` on the slide as a group holding its boxes and arrows.
fn lay_out(
    cx: &mut Cx,
    slide: &str,
    source: &str,
    area: Option<DiagramBox>,
    op: &str,
) -> Result<(Element, AddedMermaid)> {
    let flow = parse::parse(source).map_err(|m| Error::bad_input(op, m))?;
    let drawn = AddDiagram {
        slide: slide.to_owned(),
        nodes: flow.nodes,
        edges: flow.edges,
        direction: Some(flow.direction),
        area,
    }
    .run(cx)?;
    let wanted: HashSet<String> = drawn
        .nodes
        .values()
        .chain(drawn.connectors.iter())
        .cloned()
        .collect();
    let taken = ids_on(slide_mut(cx.deck, slide)?);
    let id = cx.ids.fresh(ELEMENT, |c| taken.contains(c));
    let slide = slide_mut(cx.deck, slide)?;
    let (children, rest): (Vec<Element>, Vec<Element>) = std::mem::take(&mut slide.elements)
        .into_iter()
        .partition(|e| wanted.contains(e.id()));
    slide.elements = rest;
    let bounds = union(
        children
            .iter()
            .filter_map(|e| e.base().rect().map(|(x, y, w, h)| Rect { x, y, w, h })),
    )
    .ok_or_else(|| Error::bad_input(op, "the chart has nothing to draw"))?;
    let mut base = Base::new(id.clone()).place(bounds.x, bounds.y, bounds.w, bounds.h);
    base.name = Some("Mermaid diagram".to_owned());
    let mut extra = Extra::new();
    extra.insert(SOURCE_KEY.to_owned(), Value::String(source.to_owned()));
    let mut group = Element::Group(GroupEl {
        base,
        children,
        extra,
    });
    refit(&mut group);
    Ok((
        group,
        AddedMermaid {
            group: id,
            nodes: drawn.nodes,
            connectors: drawn.connectors,
        },
    ))
}

impl Op for AddMermaid {
    type Output = AddedMermaid;
    const NAME: &'static str = "add_mermaid";
    const ABOUT: &'static str = "Draw a Mermaid flowchart (`flowchart TD` or `flowchart LR`; boxes A[text], A(text), A{text}, A((text)); arrows -->, ---, -.->, ==>, with a word as -->|word|) as boxes and arrows laid out like `add_diagram`, held in one group that keeps the source so it can be written again with `update_mermaid`. Subgraphs and styling lines are skipped. At most 60 boxes and 200 arrows.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<AddedMermaid> {
        let (group, added) = lay_out(cx, &self.slide, &self.source, self.area, Self::NAME)?;
        slide_mut(cx.deck, &self.slide)?.elements.push(group);
        Ok(added)
    }
}

/// The box a group covers, when it lies on the slide and is big enough to lay a chart out in.
fn usable_area(cx: &Cx, base: &Base) -> Option<DiagramBox> {
    let (x, y, w, h) = base.rect()?;
    let ok = [x, y, w, h].iter().all(|v| v.is_finite())
        && w >= 60.0
        && h >= 60.0
        && x >= 0.0
        && y >= 0.0
        && x + w <= cx.deck.size.w
        && y + h <= cx.deck.size.h;
    ok.then_some(DiagramBox { x, y, w, h })
}

impl Op for UpdateMermaid {
    type Output = AddedMermaid;
    const NAME: &'static str = "update_mermaid";
    const ABOUT: &'static str = "Write a Mermaid flowchart made with `add_mermaid` again: it is laid out afresh in the place the group covers (or the free area if it no longer fits there), and the group keeps its id, name, steps and place in the stacking order. Hand changes to the old boxes are replaced.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<AddedMermaid> {
        let not_one = || {
            Error::bad_input(
                Self::NAME,
                "that element is not a Mermaid diagram made with add_mermaid",
            )
        };
        let slide = slide_mut(cx.deck, &self.slide)?;
        let index = slide
            .elements
            .iter()
            .position(|e| e.id() == self.id)
            .ok_or_else(|| Error::no_element(&self.slide, &self.id))?;
        if source_of(&slide.elements[index]).is_none() {
            return Err(not_one());
        }
        let old = slide.elements.remove(index);
        let area = usable_area(cx, old.base());
        let tried = lay_out(cx, &self.slide, &self.source, area.clone(), Self::NAME);
        let (mut group, mut added) = match (tried, area) {
            (Ok(done), _) => done,
            // It no longer fits where it was: the free area of the slide is tried before giving up.
            (Err(_), Some(_)) => lay_out(cx, &self.slide, &self.source, None, Self::NAME)?,
            (Err(e), None) => return Err(e),
        };
        let mut base = old.base().clone();
        if let Some((x, y, w, h)) = group.base().rect() {
            base.x = Some(x);
            base.y = Some(y);
            base.w = Some(w);
            base.h = Some(h);
        }
        *group.base_mut() = base;
        added.group = self.id.clone();
        let slide = slide_mut(cx.deck, &self.slide)?;
        let at = index.min(slide.elements.len());
        slide.elements.insert(at, group);
        Ok(added)
    }
}
