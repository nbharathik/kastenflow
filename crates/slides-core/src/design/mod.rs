//! Layouts a person designs. A layout is worked on as a slide: [`design_deck`] makes a deck of one
//! slide that looks as the layout does (its decoration as ordinary elements, its slots as
//! placeholder elements with the words they ask for), the editor changes that slide as it changes
//! any other, and [`layout_from_slide`] reads the layout back from it. Saving a slide as a layout
//! is the same reading, applied to a slide of the deck.

mod capture;
mod slots;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use crate::canonical::FORMAT_VERSION;
use crate::error::{Error, Result};
use crate::model::{
    Base, Deck, Element, Extra, FORMAT_NAME, ImageEl, Layout, ListKind, Paragraph, PlaceholderDef,
    PlaceholderKind, Slide, Text, TextStyle, Theme,
};
use crate::resolve::box_in;

pub use slots::{SlotKind, free_role, slot_def};

/// The id of the slide a layout is designed on.
pub const DESIGN_SLIDE: &str = "s-design";

/// Where the words of a slot's prompt come from when a layout is read from a slide.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prompts {
    /// The words in the slot: the person typed what it should ask for, designing the layout.
    FromWords,
    /// The slot asks as it did, or as its kind does: the words are the slide's own.
    Kept,
}

/// A layout read from a slide, with the text styles its slots use that are new or changed.
#[derive(Clone, Debug, PartialEq)]
pub struct Read {
    pub layout: Layout,
    pub styles: BTreeMap<String, TextStyle>,
    /// The element of the slide that each slot of the layout was read from, with the slot's role.
    pub slots: Vec<(String, String)>,
}

fn unknown(name: &str, deck: &Deck) -> Error {
    let names: Vec<&str> = deck.theme.layouts.iter().map(|l| l.name.as_str()).collect();
    Error::bad_input(
        "layout_design",
        format!(
            "the theme has no layout `{name}`; it has: {}",
            names.join(", ")
        ),
    )
}

/// The text a slot shows while its layout is designed: the words it asks for, set as a list when
/// the slot is one.
fn prompt_text(def: &PlaceholderDef) -> Text {
    let mut paragraph = Paragraph::plain(def.prompt.clone());
    paragraph.list = def.list.clone();
    Text {
        valign: def.valign.clone(),
        ..Text::from_paragraphs(vec![paragraph])
    }
}

/// The element a slot is while its layout is designed: placed where the slot is, holding its prompt.
fn slot_element(def: &PlaceholderDef) -> Element {
    let mut base = Base::new(format!("ph-{}", def.role)).place(def.x, def.y, def.w, def.h);
    base.placeholder = Some(def.role.clone());
    match def.kind {
        PlaceholderKind::Image => Element::Image(ImageEl {
            base,
            src: String::new(),
            crop: None,
            mask: None,
            extra: Extra::new(),
        }),
        PlaceholderKind::Text => Element::text_el(base, prompt_text(def)),
    }
}

/// A deck of one slide, `s-design`, that is the layout `name` of `deck`'s theme to work on: the
/// layout's decoration and its slots, over the layout's background. The theme and the size are
/// the deck's, so everything drawn looks as it will on a slide of the layout.
pub fn design_deck(deck: &Deck, name: &str) -> Result<Deck> {
    let layout = deck.theme.layout(name).ok_or_else(|| unknown(name, deck))?;
    let mut slide = Slide::new(DESIGN_SLIDE, name);
    slide.background = layout.background.clone();
    slide.elements = layout
        .elements
        .iter()
        .cloned()
        .chain(layout.placeholders.iter().map(slot_element))
        .collect();
    Ok(Deck {
        format: FORMAT_NAME.to_owned(),
        format_version: FORMAT_VERSION,
        id: "d-design".to_owned(),
        title: layout.label.clone(),
        size: deck.size.clone(),
        theme: deck.theme.clone(),
        slides: vec![slide],
        sections: Vec::new(),
        present: deck.present.clone(),
        extra: Extra::new(),
    })
}

/// The first line of the words a slot holds, which is what it asks for.
fn asked_for(text: &Text) -> Option<String> {
    let words = text
        .paragraphs
        .iter()
        .map(Paragraph::text)
        .collect::<Vec<_>>()
        .join(" ");
    let words = words.split_whitespace().collect::<Vec<_>>().join(" ");
    (!words.is_empty()).then_some(words)
}

