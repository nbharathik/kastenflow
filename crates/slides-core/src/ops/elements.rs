//! Operations on the elements of a slide: adding, changing, moving, deleting
//! and arranging them.

use std::collections::HashSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::composites::follow_content;
use super::geometry::{
    outer_group, pin, refit, remap, reroute, seat_connectors, set_rect, settle_groups,
};
use super::util::{
    assign_ids, collect_ids, element_mut, ids_on, merge_patch, parent_list, path_of, remove_element,
};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Element, Paragraph, Style, Text, is_color};
use crate::resolve::{Rect, box_in};

fn color_ok(c: &str) -> std::result::Result<(), String> {
    if is_color(c) {
        Ok(())
    } else {
        Err(format!(
            "`{c}` is not a theme colour (text1, bg2, accent3, ...) or a #rrggbb value"
        ))
    }
}

fn unit(v: Option<f64>, what: &str) -> std::result::Result<(), String> {
    match v {
        Some(v) if !(0.0..=1.0).contains(&v) => Err(format!("{what} is between 0 and 1, not {v}")),
        _ => Ok(()),
    }
}

fn check_style(s: &Style) -> std::result::Result<(), String> {
    if let Some(f) = &s.fill {
        color_ok(&f.color)?;
        unit(f.alpha, "fill alpha")?;
    }
    if let Some(l) = &s.stroke {
        color_ok(&l.color)?;
        unit(l.alpha, "stroke alpha")?;
        if l.width.is_some_and(|w| w < 0.0) {
            return Err("a stroke width cannot be negative".to_owned());
        }
    }
    if let Some(sh) = &s.shadow {
        color_ok(&sh.color)?;
    }
    unit(s.opacity, "opacity")
}

/// The farthest a paragraph may be moved in from its box's edge, in slide units.
const MOST_INDENT: f64 = 5000.0;

/// Whether a paragraph and its runs follow the format's rules.
pub(super) fn check_paragraph(p: &Paragraph) -> std::result::Result<(), String> {
    for r in &p.runs {
        if let Some(c) = &r.color {
            color_ok(c)?;
        }
        if r.size.is_some_and(|s| s <= 0.0) {
            return Err("a run's size is above 0 points".to_owned());
        }
        if r.spacing
            .is_some_and(|s| !s.is_finite() || s.abs() > 1000.0)
        {
            return Err(
                "the space between letters is a number of points, between -1000 and 1000"
                    .to_owned(),
            );
        }
    }
    if let Some(c) = &p.bullet_color {
        color_ok(c)?;
    }
    if p.bullet_size
        .is_some_and(|s| !s.is_finite() || !(0.25..=4.0).contains(&s))
    {
        return Err(
            "a marker's size is a multiple of the words' size, from 0.25 to 4 (25% to 400%)"
                .to_owned(),
        );
    }
    if p.start.is_some_and(|n| n > 99_999) {
        return Err("a numbered item cannot start at a number above 99999".to_owned());
    }
    for (name, v) in [("marginLeft", p.margin_left), ("indent", p.indent)] {
        if v.is_some_and(|v| !v.is_finite() || v.abs() > MOST_INDENT) {
            return Err(format!(
                "`{name}` is a number of slide units, within {MOST_INDENT} of the edge"
            ));
        }
    }
    if p.margin_left.is_some_and(|v| v < 0.0) {
        return Err("`marginLeft` cannot be negative".to_owned());
    }
    Ok(())
}

fn check_text(t: &Text) -> std::result::Result<(), String> {
    t.paragraphs.iter().try_for_each(check_paragraph)
}

/// Whether an element, and what it holds, follows the format's rules.
pub fn validate(e: &Element) -> std::result::Result<(), String> {
    let b = e.base();
    for (name, v) in [("w", b.w), ("h", b.h)] {
        if v.is_some_and(|v| v < 0.0) {
            return Err(format!("`{name}` cannot be negative"));
        }
    }
    if let Some(s) = &b.style {
        check_style(s)?;
    }
    if let Some(t) = e.text() {
        check_text(t)?;
    }
    match e {
        Element::Shape(s) if s.shape.is_empty() => {
            return Err(
                "a shape needs a `shape` name such as rect, roundRect or ellipse".to_owned(),
            );
        }
        Element::Table(t) => {
            if let Some(problem) = t.problem() {
                return Err(problem);
            }
            for c in t.rows.iter().flat_map(|r| &r.cells) {
                check_text(&c.text)?;
            }
        }
        _ => {}
    }
    e.children().iter().try_for_each(validate)
}

op_types! {
    /// Adds elements to a slide, on top of what is there.
    pub struct AddElements {
        pub slide: String,
        /// Full elements with a `type` and a box (x, y, w, h), or a `placeholder` to fill. An `id` is optional.
        pub elements: Vec<Element>,
        /// Where in the stacking order (0 is the bottom); the top when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub at: Option<usize>,
    }

    pub struct AddedElements {
        pub ids: Vec<String>,
    }
}

