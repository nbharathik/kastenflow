//! Layouts a person makes and keeps: a layout added, renamed, ordered, copied and deleted. A slide
//! saved as one, a layout designed and a slide's slots put back are in `layouts_design`, and layouts
//! brought from another deck in `layouts_import`, which share the helpers here. A slide follows its
//! layout by what it leaves out: a slot with no box of its own stands where the layout puts it, so
//! changing the layout moves every such slot at once.

use std::collections::HashSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::layout::put_on;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Extra, Layout, Theme};

/// A name for a layout made of its label: lower-case letters and digits, one hyphen between words.
pub(super) fn slug(label: &str) -> String {
    let mut out = String::new();
    for c in label.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_owned()
}

/// A name no layout of the theme has, made of `label`.
pub(super) fn free_name(theme: &Theme, label: &str) -> String {
    let base = match slug(label) {
        s if s.is_empty() => "layout".to_owned(),
        s => s,
    };
    let taken = |name: &str| theme.layouts.iter().any(|l| l.name == name);
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|name| !taken(name))
        .unwrap_or(base)
}

pub(super) fn clean_label(op: &str, label: &str) -> Result<String> {
    let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if label.is_empty() {
        return Err(Error::bad_input(
            op,
            "a layout needs a name people can read",
        ));
    }
    if label.chars().count() > 80 {
        return Err(Error::bad_input(
            op,
            "a layout's name is 80 characters at most",
        ));
    }
    Ok(label)
}

pub(super) fn no_layout(op: &str, theme: &Theme, name: &str) -> Error {
    let names: Vec<&str> = theme.layouts.iter().map(|l| l.name.as_str()).collect();
    Error::bad_input(
        op,
        format!(
            "the theme has no layout `{name}`; it has: {}",
            names.join(", ")
        ),
    )
}

pub(super) fn at_of(op: &str, theme: &Theme, name: &str) -> Result<usize> {
    theme
        .layouts
        .iter()
        .position(|l| l.name == name)
        .ok_or_else(|| no_layout(op, theme, name))
}

fn slides_on(deck: &Deck, name: &str) -> Vec<String> {
    deck.slides
        .iter()
        .filter(|s| s.layout == name)
        .map(|s| s.id.clone())
        .collect()
}

/// Takes away the text styles a layout made for its own slots that no layout uses any more.
pub(super) fn forget_styles(theme: &mut Theme, layout: &str) {
    let prefix = format!("{layout}.");
    let used: HashSet<String> = theme
        .layouts
        .iter()
        .flat_map(|l| l.placeholders.iter().filter_map(|p| p.style.clone()))
        .collect();
    theme
        .text_styles
        .retain(|key, _| !key.starts_with(&prefix) || used.contains(key));
}

/// The scope of an operation that changes the theme and the slides that use the layout `name`.
pub(super) fn theme_and_slides_on(deck: &Deck, name: &str) -> Scope {
    Scope {
        slides: slides_on(deck, name),
        theme: true,
        ..Scope::default()
    }
}

op_types! {
    /// Adds a layout to the deck's theme, empty or as a copy of one it has.
    pub struct AddLayout {
        /// What people call it, such as "Blank (mine)".
        pub label: String,
        /// A layout to copy: its decoration, background and slots.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub from: Option<String>,
    }

    pub struct AddedLayout {
        /// The name slides refer to it by.
        pub layout: String,
    }
}

impl Op for AddLayout {
    type Output = AddedLayout;
    const NAME: &'static str = "add_layout";
    const ABOUT: &'static str = "Add a layout to the deck's theme, empty or as a copy of one it has, at the end of the list. A layout of your own appears with the others when a slide is added or changed.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<AddedLayout> {
        let label = clean_label(Self::NAME, &self.label)?;
        let theme = &mut cx.deck.theme;
        let name = free_name(theme, &label);
        let layout = match &self.from {
            None => Layout {
                name: name.clone(),
                label,
                placeholders: Vec::new(),
                hide_master: false,
                elements: Vec::new(),
                background: None,
                extra: Extra::new(),
            },
            Some(from) => {
                let source = theme
                    .layout(from)
                    .cloned()
                    .ok_or_else(|| no_layout(Self::NAME, theme, from))?;
                let prefix = format!("{}.", source.name);
                let mut copy = Layout {
                    name: name.clone(),
                    label,
                    ..source
                };
                // The looks the original made for its own slots are copied, so the two change apart.
                for def in &mut copy.placeholders {
                    let Some(style) = def.style.clone() else {
                        continue;
                    };
                    let Some(rest) = style.strip_prefix(&prefix) else {
                        continue;
                    };
                    let key = format!("{name}.{rest}");
                    if let Some(look) = theme.text_styles.get(&style).cloned() {
                        theme.text_styles.insert(key.clone(), look);
                        def.style = Some(key);
                    }
                }
                copy
            }
        };
        theme.layouts.push(layout);
        Ok(AddedLayout { layout: name })
    }
}