/// What a slot's first paragraph says about being a list, when it says anything.
fn listed(text: &Text) -> Option<ListKind> {
    text.paragraphs.first().and_then(|p| p.list.clone())
}

/// The slot an element stands for: its box, its kind of words or picture and how they look.
/// `taken` are the roles the layout already has.
fn slot_of(
    theme: &Theme,
    base: &Layout,
    on: &str,
    element: &Element,
    taken: &[&str],
    prompts: Prompts,
) -> Option<(PlaceholderDef, Option<(String, TextStyle)>)> {
    let layout = base.name.as_str();
    let wanted = element.base().placeholder.as_deref()?;
    let (x, y, w, h) = box_in(theme, on, element).map(|r| (r.x, r.y, r.w, r.h))?;
    let known = base.placeholder(wanted);
    let role = if taken.contains(&wanted) {
        free_role(SlotKind::of_role(wanted), taken)
    } else {
        wanted.to_owned()
    };
    let text = match element {
        Element::Text(t) => Some(&t.text),
        Element::Image(_) => None,
        _ => return None,
    };
    let kind = SlotKind::of_role(wanted);
    let mut def = match (known, text) {
        (Some(def), Some(_)) if def.kind == PlaceholderKind::Text => def.clone(),
        (Some(def), None) if def.kind == PlaceholderKind::Image => def.clone(),
        (_, Some(_)) => slot_def(
            if kind == SlotKind::Picture {
                SlotKind::Text
            } else {
                kind
            },
            &role,
            (x, y, w, h),
        ),
        (_, None) => slot_def(SlotKind::Picture, &role, (x, y, w, h)),
    };
    def.role = role.clone();
    (def.x, def.y, def.w, def.h) = (x, y, w, h);
    let mut style = None;
    if let Some(text) = text {
        // Paragraph style first: the editor sets one when it puts a new slot on a layout.
        let named = text
            .paragraphs
            .first()
            .and_then(|p| p.style.clone())
            .filter(|s| theme.text_style(s).is_some());
        if let Some(named) = named {
            def.style = Some(named);
        }
        if let Some(valign) = &text.valign {
            def.valign = Some(valign.clone());
        }
        if known.is_none() {
            def.list = listed(text).or(def.list);
        }
        let start = def.style.clone().unwrap_or_else(|| "body".to_owned());
        if let Some(look) = capture::captured(theme, &start, text) {
            let name = format!("{layout}.{role}");
            def.style = Some(name.clone());
            style = Some((name, look));
        }
        match prompts {
            Prompts::FromWords => {
                if let Some(words) = asked_for(text) {
                    def.prompt = words;
                }
            }
            Prompts::Kept => {}
        }
    }
    Some((def, style))
}

/// The layout `slide` stands for. Its elements that fill a slot are the layout's slots, where they
/// are; every other element is decoration. The slide's background is the layout's. `base` is what
/// the layout is to be called and where its slots' looks start from (its name also names the text
/// styles a slot gets of its own); `theme` has the layout the slide is on, which says where a slot
/// that sits in its place is.
pub fn layout_from_slide(theme: &Theme, base: &Layout, slide: &Slide, prompts: Prompts) -> Read {
    let mut layout = Layout {
        placeholders: Vec::new(),
        elements: Vec::new(),
        background: slide.background.clone(),
        ..base.clone()
    };
    let mut styles = BTreeMap::new();
    let mut slots = Vec::new();
    // What a layout draws is made of the plain shapes, pictures and words a PowerPoint file has: a
    // code block or a formula on the slide is the group of what it is drawn with.
    let drawn = crate::composites::expand_slide(theme, slide);
    for (element, shown) in slide.elements.iter().zip(&drawn.elements) {
        let taken: Vec<&str> = layout
            .placeholders
            .iter()
            .map(|p| p.role.as_str())
            .collect();
        match slot_of(theme, base, &slide.layout, element, &taken, prompts) {
            Some((def, style)) => {
                slots.push((element.id().to_owned(), def.role.clone()));
                layout.placeholders.push(def);
                styles.extend(style);
            }
            None => {
                let mut still = shown.clone();
                still.base_mut().placeholder = None;
                // Something with no place of its own has nowhere to be drawn.
                if still.base().rect().is_some() || matches!(still, Element::Group(_)) {
                    layout.elements.push(still);
                }
            }
        }
    }
    Read {
        layout,
        styles,
        slots,
    }
}
