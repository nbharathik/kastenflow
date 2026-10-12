//! The slots a person puts on a layout: what each kind is called, what it starts from and how a
//! role that nothing defines yet is understood.

use crate::model::{ListKind, PlaceholderDef, PlaceholderKind, VAlign};

/// What a slot holds, as a person picks it from a menu.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotKind {
    /// The slide's title, set large.
    Title,
    Subtitle,
    /// A list: what is typed into it becomes bullets.
    Body,
    /// Words in no particular role, without bullets.
    Text,
    Picture,
    Caption,
}

impl SlotKind {
    /// The kind a name stands for: `title`, `subtitle`, `body`, `text`, `picture` or `caption`.
    pub fn parse(name: &str) -> Option<SlotKind> {
        Some(match name {
            "title" => SlotKind::Title,
            "subtitle" => SlotKind::Subtitle,
            "body" => SlotKind::Body,
            "text" => SlotKind::Text,
            "picture" | "image" => SlotKind::Picture,
            "caption" => SlotKind::Caption,
            _ => return None,
        })
    }

    /// The role a first slot of this kind has; later ones are numbered (`body2`, `body3`).
    pub fn role(self) -> &'static str {
        match self {
            SlotKind::Title => "title",
            SlotKind::Subtitle => "subtitle",
            SlotKind::Body => "body",
            SlotKind::Text => "text",
            SlotKind::Picture => "image",
            SlotKind::Caption => "caption",
        }
    }

    /// The kind a role belongs to, ignoring a number after it (`body2` is a body). A role
    /// that is none of these is plain text.
    pub fn of_role(role: &str) -> SlotKind {
        match role.trim_end_matches(|c: char| c.is_ascii_digit()) {
            "title" | "number" => SlotKind::Title,
            "subtitle" | "label" => SlotKind::Subtitle,
            "body" | "code" => SlotKind::Body,
            "image" => SlotKind::Picture,
            "caption" | "quote" => SlotKind::Caption,
            _ => SlotKind::Text,
        }
    }

    /// The text style a slot of this kind starts from.
    pub fn style(self) -> &'static str {
        match self {
            SlotKind::Title => "title",
            SlotKind::Subtitle => "subtitle",
            SlotKind::Body | SlotKind::Text => "body",
            SlotKind::Picture | SlotKind::Caption => "caption",
        }
    }

    fn noun(self) -> &'static str {
        match self {
            SlotKind::Title => "title",
            SlotKind::Subtitle => "subtitle",
            SlotKind::Body | SlotKind::Text => "text",
            SlotKind::Picture => "image",
            SlotKind::Caption => "caption",
        }
    }

    /// What an empty slot of this kind asks for.
    pub fn prompt(self) -> String {
        format!("Click to add {}", self.noun())
    }
}

/// A role of this kind that none of `taken` has: `body`, then `body2`, `body3` ...
pub fn free_role(kind: SlotKind, taken: &[&str]) -> String {
    let base = kind.role();
    if !taken.contains(&base) {
        return base.to_owned();
    }
    (2..)
        .map(|n| format!("{base}{n}"))
        .find(|role| !taken.contains(&role.as_str()))
        .unwrap_or_else(|| base.to_owned())
}

/// A slot of `kind` named `role` in the box `(x, y, w, h)`, as the built-in layouts make theirs.
pub fn slot_def(kind: SlotKind, role: &str, (x, y, w, h): (f64, f64, f64, f64)) -> PlaceholderDef {
    PlaceholderDef {
        role: role.to_owned(),
        kind: match kind {
            SlotKind::Picture => PlaceholderKind::Image,
            _ => PlaceholderKind::Text,
        },
        x,
        y,
        w,
        h,
        style: Some(kind.style().to_owned()),
        valign: Some(match kind {
            SlotKind::Title | SlotKind::Picture => VAlign::Middle,
            _ => VAlign::Top,
        }),
        list: (kind == SlotKind::Body).then_some(ListKind::Bullet),
        prompt: kind.prompt(),
        extra: crate::model::Extra::new(),
    }
}
