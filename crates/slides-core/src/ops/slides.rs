//! Operations on slides as a whole: adding, duplicating, deleting, moving,
//! flagging, and their notes and background.

use std::collections::{BTreeMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::layout::placeholder_element;
use super::util::slide_mut;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::{ELEMENT, SLIDE};
use crate::model::{Background, Deck, Section, Slide, Transition};

/// The layout a new slide uses when none is named.
pub const DEFAULT_LAYOUT: &str = "title-body";

/// The index just after the slide at `index` and the backup slides stacked under it.
fn after_stack(deck: &Deck, index: usize) -> usize {
    let mut i = index + 1;
    while deck.slides.get(i).is_some_and(|s| s.backup) {
        i += 1;
    }
    i
}

/// A section is the slides from the one it starts at up to the next section. When the slide a
/// section starts at is moved without the rest of the section, the section stays where it was and
/// starts at the first of its slides that stays; when all of its slides move, it goes along with them.
fn hand_over_sections(deck: &mut Deck, moving: &HashSet<&String>) {
    let starts: HashSet<&str> = deck.sections.iter().map(|s| s.starts_at.as_str()).collect();
    let handed: Vec<(usize, String)> = deck
        .sections
        .iter()
        .enumerate()
        .filter(|(_, section)| moving.contains(&section.starts_at))
        .filter_map(|(n, section)| {
            let from = deck.index_of(&section.starts_at)?;
            let stays = deck.slides[from + 1..]
                .iter()
                .take_while(|s| !starts.contains(s.id.as_str()))
                .find(|s| !moving.contains(&s.id))?;
            Some((n, stays.id.clone()))
        })
        .collect();
    for (n, id) in handed {
        deck.sections[n].starts_at = id;
    }
}

/// The sections in the order of the slides they start at.
fn order_sections(deck: &mut Deck) {
    let sections = std::mem::take(&mut deck.sections);
    let mut keyed: Vec<(usize, Section)> = sections
        .into_iter()
        .map(|section| {
            (
                deck.index_of(&section.starts_at).unwrap_or(usize::MAX),
                section,
            )
        })
        .collect();
    keyed.sort_by_key(|(at, _)| *at);
    deck.sections = keyed.into_iter().map(|(_, section)| section).collect();
}

/// A slide cannot open the deck as a backup: there is nothing above it.
fn fix_first(deck: &mut Deck) {
    if let Some(first) = deck.slides.first_mut() {
        first.backup = false;
    }
}

op_types! {
    /// Adds a slide with a layout, filling its slots.
    pub struct AddSlide {
        /// A layout of the deck's theme; `title-body` when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub layout: Option<String>,
        /// The slide to add it after; the end when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub after: Option<String>,
        /// Text for the layout's slots, by role, in Markdown: `{"title": "Results", "body": "- one\n- two"}`.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub content: BTreeMap<String, String>,
        /// Speaker notes, in Markdown.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub notes: Option<String>,
        /// Stack it under the slide it follows instead of after that slide's stack.
        #[serde(default, skip_serializing_if = "crate::model::is_false")]
        pub backup: bool,
    }

    pub struct AddedSlide {
        pub slide: String,
        /// The id of the element in each slot, by role.
        pub elements: BTreeMap<String, String>,
    }
}

impl Op for AddSlide {
    type Output = AddedSlide;
    const NAME: &'static str = "add_slide";
    const ABOUT: &'static str = "Add a slide. Pick a layout from the deck's theme and give text for its slots by role in Markdown; slots you leave out stay empty. Prefer one idea per slide and a layout that fits it.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_order()
    }

    fn run(self, cx: &mut Cx) -> Result<AddedSlide> {
        let layout_name = self.layout.as_deref().unwrap_or(DEFAULT_LAYOUT);
        let layout = cx.deck.theme.layout(layout_name).cloned().ok_or_else(|| {
            Error::bad_input(
                Self::NAME,
                format!(
                    "the theme has no layout `{layout_name}`; it has: {}",
                    super::layout::layout_names(cx.deck)
                ),
            )
        })?;
        if let Some(role) = self
            .content
            .keys()
            .find(|role| layout.placeholder(role).is_none())
        {
            let roles: Vec<&str> = layout
                .placeholders
                .iter()
                .map(|p| p.role.as_str())
                .collect();
            return Err(Error::bad_input(
                Self::NAME,
                format!(
                    "layout `{layout_name}` has no slot `{role}`; its slots are: {}",
                    roles.join(", ")
                ),
            ));
        }
        let at = match &self.after {
            Some(id) => {
                let i = cx.deck.index_of(id).ok_or_else(|| Error::no_slide(id))?;
                if self.backup {
                    i + 1
                } else {
                    after_stack(cx.deck, i)
                }
            }
            None => cx.deck.slides.len(),
        };
        if self.backup && at == 0 {
            return Err(Error::refused(
                "A backup slide stacks under the slide above it; there is none.",
            ));
        }
        let taken: HashSet<String> = cx.deck.slides.iter().map(|s| s.id.clone()).collect();
        let id = cx.ids.fresh(SLIDE, |c| taken.contains(c));
        let mut slide = Slide::new(id.clone(), layout.name.clone());
        slide.backup = self.backup;
        slide.notes = self.notes.unwrap_or_default();
        let mut elements = BTreeMap::new();
        let mut used = HashSet::new();
        for def in &layout.placeholders {
            let eid = cx.ids.fresh(ELEMENT, |c| used.contains(c));
            used.insert(eid.clone());
            elements.insert(def.role.clone(), eid.clone());
            slide.elements.push(placeholder_element(
                def,
                eid,
                self.content.get(&def.role).map(String::as_str),
            ));
        }
        cx.deck.slides.insert(at, slide);
        Ok(AddedSlide {
            slide: id,
            elements,
        })
    }
}

