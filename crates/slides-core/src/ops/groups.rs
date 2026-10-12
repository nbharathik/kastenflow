//! Operations that work on several elements at once: grouping, duplicating,
//! pasting, aligning and distributing.

use std::collections::HashSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::composites::follow_content;
use super::elements::validate;
use super::geometry::{outer_group, pin, refit, reroute, settle_groups, translate, turned, union};
use super::util::{assign_ids, ids_on, parent_list, path_of};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::ELEMENT;
use crate::model::{Base, Deck, Element, Extra, GroupEl};
use crate::resolve::Rect;

/// The upright box an element covers, turned as it is.
fn covered(e: &Element) -> Option<Rect> {
    let (x, y, w, h) = e.base().rect()?;
    Some(turned(
        Rect { x, y, w, h },
        e.base().rotation.unwrap_or(0.0),
    ))
}

op_types! {
    pub struct GroupElements {
        pub slide: String,
        /// At least two, on the same level (the slide, or the same group).
        pub ids: Vec<String>,
    }

    pub struct Grouped {
        pub group: String,
    }
}

impl Op for GroupElements {
    type Output = Grouped;
    const NAME: &'static str = "group_elements";
    const ABOUT: &'static str = "Group elements so they move and scale together. The group sits where its topmost member was.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<Grouped> {
        if self.ids.len() < 2 {
            return Err(Error::bad_input(
                Self::NAME,
                "grouping needs at least two elements",
            ));
        }
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let layout = slide.layout.clone();
        let path = path_of(&slide.elements, &self.ids[0])
            .ok_or_else(|| Error::no_element(&self.slide, &self.ids[0]))?;
        for id in &self.ids {
            let p =
                path_of(&slide.elements, id).ok_or_else(|| Error::no_element(&self.slide, id))?;
            if p[..p.len() - 1] != path[..path.len() - 1] {
                return Err(Error::refused(
                    "Group elements that are on the same level: the slide, or the same group.",
                ));
            }
        }
        let taken = ids_on(slide);
        let id = cx.ids.fresh(ELEMENT, |c| taken.contains(c));
        let wanted: HashSet<&String> = self.ids.iter().collect();
        let list = parent_list(&mut slide.elements, &path)
            .ok_or_else(|| Error::no_element(&self.slide, &self.ids[0]))?;
        let top = list
            .iter()
            .rposition(|e| wanted.contains(&e.id().to_owned()))
            .unwrap_or(0);
        let before_top = list[..=top]
            .iter()
            .filter(|e| wanted.contains(&e.id().to_owned()))
            .count()
            - 1;
        let (mut children, rest): (Vec<Element>, Vec<Element>) = std::mem::take(list)
            .into_iter()
            .partition(|e| wanted.contains(&e.id().to_owned()));
        for child in &mut children {
            pin(theme, &layout, child);
        }
        let bounds = union(children.iter().filter_map(covered)).ok_or_else(|| {
            Error::bad_input(Self::NAME, "these elements have no position to group by")
        })?;
        let mut group = Element::Group(GroupEl {
            base: Base::new(id.clone()).place(bounds.x, bounds.y, bounds.w, bounds.h),
            children,
            extra: Extra::new(),
        });
        refit(&mut group);
        *list = rest;
        list.insert(top - before_top, group);
        Ok(Grouped { group: id })
    }
}

op_types! {
    pub struct UngroupElement {
        pub slide: String,
        pub id: String,
    }

    pub struct Ungrouped {
        /// The ids of what the group held, now on the level it was.
        pub ids: Vec<String>,
    }
}

impl Op for UngroupElement {
    type Output = Ungrouped;
    const NAME: &'static str = "ungroup_element";
    const ABOUT: &'static str =
        "Break a group into the elements it held, which stay where they are.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<Ungrouped> {
        let slide = super::util::slide_mut(cx.deck, &self.slide)?;
        let path = path_of(&slide.elements, &self.id)
            .ok_or_else(|| Error::no_element(&self.slide, &self.id))?;
        let index = path[path.len() - 1];
        let list = parent_list(&mut slide.elements, &path)
            .ok_or_else(|| Error::no_element(&self.slide, &self.id))?;
        if !matches!(list[index], Element::Group(_)) {
            return Err(Error::bad_input(
                Self::NAME,
                format!("`{}` is not a group", self.id),
            ));
        }
        let Element::Group(group) = list.remove(index) else {
            return Ok(Ungrouped { ids: Vec::new() });
        };
        let ids = group.children.iter().map(|c| c.id().to_owned()).collect();
        list.splice(index..index, group.children);
        Ok(Ungrouped { ids })
    }
}

