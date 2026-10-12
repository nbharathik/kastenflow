//! Composite elements become primitives. A composite (code, math, a chat, a
//! grid of cards ...) is stored with a few fields of its own; `expand` turns it
//! into the text, shapes, lines and pictures it is drawn with, in slide
//! coordinates. The editor, present mode and the PowerPoint export all draw
//! that expansion, so they always look the same. "Ungroup to shapes" is
//! the expansion made permanent.
//!
//! One file (or folder) for each kind, each with `expand(&Ctx, &Kind) -> Vec<Element>`
//! and its tests. `build.rs` has what they share for making parts, `geom.rs` keeps
//! them inside the box, and `measure.rs` estimates how much room text takes so
//! that sizes are chosen to fit.

mod build;
mod card_grid;
mod chart;
mod chat;
mod citation;
mod code;
mod embed;
mod geom;
mod guide;
mod math;
mod measure;
mod media;
mod qr;
mod step_label;
mod timer;
mod token_probs;
mod video;

pub use build::{Parts, plain_text};
pub use code::warm_up;
pub use guide::guidance;
pub use math::math_image_path;

use crate::citations::{Cites, Numbering, Refs};
use crate::model::{Base, Deck, Element, Extra, GroupEl, Slide, Theme};
use crate::resolve::{Rect, box_in};

/// What an expansion needs to know about where the composite is drawn.
pub struct Ctx<'a> {
    pub theme: &'a Theme,
    /// The name of the layout of the slide it is on.
    pub layout: &'a str,
    /// The box it is drawn in, in slide units.
    pub rect: Rect,
    /// The composite's own id: the parts' ids are made from it, so they are the same every time.
    pub id: &'a str,
    /// The bibliography and the deck's numbering of its works, when the host has them:
    /// what a citation is written from.
    pub cites: Cites<'a>,
}

/// The primitives a composite is drawn with, in slide coordinates, or None
/// for an element that is not a composite or has no box to draw in. A citation is
/// written with its keys as they are; see [`expand_with`].
pub fn expand(theme: &Theme, layout: &str, element: &Element) -> Option<Vec<Element>> {
    expand_with(theme, layout, element, &Cites::default())
}

/// The same, with the bibliography and the numbering of the deck that a citation is written from.
pub fn expand_with(
    theme: &Theme,
    layout: &str,
    element: &Element,
    cites: &Cites,
) -> Option<Vec<Element>> {
    if !element.is_composite() {
        return None;
    }
    // Whatever the box says, the expansions work with a finite one that is not upside down.
    let rect = geom::sane(box_in(theme, layout, element)?);
    let cx = Ctx {
        theme,
        layout,
        rect,
        id: element.id(),
        cites: *cites,
    };
    Some(match element {
        Element::Code(e) => code::expand(&cx, e),
        Element::Math(e) => math::expand(&cx, e),
        Element::Chat(e) => chat::expand(&cx, e),
        Element::TokenProbs(e) => token_probs::expand(&cx, e),
        Element::CardGrid(e) => card_grid::expand(&cx, e),
        Element::Citation(e) => citation::expand(&cx, e),
        Element::StepLabel(e) => step_label::expand(&cx, e),
        Element::Embed(e) => embed::expand(&cx, e),
        Element::Video(e) => video::expand(&cx, e),
        Element::Chart(e) => chart::expand(&cx, e),
        Element::Timer(e) => timer::expand(&cx, e),
        Element::Qr(e) => qr::expand(&cx, e),
        _ => return None,
    })
}

/// The link and the words for a person who cannot see it that a composite gives its group when
/// it has none of its own: an embedded page and a video point somewhere.
fn identity(element: &Element) -> (Option<String>, Option<String>) {
    match element {
        Element::Embed(e) => (embed::link_of(e), Some(embed::alt_of(e))),
        Element::Video(e) => (
            video::link_of(e).map(str::to_owned),
            Some(video::ALT.to_owned()),
        ),
        Element::Chart(e) => (None, Some(chart::alt_of(e))),
        Element::Timer(e) => (None, Some(timer::alt_of(e))),
        Element::Qr(e) => (None, Some(qr::alt_of(e))),
        _ => (None, None),
    }
}

