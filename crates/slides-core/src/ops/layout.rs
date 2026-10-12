//! Layouts: filling a layout's slots with elements, and changing a slide's
//! layout without losing anything on it.

use std::collections::HashSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::geometry::{rect_of, set_rect};
use super::util::ids_on;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::{ELEMENT, IdGen};
use crate::markdown;
use crate::model::{
    Base, Deck, Element, Extra, ImageEl, Layout, ListKind, Paragraph, PlaceholderDef,
    PlaceholderKind, Slide, Text, TextFit, Theme,
};

/// Paragraphs for a slot: `markdown` if there is any, otherwise one plain
/// empty paragraph to type into. The slot's list setting applies to the words
/// that are put in it, not to an empty slot: an empty body shows no bullet.
pub fn slot_text(list: Option<&ListKind>, markdown_text: Option<&str>) -> Text {
    let mut paragraphs = markdown_text.map(markdown::parse).unwrap_or_default();
    if paragraphs.is_empty() {
        return Text::from_paragraphs(vec![Paragraph::plain("")]);
    }
    for p in &mut paragraphs {
        if p.list.is_none() && p.style.is_none() {
            p.list = list.cloned();
        }
    }
    Text::from_paragraphs(paragraphs)
}

/// An element that fills a layout slot, holding `markdown` or empty.
pub fn placeholder_element(
    def: &PlaceholderDef,
    id: String,
    markdown_text: Option<&str>,
) -> Element {
    let mut base = Base::new(id);
    base.placeholder = Some(def.role.clone());
    match def.kind {
        PlaceholderKind::Image => Element::Image(ImageEl {
            base,
            src: String::new(),
            crop: None,
            mask: None,
            extra: Extra::new(),
        }),
        PlaceholderKind::Text => {
            let mut text = slot_text(def.list.as_ref(), markdown_text);
            // A slot's words are made to fit it, as Google Slides does: a long title or a long list shrinks
            // instead of running past the edge. The slide number is only a number.
            if def.role != "number" {
                text.fit = Some(TextFit::Shrink);
            }
            Element::text_el(base, text)
        }
    }
}

op_types! {
    /// Puts a slide on another layout. What it holds moves to the matching
    /// slots; what has no slot stays where it was as an ordinary element.
    /// Nothing is deleted.
    pub struct SetLayout {
        pub slide: String,
        /// A layout of the deck's theme, such as `two-columns`.
        pub layout: String,
    }

    pub struct SetLayoutOutput {
        /// Ids of the empty slots added for the new layout.
        pub added: Vec<String>,
        /// Ids of elements whose slot the new layout lacks.
        pub detached: Vec<String>,
    }
}

/// The layouts a deck can use, for an error message.
pub fn layout_names(deck: &Deck) -> String {
    deck.theme
        .layouts
        .iter()
        .map(|l| l.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

impl Op for SetLayout {
    type Output = SetLayoutOutput;
    const NAME: &'static str = "set_layout";
    const ABOUT: &'static str = "Change a slide's layout. Content moves to the matching slots by role (title, body, ...); anything without a slot stays where it was as a plain element, and new empty slots are added. Nothing is deleted.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<SetLayoutOutput> {
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let new = theme.layout(&self.layout).cloned().ok_or_else(|| {
            Error::bad_input(
                Self::NAME,
                format!(
                    "the theme has no layout `{}`; it has: {}",
                    self.layout,
                    theme
                        .layouts
                        .iter()
                        .map(|l| l.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
        })?;
        let Moved { added, detached } = put_on(cx.ids, theme, slide, &new);
        Ok(SetLayoutOutput { added, detached })
    }
}

/// What putting a slide on a layout did.
pub(super) struct Moved {
    /// Ids of the empty slots added.
    pub added: Vec<String>,
    /// Ids of the elements whose slot the layout lacks.
    pub detached: Vec<String>,
}

/// Puts `slide` on the layout `new`, which is in `theme` or about to be. What fills a slot the
/// layout has stays in it; what filled a slot it lacks stays where it was as a plain element, pinned
/// to the box the slide's old layout gave it (`theme` still has that layout); slots the slide
/// lacks are added empty. Nothing is deleted.
pub(super) fn put_on(ids: &mut IdGen, theme: &Theme, slide: &mut Slide, new: &Layout) -> Moved {
    let detached = detach_missing(theme, slide, new);
    slide.layout = new.name.clone();
    let added = add_missing_slots(ids, slide, new);
    Moved { added, detached }
}

/// Lets go of what fills a slot `new` lacks: it stays where it was as a plain element, pinned to the
/// box the slide's layout (which `theme` still has) gave it. Gives the ids of those elements.
pub(super) fn detach_missing(theme: &Theme, slide: &mut Slide, new: &Layout) -> Vec<String> {
    let old = slide.layout.clone();
    let mut detached = Vec::new();
    for e in &mut slide.elements {
        let Some(role) = e.base().placeholder.clone() else {
            continue;
        };
        if new.placeholder(&role).is_none() {
            if let Some(r) = rect_of(theme, &old, e) {
                set_rect(e, r);
            }
            e.base_mut().placeholder = None;
            detached.push(e.id().to_owned());
        }
    }
    detached
}

/// Adds an empty element for each slot of `layout` that nothing on the slide fills, at the bottom
/// of the stack in the layout's order. Gives the ids made.
pub(super) fn add_missing_slots(
    ids: &mut IdGen,
    slide: &mut Slide,
    layout: &Layout,
) -> Vec<String> {
    let have: HashSet<String> = slide
        .elements
        .iter()
        .filter_map(|e| e.base().placeholder.clone())
        .collect();
    let mut taken = ids_on(slide);
    let mut added = Vec::new();
    for (at, def) in layout
        .placeholders
        .iter()
        .filter(|d| !have.contains(&d.role))
        .enumerate()
    {
        let id = ids.fresh(ELEMENT, |c| taken.contains(c));
        taken.insert(id.clone());
        added.push(id.clone());
        slide
            .elements
            .insert(at, placeholder_element(def, id, None));
    }
    added
}
