//! Templates. A template is a deck whose look is the point: its theme (colours, fonts, text styles,
//! the decoration every slide has, its layouts), its page size and, when its maker kept them,
//! slides to show what the layouts are for. [`template_of`] makes one of a deck, [`Engine::create_from_template`]
//! starts a deck from one, and `apply_template` puts one on a deck that exists without touching what
//! is on its slides.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::layout::placeholder_element;
use super::theme::{LOGO, check_theme, keep_own_layouts, logo_of, set_logo};
use super::{Cx, Engine, Op, Scope, op_types};
use crate::canonical::check_structure;
use crate::error::{Error, Result};
use crate::ids::{DECK, ELEMENT, IdGen, SLIDE};
use crate::model::{Deck, Element, Size, Slide, Text, Theme, is_false};
use crate::resize::{Fit, checked, scale_deck, scale_theme};

/// A slide on the layout a deck starts from, its slots empty; the title slot holds `title`.
/// None when the theme has no layout at all.
fn start_slide(theme: &Theme, title: Option<&str>, ids: &mut IdGen) -> Option<Slide> {
    let layout = theme
        .layout("title")
        .or_else(|| {
            theme
                .new_slide_layout
                .as_deref()
                .and_then(|name| theme.layout(name))
        })
        .or_else(|| theme.layouts.first())?;
    let mut slide = Slide::new(ids.fresh(SLIDE, |_| false), layout.name.clone());
    let mut used = std::collections::HashSet::new();
    for def in &layout.placeholders {
        let id = ids.fresh(ELEMENT, |c| used.contains(c));
        used.insert(id.clone());
        let mut element = placeholder_element(def, id, None);
        if let (Element::Text(t), Some(title), "title") = (&mut element, title, def.role.as_str()) {
            t.text = Text::plain(title);
        }
        slide.elements.push(element);
    }
    Some(slide)
}

/// What an assistant marked on a slide is not a template's.
fn unmarked(mut slide: Slide) -> Slide {
    slide.extra.remove("x-agent");
    slide
}

/// The deck's look as a deck of its own to start others from, called `title`. With `keep_slides` the
/// slides come along as the examples of what the layouts are for; without, the template holds one
/// empty slide of its title layout and none of the deck's words. `seed` starts its ids.
pub fn template_of(deck: &Deck, title: &str, keep_slides: bool, seed: u64) -> Deck {
    let mut ids = IdGen::new(seed);
    let (slides, sections) = if keep_slides {
        (
            deck.slides.iter().cloned().map(unmarked).collect(),
            deck.sections.clone(),
        )
    } else {
        (
            start_slide(&deck.theme, None, &mut ids)
                .into_iter()
                .collect(),
            Vec::new(),
        )
    };
    Deck {
        id: ids.fresh(DECK, |_| false),
        title: title.to_owned(),
        slides,
        sections,
        ..deck.clone()
    }
}

impl Engine {
    /// A new deck called `title` with the template's look and page size, and its own id. With
    /// `examples` it starts with the template's slides; without, with one title slide that says
    /// the deck's name. It has nothing to undo.
    pub fn create_from_template(
        template: &Deck,
        title: &str,
        examples: bool,
        seed: u64,
    ) -> Result<Engine> {
        let title = title.trim();
        if title.is_empty() {
            return Err(Error::bad_input("create_deck", "a deck needs a title"));
        }
        let mut ids = IdGen::new(seed);
        let (slides, sections) = if examples && !template.slides.is_empty() {
            (
                template.slides.iter().cloned().map(unmarked).collect(),
                template.sections.clone(),
            )
        } else {
            let slide = start_slide(&template.theme, Some(title), &mut ids)
                .ok_or_else(|| Error::bad_input("create_deck", "the template has no layouts"))?;
            (vec![slide], Vec::new())
        };
        let deck = Deck {
            id: ids.fresh(DECK, |_| false),
            title: title.to_owned(),
            slides,
            sections,
            ..template.clone()
        };
        check_structure(&deck)?;
        Ok(Engine::from_parts(deck, ids))
    }
}

op_types! {
    /// Puts a template's look on the deck.
    pub struct ApplyTemplate {
        /// The theme of the template's deck.
        pub theme: Theme,
        /// The size of slide the template is drawn for.
        pub size: Size,
        /// Give the deck the template's page size too, refitting its slides; otherwise the template's theme is fitted to the deck's own size.
        #[serde(default, skip_serializing_if = "is_false")]
        pub resize: bool,
    }
}

impl Op for ApplyTemplate {
    type Output = ();
    const NAME: &'static str = "apply_template";
    const ABOUT: &'static str = "Restyle the deck with a template's theme: colours, fonts, text styles, layouts, the decoration on every slide, and (with `resize`) its page size. The words and elements of every slide stay as they are; layouts the deck has and the template lacks are kept after the template's own.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::everything()
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        check_theme(Self::NAME, &self.theme)?;
        let (w, h) =
            checked(self.size.w, self.size.h).map_err(|m| Error::bad_input(Self::NAME, m))?;
        let mut theme = self.theme;
        if self.resize {
            scale_deck(cx.deck, w, h);
        } else {
            let drawn = Size {
                w,
                h,
                extra: self.size.extra,
            };
            scale_theme(&mut theme, &Fit::between(&drawn, &cx.deck.size));
        }
        let old = &cx.deck.theme;
        // A logo the deck has goes in the logo slot the template leaves empty.
        let slot = theme
            .master
            .iter()
            .any(|e| matches!(e, Element::Image(i) if i.base.id == LOGO));
        if slot
            && logo_of(&theme).is_none()
            && let Some(logo) = logo_of(old)
        {
            set_logo(&mut theme, &logo, &cx.deck.size);
        }
        keep_own_layouts(old, &mut theme);
        cx.deck.theme = theme;
        Ok(())
    }
}
