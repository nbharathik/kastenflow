//! Pages of the host in a deck: what a page, or one section of it, says as elements of a slide, and the same
//! again when the page has changed (a page cut into slides is in `page_slides`). The host reads the page and hands
//! over its Markdown, so these work wherever the deck is, and a deck made from a page keeps what the page said.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::composites::follow_content;
use super::geometry::{rect_of, refit};
use super::util::{assign_ids, ids_on, parent_list, path_of};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{
    Base, Deck, Element, Extra, GroupEl, PageSource, Size, Slide, SourceKind, Theme, is_false,
};
use crate::page::{self, Sizes};
use crate::resolve::Rect;

/// How far in from the edges of the slide a page's contents start when no box is given, and the room kept at the bottom.
const MARGIN: f64 = 64.0;
const FOOT: f64 = 48.0;

op_types! {
    /// A box on a slide, in slide units.
    pub struct PageArea {
        pub x: f64,
        pub y: f64,
        pub w: f64,
        pub h: f64,
    }
}

impl From<&PageArea> for Rect {
    fn from(a: &PageArea) -> Rect {
        Rect {
            x: a.x,
            y: a.y,
            w: a.w.max(1.0),
            h: a.h.max(1.0),
        }
    }
}

/// The place on a slide that a page's contents go in when the caller names none: the layout's body slot, else what is
/// left of the slide under its title.
pub(super) fn room_for(size: &Size, theme: &Theme, slide: &Slide) -> Rect {
    let layout = theme.layout(&slide.layout);
    if let Some(body) = layout.and_then(|l| l.placeholder("body")) {
        return Rect {
            x: body.x,
            y: body.y,
            w: body.w,
            h: body.h,
        };
    }
    let top = layout
        .and_then(|l| l.placeholder("title"))
        .map_or(MARGIN, |t| t.y + t.h + 16.0);
    Rect {
        x: MARGIN,
        y: top,
        w: (size.w - 2.0 * MARGIN).max(1.0),
        h: (size.h - top - FOOT).max(1.0),
    }
}

/// The source an element made from a page keeps: what the host said, with the fingerprint of the words it was made from.
fn kept(mut source: PageSource, markdown: &str, kind: SourceKind) -> PageSource {
    source.kind = kind;
    source.hash = Some(page::fingerprint(markdown));
    // The elements are the snapshot: the Markdown is only kept for an embedded page, which has nothing else to be drawn from.
    source.markdown = None;
    source
}

/// What a page or a section made of its blocks is called when it has no name of its own.
pub(super) fn name_of(source: &PageSource) -> String {
    match (&source.section, source.kind == SourceKind::Section) {
        (Some(section), true) => format!("Section: {}", section.trim()),
        _ => format!("Page: {}", source.name()),
    }
}

/// The elements as one: the only one itself, or a group of them. Either carries where it came from, if it is to be kept
/// in step with the page.
pub(super) fn assemble(
    mut elements: Vec<Element>,
    source: Option<PageSource>,
    name: String,
) -> Element {
    let mut top = if elements.len() == 1 {
        elements.remove(0)
    } else {
        let mut group = Element::Group(GroupEl {
            base: Base::new(""),
            children: elements,
            extra: Extra::new(),
        });
        refit(&mut group);
        group
    };
    let base = top.base_mut();
    base.name = Some(name);
    base.source = source;
    top
}

pub(super) fn ids_below(element: &Element, out: &mut Vec<String>) {
    for child in element.children() {
        out.push(child.id().to_owned());
        ids_below(child, out);
    }
}

op_types! {
    /// Puts the contents of a page, or of one section of it, on a slide.
    pub struct AddPageContents {
        pub slide: String,
        /// The page's Markdown, or the section's, as the host read it.
        pub markdown: String,
        /// Where it came from: the page, and the heading when it is a section. `kind` is `contents` or `section`; the Markdown is not kept, the elements are the snapshot.
        /// Left out, the elements are plain ones that remember nothing of the page.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub source: Option<PageSource>,
        /// Where on the slide it goes; the layout's body slot, or what is left under the title, when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub area: Option<PageArea>,
        /// The size in pixels of each picture of the page, by the path the page names it with, so pictures keep their shape.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub sizes: Sizes,
        /// Where in the stacking order (0 is the bottom); the top when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub at: Option<usize>,
    }

    pub struct AddedPageContents {
        /// The element that holds it all: a text box, or a group when pictures or tables came with the words.
        pub id: String,
        /// The ids of what the group holds, if it is one.
        pub parts: Vec<String>,
    }
}

impl Op for AddPageContents {
    type Output = AddedPageContents;
    const NAME: &'static str = "add_page_contents";
    const ABOUT: &'static str = "Put what a page of the host says, or one section of it, on a slide as elements: its words in one text box that shrinks to fit, its pictures, tables, code and formulas beside or under them. The element remembers the page (and the heading) it came from, so it can be made again when the page changes (update_page_contents).";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<AddedPageContents> {
        let Deck {
            size,
            theme,
            slides,
            ..
        } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let blocks = page::blocks(&self.markdown);
        let area = match &self.area {
            Some(area) => Rect::from(area),
            None => room_for(size, theme, slide),
        };
        let made = page::contents(&blocks, area, &self.sizes);
        if made.is_empty() {
            return Err(Error::bad_input(
                Self::NAME,
                "there is nothing on that page to put on a slide (it has no words, pictures, tables, code or formulas)",
            ));
        }
        let source = self.source.map(|source| {
            let kind = if source.kind == SourceKind::Section || source.section.is_some() {
                SourceKind::Section
            } else {
                SourceKind::Contents
            };
            kept(source, &self.markdown, kind)
        });
        let name = source
            .as_ref()
            .map_or_else(|| "Page contents".to_owned(), name_of);
        let mut top = vec![assemble(made, source, name)];
        let mut taken = ids_on(slide);
        assign_ids(&mut top, &mut taken, cx.ids, true);
        let element = top.remove(0);
        let id = element.id().to_owned();
        let mut parts = Vec::new();
        ids_below(&element, &mut parts);
        let at = self
            .at
            .unwrap_or(slide.elements.len())
            .min(slide.elements.len());
        slide.elements.insert(at, element);
        follow_content(slide);
        Ok(AddedPageContents { id, parts })
    }
}

