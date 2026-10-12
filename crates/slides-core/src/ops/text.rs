//! Operations on the words in an element.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::layout::slot_text;
use super::util::element_mut;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Element, Text};
use crate::resolve::placeholder_of;

/// Puts `text` in the element, or says why it cannot hold text.
fn put(e: &mut Element, text: Text) -> Result<()> {
    match e {
        Element::Text(t) => t.text = text,
        Element::Shape(s) => s.text = Some(text),
        Element::Connector(c) => c.label = Some(text),
        _ => {
            return Err(Error::refused(format!(
                "A {} element cannot hold text.",
                e.kind()
            )));
        }
    }
    Ok(())
}

/// Text that takes `old`'s box settings.
fn keeping_box(mut fresh: Text, old: Option<&Text>) -> Text {
    if let Some(old) = old {
        fresh.valign = old.valign.clone();
        fresh.insets = old.insets.clone();
        fresh.fit = old.fit.clone();
        fresh.wrap = old.wrap;
        fresh.extra = old.extra.clone();
    }
    fresh
}

op_types! {
    pub struct SetText {
        pub slide: String,
        pub id: String,
        /// The words, in Markdown: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`, `$latex$`, `- bullets`, `1. numbers`, one paragraph per line.
        pub markdown: String,
    }
}

impl Op for SetText {
    type Output = ();
    const NAME: &'static str = "set_text";
    const ABOUT: &'static str = "Replace the words in a text box, shape, or connector label with Markdown. Formatting the old words had is not kept; the box's alignment and insets are. A body slot makes bullets by default.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let list = {
            let e = slide
                .element(&self.id)
                .ok_or_else(|| Error::no_element(&self.slide, &self.id))?;
            placeholder_of(theme, slide, e).and_then(|d| d.list.clone())
        };
        let e = element_mut(slide, &self.id)?;
        let fresh = keeping_box(slot_text(list.as_ref(), Some(&self.markdown)), e.text());
        put(e, fresh)
    }
}

op_types! {
    pub struct SetRichText {
        pub slide: String,
        pub id: String,
        /// Paragraphs of runs, as the editor writes them.
        pub text: Text,
    }
}

impl Op for SetRichText {
    type Output = ();
    const NAME: &'static str = "set_rich_text";
    const ABOUT: &'static str = "Replace the text of an element with paragraphs of runs (the stored form). Use set_text for Markdown.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        super::elements::validate(&Element::text_el(
            crate::model::Base::new("x"),
            self.text.clone(),
        ))
        .map_err(|m| Error::bad_input(Self::NAME, m))?;
        let slide = super::util::slide_mut(cx.deck, &self.slide)?;
        put(element_mut(slide, &self.id)?, self.text)
    }
}
