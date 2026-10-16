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
use crate::model::{Deck, Element};
use crate::resolve::{Rect, box_in};

// The rules an element is checked against live in `validate.rs`; the operations on elements, and
// the ones on tables and text, reach them from here.
pub use super::validate::validate;
pub(super) use super::validate::{check_paragraph, color_ok, unit};

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
    const ABOUT: &'static str = "Add elements (text, shape, line, connector, image, group, table) to a slide. Give each a type and a box in slide units (`get_deck` gives the deck's size), or a placeholder to fill; colours are theme tokens (text1, bg2, accent1 ...) or #rrggbb. A connector may name the two elements it joins (`from` and `to`, each an element id and a side) instead of a box. Returns the ids.";

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
