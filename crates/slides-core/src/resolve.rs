//! Where an element is. An element with its own box is where it says; one
//! that fills a placeholder is where its slide's layout puts that slot.

use crate::model::{Background, Element, Layout, PlaceholderDef, Slide, Theme};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The layout a slide uses.
pub fn layout_of<'a>(theme: &'a Theme, slide: &Slide) -> Option<&'a Layout> {
    theme.layout(&slide.layout)
}

/// What fills a slide behind its elements: the slide's own background, or else its layout's.
pub fn background_of<'a>(theme: &'a Theme, slide: &'a Slide) -> Option<&'a Background> {
    slide
        .background
        .as_ref()
        .or_else(|| layout_of(theme, slide).and_then(|l| l.background.as_ref()))
}

/// The slot an element fills, on its slide's layout.
pub fn placeholder_of<'a>(
    theme: &'a Theme,
    slide: &Slide,
    element: &Element,
) -> Option<&'a PlaceholderDef> {
    let role = element.base().placeholder.as_deref()?;
    layout_of(theme, slide)?.placeholder(role)
}

/// The box an element occupies: each of x, y, w and h it names itself, and
/// the rest from its placeholder.
pub fn box_of(theme: &Theme, slide: &Slide, element: &Element) -> Option<Rect> {
    box_in(theme, &slide.layout, element)
}

/// The same, for an element of a slide that uses the layout called `layout`.
pub fn box_in(theme: &Theme, layout: &str, element: &Element) -> Option<Rect> {
    let base = element.base();
    let slot = base
        .placeholder
        .as_deref()
        .and_then(|role| theme.layout(layout)?.placeholder(role));
    Some(Rect {
        x: base.x.or(slot.map(|s| s.x))?,
        y: base.y.or(slot.map(|s| s.y))?,
        w: base.w.or(slot.map(|s| s.w))?,
        h: base.h.or(slot.map(|s| s.h))?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Base, Text};

    #[test]
    fn an_element_with_a_box_keeps_it() {
        let theme = crate::themes::light();
        let slide = Slide::new("s-1", "blank");
        let e = Element::text_el(
            Base::new("e-1").place(10.0, 20.0, 30.0, 40.0),
            Text::plain("x"),
        );
        assert_eq!(
            box_of(&theme, &slide, &e),
            Some(Rect {
                x: 10.0,
                y: 20.0,
                w: 30.0,
                h: 40.0
            })
        );
    }

    #[test]
    fn a_placeholder_takes_its_box_from_the_layout_and_a_named_side_wins() {
        let theme = crate::themes::light();
        let slide = Slide::new("s-1", "title-only");
        let slot = layout_of(&theme, &slide)
            .and_then(|l| l.placeholder("title"))
            .cloned()
            .unwrap();
        let mut base = Base::new("e-1");
        base.placeholder = Some("title".to_owned());
        let e = Element::text_el(base.clone(), Text::plain("x"));
        assert_eq!(
            box_of(&theme, &slide, &e),
            Some(Rect {
                x: slot.x,
                y: slot.y,
                w: slot.w,
                h: slot.h
            })
        );
        base.h = Some(99.0);
        let e = Element::text_el(base, Text::plain("x"));
        assert_eq!(box_of(&theme, &slide, &e).map(|r| r.h), Some(99.0));
    }

    #[test]
    fn an_element_with_neither_has_no_box() {
        let theme = crate::themes::light();
        let slide = Slide::new("s-1", "blank");
        let e = Element::text_el(Base::new("e-1"), Text::plain("x"));
        assert_eq!(box_of(&theme, &slide, &e), None);
    }
}
