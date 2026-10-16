//! Citing works on a slide: the keys go in the slide's footer citation.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::util::{ids_on, slide_mut};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::ELEMENT;
use crate::model::{Base, CitationEl, CitationStyle, Deck, Element, Extra, Slide};

/// The name a footer citation is given, so it is found again.
const FOOTER_NAME: &str = "citations";
/// Where the footer stands: the side margin of the built-in layouts, the height of one line
/// of the citation style with its insets (the strip under the content of the built-in layouts,
/// which end 48 units above the bottom), and the space under it, which is what lint asks to be
/// kept round anything on a slide.
const SIDE: f64 = 64.0;
const HEIGHT: f64 = 24.0;
const BELOW: f64 = 24.0;
/// The room kept clear of whatever the theme draws in the footer, such as the slide number.
const CLEAR: f64 = 8.0;
/// The longest a key is.
const LONGEST_KEY: usize = 200;

op_types! {
    /// Cites works on a slide by their BibTeX keys.
    pub struct AddCitation {
        pub slide: String,
        /// BibTeX keys, such as `vaswani2017attention`. Keys the slide already cites are not added twice.
        pub keys: Vec<String>,
        /// How the footer writes them: `short` (the default for a new one), `full` or `numbered`.
        /// An existing footer keeps its format unless this is given.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub format: Option<CitationStyle>,
    }

    pub struct AddedCitation {
        /// The citation element that holds the keys now.
        pub id: String,
        /// Whether the slide had no footer citation, so one was made.
        pub created: bool,
        /// The keys that were not there yet.
        pub added: Vec<String>,
    }
}

/// A key as it is kept, or why it cannot be one.
fn checked(key: &str) -> std::result::Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("a key is not empty".to_owned());
    }
    if key.chars().count() > LONGEST_KEY {
        return Err(format!("`{key}` is too long to be a BibTeX key"));
    }
    if key
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || matches!(c, ',' | '{' | '}'))
    {
        return Err(format!(
            "`{key}` cannot be a BibTeX key: a key has no spaces, commas or braces"
        ));
    }
    Ok(key.to_owned())
}

/// The citations on a slide, in groups too, that are not lists, and how low each stands.
fn footers(elements: &[Element], out: &mut Vec<(String, bool, f64)>) {
    for element in elements {
        if let Element::Citation(c) = element
            && c.format != Some(CitationStyle::List)
        {
            let base = &c.base;
            let bottom = base.y.unwrap_or(0.0) + base.h.unwrap_or(0.0);
            out.push((
                base.id.clone(),
                base.name.as_deref() == Some(FOOTER_NAME),
                bottom,
            ));
        }
        footers(element.children(), out);
    }
}

/// The footer citation of a slide: the one named `citations`, else the lowest.
fn footer_of(slide: &Slide) -> Option<String> {
    let mut all = Vec::new();
    footers(&slide.elements, &mut all);
    all.iter()
        .find(|(_, named, _)| *named)
        .or_else(|| all.iter().max_by(|a, b| a.2.total_cmp(&b.2)))
        .map(|(id, _, _)| id.clone())
}

/// Where a new footer citation goes: along the bottom margin, stopping short of what the theme draws there.
fn footer_box(deck: &Deck) -> (f64, f64, f64, f64) {
    let (width, height) = (deck.size.w, deck.size.h);
    let y = (height - HEIGHT - BELOW).max(0.0);
    let mut right = width - SIDE;
    for element in &deck.theme.master {
        if let Some((x, top, _, h)) = element.base().rect()
            && top < y + HEIGHT
            && top + h > y
            && x > SIDE
        {
            right = right.min(x - CLEAR);
        }
    }
    (SIDE, y, (right - SIDE).max(SIDE), HEIGHT)
}

impl Op for AddCitation {
    type Output = AddedCitation;
    const NAME: &'static str = "add_citation";
    const ABOUT: &'static str = "Cite works on a slide by BibTeX key: the keys go in the slide's footer citation (the one named `citations`), which is made along the bottom margin when the slide has none. Keys already cited are not added twice. `format` is short (Vaswani et al., 2017 (NeurIPS); the default for a new footer), full or numbered ([1]); an existing footer keeps its format unless you give one. Use it for every figure, quote or claim taken from a paper. The keys must be in the bibliography: lint reports one that is not. For a references slide add a citation element with format list, which prints every work the deck cites.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<AddedCitation> {
        if self.keys.is_empty() {
            return Err(Error::bad_input(Self::NAME, "give at least one key"));
        }
        if self.format == Some(CitationStyle::List) {
            return Err(Error::bad_input(
                Self::NAME,
                "a footer is short, full or numbered; a list is for a references slide, which add_elements makes with a citation element of format list",
            ));
        }
        let mut keys: Vec<String> = Vec::new();
        for key in &self.keys {
            let key = checked(key).map_err(|m| Error::bad_input(Self::NAME, m))?;
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
        let (x, y, w, h) = footer_box(cx.deck);
        let slide = slide_mut(cx.deck, &self.slide)?;
        if let Some(id) = footer_of(slide) {
            let Some(Element::Citation(footer)) = slide.element_mut(&id) else {
                return Err(Error::no_element(&self.slide, &id));
            };
            let added: Vec<String> = keys
                .into_iter()
                .filter(|key| !footer.keys.contains(key))
                .collect();
            footer.keys.extend(added.iter().cloned());
            if let Some(format) = self.format {
                footer.format = Some(format);
            }
            return Ok(AddedCitation {
                id,
                created: false,
                added,
            });
        }
        let taken = ids_on(slide);
        let id = cx.ids.fresh(ELEMENT, |c| taken.contains(c));
        let mut base = Base::new(id.clone()).place(x, y, w, h);
        base.name = Some(FOOTER_NAME.to_owned());
        slide.elements.push(Element::Citation(CitationEl {
            base,
            keys: keys.clone(),
            format: self.format,
            links: false,
            extra: Extra::new(),
        }));
        Ok(AddedCitation {
            id,
            created: true,
            added: keys,
        })
    }
}
