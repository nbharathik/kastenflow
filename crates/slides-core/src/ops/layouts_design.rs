//! Layouts designed on a slide: a slide saved as a layout of its own, a layout set from a slide it was designed
//! on, and a slide's slots put back where its layout has them.

use std::collections::{BTreeMap, HashMap};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::layout::{add_missing_slots, detach_missing};
use super::layouts::{
    at_of, clean_label, forget_styles, free_name, no_layout, theme_and_slides_on,
};
use super::{Cx, Op, Scope, op_types};
use crate::design::{self, Prompts, SlotKind, free_role};
use crate::error::{Error, Result};
use crate::model::{Deck, Element, Layout, Slide, is_false};

op_types! {
    /// Saves a slide as a layout of its own.
    pub struct SaveLayout {
        /// The slide to read the layout from.
        pub slide: String,
        /// What people call the layout.
        pub label: String,
        /// Which elements of the slide are slots, by element id: `title`, `subtitle`, `body`, `text`, `picture` or `caption`. Elements that already fill a slot of the slide's layout stay slots; everything else is decoration.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub roles: BTreeMap<String, String>,
        /// Put the slide on the new layout, moving its decoration and background there (on by default).
        #[serde(default = "yes", skip_serializing_if = "is_true")]
        pub use_for_slide: bool,
        /// Make it the layout new slides start from.
        #[serde(default, skip_serializing_if = "is_false")]
        pub new_slide_default: bool,
    }

    pub struct SavedLayout {
        /// The name slides refer to it by.
        pub layout: String,
    }
}

fn yes() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

/// The kinds a person may name, for a message.
const KINDS: &str = "title, subtitle, body, text, picture or caption";

impl Op for SaveLayout {
    type Output = SavedLayout;
    const NAME: &'static str = "save_layout";
    const ABOUT: &'static str = "Save a slide as a layout: the elements named in `roles` become slots (title, subtitle, body, text, picture, caption), the others become decoration drawn behind every slide of the layout, and the slide's background becomes the layout's. The slide goes on the new layout unless `useForSlide` is false.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            slides: vec![self.slide.clone()],
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<SavedLayout> {
        let label = clean_label(Self::NAME, &self.label)?;
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let current = theme
            .layout(&slide.layout)
            .cloned()
            .ok_or_else(|| no_layout(Self::NAME, theme, &slide.layout))?;

        // The slide as it would be if each element named were already a slot of its kind.
        let mut marked = slide.clone();
        let mut roles: Vec<String> = marked
            .elements
            .iter()
            .filter_map(|e| e.base().placeholder.clone())
            .collect();
        if let Some(id) = self
            .roles
            .keys()
            .find(|id| !marked.elements.iter().any(|e| e.id() == id.as_str()))
        {
            return Err(Error::no_element(&self.slide, id));
        }
        // In the order of the stack, so the slots are numbered the way they are read.
        for element in &mut marked.elements {
            let id = element.id().to_owned();
            let Some(kind) = self.roles.get(&id) else {
                continue;
            };
            let kind = SlotKind::parse(kind).ok_or_else(|| {
                Error::bad_input(
                    Self::NAME,
                    format!("`{kind}` is not a kind of slot; use {KINDS}"),
                )
            })?;
            let fits = match element {
                Element::Text(_) => kind != SlotKind::Picture,
                Element::Image(_) => kind == SlotKind::Picture,
                _ => false,
            };
            if !fits {
                return Err(Error::bad_input(
                    Self::NAME,
                    format!(
                        "element `{id}` cannot be a {} slot: words can be a title, subtitle, body, text or caption, and a picture a picture",
                        kind.role()
                    ),
                ));
            }
            let taken: Vec<&str> = roles.iter().map(String::as_str).collect();
            let role = free_role(kind, &taken);
            roles.push(role.clone());
            element.base_mut().placeholder = Some(role);
            if let Element::Text(t) = element
                && let Some(first) = t.text.paragraphs.first_mut()
            {
                first.style.get_or_insert_with(|| kind.style().to_owned());
            }
        }

        let name = free_name(theme, &label);
        let base = Layout {
            name: name.clone(),
            label,
            ..current
        };
        let read = design::layout_from_slide(theme, &base, &marked, Prompts::Kept);
        theme.text_styles.extend(read.styles);
        let layout = read.layout;
        if self.use_for_slide {
            let slots: HashMap<&str, &str> = read
                .slots
                .iter()
                .map(|(id, role)| (id.as_str(), role.as_str()))
                .collect();
            // What became decoration is the layout's now; what became a slot follows the layout's box.
            slide.elements.retain(|e| slots.contains_key(e.id()));
            for e in &mut slide.elements {
                let b = e.base_mut();
                b.placeholder = slots.get(b.id.as_str()).map(|role| (*role).to_owned());
                (b.x, b.y, b.w, b.h) = (None, None, None, None);
            }
            slide.layout = name.clone();
            slide.background = None;
        }
        theme.layouts.push(layout);
        if self.new_slide_default {
            theme.new_slide_layout = Some(name.clone());
        }
        Ok(SavedLayout { layout: name })
    }
}

