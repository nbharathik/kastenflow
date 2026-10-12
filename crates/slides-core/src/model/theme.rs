//! A deck's theme: colours, fonts, text styles, layouts and the master
//! elements every slide shows. Each deck carries its own copy, so a deck
//! opens the same wherever it goes.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Align, Background, Element, Extra, ListKind, VAlign, is_false};

model! {
    /// The twelve colours a theme names. They map one for one to PPTX theme colours.
    #[serde(rename_all = "camelCase")]
    pub struct Colors {
        pub text1: String,
        pub text2: String,
        pub bg1: String,
        pub bg2: String,
        pub accent1: String,
        pub accent2: String,
        pub accent3: String,
        pub accent4: String,
        pub accent5: String,
        pub accent6: String,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A typeface and what to fall back on when it is missing.
    #[serde(rename_all = "camelCase")]
    pub struct FontSpec {
        pub family: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub fallback: Vec<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct Fonts {
        pub heading: FontSpec,
        pub body: FontSpec,
        pub code: FontSpec,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// One of the named looks for text: `title`, `subtitle`, `body`, `caption`, `code`, `citation`.
    #[serde(rename_all = "camelCase")]
    pub struct TextStyle {
        /// Points.
        pub size: f64,
        /// A colour token.
        pub color: String,
        /// `heading`, `body` or `code`.
        pub font: String,
        #[serde(default, skip_serializing_if = "is_false")]
        pub bold: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        pub italic: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub align: Option<Align>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub line_spacing: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub space_before: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub space_after: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub enum PlaceholderKind {
        Text,
        Image,
    }

    /// A slot on a layout that an element can fill.
    #[serde(rename_all = "camelCase")]
    pub struct PlaceholderDef {
        /// `title`, `subtitle`, `body`, `body2`, `image`, `caption`, `code`, `quote`, `number`, `label`, `label2`.
        pub role: String,
        pub kind: PlaceholderKind,
        pub x: f64,
        pub y: f64,
        pub w: f64,
        pub h: f64,
        /// The text style it starts from.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub style: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub valign: Option<VAlign>,
        /// Set as a list when filled.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub list: Option<ListKind>,
        /// What the empty slot asks for, such as "Click to add title".
        pub prompt: String,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct Layout {
        /// The name a slide refers to: `title`, `title-body`, `two-columns`, ...
        pub name: String,
        /// What a person sees: "Title + body".
        pub label: String,
        pub placeholders: Vec<PlaceholderDef>,
        /// Leave out the master elements on slides of this layout.
        #[serde(default, skip_serializing_if = "is_false")]
        pub hide_master: bool,
        /// Shapes, pictures and words drawn on every slide of this layout, under the slide's own
        /// elements and over the master's: the decoration of a layout a person designed. Not
        /// selectable on a slide; changing them changes every slide that uses the layout.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub elements: Vec<Element>,
        /// What fills a slide of this layout behind its elements, when the slide has none of its own.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub background: Option<Background>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The outline drawn around a highlighted element.
    #[serde(rename_all = "camelCase")]
    pub struct Highlight {
        pub color: String,
        pub width: f64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct Theme {
        pub name: String,
        pub colors: Colors,
        pub fonts: Fonts,
        pub text_styles: BTreeMap<String, TextStyle>,
        pub layouts: Vec<Layout>,
        /// Elements drawn on every slide, under its own: a header bar, a logo, a slide number.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub master: Vec<Element>,
        /// Opacity of a dimmed element, 0 to 1.
        pub dimmed_opacity: f64,
        pub highlight: Highlight,
        /// The layout a new slide starts from when the person asked for "my default layout"; the
        /// blank layout when absent or when the deck has no layout of that name.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub new_slide_layout: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl Colors {
    /// The hex value a theme token names.
    pub fn token(&self, name: &str) -> Option<&str> {
        Some(match name {
            "text1" => &self.text1,
            "text2" => &self.text2,
            "bg1" => &self.bg1,
            "bg2" => &self.bg2,
            "accent1" => &self.accent1,
            "accent2" => &self.accent2,
            "accent3" => &self.accent3,
            "accent4" => &self.accent4,
            "accent5" => &self.accent5,
            "accent6" => &self.accent6,
            _ => return None,
        })
    }
}

impl Theme {
    pub fn layout(&self, name: &str) -> Option<&Layout> {
        self.layouts.iter().find(|l| l.name == name)
    }

    pub fn text_style(&self, name: &str) -> Option<&TextStyle> {
        self.text_styles.get(name)
    }

    /// The `#rrggbb` a colour value stands for: a token is looked up, a hex value is kept.
    pub fn resolve_color(&self, value: &str) -> Option<String> {
        if let Some(hex) = self.colors.token(value) {
            return Some(hex.to_owned());
        }
        is_hex(value).then(|| value.to_owned())
    }
}

/// Whether `value` is `#rgb` or `#rrggbb`.
pub fn is_hex(value: &str) -> bool {
    let Some(digits) = value.strip_prefix('#') else {
        return false;
    };
    matches!(digits.len(), 3 | 6) && digits.chars().all(|c| c.is_ascii_hexdigit())
}

/// Whether `value` is a theme token or a hex colour.
pub fn is_color(value: &str) -> bool {
    matches!(
        value,
        "text1"
            | "text2"
            | "bg1"
            | "bg2"
            | "accent1"
            | "accent2"
            | "accent3"
            | "accent4"
            | "accent5"
            | "accent6"
    ) || is_hex(value)
}

impl Layout {
    pub fn placeholder(&self, role: &str) -> Option<&PlaceholderDef> {
        self.placeholders.iter().find(|p| p.role == role)
    }
}
