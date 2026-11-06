//! The deck: its slides in order, and what belongs to the deck as a whole.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    DeckComment, DeckFont, Effect, Element, Extra, Guides, HeaderFooter, MotionDirection,
    SlideAccess, Theme, is_false, is_zero,
};

model! {
    /// Width and height in slide units (1/96 inch).
    #[serde(rename_all = "camelCase")]
    pub struct Size {
        pub w: f64,
        pub h: f64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub enum TransitionKind {
        None,
        Fade,
        Slide,
        Morph,
        /// The new slide pushes the old one out.
        Push,
        /// The new slide is wiped in over the old one.
        Wipe,
        /// The new slide slides in over the old one, which stays.
        Cover,
        /// The old slide slides away and shows the new one under it.
        Uncover,
        Zoom,
        Flip,
        /// A slow cross-fade.
        Dissolve,
    }

    /// How a slide arrives.
    #[serde(rename_all = "camelCase")]
    pub struct Transition {
        pub kind: TransitionKind,
        /// Seconds; 0.6 for a morph when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub duration: Option<f64>,
        /// The side a push, wipe, cover, uncover or flip comes from; the right when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub direction: Option<MotionDirection>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub easing: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// What fills a slide behind its elements.
    #[serde(rename_all = "camelCase")]
    pub struct Background {
        /// A colour token or hex value.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<String>,
        /// A file in the host's image store, stretched to cover.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub image: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A named stretch of the deck, from one slide to the next section.
    #[serde(rename_all = "camelCase")]
    pub struct Section {
        pub title: String,
        pub starts_at: String,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A named subset of the deck's slides, shown in the order given, chosen from the Slideshow menu.
    #[serde(rename_all = "camelCase")]
    pub struct CustomShow {
        /// Unique among the deck's custom shows.
        pub id: String,
        pub name: String,
        /// The ids of the slides the show plays, in order; an id the deck no longer has is skipped.
        pub slides: Vec<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// Settings for presenting the whole deck.
    #[serde(rename_all = "camelCase")]
    pub struct Present {
        pub slide_numbers: bool,
        /// What the step label says; `{n}` and `{total}` are replaced.
        pub step_label: String,
        /// The transition of a slide that names none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub transition: Option<Transition>,
        /// How a change of state is drawn when an element names none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub effect: Option<Effect>,
        /// The show goes back to the first slide after the last (a kiosk or a loop). Off when absent.
        #[serde(default, rename = "loop", skip_serializing_if = "is_false")]
        pub looped: bool,
        /// Seconds after which the show moves on by itself (a kiosk); absent for the presenter's own clicks.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub auto_advance: Option<f64>,
        /// Named subsets of the slides to play instead of the whole deck.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub shows: Vec<CustomShow>,
        /// The footer words and the date every slide shows beside its number (the number itself is `slide_numbers`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub header_footer: Option<HeaderFooter>,
        /// The rulers, grid and guides of the editor. Never drawn when presenting or exported.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub guides: Option<Guides>,
        /// Words the spelling check leaves alone in this deck (names, terms), kept in the order they were added.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub dictionary: Vec<String>,
        /// Font files the deck carries, drawn with in the editor, the show and the HTML export.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub fonts: Vec<DeckFont>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct Slide {
        /// Unique in the deck, and never reused.
        pub id: String,
        /// The name of a layout in the deck's theme.
        pub layout: String,
        #[serde(default, skip_serializing_if = "is_false")]
        pub hidden: bool,
        /// Stacked under the slide above it: skipped unless the presenter goes down.
        #[serde(default, skip_serializing_if = "is_false")]
        pub backup: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub transition: Option<Transition>,
        /// Clicks on the slide after it appears; 0 for none.
        #[serde(default, skip_serializing_if = "is_zero")]
        pub steps: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub background: Option<Background>,
        /// Speaker notes, in Markdown.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        pub notes: String,
        /// This slide's own footer and date, over the deck's (`present.header_footer`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub footer: Option<HeaderFooter>,
        /// Bottom to top.
        pub elements: Vec<Element>,
        /// Notes left on the slide or on something on it, oldest first.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub comments: Vec<DeckComment>,
        /// A hidden title and the reading order, for a person who cannot see the slide.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub access: Option<SlideAccess>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A deck: what a `.deck` file holds.
    #[serde(rename_all = "camelCase")]
    pub struct Deck {
        /// Always `kasten-deck`.
        pub format: String,
        pub format_version: u32,
        /// `d-` and random characters.
        pub id: String,
        pub title: String,
        pub size: Size,
        pub theme: Theme,
        pub slides: Vec<Slide>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub sections: Vec<Section>,
        pub present: Present,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

/// The value of `Deck::format`.
pub const FORMAT_NAME: &str = "kasten-deck";

impl Default for Present {
    fn default() -> Self {
        Present {
            slide_numbers: true,
            step_label: "Step {n} / {total}".to_owned(),
            transition: None,
            effect: None,
            looped: false,
            auto_advance: None,
            shows: Vec::new(),
            header_footer: None,
            guides: None,
            dictionary: Vec::new(),
            fonts: Vec::new(),
            extra: Extra::new(),
        }
    }
}

impl Slide {
    pub fn new(id: impl Into<String>, layout: impl Into<String>) -> Slide {
        Slide {
            id: id.into(),
            layout: layout.into(),
            hidden: false,
            backup: false,
            transition: None,
            steps: 0,
            background: None,
            notes: String::new(),
            footer: None,
            elements: Vec::new(),
            comments: Vec::new(),
            access: None,
            extra: Extra::new(),
        }
    }

    /// The element with `id`, looking inside groups.
    pub fn element(&self, id: &str) -> Option<&Element> {
        find(&self.elements, id)
    }

    pub fn element_mut(&mut self, id: &str) -> Option<&mut Element> {
        find_mut(&mut self.elements, id)
    }
}

fn find<'a>(list: &'a [Element], id: &str) -> Option<&'a Element> {
    for e in list {
        if e.id() == id {
            return Some(e);
        }
        if let Some(found) = find(e.children(), id) {
            return Some(found);
        }
    }
    None
}

fn find_mut<'a>(list: &'a mut [Element], id: &str) -> Option<&'a mut Element> {
    for e in list {
        if e.id() == id {
            return Some(e);
        }
        if let Some(children) = e.children_mut()
            && let Some(found) = find_mut(children, id)
        {
            return Some(found);
        }
    }
    None
}

impl Deck {
    pub fn slide(&self, id: &str) -> Option<&Slide> {
        self.slides.iter().find(|s| s.id == id)
    }

    pub fn slide_mut(&mut self, id: &str) -> Option<&mut Slide> {
        self.slides.iter_mut().find(|s| s.id == id)
    }

    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.slides.iter().position(|s| s.id == id)
    }
}