op_types! {
    pub struct DuplicateSlides {
        pub ids: Vec<String>,
    }

    pub struct DuplicatedSlides {
        /// The new slides' ids, in deck order.
        pub slides: Vec<String>,
    }
}

impl Op for DuplicateSlides {
    type Output = DuplicatedSlides;
    const NAME: &'static str = "duplicate_slides";
    const ABOUT: &'static str = "Duplicate slides. Each copy follows its original and keeps its elements' ids, so a copy edited a little is ready for a Morph transition.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_order()
    }

    fn run(self, cx: &mut Cx) -> Result<DuplicatedSlides> {
        for id in &self.ids {
            cx.deck.slide(id).ok_or_else(|| Error::no_slide(id))?;
        }
        let wanted: HashSet<&String> = self.ids.iter().collect();
        let mut taken: HashSet<String> = cx.deck.slides.iter().map(|s| s.id.clone()).collect();
        let mut made = Vec::new();
        let mut i = 0;
        while i < cx.deck.slides.len() {
            if !wanted.contains(&cx.deck.slides[i].id) {
                i += 1;
                continue;
            }
            let mut copy = cx.deck.slides[i].clone();
            copy.id = cx.ids.fresh(SLIDE, |c| taken.contains(c));
            taken.insert(copy.id.clone());
            made.push(copy.id.clone());
            let at = if copy.backup {
                i + 1
            } else {
                after_stack(cx.deck, i)
            };
            cx.deck.slides.insert(at, copy);
            // Continue after the copy, which is never itself in `wanted`.
            i = at + 1;
        }
        Ok(DuplicatedSlides { slides: made })
    }
}

op_types! {
    pub struct DeleteSlides {
        pub ids: Vec<String>,
    }
}

impl Op for DeleteSlides {
    type Output = ();
    const NAME: &'static str = "delete_slides";
    const ABOUT: &'static str = "Delete slides. A deck keeps at least one slide. The deck's history keeps what was deleted.";

    fn scope(&self, deck: &Deck) -> Scope {
        // The slide that ends up first may lose its backup flag.
        let first = deck
            .slides
            .iter()
            .find(|s| !self.ids.contains(&s.id))
            .map(|s| s.id.clone());
        let mut scope = Scope::slides(self.ids.iter().chain(first.as_ref())).with_order();
        scope.meta = true;
        scope
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        for id in &self.ids {
            cx.deck.slide(id).ok_or_else(|| Error::no_slide(id))?;
        }
        let gone: HashSet<&String> = self.ids.iter().collect();
        if cx.deck.slides.iter().all(|s| gone.contains(&s.id)) {
            return Err(Error::refused("A deck keeps at least one slide."));
        }
        // A section that began at a deleted slide begins at the next slide left, unless another section already does.
        let starts: HashSet<String> = cx
            .deck
            .sections
            .iter()
            .map(|s| s.starts_at.clone())
            .collect();
        let mut moved = Vec::new();
        for section in &cx.deck.sections {
            if !gone.contains(&section.starts_at) {
                continue;
            }
            let from = cx.deck.index_of(&section.starts_at).unwrap_or(0);
            let next = cx
                .deck
                .slides
                .iter()
                .skip(from)
                .find(|s| !gone.contains(&s.id))
                .map(|s| s.id.clone());
            moved.push((
                section.starts_at.clone(),
                next.filter(|n| !starts.contains(n)),
            ));
        }
        for (from, to) in moved {
            match to {
                Some(id) => {
                    if let Some(s) = cx.deck.sections.iter_mut().find(|s| s.starts_at == from) {
                        s.starts_at = id;
                    }
                }
                None => cx.deck.sections.retain(|s| s.starts_at != from),
            }
        }
        cx.deck.slides.retain(|s| !gone.contains(&s.id));
        fix_first(cx.deck);
        Ok(())
    }
}

