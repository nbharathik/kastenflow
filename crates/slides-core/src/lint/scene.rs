//! A slide the way the rules look at it: its elements flattened into leaves
//! (drawn things with a box) and units (the elements as the person sees and
//! selects them), with composites expanded, where each element stands on
//! the stack, and at which steps it shows.

use crate::citations::{Cites, Numbering, Refs};
use crate::composites;
use crate::model::{Base, Deck, Element, Slide, StepState, Text};
use crate::resolve::{Rect, box_in};

use super::color::Rgb;
use super::geometry::{turned, union};

/// The most steps lint tells apart; a slide has at most 50.
const MOST_STEPS: u32 = 63;

/// Bit `s` says the element shows at step `s`.
pub type Steps = u64;

/// The composite a leaf is a part of.
#[derive(Clone, Copy, Debug)]
pub struct Owner<'a> {
    pub id: &'a str,
    pub kind: &'static str,
    /// Its layer name, if it has one.
    pub name: Option<&'a str>,
}

/// What a unit is, for the rules that treat kinds differently.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Text,
    Shape,
    Image,
    Table,
    Line,
    Group,
    Raw,
    Composite(&'static str),
}

/// A drawn element with a box: a primitive, or a part of a composite.
pub struct Leaf<'a> {
    pub el: &'a Element,
    /// Where it stands from the bottom of the slide's stack.
    pub z: usize,
    /// The unit it belongs to.
    pub unit: usize,
    pub owner: Option<Owner<'a>>,
    /// The groups it is in, outermost first (numbered on this slide).
    pub groups: Vec<usize>,
    pub rect: Option<Rect>,
    /// The upright box that holds it as turned.
    pub bounds: Option<Rect>,
    pub visible: Steps,
    /// An empty slot draws nothing to an audience.
    pub undrawn: bool,
}

/// An element of the slide as it stands in the list: what the person selects.
pub struct Unit<'a> {
    /// The element in the expanded slide (a composite is its group of parts).
    pub el: &'a Element,
    pub id: &'a str,
    pub kind: Kind,
    /// The box that holds everything it draws.
    pub bounds: Option<Rect>,
    pub visible: Steps,
    pub undrawn: bool,
    pub turned: bool,
}

pub struct Scene<'a> {
    pub deck: &'a Deck,
    pub slide: &'a Slide,
    pub width: f64,
    pub height: f64,
    pub leaves: Vec<Leaf<'a>>,
    pub units: Vec<Unit<'a>>,
    /// The colour behind everything, unless a picture is.
    pub paper: Option<Rgb>,
}

#[derive(Clone)]
struct Ctx<'a> {
    unit: Option<usize>,
    owner: Option<Owner<'a>>,
    groups: Vec<usize>,
    visible: Steps,
}

struct Builder<'a> {
    deck: &'a Deck,
    slide: &'a Slide,
    steps: u32,
    leaves: Vec<Leaf<'a>>,
    units: Vec<Unit<'a>>,
    groups: usize,
}

/// Whether nothing shows: no visible character, and no field.
pub fn is_blank(text: &Text) -> bool {
    text.paragraphs.iter().all(|p| {
        p.runs
            .iter()
            .all(|r| r.t.trim().is_empty() && r.field.is_none())
    })
}

/// The steps at which an element shows, given its own states.
fn mask_of(base: &Base, steps: u32) -> Steps {
    let mut mask = 0;
    for s in 0..=steps.min(MOST_STEPS) {
        let state = base
            .step_states
            .range(..=s)
            .next_back()
            .map_or(StepState::Normal, |(_, state)| state.clone());
        if state != StepState::Hidden {
            mask |= 1 << s;
        }
    }
    mask
}

fn every_step(steps: u32) -> Steps {
    match steps.min(MOST_STEPS) + 1 {
        64 => u64::MAX,
        n => (1u64 << n) - 1,
    }
}

/// Whether an element is an empty slot, which an audience does not see.
fn undrawn(el: &Element) -> bool {
    match el {
        Element::Text(t) => el.base().placeholder.is_some() && is_blank(&t.text),
        Element::Shape(s) => {
            el.base().placeholder.is_some() && s.text.as_ref().is_none_or(is_blank)
        }
        Element::Image(i) => i.src.trim().is_empty(),
        _ => false,
    }
}

fn kind_of(el: &Element, composite: Option<&'static str>) -> Kind {
    match (composite, el) {
        (Some(kind), Element::Group(_)) => Kind::Composite(kind),
        (_, Element::Text(_)) => Kind::Text,
        (_, Element::Shape(_)) => Kind::Shape,
        (_, Element::Image(_)) => Kind::Image,
        (_, Element::Table(_)) => Kind::Table,
        (_, Element::Line(_) | Element::Connector(_)) => Kind::Line,
        (_, Element::Group(_)) => Kind::Group,
        (_, Element::Raw(_)) => Kind::Raw,
        (_, other) => Kind::Composite(other.kind()),
    }
}

