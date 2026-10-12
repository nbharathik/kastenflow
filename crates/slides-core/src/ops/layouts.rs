//! Layouts a person makes and keeps: a slide saved as one, a layout designed, renamed, ordered,
//! copied, deleted and brought from another deck, and a slide's slots put back where its layout
//! has them. A slide follows its layout by what it leaves out: a slot with no box of its own
//! stands where the layout puts it, so changing the layout moves every such slot at once.

use std::collections::{BTreeMap, HashMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::layout::{add_missing_slots, detach_missing, put_on};
use super::{Cx, Op, Scope, op_types};
use crate::design::{self, Prompts, SlotKind, free_role};
use crate::error::{Error, Result};
use crate::model::{Deck, Element, Extra, Layout, Slide, TextStyle, Theme, is_false};

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

fn clean_label(op: &str, label: &str) -> Result<String> {
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

fn no_layout(op: &str, theme: &Theme, name: &str) -> Error {
    let names: Vec<&str> = theme.layouts.iter().map(|l| l.name.as_str()).collect();
    Error::bad_input(
        op,
        format!(
            "the theme has no layout `{name}`; it has: {}",
            names.join(", ")
        ),
    )
}

fn at_of(op: &str, theme: &Theme, name: &str) -> Result<usize> {
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
fn forget_styles(theme: &mut Theme, layout: &str) {
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
fn theme_and_slides_on(deck: &Deck, name: &str) -> Scope {
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
    /// Saves a slide as a layout of its own.
    pub struct SaveLayout {
        /// The slide to read the layout from.
        pub slide: String,
        /// What people call the layout.
        pub label: String,
        /// Which elements of the slide are slots, by element id: `title`, `subtitle`, `body`, `text`, `picture` or `caption`. Elements that already fill a slot of the slide's layout stay slots; everything else is decoration.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub roles: BTreeMap<String, String>,
        /// Put the slide on the new layout, moving its decoration and background there (on by default).
        #[serde(default = "yes", skip_serializing_if = "is_true")]
        pub use_for_slide: bool,
        /// Make it the layout new slides start from.
        #[serde(default, skip_serializing_if = "is_false")]
        pub new_slide_default: bool,
    }

    pub struct SavedLayout {
        /// The name slides refer to it by.
        pub layout: String,
    }
}

fn yes() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

/// The kinds a person may name, for a message.
const KINDS: &str = "title, subtitle, body, text, picture or caption";

impl Op for SaveLayout {
    type Output = SavedLayout;
    const NAME: &'static str = "save_layout";
    const ABOUT: &'static str = "Save a slide as a layout: the elements named in `roles` become slots (title, subtitle, body, text, picture, caption), the others become decoration drawn behind every slide of the layout, and the slide's background becomes the layout's. The slide goes on the new layout unless `useForSlide` is false.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope {
            slides: vec![self.slide.clone()],
            theme: true,
            ..Scope::default()
        }
    }

    fn run(self, cx: &mut Cx) -> Result<SavedLayout> {
        let label = clean_label(Self::NAME, &self.label)?;
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let current = theme
            .layout(&slide.layout)
            .cloned()
            .ok_or_else(|| no_layout(Self::NAME, theme, &slide.layout))?;

        // The slide as it would be if each element named were already a slot of its kind.
        let mut marked = slide.clone();
        let mut roles: Vec<String> = marked
            .elements
            .iter()
            .filter_map(|e| e.base().placeholder.clone())
            .collect();
        if let Some(id) = self
            .roles
            .keys()
            .find(|id| !marked.elements.iter().any(|e| e.id() == id.as_str()))
        {
            return Err(Error::no_element(&self.slide, id));
        }
        // In the order of the stack, so the slots are numbered the way they are read.
        for element in &mut marked.elements {
            let id = element.id().to_owned();
            let Some(kind) = self.roles.get(&id) else {
                continue;
            };
            let kind = SlotKind::parse(kind).ok_or_else(|| {
                Error::bad_input(
                    Self::NAME,
                    format!("`{kind}` is not a kind of slot; use {KINDS}"),
                )
            })?;
            let fits = match element {
                Element::Text(_) => kind != SlotKind::Picture,
                Element::Image(_) => kind == SlotKind::Picture,
                _ => false,
            };
            if !fits {
                return Err(Error::bad_input(
                    Self::NAME,
                    format!(
                        "element `{id}` cannot be a {} slot: words can be a title, subtitle, body, text or caption, and a picture a picture",
                        kind.role()
                    ),
                ));
            }
            let taken: Vec<&str> = roles.iter().map(String::as_str).collect();
            let role = free_role(kind, &taken);
            roles.push(role.clone());
            element.base_mut().placeholder = Some(role);
            if let Element::Text(t) = element
                && let Some(first) = t.text.paragraphs.first_mut()
            {
                first.style.get_or_insert_with(|| kind.style().to_owned());
            }
        }

        let name = free_name(theme, &label);
        let base = Layout {
            name: name.clone(),
            label,
            ..current
        };
        let read = design::layout_from_slide(theme, &base, &marked, Prompts::Kept);
        theme.text_styles.extend(read.styles);
        let layout = read.layout;
        if self.use_for_slide {
            let slots: HashMap<&str, &str> = read
                .slots
                .iter()
                .map(|(id, role)| (id.as_str(), role.as_str()))
                .collect();
            // What became decoration is the layout's now; what became a slot follows the layout's box.
            slide.elements.retain(|e| slots.contains_key(e.id()));
            for e in &mut slide.elements {
                let b = e.base_mut();
                b.placeholder = slots.get(b.id.as_str()).map(|role| (*role).to_owned());
                (b.x, b.y, b.w, b.h) = (None, None, None, None);
            }
            slide.layout = name.clone();
            slide.background = None;
        }
        theme.layouts.push(layout);
        if self.new_slide_default {
            theme.new_slide_layout = Some(name.clone());
        }
        Ok(SavedLayout { layout: name })
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
    /// Sets a layout from a slide it was designed on.
    pub struct SetLayoutDesign {
        /// The layout to change.
        pub name: String,
        /// The slide it was designed on (the slide `design_deck` made, changed): its elements that fill a slot are the layout's slots and the others its decoration.
        pub design: Slide,
        /// Hide the theme's master on the layout's slides.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub hide_master: Option<bool>,
    }

    pub struct DesignedLayout {
        /// Ids of what filled a slot the layout no longer has: it stays on its slide as a plain element.
        pub detached: Vec<String>,
    }
}

impl Op for SetLayoutDesign {
    type Output = DesignedLayout;
    const NAME: &'static str = "set_layout_design";
    const ABOUT: &'static str = "Replace a layout's decoration, background and slots with those of a slide it was designed on. Slides that use it follow: a slot they leave at the layout's place moves with it, one moved by hand stays, and what filled a slot that is gone stays as a plain element. Nothing is deleted.";

    fn scope(&self, deck: &Deck) -> Scope {
        theme_and_slides_on(deck, &self.name)
    }

    fn run(self, cx: &mut Cx) -> Result<DesignedLayout> {
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let at = at_of(Self::NAME, theme, &self.name)?;
        let base = theme.layouts[at].clone();
        let mut design = self.design;
        design.layout = self.name.clone();
        let read = design::layout_from_slide(theme, &base, &design, Prompts::FromWords);
        let mut layout = read.layout;
        if let Some(hide) = self.hide_master {
            layout.hide_master = hide;
        }
        let mut detached = Vec::new();
        for slide in slides.iter_mut().filter(|s| s.layout == self.name) {
            detached.extend(detach_missing(theme, slide, &layout));
        }
        theme.layouts[at] = layout;
        theme.text_styles.extend(read.styles);
        forget_styles(theme, &self.name);
        Ok(DesignedLayout { detached })
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

op_types! {
    /// Brings layouts from another deck.
    pub struct ImportLayouts {
        pub layouts: Vec<Layout>,
        /// The text styles of the deck they come from that they name and this theme lacks.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub text_styles: BTreeMap<String, TextStyle>,
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
        let theme = &mut cx.deck.theme;
        let mut added = Vec::new();
        for mut layout in self.layouts {
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
                match (style.strip_prefix(&prefix), self.text_styles.get(&style)) {
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

op_types! {
    /// Puts the slots of slides back where their layout has them.
    pub struct ResetSlides {
        pub ids: Vec<String>,
    }

    pub struct ResetDone {
        /// How many slots were put back in place.
        pub reset: usize,
        /// Ids of the empty slots added for slots the slide lacked.
        pub added: Vec<String>,
    }
}

impl Op for ResetSlides {
    type Output = ResetDone;
    const NAME: &'static str = "reset_slides";
    const ABOUT: &'static str = "Reset slides to their layout: each slot that was moved or resized goes back to where the layout puts it, and slots the slide lacks are added empty. The words and everything that is not a slot stay.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slides(self.ids.iter())
    }

    fn run(self, cx: &mut Cx) -> Result<ResetDone> {
        for id in &self.ids {
            cx.deck.slide(id).ok_or_else(|| Error::no_slide(id))?;
        }
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let mut done = ResetDone {
            reset: 0,
            added: Vec::new(),
        };
        for slide in slides.iter_mut().filter(|s| self.ids.contains(&s.id)) {
            let Some(layout) = theme.layout(&slide.layout).cloned() else {
                continue;
            };
            for e in &mut slide.elements {
                let b = e.base_mut();
                let follows = b
                    .placeholder
                    .as_deref()
                    .is_some_and(|r| layout.placeholder(r).is_some());
                if follows && (b.x, b.y, b.w, b.h) != (None, None, None, None) {
                    (b.x, b.y, b.w, b.h) = (None, None, None, None);
                    done.reset += 1;
                }
            }
            done.added.extend(add_missing_slots(cx.ids, slide, &layout));
        }
        Ok(done)
    }
}