op_types! {
    pub struct MoveSlides {
        pub ids: Vec<String>,
        /// Where the first of them goes, counted among the slides that stay.
        pub to: usize,
    }
}

impl Op for MoveSlides {
    type Output = ();
    const NAME: &'static str = "move_slides";
    const ABOUT: &'static str = "Move slides, keeping their order among themselves, so the first lands at position `to` (0 is the start) counted among the slides that stay. A section starts at a slide and lasts up to the next section: moving the slide a section starts at without the rest of the section leaves the section with the first of its slides that stays, and moving all of its slides takes it along.";

    fn scope(&self, _: &Deck) -> Scope {
        // Whichever slide lands first may lose its backup flag, and a section may pass to another slide.
        Scope {
            every_slide: true,
            order: true,
            meta: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        for id in &self.ids {
            cx.deck.slide(id).ok_or_else(|| Error::no_slide(id))?;
        }
        let moving: HashSet<&String> = self.ids.iter().collect();
        hand_over_sections(cx.deck, &moving);
        let (moved, mut rest): (Vec<Slide>, Vec<Slide>) = std::mem::take(&mut cx.deck.slides)
            .into_iter()
            .partition(|s| moving.contains(&s.id));
        let at = self.to.min(rest.len());
        rest.splice(at..at, moved);
        cx.deck.slides = rest;
        order_sections(cx.deck);
        fix_first(cx.deck);
        Ok(())
    }
}

op_types! {
    pub struct SetSlideFlags {
        pub ids: Vec<String>,
        /// Skipped when presenting.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub hidden: Option<bool>,
        /// Stacked under the slide above.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub backup: Option<bool>,
    }
}

impl Op for SetSlideFlags {
    type Output = ();
    const NAME: &'static str = "set_slide_flags";
    const ABOUT: &'static str = "Hide slides (they are skipped when presenting) or make them backup slides stacked under the slide above, reached only by going down.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slides(self.ids.iter())
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        for id in &self.ids {
            let index = cx.deck.index_of(id).ok_or_else(|| Error::no_slide(id))?;
            if index == 0 && self.backup == Some(true) {
                return Err(Error::refused(
                    "The first slide cannot be a backup slide: there is no slide above it.",
                ));
            }
            let slide = &mut cx.deck.slides[index];
            if let Some(h) = self.hidden {
                slide.hidden = h;
            }
            if let Some(b) = self.backup {
                slide.backup = b;
            }
        }
        Ok(())
    }
}

op_types! {
    pub struct SetTransition {
        pub ids: Vec<String>,
        /// How the slides arrive; null takes the transition away, so the deck's own applies.
        pub transition: Option<Transition>,
    }
}

/// The longest a transition may take, in seconds.
pub(super) const LONGEST_TRANSITION: f64 = 10.0;

impl Op for SetTransition {
    type Output = ();
    const NAME: &'static str = "set_transition";
    const ABOUT: &'static str = "Set how slides arrive: none, fade, slide or morph, with an optional duration in seconds. A null transition takes it away, so the deck's default applies. Morph pairs elements that share an id on the slide before.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slides(self.ids.iter())
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if let Some(duration) = self.transition.as_ref().and_then(|t| t.duration)
            && !(0.0..=LONGEST_TRANSITION).contains(&duration)
        {
            return Err(Error::invalid(format!(
                "A transition takes between 0 and {LONGEST_TRANSITION} seconds, not {duration}."
            )));
        }
        for id in &self.ids {
            let index = cx.deck.index_of(id).ok_or_else(|| Error::no_slide(id))?;
            cx.deck.slides[index].transition = self.transition.clone();
        }
        Ok(())
    }
}

op_types! {
    pub struct SetNotes {
        pub slide: String,
        /// Speaker notes in Markdown; empty clears them.
        pub notes: String,
    }
}

impl Op for SetNotes {
    type Output = ();
    const NAME: &'static str = "set_notes";
    const ABOUT: &'static str =
        "Set a slide's speaker notes (Markdown). The presenter sees them; the audience does not.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        slide_mut(cx.deck, &self.slide)?.notes = self.notes;
        Ok(())
    }
}

op_types! {
    pub struct SetBackground {
        pub slide: String,
        /// A colour or an image; absent puts the theme's background back.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub background: Option<Background>,
    }
}

impl Op for SetBackground {
    type Output = ();
    const NAME: &'static str = "set_background";
    const ABOUT: &'static str = "Set a slide's background colour (a theme token such as bg2 or a #rrggbb value) or image, or clear it to use the theme's.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if let Some(color) = self.background.as_ref().and_then(|b| b.color.as_deref())
            && !crate::model::is_color(color)
        {
            return Err(Error::bad_input(
                Self::NAME,
                format!(
                    "`{color}` is not a theme colour (text1, bg2, accent3, ...) or a #rrggbb value"
                ),
            ));
        }
        slide_mut(cx.deck, &self.slide)?.background = self.background;
        Ok(())
    }
}
