//! Pages of the host in a deck: what a page, or one section of it, says as elements of a slide; the same again when
//! the page has changed; and a page cut into slides. The host reads the page and hands over its Markdown, so
//! these work wherever the deck is, and a deck made from a page keeps what the page said.

use std::collections::{BTreeMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::composites::follow_content;
use super::geometry::{rect_of, refit, set_rect};
use super::layout::placeholder_element;
use super::util::{assign_ids, ids_on, parent_list, path_of};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::{ELEMENT, SLIDE};
use crate::model::{
    Base, Deck, Element, Extra, GroupEl, PageSource, Size, Slide, SourceKind, Text, TextFit, Theme,
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
fn room_for(size: &Size, theme: &Theme, slide: &Slide) -> Rect {
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
fn name_of(source: &PageSource) -> String {
    match (&source.section, source.kind == SourceKind::Section) {
        (Some(section), true) => format!("Section: {}", section.trim()),
        _ => format!("Page: {}", source.name()),
    }
}

/// The elements as one: the only one itself, or a group of them. Either carries where it came from, if it is to be kept
/// in step with the page.
fn assemble(mut elements: Vec<Element>, source: Option<PageSource>, name: String) -> Element {
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

fn ids_below(element: &Element, out: &mut Vec<String>) {
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
    }

    pub struct UpdatedPageContents {
        /// Whether the page said anything different from what the element was made from.
        pub changed: bool,
    }
}

impl Op for UpdatePageContents {
    type Output = UpdatedPageContents;
    const NAME: &'static str = "update_page_contents";
    const ABOUT: &'static str = "Make an element that came from a page of the host again from the page as it is now: its words and pictures are rebuilt in the same place and at the same size, keeping its id, name, steps and link. Words typed into it by hand are replaced.";

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
        let blocks = page::blocks(&self.markdown);
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
        Ok(UpdatedPageContents { changed })
    }
}

op_types! {
    /// Puts a page on slides: one for each of its sections.
    pub struct AddPageSlides {
        /// The page's Markdown as the host read it.
        pub markdown: String,
        /// What the page is called: the title of the slide that holds the words before its first heading.
        pub title: String,
        /// The layout of the new slides; `title-body` when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub layout: Option<String>,
        /// The slide to add them after (and its backup slides); the end when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub after: Option<String>,
        /// The heading level a slide starts at (1 to 6); 0 or absent for the level that suits the page.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub split: Option<u8>,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub sizes: Sizes,
    }

    pub struct AddedPageSlides {
        /// The new slides, in order.
        pub slides: Vec<String>,
    }
}

impl Op for AddPageSlides {
    type Output = AddedPageSlides;
    const NAME: &'static str = "add_page_slides";
    const ABOUT: &'static str = "Put a page of the host on slides: each section at a heading level becomes a slide whose title is the heading and whose body is what is under it, with its pictures, tables and code beside the words. Words before the first heading go on a slide named after the page.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_order()
    }

    fn run(self, cx: &mut Cx) -> Result<AddedPageSlides> {
        let layout_name = self
            .layout
            .as_deref()
            .unwrap_or(super::slides::DEFAULT_LAYOUT);
        let layout = cx.deck.theme.layout(layout_name).cloned().ok_or_else(|| {
            Error::bad_input(
                Self::NAME,
                format!(
                    "the theme has no layout `{layout_name}`; it has: {}",
                    super::layout::layout_names(cx.deck)
                ),
            )
        })?;
        let blocks = page::blocks(&self.markdown);
        let title = if self.title.trim().is_empty() {
            "Page"
        } else {
            self.title.trim()
        };
        let parts = page::parts(&blocks, self.split.unwrap_or(0), title);
        if parts.is_empty() {
            return Err(Error::bad_input(
                Self::NAME,
                "there is nothing on that page to put on slides",
            ));
        }
        let mut at = match &self.after {
            Some(id) => {
                let i = cx.deck.index_of(id).ok_or_else(|| Error::no_slide(id))?;
                let mut next = i + 1;
                while cx.deck.slides.get(next).is_some_and(|s| s.backup) {
                    next += 1;
                }
                next
            }
            None => cx.deck.slides.len(),
        };
        let mut taken: HashSet<String> = cx.deck.slides.iter().map(|s| s.id.clone()).collect();
        let mut made = Vec::with_capacity(parts.len());
        for part in parts {
            let id = cx.ids.fresh(SLIDE, |c| taken.contains(c));
            taken.insert(id.clone());
            let mut slide = Slide::new(id.clone(), layout.name.clone());
            let media = page::has_media(&part.blocks);
            let body_area = layout.placeholder("body").map(|b| Rect {
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
            });
            let mut used = HashSet::new();
            for def in &layout.placeholders {
                let eid = cx.ids.fresh(ELEMENT, |c| used.contains(c));
                used.insert(eid.clone());
                let mut element = placeholder_element(def, eid, None);
                match def.role.as_str() {
                    "title" => {
                        if let Element::Text(t) = &mut element {
                            t.text = Text {
                                fit: Some(TextFit::Shrink),
                                ..Text::from_paragraphs(vec![crate::model::Paragraph {
                                    runs: part.title.clone(),
                                    ..crate::model::Paragraph::plain("")
                                }])
                            };
                        }
                    }
                    "body" => {
                        let mut words = page::text_paragraphs(&part.blocks);
                        if !words.is_empty() {
                            for p in &mut words {
                                if p.list.is_none() && p.style.is_none() {
                                    p.list = def.list.clone();
                                }
                            }
                            if let Element::Text(t) = &mut element {
                                t.text = Text {
                                    fit: Some(TextFit::Shrink),
                                    ..Text::from_paragraphs(words)
                                };
                            }
                            // Words with pictures beside them take their share of the slot.
                            if media && let Some(area) = body_area {
                                set_rect(&mut element, page::split(area).0);
                            }
                        }
                    }
                    _ => {}
                }
                slide.elements.push(element);
            }
            if let Some(area) = body_area {
                if media {
                    let words = !page::text_paragraphs(&part.blocks).is_empty();
                    let place = if words { page::split(area).1 } else { area };
                    let mut extra = page::media_elements(&part.blocks, place, &self.sizes);
                    assign_ids(&mut extra, &mut used, cx.ids, true);
                    slide.elements.extend(extra);
                }
            } else {
                // A layout with no body slot has nowhere to put the words: they go in a box of their own, under the title.
                let area = room_for(&cx.deck.size, &cx.deck.theme, &slide);
                let mut extra = page::contents(&part.blocks, area, &self.sizes);
                assign_ids(&mut extra, &mut used, cx.ids, true);
                slide.elements.extend(extra);
            }
            cx.deck.slides.insert(at, slide);
            at += 1;
            made.push(id);
        }
        if let Some(first) = cx.deck.slides.first_mut() {
            first.backup = false;
        }
        Ok(AddedPageSlides { slides: made })
    }
}
