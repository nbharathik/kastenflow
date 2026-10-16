//! Layouts brought from another deck: each is added under a name this theme does not have yet, and the text styles
//! it names come with it when the theme lacks them.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::incoming::from_size_fit;
use super::layouts::{clean_label, free_name};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Layout, Size, TextStyle};
use crate::resize::{scale_layout, scale_text_styles};

op_types! {
    /// Brings layouts from another deck.
    pub struct ImportLayouts {
        pub layouts: Vec<Layout>,
        /// The text styles of the deck they come from that they name and this theme lacks.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub text_styles: BTreeMap<String, TextStyle>,
        /// The size of the slides of the deck they come from, when it is not this deck's. The layouts and their text styles are then refitted to this deck's size as a change of page size refits a theme.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub from_size: Option<Size>,
    }

    pub struct ImportedLayouts {
        /// The names they were given here, in order.
        pub added: Vec<String>,
    }
}

impl Op for ImportLayouts {
    type Output = ImportedLayouts;
    const NAME: &'static str = "import_layouts";
    const ABOUT: &'static str = "Add layouts from another deck at the end of the theme's list, under names this theme does not have yet. Their colours are theme tokens, so they take on this deck's palette.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<ImportedLayouts> {
        if self.layouts.is_empty() {
            return Err(Error::bad_input(Self::NAME, "give at least one layout"));
        }
        let fit = from_size_fit(Self::NAME, self.from_size.as_ref(), &cx.deck.size)?;
        let mut text_styles = self.text_styles;
        scale_text_styles(&mut text_styles, &fit);
        let theme = &mut cx.deck.theme;
        let mut added = Vec::new();
        for mut layout in self.layouts {
            scale_layout(&mut layout, &fit);
            let label = clean_label(
                Self::NAME,
                if layout.label.trim().is_empty() {
                    &layout.name
                } else {
                    &layout.label
                },
            )?;
            let name = free_name(theme, &label);
            let prefix = format!("{}.", layout.name);
            for def in &mut layout.placeholders {
                let Some(style) = def.style.clone() else {
                    continue;
                };
                let known = theme.text_style(&style).is_some();
                match (style.strip_prefix(&prefix), text_styles.get(&style)) {
                    // Its own look, named for the layout: it takes the new name.
                    (Some(rest), Some(look)) => {
                        let key = format!("{name}.{rest}");
                        theme.text_styles.insert(key.clone(), look.clone());
                        def.style = Some(key);
                    }
                    (Some(_), None) => def.style = Some("body".to_owned()),
                    // A look the theme has is kept; one it lacks comes along, or falls back to the body's.
                    (None, Some(look)) if !known => {
                        theme.text_styles.insert(style, look.clone());
                    }
                    (None, None) if !known => def.style = Some("body".to_owned()),
                    _ => {}
                }
            }
            layout.name = name.clone();
            layout.label = label;
            theme.layouts.push(layout);
            added.push(name);
        }
        Ok(ImportedLayouts { added })
    }
}