op_types! {
    /// Makes an element that came from a page again, from the page as it is now.
    pub struct UpdatePageContents {
        pub slide: String,
        /// The element `add_page_contents` made (a text box or a group that has a source).
        pub id: String,
        /// The page's Markdown, or the section's, as the host reads it now.
        pub markdown: String,
        /// What the page is called now, if it changed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub sizes: Sizes,
        /// Leave the element alone when it has been changed by hand since it was made from the page (its words, pictures or looks are no longer what it was made with; moving it is not a change). Only elements made by a storyboard can tell; any other is updated.
        #[serde(default, skip_serializing_if = "is_false")]
        pub keep_edits: bool,
    }

    pub struct UpdatedPageContents {
        /// Whether the page said anything different from what the element was made from.
        pub changed: bool,
        /// Whether `keepEdits` stopped the update because the element was changed by hand. Nothing was done.
        #[serde(default, skip_serializing_if = "is_false")]
        pub edited: bool,
    }
}

impl Op for UpdatePageContents {
    type Output = UpdatedPageContents;
    const NAME: &'static str = "update_page_contents";
    const ABOUT: &'static str = "Make an element that came from a page of the host again from the page as it is now: its words and pictures are rebuilt in the same place and at the same size, keeping its id, name, steps and link. Words typed into it by hand are replaced, unless `keepEdits` is set and the element was made by a storyboard: then an element changed by hand is left alone and the answer says `edited`. A slide made by a storyboard is rebuilt the way a storyboard makes it: the section's point and evidence, not its heading.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<UpdatedPageContents> {
        let Deck {
            size,
            theme,
            slides,
            ..
        } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let path = path_of(&slide.elements, &self.id)
            .ok_or_else(|| Error::no_element(&self.slide, &self.id))?;
        let old = slide
            .element(&self.id)
            .cloned()
            .ok_or_else(|| Error::no_element(&self.slide, &self.id))?;
        let source = old.base().source.clone().filter(|s| matches!(s.kind, SourceKind::Contents | SourceKind::Section)).ok_or_else(|| {
            Error::refused(format!(
                "`{}` was not made from a page, so there is nothing to update it from. Only what Insert → Page put on the slide (the contents of a page, or a section) can be."
                , self.id
            ))
        })?;
        let area =
            rect_of(theme, &slide.layout, &old).unwrap_or_else(|| room_for(size, theme, slide));
        let changed = source.hash.as_deref() != Some(page::fingerprint(&self.markdown).as_str());
        // Only a storyboard marks what it made with a fingerprint of what it said; it is also what tells that the slide is made the
        // storyboard's way. Any other word in `made` is the host's own, and is kept as it is.
        let storyboard = source.made.as_deref().is_some_and(page::is_fingerprint);
        if self.keep_edits
            && storyboard
            && source
                .made
                .as_deref()
                .is_some_and(|made| page::made_of(&old) != made)
        {
            return Ok(UpdatedPageContents {
                changed,
                edited: true,
            });
        }
        let mut fresh_source = source;
        if let Some(title) = self
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            fresh_source.title = Some(title.to_owned());
        }
        let kind = fresh_source.kind.clone();
        let blocks = if storyboard {
            page::section_body(
                fresh_source.section.as_deref().unwrap_or_default(),
                &self.markdown,
            )
        } else {
            page::blocks(&self.markdown)
        };
        let made = page::contents(&blocks, area, &self.sizes);
        if made.is_empty() {
            return Err(Error::bad_input(
                Self::NAME,
                "the page no longer has anything to put on a slide",
            ));
        }
        let source = kept(fresh_source, &self.markdown, kind);
        let name = name_of(&source);
        let mut top = vec![assemble(made, Some(source), name)];
        // What the person set on the element stays: its id, steps, link, words for those who cannot see it, lock, and a name they gave.
        let before = old.base();
        {
            let base = top[0].base_mut();
            if before
                .name
                .as_deref()
                .is_some_and(|n| !n.starts_with("Page: ") && !n.starts_with("Section: "))
            {
                base.name = before.name.clone();
            }
            base.id = before.id.clone();
            base.step_states = before.step_states.clone();
            base.link = before.link.clone();
            base.alt = before.alt.clone();
            base.locked = before.locked;
            base.morph_id = before.morph_id.clone();
        }
        // What it says now is what it was made with, so that the next change by hand shows.
        if storyboard {
            let made = page::made_of(&top[0]);
            if let Some(source) = top[0].base_mut().source.as_mut() {
                source.made = Some(made);
            }
        }
        let mut taken = ids_on(slide);
        taken.remove(&self.id);
        let mut below = Vec::new();
        ids_below(&old, &mut below);
        for id in &below {
            taken.remove(id);
        }
        // The new element keeps the old one's id, which `assign_ids` keeps when it is free.
        assign_ids(&mut top, &mut taken, cx.ids, true);
        let index = path[path.len() - 1];
        let list = parent_list(&mut slide.elements, &path)
            .ok_or_else(|| Error::no_element(&self.slide, &self.id))?;
        list[index] = top.remove(0);
        follow_content(slide);
        Ok(UpdatedPageContents {
            changed,
            edited: false,
        })
    }
}
