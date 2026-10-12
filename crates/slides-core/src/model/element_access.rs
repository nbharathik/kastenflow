//! What every element answers whichever kind it is: its common part, its id and
//! kind, the text it carries, the elements inside it, and how a text box or a shape is made.

use super::{Base, Element, Extra, ShapeEl, Text, TextEl};

impl Element {
    pub fn base(&self) -> &Base {
        match self {
            Element::Text(e) => &e.base,
            Element::Shape(e) => &e.base,
            Element::Line(e) => &e.base,
            Element::Connector(e) => &e.base,
            Element::Image(e) => &e.base,
            Element::Group(e) => &e.base,
            Element::Table(e) => &e.base,
            Element::Raw(e) => &e.base,
            Element::Code(e) => &e.base,
            Element::Math(e) => &e.base,
            Element::Chat(e) => &e.base,
            Element::TokenProbs(e) => &e.base,
            Element::CardGrid(e) => &e.base,
            Element::Citation(e) => &e.base,
            Element::StepLabel(e) => &e.base,
            Element::Embed(e) => &e.base,
            Element::Video(e) => &e.base,
            Element::Chart(e) => &e.base,
            Element::Timer(e) => &e.base,
            Element::Qr(e) => &e.base,
        }
    }

    pub fn base_mut(&mut self) -> &mut Base {
        match self {
            Element::Text(e) => &mut e.base,
            Element::Shape(e) => &mut e.base,
            Element::Line(e) => &mut e.base,
            Element::Connector(e) => &mut e.base,
            Element::Image(e) => &mut e.base,
            Element::Group(e) => &mut e.base,
            Element::Table(e) => &mut e.base,
            Element::Raw(e) => &mut e.base,
            Element::Code(e) => &mut e.base,
            Element::Math(e) => &mut e.base,
            Element::Chat(e) => &mut e.base,
            Element::TokenProbs(e) => &mut e.base,
            Element::CardGrid(e) => &mut e.base,
            Element::Citation(e) => &mut e.base,
            Element::StepLabel(e) => &mut e.base,
            Element::Embed(e) => &mut e.base,
            Element::Video(e) => &mut e.base,
            Element::Chart(e) => &mut e.base,
            Element::Timer(e) => &mut e.base,
            Element::Qr(e) => &mut e.base,
        }
    }

    pub fn id(&self) -> &str {
        &self.base().id
    }

    /// The `type` it is written with.
    pub fn kind(&self) -> &'static str {
        match self {
            Element::Text(_) => "text",
            Element::Shape(_) => "shape",
            Element::Line(_) => "line",
            Element::Connector(_) => "connector",
            Element::Image(_) => "image",
            Element::Group(_) => "group",
            Element::Table(_) => "table",
            Element::Raw(_) => "raw",
            Element::Code(_) => "code",
            Element::Math(_) => "math",
            Element::Chat(_) => "chat",
            Element::TokenProbs(_) => "token-probs",
            Element::CardGrid(_) => "card-grid",
            Element::Citation(_) => "citation",
            Element::StepLabel(_) => "step-label",
            Element::Embed(_) => "embed",
            Element::Video(_) => "video",
            Element::Chart(_) => "chart",
            Element::Timer(_) => "timer",
            Element::Qr(_) => "qr",
        }
    }

    /// The text this element carries, if it is one that can.
    pub fn text(&self) -> Option<&Text> {
        match self {
            Element::Text(e) => Some(&e.text),
            Element::Shape(e) => e.text.as_ref(),
            Element::Connector(e) => e.label.as_ref(),
            _ => None,
        }
    }

    pub fn children(&self) -> &[Element] {
        match self {
            Element::Group(g) => &g.children,
            _ => &[],
        }
    }

    pub fn children_mut(&mut self) -> Option<&mut Vec<Element>> {
        match self {
            Element::Group(g) => Some(&mut g.children),
            _ => None,
        }
    }

    /// Whether this is a composite, built from primitives by `crate::composites::expand`.
    pub fn is_composite(&self) -> bool {
        matches!(
            self,
            Element::Code(_)
                | Element::Math(_)
                | Element::Chat(_)
                | Element::TokenProbs(_)
                | Element::CardGrid(_)
                | Element::Citation(_)
                | Element::StepLabel(_)
                | Element::Embed(_)
                | Element::Video(_)
                | Element::Chart(_)
                | Element::Timer(_)
                | Element::Qr(_)
        )
    }

    pub fn text_el(base: Base, text: Text) -> Element {
        Element::Text(TextEl {
            base,
            text,
            extra: Extra::new(),
        })
    }

    pub fn shape(base: Base, shape: &str, text: Option<Text>) -> Element {
        Element::Shape(ShapeEl {
            base,
            shape: shape.to_owned(),
            text,
            extra: Extra::new(),
        })
    }
}
