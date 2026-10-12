//! Making a new deck: the theme at the deck's size, and either one title slide or the theme's example
//! slides.

use std::collections::HashSet;

use super::Engine;
use super::layout::placeholder_element;
use crate::canonical::FORMAT_VERSION;
use crate::error::{Error, Result};
use crate::ids::{DECK, ELEMENT, IdGen, SLIDE};
use crate::model::{
    Align, Base, Deck, Element, Extra, FORMAT_NAME, Fill, Paragraph, Present, Size, Slide, Style,
    Text, Theme, VAlign,
};
use crate::resize::checked;
use crate::themes::{self, samples};

/// What a new deck is made of.
#[derive(Clone, Debug)]
pub struct NewDeck<'a> {
    pub title: &'a str,
    /// A built-in theme, by name.
    pub theme: &'a str,
    /// Width and height in slide units; 960 by 540 when absent.
    pub size: Option<(f64, f64)>,
    /// Start with the theme's example slides (a title, a section, a list, two columns, a picture
    /// beside words, a quote and a closing slide) instead of a title slide alone.
    pub examples: bool,
    /// Starts the ids of everything new.
    pub seed: u64,
}

fn unknown_theme(name: &str) -> Error {
    Error::bad_input(
        "create_deck",
        format!(
            "there is no theme `{name}`; the themes are: {}",
            themes::all()
                .iter()
                .map(|t| t.name.clone())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    )
}

/// A slide of the layout `example` names, its slots holding the example's words. `picture` leaves
/// out the empty picture slot and puts a plain panel in its place, which says where a picture goes.
fn slide_of(theme: &Theme, example: &samples::Example, title: &str, ids: &mut IdGen) -> Slide {
    let mut slide = Slide::new(ids.fresh(SLIDE, |_| false), example.layout);
    slide.notes = example.notes.to_owned();
    let Some(layout) = theme.layout(example.layout) else {
        return slide;
    };
    let mut used = HashSet::new();
    for def in &layout.placeholders {
        let id = ids.fresh(ELEMENT, |c| used.contains(c));
        used.insert(id.clone());
        if example.picture && def.role == "image" {
            slide
                .elements
                .push(stand_in(def.x, def.y, def.w, def.h, id));
            continue;
        }
        let words = example
            .content
            .iter()
            .find(|(role, _)| *role == def.role)
            .map(|(_, words)| words.replace(samples::TITLE, title));
        slide
            .elements
            .push(placeholder_element(def, id, words.as_deref()));
    }
    slide
}

/// A rounded panel in the second background colour that says where a picture goes. Its name is not one PowerPoint gives
/// its own pictures ("Picture 3"), which an import takes to be no name at all, so it comes back from a file as it went.
fn stand_in(x: f64, y: f64, w: f64, h: f64, id: String) -> Element {
    let mut base = Base::new(id).place(x, y, w, h);
    base.name = Some("Picture slot".to_owned());
    base.style = Some(Style {
        fill: Some(Fill {
            color: "bg2".to_owned(),
            alpha: None,
            extra: Extra::new(),
        }),
        radius: Some(12.0),
        ..Style::default()
    });
    let words = Paragraph {
        align: Some(Align::Center),
        style: Some("caption".to_owned()),
        ..Paragraph::plain(samples::PICTURE_WORDS)
    };
    let text = Text {
        valign: Some(VAlign::Middle),
        ..Text::from_paragraphs(vec![words])
    };
    Element::shape(base, "roundRect", Some(text))
}

impl Engine {
    /// A new deck of the named theme, with a title slide.
    pub fn create(title: &str, theme: &str, seed: u64) -> Result<Engine> {
        Engine::create_with(&NewDeck {
            title,
            theme,
            size: None,
            examples: false,
            seed,
        })
    }

    /// A new deck of the named theme at the size asked for, with a title slide or with the
    /// theme's example slides. It has nothing to undo.
    pub fn create_with(new: &NewDeck) -> Result<Engine> {
        let (w, h) = match new.size {
            Some((w, h)) => checked(w, h).map_err(|m| Error::bad_input("create_deck", m))?,
            None => (crate::units::SLIDE_WIDTH, crate::units::SLIDE_HEIGHT),
        };
        let size = Size {
            w,
            h,
            extra: Extra::new(),
        };
        let theme =
            themes::by_name_sized(new.theme, &size).ok_or_else(|| unknown_theme(new.theme))?;
        let mut ids = IdGen::new(new.seed);
        let slides = if new.examples {
            samples::EXAMPLES
                .iter()
                .map(|example| slide_of(&theme, example, new.title, &mut ids))
                .collect()
        } else {
            let title = samples::Example {
                layout: "title",
                content: &[("title", samples::TITLE)],
                notes: "",
                picture: false,
            };
            vec![slide_of(&theme, &title, new.title, &mut ids)]
        };
        let deck = Deck {
            format: FORMAT_NAME.to_owned(),
            format_version: FORMAT_VERSION,
            id: ids.fresh(DECK, |_| false),
            title: new.title.to_owned(),
            size,
            theme,
            slides,
            sections: Vec::new(),
            // A new deck shows no slide numbers; a deck read from a file keeps what the file says.
            present: Present {
                slide_numbers: false,
                ..Present::default()
            },
            extra: Extra::new(),
        };
        Ok(Engine::from_parts(deck, ids))
    }
}