/// How far a copy sits from its original when no offset is given.
const NUDGE: f64 = 12.0;

op_types! {
    pub struct DuplicateElements {
        pub slide: String,
        pub ids: Vec<String>,
        /// Slide units to the right; 12 when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub dx: Option<f64>,
        /// Slide units down; 12 when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub dy: Option<f64>,
    }

    pub struct DuplicatedElements {
        pub ids: Vec<String>,
    }
}

impl Op for DuplicateElements {
    type Output = DuplicatedElements;
    const NAME: &'static str = "duplicate_elements";
    const ABOUT: &'static str = "Duplicate elements, offset a little, on top of their level. Connectors between duplicated elements join the copies.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<DuplicatedElements> {
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let layout = slide.layout.clone();
        let mut copies = Vec::new();
        for id in &self.ids {
            let path =
                path_of(&slide.elements, id).ok_or_else(|| Error::no_element(&self.slide, id))?;
            let e = slide
                .element(id)
                .cloned()
                .ok_or_else(|| Error::no_element(&self.slide, id))?;
            copies.push((path[..path.len() - 1].to_vec(), e));
        }
        let mut elements: Vec<Element> = copies.iter().map(|(_, e)| e.clone()).collect();
        for e in &mut elements {
            pin(theme, &layout, e);
            translate(e, self.dx.unwrap_or(NUDGE), self.dy.unwrap_or(NUDGE));
        }
        let mut taken = ids_on(slide);
        assign_ids(&mut elements, &mut taken, cx.ids, false);
        let ids = elements.iter().map(|e| e.id().to_owned()).collect();
        for ((parent, _), copy) in copies.into_iter().zip(elements) {
            let list = if parent.is_empty() {
                &mut slide.elements
            } else {
                let mut probe = parent.clone();
                probe.push(0);
                parent_list(&mut slide.elements, &probe)
                    .ok_or_else(|| Error::no_slide(&self.slide))?
            };
            list.push(copy);
        }
        reroute(theme, slide);
        follow_content(slide);
        Ok(DuplicatedElements { ids })
    }
}

op_types! {
    pub struct PasteElements {
        pub slide: String,
        /// Elements as copied, with their boxes.
        pub elements: Vec<Element>,
        /// Keep an element's id when it is free on this slide (so a paste can join a Morph); new ids otherwise.
        #[serde(default, skip_serializing_if = "crate::model::is_false")]
        pub keep_ids: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub dx: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub dy: Option<f64>,
    }
}

impl Op for PasteElements {
    type Output = DuplicatedElements;
    const NAME: &'static str = "paste_elements";
    const ABOUT: &'static str = "Paste elements copied from any slide or deck. They become ordinary elements at their own boxes, on top of the slide.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<DuplicatedElements> {
        let mut elements = self.elements;
        for e in &mut elements {
            validate(e).map_err(|m| Error::bad_input(Self::NAME, m))?;
            super::util::each_mut(std::slice::from_mut(e), &mut |x| {
                x.base_mut().placeholder = None
            });
            if e.base().rect().is_none() && !matches!(e, Element::Group(_)) {
                return Err(Error::bad_input(
                    Self::NAME,
                    "a pasted element needs its own box (x, y, w, h)",
                ));
            }
            refit(e);
            translate(e, self.dx.unwrap_or(0.0), self.dy.unwrap_or(0.0));
        }
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let mut taken = ids_on(slide);
        assign_ids(&mut elements, &mut taken, cx.ids, self.keep_ids);
        let ids = elements.iter().map(|e| e.id().to_owned()).collect();
        slide.elements.extend(elements);
        reroute(theme, slide);
        follow_content(slide);
        Ok(DuplicatedElements { ids })
    }
}