/// Turns every part `degrees` clockwise about `pivot`, as a rotated group turns what it holds.
fn turn_parts(parts: &mut [Element], pivot: (f64, f64), degrees: f64) {
    let (sin, cos) = degrees.to_radians().sin_cos();
    for part in parts {
        let base = part.base_mut();
        if let (Some(x), Some(y), Some(w), Some(h)) = (base.x, base.y, base.w, base.h) {
            let (dx, dy) = (x + w / 2.0 - pivot.0, y + h / 2.0 - pivot.1);
            let centre = (pivot.0 + dx * cos - dy * sin, pivot.1 + dx * sin + dy * cos);
            base.x = Some(geom::round2(centre.0 - w / 2.0));
            base.y = Some(geom::round2(centre.1 - h / 2.0));
            base.rotation = Some(geom::round2(base.rotation.unwrap_or(0.0) + degrees));
        }
    }
}

/// The composite as one group of its parts, keeping its id, box, steps, name and link, so
/// the group can stand where the composite stood. A group keeps no turn of its own, so a
/// turned composite has its parts turned about its middle instead.
pub fn expanded_group(theme: &Theme, layout: &str, element: &Element) -> Option<Element> {
    expanded_group_with(theme, layout, element, &Cites::default())
}

/// The same, with the bibliography and numbering that citations are written from.
pub fn expanded_group_with(
    theme: &Theme,
    layout: &str,
    element: &Element,
    cites: &Cites,
) -> Option<Element> {
    let mut children = expand_with(theme, layout, element, cites)?;
    let mut base = element.base().clone();
    if let Some(r) = box_in(theme, layout, element).map(geom::sane) {
        base.x = Some(r.x);
        base.y = Some(r.y);
        base.w = Some(r.w);
        base.h = Some(r.h);
        let turn = base.rotation.unwrap_or(0.0);
        if turn.is_finite() && turn.rem_euclid(360.0) != 0.0 {
            turn_parts(&mut children, geom::middle(r), turn);
        }
    }
    base.rotation = None;
    let (link, alt) = identity(element);
    base.link = base.link.or(link);
    base.alt = base.alt.or(alt);
    // The parts carry the looks; the group has none of its own to add.
    base.placeholder = None;
    Some(Element::Group(GroupEl {
        base: Base {
            style: None,
            ..base
        },
        children,
        extra: Extra::new(),
    }))
}

fn expand_list(theme: &Theme, layout: &str, elements: &[Element], cites: &Cites) -> Vec<Element> {
    elements
        .iter()
        .map(|e| match expanded_group_with(theme, layout, e, cites) {
            Some(group) => group,
            None => match e {
                Element::Group(g) => {
                    let mut g = g.clone();
                    g.children = expand_list(theme, layout, &g.children, cites);
                    Element::Group(g)
                }
                other => other.clone(),
            },
        })
        .collect()
}

/// The slide with every composite replaced by the group of its parts: what an exporter draws.
/// The slide alone cannot say how the deck numbers its citations; see [`expand_slide_with`].
pub fn expand_slide(theme: &Theme, slide: &Slide) -> Slide {
    expand_slide_with(theme, slide, &Cites::default())
}

/// The same, with the bibliography and the deck's numbering that citations are written from.
pub fn expand_slide_with(theme: &Theme, slide: &Slide, cites: &Cites) -> Slide {
    let mut out = slide.clone();
    out.elements = expand_list(theme, &slide.layout, &slide.elements, cites);
    out
}

/// The deck with every composite replaced by the group of its parts. Its citations are
/// numbered as the deck numbers its works and written with their keys.
pub fn expand_deck(deck: &Deck) -> Deck {
    expand_deck_with(deck, None)
}

/// The same, with the bibliography that says who wrote each work the citations name.
pub fn expand_deck_with(deck: &Deck, refs: Option<&Refs>) -> Deck {
    let numbering = Numbering::of(deck);
    let cites = Cites {
        refs,
        numbering: Some(&numbering),
    };
    let mut out = deck.clone();
    out.slides = deck
        .slides
        .iter()
        .map(|s| expand_slide_with(&deck.theme, s, &cites))
        .collect();
    out
}

/// How many steps a composite needs its slide to have: a code block with three
/// focus entries needs three. A group needs what the most demanding thing in it does.
pub fn steps_needed(element: &Element) -> u32 {
    match element {
        Element::Code(e) => u32::try_from(e.focus.len()).unwrap_or(u32::MAX),
        Element::Group(g) => g.children.iter().map(steps_needed).max().unwrap_or(0),
        _ => 0,
    }
}

/// How many steps a slide needs to have for everything on it to show: the most any
/// composite on it asks for.
pub fn slide_steps_needed(slide: &Slide) -> u32 {
    slide.elements.iter().map(steps_needed).max().unwrap_or(0)
}

#[cfg(test)]
mod tests;