op_types! {
    /// Sets a layout from a slide it was designed on.
    pub struct SetLayoutDesign {
        /// The layout to change.
        pub name: String,
        /// The slide it was designed on (the slide `design_deck` made, changed): its elements that fill a slot are the layout's slots and the others its decoration.
        pub design: Slide,
        /// Hide the theme's master on the layout's slides.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub hide_master: Option<bool>,
    }

    pub struct DesignedLayout {
        /// Ids of what filled a slot the layout no longer has: it stays on its slide as a plain element.
        pub detached: Vec<String>,
    }
}

impl Op for SetLayoutDesign {
    type Output = DesignedLayout;
    const NAME: &'static str = "set_layout_design";
    const ABOUT: &'static str = "Replace a layout's decoration, background and slots with those of a slide it was designed on. Slides that use it follow: a slot they leave at the layout's place moves with it, one moved by hand stays, and what filled a slot that is gone stays as a plain element. Nothing is deleted.";

    fn scope(&self, deck: &Deck) -> Scope {
        theme_and_slides_on(deck, &self.name)
    }

    fn run(self, cx: &mut Cx) -> Result<DesignedLayout> {
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let at = at_of(Self::NAME, theme, &self.name)?;
        let base = theme.layouts[at].clone();
        let mut design = self.design;
        design.layout = self.name.clone();
        let read = design::layout_from_slide(theme, &base, &design, Prompts::FromWords);
        let mut layout = read.layout;
        if let Some(hide) = self.hide_master {
            layout.hide_master = hide;
        }
        let mut detached = Vec::new();
        for slide in slides.iter_mut().filter(|s| s.layout == self.name) {
            detached.extend(detach_missing(theme, slide, &layout));
        }
        theme.layouts[at] = layout;
        theme.text_styles.extend(read.styles);
        forget_styles(theme, &self.name);
        Ok(DesignedLayout { detached })
    }
}

op_types! {
    /// Puts the slots of slides back where their layout has them.
    pub struct ResetSlides {
        pub ids: Vec<String>,
    }

    pub struct ResetDone {
        /// How many slots were put back in place.
        pub reset: usize,
        /// Ids of the empty slots added for slots the slide lacked.
        pub added: Vec<String>,
    }
}

impl Op for ResetSlides {
    type Output = ResetDone;
    const NAME: &'static str = "reset_slides";
    const ABOUT: &'static str = "Reset slides to their layout: each slot that was moved or resized goes back to where the layout puts it, and slots the slide lacks are added empty. The words and everything that is not a slot stay.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slides(self.ids.iter())
    }

    fn run(self, cx: &mut Cx) -> Result<ResetDone> {
        for id in &self.ids {
            cx.deck.slide(id).ok_or_else(|| Error::no_slide(id))?;
        }
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let mut done = ResetDone {
            reset: 0,
            added: Vec::new(),
        };
        for slide in slides.iter_mut().filter(|s| self.ids.contains(&s.id)) {
            let Some(layout) = theme.layout(&slide.layout).cloned() else {
                continue;
            };
            for e in &mut slide.elements {
                let b = e.base_mut();
                let follows = b
                    .placeholder
                    .as_deref()
                    .is_some_and(|r| layout.placeholder(r).is_some());
                if follows && (b.x, b.y, b.w, b.h) != (None, None, None, None) {
                    (b.x, b.y, b.w, b.h) = (None, None, None, None);
                    done.reset += 1;
                }
            }
            done.added.extend(add_missing_slots(cx.ids, slide, &layout));
        }
        Ok(done)
    }
}
