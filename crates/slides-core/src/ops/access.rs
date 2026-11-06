//! What a slide tells a person who cannot see it: a title that is not drawn,
//! and the order its elements are read in.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::steps::reading_order;
use super::util::slide_mut;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Element, SlideAccess, Theme};

/// The longest a hidden title is, in characters.
const LONGEST_TITLE: usize = 200;

/// The elements in the order they are read: those the slide's reading order lists, first to last,
/// then the others in the usual order (rows from top to bottom, each from left to right).
pub fn read_in_order<'a>(
    theme: &Theme,
    layout: &str,
    access: Option<&SlideAccess>,
    elements: impl IntoIterator<Item = &'a Element>,
) -> Vec<&'a Element> {
    let usual = reading_order(theme, layout, elements);
    let Some(listed) = access.map(|a| &a.reading_order).filter(|l| !l.is_empty()) else {
        return usual;
    };
    let mut first: Vec<&'a Element> = listed
        .iter()
        .filter_map(|id| usual.iter().copied().find(|e| e.id() == id))
        .collect();
    first.extend(
        usual
            .iter()
            .copied()
            .filter(|e| !listed.iter().any(|id| id == e.id())),
    );
    first
}

op_types! {
    /// Sets a slide's hidden title and the order its elements are read in. Only what is given changes.
    pub struct SetSlideAccess {
        pub slide: String,
        /// A title for a slide that shows none, read aloud and used in the outline; empty text takes it away.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        /// The ids of elements of the slide, in the order they are read. The elements it leaves out are read after these. An empty list goes back to the usual order.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub reading_order: Option<Vec<String>>,
    }
}

impl Op for SetSlideAccess {
    type Output = ();
    const NAME: &'static str = "set_slide_access";
    const ABOUT: &'static str = "Set what a slide tells a person who cannot see it. `title` is a title the slide does not draw (for a slide with a picture and no heading); empty text takes it away. `readingOrder` lists element ids in the order a screen reader reads them, the rest in the usual order (top to bottom, left to right); an empty list goes back to the usual order. To mark a picture as decoration, patch its `alt` to the empty string.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let slide = slide_mut(cx.deck, &self.slide)?;
        let title = self.title.as_deref().map(str::trim);
        if title.is_some_and(|t| t.chars().count() > LONGEST_TITLE) {
            return Err(Error::invalid(format!(
                "A hidden title is at most {LONGEST_TITLE} characters."
            )));
        }
        if let Some(order) = &self.reading_order {
            for (at, id) in order.iter().enumerate() {
                if slide.element(id).is_none() {
                    return Err(Error::no_element(&self.slide, id));
                }
                if order[..at].contains(id) {
                    return Err(Error::invalid(format!(
                        "The reading order names `{id}` twice."
                    )));
                }
            }
        }
        let mut access = slide.access.take().unwrap_or_else(|| SlideAccess {
            title: None,
            reading_order: Vec::new(),
            extra: Default::default(),
        });
        if let Some(title) = title {
            access.title = (!title.is_empty()).then(|| title.to_owned());
        }
        if let Some(order) = self.reading_order {
            access.reading_order = order;
        }
        let empty =
            access.title.is_none() && access.reading_order.is_empty() && access.extra.is_empty();
        slide.access = (!empty).then_some(access);
        Ok(())
    }
}
