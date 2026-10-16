//! Slides and decks that come from elsewhere (an import): added to a deck, or put in its place. Each
//! is one operation, so an import is one step to undo, and several can go together in a batch.

use std::collections::HashSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::util::assign_ids;
use super::{Cx, Op, Scope, op_types};
use crate::canonical::check_structure;
use crate::error::{Error, Result};
use crate::ids::SLIDE;
use crate::model::{Deck, Extra, Size, Slide};
use crate::resize::{Fit, checked, scale_slide};

/// How far to refit what comes from a deck whose slides are `from` units to this deck's `to`: no
/// change at all when nothing is said, and a refusal when what is said is not a slide size.
pub(super) fn from_size_fit(op: &str, from: Option<&Size>, to: &Size) -> Result<Fit> {
    let Some(from) = from else {
        return Ok(Fit { sx: 1.0, sy: 1.0 });
    };
    let (w, h) = checked(from.w, from.h)
        .map_err(|message| Error::bad_input(op, format!("`fromSize`: {message}")))?;
    let from = Size {
        w,
        h,
        extra: Extra::new(),
    };
    Ok(Fit::between(&from, to))
}

op_types! {
    /// Adds slides that were made elsewhere.
    pub struct AddSlides {
        /// Whole slides, each with a layout the deck's theme has.
        pub slides: Vec<Slide>,
        /// The slide to add them after (and the backup slides stacked under it); the end when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub after: Option<String>,
        /// The size of the slides of the deck they were made in, when it is not this deck's. They are then refitted to this deck as a change of page size refits a deck: boxes stretch with the slide, type, lines and corners follow the width, and pictures and anything turned keep their shape.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub from_size: Option<Size>,
    }

    pub struct AddedSlides {
        /// The ids the slides have in the deck: theirs, unless a slide of the deck already had it.
        pub slides: Vec<String>,
    }
}

impl Op for AddSlides {
    type Output = AddedSlides;
    const NAME: &'static str = "add_slides";
    const ABOUT: &'static str = "Add whole slides that were made elsewhere, such as the ones of an imported PowerPoint file, after a slide or at the end. Each needs a layout the theme has. A slide keeps its id and its elements' ids unless they are taken. Give `fromSize` (the page size of the deck they come from) to refit them to this deck's page size.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_order()
    }

    fn run(self, cx: &mut Cx) -> Result<AddedSlides> {
        let fit = from_size_fit(Self::NAME, self.from_size.as_ref(), &cx.deck.size)?;
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
        let mut made = Vec::with_capacity(self.slides.len());
        for mut slide in self.slides {
            if cx.deck.theme.layout(&slide.layout).is_none() {
                return Err(Error::refused(format!(
                    "The slide `{}` uses the layout `{}`, which the theme does not have. The layouts are: {}.",
                    slide.id,
                    slide.layout,
                    cx.deck
                        .theme
                        .layouts
                        .iter()
                        .map(|l| l.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )));
            }
            if slide.id.is_empty() || taken.contains(&slide.id) {
                slide.id = cx.ids.fresh(SLIDE, |c| taken.contains(c));
            }
            // What an assistant did in this deck is not said by a slide that comes from elsewhere.
            slide.extra.remove(crate::marks::KEY);
            taken.insert(slide.id.clone());
            assign_ids(&mut slide.elements, &mut HashSet::new(), cx.ids, true);
            scale_slide(&mut slide, &cx.deck.theme, &fit);
            made.push(slide.id.clone());
            cx.deck.slides.insert(at, slide);
            at += 1;
        }
        // Nothing stands above the first slide for a backup to stack under.
        if let Some(first) = cx.deck.slides.first_mut() {
            first.backup = false;
        }
        Ok(AddedSlides { slides: made })
    }
}

op_types! {
    /// Puts another deck in place of this one.
    pub struct ReplaceDeck {
        /// The whole deck: its title, size, theme, slides, sections and present settings replace these.
        pub deck: Deck,
    }
}

impl Op for ReplaceDeck {
    type Output = ();
    const NAME: &'static str = "replace_deck";
    const ABOUT: &'static str = "Replace the deck's title, size, theme, slides, sections and present settings with those of another deck, as one step that can be undone. For an import that replaces the deck, or a new version of it. The deck keeps its own id.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::everything()
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        check_structure(&self.deck)?;
        if self.deck.slides.is_empty() {
            return Err(Error::refused("A deck keeps at least one slide."));
        }
        let Deck {
            title,
            size,
            theme,
            slides,
            sections,
            present,
            ..
        } = self.deck;
        cx.deck.title = title;
        cx.deck.size = size;
        cx.deck.theme = theme;
        cx.deck.slides = slides;
        for slide in &mut cx.deck.slides {
            slide.extra.remove(crate::marks::KEY);
        }
        cx.deck.sections = sections;
        cx.deck.present = present;
        Ok(())
    }
}