impl Op for AddElements {
    type Output = AddedElements;
    const NAME: &'static str = "add_elements";
    const ABOUT: &'static str = "Add elements (text, shape, line, connector, image, group, table) to a slide. Give each a type and a box in slide units (the slide is 960 by 540), or a placeholder to fill; colours are theme tokens (text1, bg2, accent1 ...) or #rrggbb. A connector may name the two elements it joins (`from` and `to`, each an element id and a side) instead of a box. Returns the ids.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<AddedElements> {
        let mut elements = self.elements;
        for e in &mut elements {
            validate(e).map_err(|m| Error::bad_input(Self::NAME, m))?;
            refit(e);
        }
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let mut known = ids_on(slide);
        collect_ids(&elements, &mut known);
        seat_connectors(&mut elements, &known).map_err(|m| Error::bad_input(Self::NAME, m))?;
        for e in &elements {
            if box_in(theme, &slide.layout, e).is_none() {
                return Err(Error::bad_input(
                    Self::NAME,
                    "an element needs a position: give x, y, w and h, or a `placeholder` that the slide's layout has",
                ));
            }
        }
        let mut taken = ids_on(slide);
        assign_ids(&mut elements, &mut taken, cx.ids, true);
        let ids = elements.iter().map(|e| e.id().to_owned()).collect();
        let at = self
            .at
            .unwrap_or(slide.elements.len())
            .min(slide.elements.len());
        slide.elements.splice(at..at, elements);
        reroute(theme, slide);
        follow_content(slide);
        Ok(AddedElements { ids })
    }
}

op_types! {
    pub struct ElementPatch {
        pub id: String,
        /// A JSON merge patch on the element: keys to set, and null to remove a key. `id`, `type` and a group's `children` cannot be patched.
        pub patch: Value,
    }

    /// Changes properties of elements: style, text, alt text, name, lock, link, steps.
    pub struct PatchElements {
        pub slide: String,
        pub patches: Vec<ElementPatch>,
    }
}

impl Op for PatchElements {
    type Output = ();
    const NAME: &'static str = "patch_elements";
    const ABOUT: &'static str = "Change properties of elements with a JSON merge patch each, such as {\"style\": {\"fill\": {\"color\": \"accent2\"}}} or {\"name\": \"LLM box\"}. Move and resize with transform_elements instead; use set_text for words.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let mut anchors_changed = false;
        let mut moved = false;
        let holders: HashSet<String> = self
            .patches
            .iter()
            .filter_map(|p| outer_group(slide, &p.id))
            .collect();
        for item in self.patches {
            let e = element_mut(slide, &item.id)?;
            let keys: Vec<&str> = item
                .patch
                .as_object()
                .map(|o| o.keys().map(String::as_str).collect())
                .unwrap_or_default();
            if keys
                .iter()
                .any(|k| matches!(*k, "id" | "type" | "children"))
            {
                return Err(Error::bad_input(
                    Self::NAME,
                    "`id`, `type` and `children` cannot be patched",
                ));
            }
            if matches!(e, Element::Group(_))
                && keys.iter().any(|k| matches!(*k, "x" | "y" | "w" | "h"))
            {
                return Err(Error::bad_input(
                    Self::NAME,
                    "a group's box follows what it holds; move or resize it with transform_elements",
                ));
            }
            anchors_changed |= keys.iter().any(|k| matches!(*k, "from" | "to"));
            moved |= keys
                .iter()
                .any(|k| matches!(*k, "x" | "y" | "w" | "h" | "rotation"));
            let mut value =
                serde_json::to_value(&*e).map_err(|err| Error::bad_input(Self::NAME, err))?;
            merge_patch(&mut value, &item.patch);
            let patched: Element =
                serde_json::from_value(value).map_err(|err| Error::bad_input(Self::NAME, err))?;
            validate(&patched).map_err(|m| Error::bad_input(Self::NAME, m))?;
            *e = patched;
        }
        if moved {
            settle_groups(slide, &holders);
        }
        if anchors_changed {
            reroute(theme, slide);
        }
        follow_content(slide);
        Ok(())
    }
}

op_types! {
    /// Where and how big. What is left out stays as it is.
    pub struct Transform {
        pub id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub x: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub y: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub w: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub h: Option<f64>,
        /// Degrees clockwise. For a group it is how many degrees to turn everything in it by, not an angle it keeps.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub rotation: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub flip_h: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub flip_v: Option<bool>,
    }

    pub struct TransformElements {
        pub slide: String,
        pub items: Vec<Transform>,
    }
}

