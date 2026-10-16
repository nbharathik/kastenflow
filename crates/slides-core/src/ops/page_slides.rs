//! A page of the host cut into slides: each section at a heading level becomes a slide, its title the heading and its
//! body what is under it. The host reads the page and hands over its Markdown, so this works wherever the deck is.

use std::collections::{BTreeMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::geometry::set_rect;
use super::layout::placeholder_element;
use super::pages::room_for;
use super::util::assign_ids;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::{ELEMENT, SLIDE};
use crate::model::{Deck, Element, Slide, Text, TextFit};
use crate::page::{self, Sizes};
use crate::resolve::Rect;

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
