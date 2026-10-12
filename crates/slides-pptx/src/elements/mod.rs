//! The elements of a slide, each written as the PPTX object that is one for
//! one what the editor draws: a text box or shape (`p:sp`), a line or connector
//! (`p:cxnSp`), a picture (`p:pic`), a group (`p:grpSp`) and a table
//! (`p:graphicFrame`). Elements come out in the order of the deck, which is
//! the stacking order.

mod common;
mod group;
mod line;
mod picture;
mod presets;
mod raw;
mod shape;
mod steps;
mod table;

use slides_core::{Base, Element, StepState};

use crate::backing::Behind;
use crate::cx::Cx;
use crate::xml::Xml;
pub use common::{Frame, Ph, ph_of};
use common::{frame_of, placeholder_for};
pub use picture::{cover, write_blip_fill};

/// What an element inherits from the groups around it.
#[derive(Clone, Copy, Debug)]
pub struct Env {
    /// How opaque the groups around it make it, 1 for a slide's own element.
    pub opacity: f64,
}

impl Default for Env {
    fn default() -> Env {
        Env { opacity: 1.0 }
    }
}

impl Env {
    /// The opacity of an element: its own, times what its groups leave it.
    pub fn opacity_of(&self, base: &Base) -> f64 {
        let own = base.style.as_ref().and_then(|s| s.opacity).unwrap_or(1.0);
        (self.opacity * own).clamp(0.0, 1.0)
    }
}

/// Where and how an element is drawn, worked out before its kind writes it.
#[derive(Clone, Copy, Debug)]
pub struct Site {
    /// The shape's number on the slide.
    pub id: u32,
    pub frame: Frame,
    pub opacity: f64,
    /// The layout slot it fills.
    pub ph: Option<Ph>,
}

/// Writes the elements of a slide (or a group) in order.
pub fn write_all(x: &mut Xml, cx: &mut Cx, elements: &[Element], env: &Env) {
    for element in elements {
        write(x, cx, element, env);
    }
}

/// Records the shapes a slide's layout draws under it, so that words a step dims on the slide are
/// mixed toward what is behind them there and not toward the page.
pub fn remember(cx: &mut Cx, elements: &[Element]) {
    for el in elements {
        if let Element::Group(g) = el {
            remember(cx, &g.children);
            continue;
        }
        let Some(frame) = frame_of(cx, el) else {
            continue;
        };
        let behind = cx.backing.behind(&frame.rect);
        if let Some(shown) = steps::shows(cx, el, 1.0, &behind)
            && frame.rotation % 360.0 == 0.0
        {
            cx.backing.push(frame.rect, shown);
        }
    }
}

/// Writes one element.
pub fn write(x: &mut Xml, cx: &mut Cx, el: &Element, env: &Env) {
    cx.element = Some(el.id().to_owned());
    write_one(x, cx, el, env);
    cx.element = None;
}

fn write_one(x: &mut Xml, cx: &mut Cx, el: &Element, env: &Env) {
    let state = steps::state(el, cx.step);
    if state == StepState::Hidden {
        return;
    }
    let dimmed = state == StepState::Dimmed;
    let share = cx.deck.theme.dimmed_opacity.clamp(0.0, 1.0);
    let env = Env {
        opacity: if dimmed {
            env.opacity * share
        } else {
            env.opacity
        },
    };
    let (outer, under) = (cx.dim, cx.under.clone());
    if dimmed {
        // Words are mixed toward what lies behind the outermost element that dims them.
        if outer >= 1.0 {
            cx.under = steps::behind(cx, el);
        }
        cx.dim = outer * share;
    }
    write_shown(x, cx, el, &env, state == StepState::Highlighted);
    (cx.dim, cx.under, cx.backdrop) = (outer, under, Behind::Page);
}

/// Writes an element that is there at this step, and its outline when the step highlights it.
fn write_shown(x: &mut Xml, cx: &mut Cx, el: &Element, env: &Env, highlighted: bool) {
    let Some(id) = cx.ids.of(el.id()) else {
        return;
    };
    if let Element::Group(g) = el {
        group::write(x, cx, g, id, env);
        if highlighted && let Some(frame) = steps::group_frame(cx, el) {
            steps::write_highlight(x, cx, el, frame, env.opacity_of(el.base()));
        }
        return;
    }
    let Some(frame) = frame_of(cx, el) else {
        cx.warn(format!(
            "a {} has no position, so it was left out",
            el.kind()
        ));
        return;
    };
    let site = Site {
        id,
        frame,
        opacity: env.opacity_of(el.base()),
        ph: placeholder_for(cx, el),
    };
    // What is behind the words matters only to a step, which dims or hides them.
    let shows = if cx.step.is_some() {
        let behind = cx.backing.behind(&frame.rect);
        let shows = steps::shows(cx, el, site.opacity, &behind);
        cx.backdrop = shows.clone().unwrap_or(behind);
        shows
    } else {
        None
    };
    match el {
        Element::Text(t) => shape::write_text(x, cx, t, &site),
        Element::Shape(s) => shape::write_shape(x, cx, s, &site),
        Element::Line(l) => line::write_line(x, cx, l, &site),
        Element::Connector(c) => line::write_connector(x, cx, c, &site),
        Element::Image(i) => picture::write_image(x, cx, i, &site),
        Element::Table(t) => table::write(x, cx, t, &site),
        Element::Raw(r) => raw::write(x, cx, r, &site),
        Element::Group(_) => {}
        // The model will grow kinds this exporter does not know; they are left out, not fatal.
        #[allow(unreachable_patterns)]
        other => {
            cx.warn(format!(
                "a {} element cannot be written to PPTX and was left out",
                other.kind()
            ));
            return;
        }
    }
    if let Some(shown) = shows
        && frame.rotation % 360.0 == 0.0
    {
        cx.backing.push(frame.rect, shown);
    }
    if highlighted {
        steps::write_highlight(x, cx, el, site.frame, site.opacity);
    }
}

/// One element as XML, numbered as it would be on a slide of its own.
#[cfg(test)]
pub fn xml_of(cx: &mut Cx, el: &Element) -> String {
    cx.ids.assign(std::slice::from_ref(el));
    let mut x = Xml::fragment();
    write(&mut x, cx, el, &Env::default());
    x.into_string()
}

#[cfg(test)]
mod tests;