impl Op for TransformElements {
    type Output = ();
    const NAME: &'static str = "transform_elements";
    const ABOUT: &'static str = "Move, resize, rotate or flip elements. Give the new x, y, w, h (slide units) and rotation (degrees) you want changed. A group carries what it holds; connectors attached to moved elements follow.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let layout = slide.layout.clone();
        // An element inside a group changes the box of the group that holds it.
        let holders: HashSet<String> = self
            .items
            .iter()
            .filter_map(|t| outer_group(slide, &t.id))
            .collect();
        for t in self.items {
            if t.w.is_some_and(|w| w < 0.0) || t.h.is_some_and(|h| h < 0.0) {
                return Err(Error::bad_input(Self::NAME, "w and h cannot be negative"));
            }
            let e = element_mut(slide, &t.id)?;
            pin(theme, &layout, e);
            let Some((x, y, w, h)) = e.base().rect() else {
                return Err(Error::bad_input(
                    Self::NAME,
                    format!("element `{}` has no position to change", t.id),
                ));
            };
            let old = Rect { x, y, w, h };
            let new = Rect {
                x: t.x.unwrap_or(x),
                y: t.y.unwrap_or(y),
                w: t.w.unwrap_or(w),
                h: t.h.unwrap_or(h),
            };
            if matches!(e, Element::Group(_)) {
                remap(e, old, new, t.rotation.unwrap_or(0.0));
                refit(e);
            } else {
                set_rect(e, new);
                if let Some(r) = t.rotation {
                    e.base_mut().rotation = Some(super::util::round2(r));
                }
            }
            if let Some(f) = t.flip_h {
                e.base_mut().flip_h = f;
            }
            if let Some(f) = t.flip_v {
                e.base_mut().flip_v = f;
            }
        }
        settle_groups(slide, &holders);
        reroute(theme, slide);
        Ok(())
    }
}

op_types! {
    pub struct DeleteElements {
        pub slide: String,
        pub ids: Vec<String>,
    }
}

impl Op for DeleteElements {
    type Output = ();
    const NAME: &'static str = "delete_elements";
    const ABOUT: &'static str = "Delete elements from a slide. Connectors that were attached to them keep their place and lose that end's attachment.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let slide = super::util::slide_mut(cx.deck, &self.slide)?;
        let holders: HashSet<String> = self
            .ids
            .iter()
            .filter_map(|id| outer_group(slide, id))
            .collect();
        for id in &self.ids {
            remove_element(&mut slide.elements, id)
                .ok_or_else(|| Error::no_element(&self.slide, id))?;
        }
        let gone: HashSet<&String> = self.ids.iter().collect();
        super::util::each_mut(&mut slide.elements, &mut |e| {
            if let Element::Connector(c) = e {
                for anchor in [&mut c.from, &mut c.to] {
                    if anchor.as_ref().is_some_and(|a| gone.contains(&a.el)) {
                        *anchor = None;
                    }
                }
            }
        });
        drop_empty_groups(&mut slide.elements);
        settle_groups(slide, &holders);
        Ok(())
    }
}

/// A group whose last child was deleted goes with it.
fn drop_empty_groups(list: &mut Vec<Element>) {
    for e in list.iter_mut() {
        if let Some(children) = e.children_mut() {
            drop_empty_groups(children);
        }
    }
    list.retain(|e| !matches!(e, Element::Group(g) if g.children.is_empty()));
}

op_types! {
    pub enum Arrange {
        /// On top of everything.
        Front,
        /// Under everything.
        Back,
        /// One step up.
        Forward,
        /// One step down.
        Backward,
    }

    pub struct ReorderElements {
        pub slide: String,
        pub ids: Vec<String>,
        pub to: Arrange,
    }
}

impl Op for ReorderElements {
    type Output = ();
    const NAME: &'static str = "reorder_elements";
    const ABOUT: &'static str = "Change the stacking order of elements that share a level (the slide, or one group): to the front, to the back, or one step forward or backward.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let slide = super::util::slide_mut(cx.deck, &self.slide)?;
        let Some(first) = self.ids.first() else {
            return Ok(());
        };
        let path =
            path_of(&slide.elements, first).ok_or_else(|| Error::no_element(&self.slide, first))?;
        let parent_path = &path[..path.len() - 1];
        for id in &self.ids {
            let p =
                path_of(&slide.elements, id).ok_or_else(|| Error::no_element(&self.slide, id))?;
            if &p[..p.len() - 1] != parent_path {
                return Err(Error::refused(
                    "Arrange elements that are on the same level: the slide, or the same group.",
                ));
            }
        }
        let wanted: HashSet<&String> = self.ids.iter().collect();
        let list = parent_list(&mut slide.elements, &path)
            .ok_or_else(|| Error::no_element(&self.slide, first))?;
        match self.to {
            Arrange::Front | Arrange::Back => {
                let (picked, rest): (Vec<Element>, Vec<Element>) = std::mem::take(list)
                    .into_iter()
                    .partition(|e| wanted.contains(&e.id().to_owned()));
                *list = if matches!(self.to, Arrange::Front) {
                    rest.into_iter().chain(picked).collect()
                } else {
                    picked.into_iter().chain(rest).collect()
                };
            }
            Arrange::Forward => {
                for i in (0..list.len().saturating_sub(1)).rev() {
                    if wanted.contains(&list[i].id().to_owned())
                        && !wanted.contains(&list[i + 1].id().to_owned())
                    {
                        list.swap(i, i + 1);
                    }
                }
            }
            Arrange::Backward => {
                for i in 1..list.len() {
                    if wanted.contains(&list[i].id().to_owned())
                        && !wanted.contains(&list[i - 1].id().to_owned())
                    {
                        list.swap(i, i - 1);
                    }
                }
            }
        }
        Ok(())
    }
}