op_types! {
    pub enum AlignMode {
        Left,
        CenterH,
        Right,
        Top,
        MiddleV,
        Bottom,
    }

    pub struct AlignElements {
        pub slide: String,
        pub ids: Vec<String>,
        pub mode: AlignMode,
    }
}

impl Op for AlignElements {
    type Output = ();
    const NAME: &'static str = "align_elements";
    const ABOUT: &'static str = "Align elements to each other's left, centre, right, top, middle or bottom edge; one element aligns to the slide.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
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
        let layout = slide.layout.clone();
        let holders: HashSet<String> = self
            .ids
            .iter()
            .filter_map(|id| outer_group(slide, id))
            .collect();
        let mut boxes = Vec::new();
        for id in &self.ids {
            let e = super::util::element_mut(slide, id)?;
            pin(theme, &layout, e);
            boxes.push((
                id.clone(),
                covered(e).ok_or_else(|| {
                    Error::bad_input(Self::NAME, format!("`{id}` has no position"))
                })?,
            ));
        }
        let frame = if boxes.len() == 1 {
            Rect {
                x: 0.0,
                y: 0.0,
                w: size.w,
                h: size.h,
            }
        } else {
            union(boxes.iter().map(|(_, r)| *r)).unwrap_or(Rect {
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 0.0,
            })
        };
        for (id, r) in boxes {
            let (dx, dy) = match self.mode {
                AlignMode::Left => (frame.x - r.x, 0.0),
                AlignMode::CenterH => (frame.x + frame.w / 2.0 - (r.x + r.w / 2.0), 0.0),
                AlignMode::Right => (frame.x + frame.w - (r.x + r.w), 0.0),
                AlignMode::Top => (0.0, frame.y - r.y),
                AlignMode::MiddleV => (0.0, frame.y + frame.h / 2.0 - (r.y + r.h / 2.0)),
                AlignMode::Bottom => (0.0, frame.y + frame.h - (r.y + r.h)),
            };
            translate(super::util::element_mut(slide, &id)?, dx, dy);
        }
        settle_groups(slide, &holders);
        reroute(theme, slide);
        Ok(())
    }
}

op_types! {
    pub enum Axis {
        Horizontal,
        Vertical,
    }

    pub struct DistributeElements {
        pub slide: String,
        /// At least three.
        pub ids: Vec<String>,
        pub axis: Axis,
    }
}

impl Op for DistributeElements {
    type Output = ();
    const NAME: &'static str = "distribute_elements";
    const ABOUT: &'static str = "Space three or more elements evenly along an axis, keeping the outermost two where they are.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if self.ids.len() < 3 {
            return Err(Error::bad_input(
                Self::NAME,
                "distributing needs at least three elements",
            ));
        }
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let layout = slide.layout.clone();
        let holders: HashSet<String> = self
            .ids
            .iter()
            .filter_map(|id| outer_group(slide, id))
            .collect();
        let horizontal = matches!(self.axis, Axis::Horizontal);
        let mut boxes = Vec::new();
        for id in &self.ids {
            let e = super::util::element_mut(slide, id)?;
            pin(theme, &layout, e);
            boxes.push((
                id.clone(),
                covered(e).ok_or_else(|| {
                    Error::bad_input(Self::NAME, format!("`{id}` has no position"))
                })?,
            ));
        }
        let start = |r: &Rect| if horizontal { r.x } else { r.y };
        let length = |r: &Rect| if horizontal { r.w } else { r.h };
        boxes.sort_by(|a, b| start(&a.1).total_cmp(&start(&b.1)));
        let first = start(&boxes[0].1);
        let last = boxes
            .iter()
            .map(|(_, r)| start(r) + length(r))
            .fold(f64::MIN, f64::max);
        let total: f64 = boxes.iter().map(|(_, r)| length(r)).sum();
        let gap = (last - first - total) / (boxes.len() - 1) as f64;
        let mut at = first;
        for (id, r) in boxes {
            let delta = at - start(&r);
            let (dx, dy) = if horizontal {
                (delta, 0.0)
            } else {
                (0.0, delta)
            };
            translate(super::util::element_mut(slide, &id)?, dx, dy);
            at += length(&r) + gap;
        }
        settle_groups(slide, &holders);
        reroute(theme, slide);
        Ok(())
    }
}