impl<'a> Builder<'a> {
    fn walk(&mut self, orig: &'a [Element], exp: &'a [Element], ctx: &Ctx<'a>) {
        for (i, e) in exp.iter().enumerate() {
            let o = orig.get(i);
            let mut inner = ctx.clone();
            inner.visible &= mask_of(e.base(), self.steps);
            let composite = o.filter(|o| o.is_composite()).map(Element::kind);
            let unit = match ctx.unit {
                Some(unit) => unit,
                None => {
                    self.units.push(Unit {
                        el: e,
                        id: e.id(),
                        kind: kind_of(e, composite),
                        bounds: None,
                        visible: inner.visible,
                        undrawn: false,
                        turned: false,
                    });
                    self.units.len() - 1
                }
            };
            inner.unit = Some(unit);
            if let Element::Group(g) = e {
                match (o, composite) {
                    (Some(o), Some(kind)) if ctx.owner.is_none() => {
                        inner.owner = Some(Owner {
                            id: o.id(),
                            kind,
                            name: o.base().name.as_deref(),
                        });
                    }
                    _ => {
                        self.groups += 1;
                        inner.groups.push(self.groups);
                    }
                }
                let below: &'a [Element] = match o {
                    Some(o) if composite.is_none() => o.children(),
                    _ => &[],
                };
                self.walk(below, &g.children, &inner);
                continue;
            }
            let rect = box_in(&self.deck.theme, &self.slide.layout, e);
            let rotation = e.base().rotation.unwrap_or(0.0);
            self.leaves.push(Leaf {
                el: e,
                z: self.leaves.len(),
                unit,
                owner: inner.owner,
                groups: inner.groups.clone(),
                rect,
                bounds: rect.map(|r| turned(r, rotation)),
                visible: inner.visible,
                undrawn: undrawn(e),
            });
        }
    }
}

impl<'a> Scene<'a> {
    /// `expanded` is `slide` with its composites replaced by the groups of
    /// their parts (`composites::expand_slide`), which must be the same length.
    pub fn new(deck: &'a Deck, slide: &'a Slide, expanded: &'a Slide) -> Scene<'a> {
        let mut builder = Builder {
            deck,
            slide,
            steps: slide.steps,
            leaves: Vec::new(),
            units: Vec::new(),
            groups: 0,
        };
        let ctx = Ctx {
            unit: None,
            owner: None,
            groups: Vec::new(),
            visible: every_step(slide.steps),
        };
        builder.walk(&slide.elements, &expanded.elements, &ctx);
        let Builder {
            leaves, mut units, ..
        } = builder;
        for (n, unit) in units.iter_mut().enumerate() {
            let mine: Vec<&Leaf> = leaves.iter().filter(|l| l.unit == n).collect();
            unit.bounds = mine
                .iter()
                .filter_map(|l| l.bounds)
                .reduce(union)
                .or_else(|| {
                    unit.el
                        .base()
                        .rect()
                        .map(|(x, y, w, h)| Rect { x, y, w, h })
                });
            unit.undrawn = mine.iter().all(|l| l.undrawn);
            unit.turned = mine
                .iter()
                .any(|l| l.el.base().rotation.unwrap_or(0.0).rem_euclid(360.0) != 0.0);
        }
        let paper = match crate::resolve::background_of(&deck.theme, slide) {
            Some(b) if b.image.as_deref().is_some_and(|i| !i.trim().is_empty()) => None,
            Some(b) => b
                .color
                .as_deref()
                .and_then(|c| deck.theme.resolve_color(c))
                .and_then(|c| Rgb::parse(&c)),
            None => Rgb::parse(&deck.theme.colors.bg1),
        };
        Scene {
            deck,
            slide,
            width: deck.size.w,
            height: deck.size.h,
            leaves,
            units,
            paper,
        }
    }
}

/// Whether two things ever show together.
pub fn together(a: Steps, b: Steps) -> bool {
    a & b != 0
}

/// The slide with its composites replaced by the groups of their parts, its citations
/// numbered as the whole deck numbers its works and, where the bibliography is known,
/// written from it, as the slide is drawn.
pub fn expanded_with(deck: &Deck, slide: &Slide, refs: Option<&Refs>) -> Slide {
    if !slide.elements.iter().any(holds_citation) {
        return composites::expand_slide(&deck.theme, slide);
    }
    let numbering = Numbering::of(deck);
    let cites = Cites {
        refs,
        numbering: Some(&numbering),
    };
    composites::expand_slide_with(&deck.theme, slide, &cites)
}

fn holds_citation(element: &Element) -> bool {
    matches!(element, Element::Citation(_)) || element.children().iter().any(holds_citation)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_step_state_holds_until_the_next_change() {
        let mut base = Base::new("e");
        base.step_states.insert(1, StepState::Hidden);
        base.step_states.insert(3, StepState::Normal);
        assert_eq!(mask_of(&base, 4), 0b11001);
        assert_eq!(mask_of(&Base::new("x"), 2), 0b111);
        assert_eq!(every_step(0), 1);
        assert_eq!(every_step(200), u64::MAX);
    }
}
