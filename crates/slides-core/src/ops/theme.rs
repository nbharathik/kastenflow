//! Operations on the deck as a whole: its title, its theme and its logo.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::util::merge_patch;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Base, Deck, Element, Extra, ImageEl, Size, Theme, is_hex};
use crate::resize::{Fit, scale_elements};
use crate::themes as catalog;

/// The id of the master element that holds the deck's logo.
pub const LOGO: &str = "master-logo";

op_types! {
    pub struct SetTitle {
        pub title: String,
    }
}

impl Op for SetTitle {
    type Output = ();
    const NAME: &'static str = "set_title";
    const ABOUT: &'static str =
        "Rename the deck. The title shows in the deck list and in the outline.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_meta()
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        cx.deck.title = self.title;
        Ok(())
    }
}

op_types! {
    pub struct ApplyTheme {
        /// A built-in theme: `Light`, `Dark`, `Serif`, `Lecture`, `Minimal`, `Bold`, `Modern`, `Academic`, `Pitch`, `Dark Studio` or `Warm Paper`.
        pub name: String,
    }
}

pub(super) fn logo_of(theme: &Theme) -> Option<String> {
    theme.master.iter().find_map(|e| match e {
        Element::Image(i) if i.base.id == LOGO && !i.src.is_empty() => Some(i.src.clone()),
        _ => None,
    })
}

/// Puts the logo in the theme's master: in the logo element it has, or in a new one at the top
/// right, placed as it would be on a 960 by 540 slide and refitted to `size`.
pub(super) fn set_logo(theme: &mut Theme, src: &str, size: &Size) {
    for e in &mut theme.master {
        if let Element::Image(i) = e
            && i.base.id == LOGO
        {
            i.src = src.to_owned();
            return;
        }
    }
    let mut base = Base::new(LOGO).place(836.0, 8.0, 100.0, 40.0);
    base.alt = Some("Logo".to_owned());
    let mut logo = [Element::Image(ImageEl {
        base,
        src: src.to_owned(),
        crop: None,
        mask: None,
        extra: Extra::new(),
    })];
    scale_elements(&mut logo, &Fit::between(&crate::themes::drawn_for(), size));
    theme.master.extend(logo);
}

impl Op for ApplyTheme {
    type Output = ();
    const NAME: &'static str = "apply_theme";
    const ABOUT: &'static str = "Switch the deck to a built-in theme (Light, Dark, Serif, Lecture, Minimal, Bold, Modern, Academic, Pitch, Dark Studio, Warm Paper). Slides keep their layouts and content and take the new colours, fonts and slot positions, fitted to the deck's page size; a logo set on the old theme carries over, and so do the layouts someone made (they go after the theme's own).";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let mut theme = catalog::by_name_sized(&self.name, &cx.deck.size).ok_or_else(|| {
            Error::bad_input(
                Self::NAME,
                format!(
                    "there is no theme `{}`; the themes are: {}",
                    self.name,
                    catalog::all()
                        .iter()
                        .map(|t| t.name.clone())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
        })?;
        if let Some(logo) = logo_of(&cx.deck.theme) {
            set_logo(&mut theme, &logo, &cx.deck.size);
        }
        keep_own_layouts(&cx.deck.theme, &mut theme);
        cx.deck.theme = theme;
        Ok(())
    }
}

/// The layouts of the theme being left that the new one does not have (the ones a person made, or
/// came with the deck) go on after the new theme's own, with the text styles their slots need, so
/// no slide loses its layout and nobody loses a layout they made. The layout new slides start
/// from is kept.
pub(super) fn keep_own_layouts(old: &Theme, new: &mut Theme) {
    for layout in &old.layouts {
        if new.layouts.iter().any(|l| l.name == layout.name) {
            continue;
        }
        new.layouts.push(layout.clone());
        for style in layout.placeholders.iter().filter_map(|d| d.style.as_ref()) {
            if new.text_style(style).is_none()
                && let Some(look) = old.text_styles.get(style)
            {
                new.text_styles.insert(style.clone(), look.clone());
            }
        }
    }
    new.new_slide_layout = old
        .new_slide_layout
        .clone()
        .filter(|name| new.layout(name).is_some());
}

op_types! {
    pub struct EditTheme {
        /// A JSON merge patch on the theme: `{"colors": {"accent1": "#0b5cad"}, "fonts": {"heading": {"family": "Lato"}}}`. A key set to null is removed.
        pub patch: Value,
    }
}

impl Op for EditTheme {
    type Output = ();
    const NAME: &'static str = "edit_theme";
    const ABOUT: &'static str = "Change the deck's own theme with a JSON merge patch: colours (text1, text2, bg1, bg2, accent1 to accent6 as #rrggbb), fonts, text styles, dimmed opacity, or the layouts and master elements.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let mut value =
            serde_json::to_value(&cx.deck.theme).map_err(|e| Error::bad_input(Self::NAME, e))?;
        merge_patch(&mut value, &self.patch);
        let theme: Theme =
            serde_json::from_value(value).map_err(|e| Error::bad_input(Self::NAME, e))?;
        check_theme(Self::NAME, &theme)?;
        cx.deck.theme = theme;
        Ok(())
    }
}

/// Whether a theme can be drawn: its twelve colours are `#rrggbb` and the dimmed opacity is a share.
pub(super) fn check_theme(op: &str, theme: &Theme) -> Result<()> {
    let c = &theme.colors;
    for (name, hex) in [
        ("text1", &c.text1),
        ("text2", &c.text2),
        ("bg1", &c.bg1),
        ("bg2", &c.bg2),
        ("accent1", &c.accent1),
        ("accent2", &c.accent2),
        ("accent3", &c.accent3),
        ("accent4", &c.accent4),
        ("accent5", &c.accent5),
        ("accent6", &c.accent6),
    ] {
        if !is_hex(hex) {
            return Err(Error::bad_input(
                op,
                format!("colour `{name}` is `{hex}`, which is not #rrggbb"),
            ));
        }
    }
    if !(0.0..=1.0).contains(&theme.dimmed_opacity) {
        return Err(Error::bad_input(op, "dimmedOpacity is between 0 and 1"));
    }
    Ok(())
}

op_types! {
    pub struct SetLogo {
        /// An image in the host's image store, such as `assets/logo.png`; empty removes the logo.
        pub src: String,
    }
}

impl Op for SetLogo {
    type Output = ();
    const NAME: &'static str = "set_logo";
    const ABOUT: &'static str = "Set the deck's logo, shown by themes that have a logo slot (Lecture has one top right). The image must already be in the image store.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let size = cx.deck.size.clone();
        set_logo(&mut cx.deck.theme, &self.src, &size);
        Ok(())
    }
}