op_types! {
    /// Renames a layout, hides the master on it, or makes it the one new slides start from.
    pub struct EditLayout {
        pub name: String,
        /// What people call it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub label: Option<String>,
        /// Leave out the theme's master elements (a header bar, a logo, the slide number) on its slides.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub hide_master: Option<bool>,
        /// Make it the layout a new slide starts from (`true`), or stop it being that (`false`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub default_for_new: Option<bool>,
    }
}

impl Op for EditLayout {
    type Output = ();
    const NAME: &'static str = "edit_layout";
    const ABOUT: &'static str = "Rename a layout (its label), hide the theme's master on it, or make it the layout new slides start from. Slides keep using it by its name.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let label = self
            .label
            .as_deref()
            .map(|l| clean_label(Self::NAME, l))
            .transpose()?;
        let theme = &mut cx.deck.theme;
        let at = at_of(Self::NAME, theme, &self.name)?;
        if let Some(label) = label {
            theme.layouts[at].label = label;
        }
        if let Some(hide) = self.hide_master {
            theme.layouts[at].hide_master = hide;
        }
        match self.default_for_new {
            Some(true) => theme.new_slide_layout = Some(self.name.clone()),
            Some(false) if theme.new_slide_layout.as_deref() == Some(self.name.as_str()) => {
                theme.new_slide_layout = None;
            }
            _ => {}
        }
        Ok(())
    }
}

op_types! {
    /// Deletes a layout; the slides that use it move to another.
    pub struct DeleteLayout {
        pub name: String,
        /// The layout the slides that use it go to. Needed when any do.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub move_to: Option<String>,
    }
}

impl Op for DeleteLayout {
    type Output = ();
    const NAME: &'static str = "delete_layout";
    const ABOUT: &'static str = "Delete a layout. The slides that use it move to the layout named in `moveTo` as if their layout had been changed: what they hold stays. A theme keeps at least one layout.";

    fn scope(&self, deck: &Deck) -> Scope {
        theme_and_slides_on(deck, &self.name)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let at = at_of(Self::NAME, theme, &self.name)?;
        if self.move_to.as_deref() == Some(self.name.as_str()) {
            return Err(Error::bad_input(
                Self::NAME,
                "the slides of a layout cannot move to the layout being deleted",
            ));
        }
        if theme.layouts.len() == 1 {
            return Err(Error::refused("A theme keeps at least one layout."));
        }
        let using = slides.iter().filter(|s| s.layout == self.name).count();
        if using > 0 {
            let Some(to) = &self.move_to else {
                return Err(Error::refused(format!(
                    "{using} slide{} use{} the layout `{}`: say which layout {} move to (`moveTo`).",
                    if using == 1 { "" } else { "s" },
                    if using == 1 { "s" } else { "" },
                    self.name,
                    if using == 1 { "it" } else { "they" },
                )));
            };
            let new = theme
                .layout(to)
                .cloned()
                .ok_or_else(|| no_layout(Self::NAME, theme, to))?;
            for slide in slides.iter_mut().filter(|s| s.layout == self.name) {
                put_on(cx.ids, theme, slide, &new);
            }
        }
        theme.layouts.remove(at);
        if theme.new_slide_layout.as_deref() == Some(self.name.as_str()) {
            theme.new_slide_layout = None;
        }
        forget_styles(theme, &self.name);
        Ok(())
    }
}

op_types! {
    /// Moves a layout in the list.
    pub struct MoveLayout {
        pub name: String,
        /// Where it goes, from 0; past the end is the end.
        pub to: usize,
    }
}

impl Op for MoveLayout {
    type Output = ();
    const NAME: &'static str = "move_layout";
    const ABOUT: &'static str = "Move a layout to another place in the theme's list, which is the order menus and pickers show them in.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let theme = &mut cx.deck.theme;
        let at = at_of(Self::NAME, theme, &self.name)?;
        let layout = theme.layouts.remove(at);
        let to = self.to.min(theme.layouts.len());
        theme.layouts.insert(to, layout);
        Ok(())
    }
}
