//! The named looks for text. They hold colour tokens and font roles only
//! (`text1`, `heading`), never a hex value or a family, so one table serves
//! every theme and a deck that changes theme restyles its text with it.

use std::collections::BTreeMap;

use crate::model::TextStyle;

fn style(size: f64, color: &str, font: &str) -> TextStyle {
    TextStyle {
        size,
        color: color.to_owned(),
        font: font.to_owned(),
        bold: false,
        italic: false,
        align: None,
        line_spacing: None,
        space_before: None,
        space_after: None,
        extra: crate::model::Extra::new(),
    }
}

/// What a theme chooses about its type: the sizes in points and which looks are bold or italic.
/// The other looks (the caption, the code, the citation) are the same in every theme, and so
/// are the colours and the spacing of lines.
#[derive(Clone, Copy)]
pub(super) struct Type {
    pub title: f64,
    pub title_bold: bool,
    pub display: f64,
    pub display_bold: bool,
    pub subtitle: f64,
    pub body: f64,
    pub big_number: f64,
    pub big_number_bold: bool,
    pub quote: f64,
    pub quote_italic: bool,
}

/// The type of the first four themes.
pub(super) const CLASSIC: Type = Type {
    title: 36.0,
    title_bold: true,
    display: 44.0,
    display_bold: true,
    subtitle: 20.0,
    body: 22.0,
    big_number: 96.0,
    big_number_bold: true,
    quote: 32.0,
    quote_italic: true,
};

/// The nine styles of the first four themes, sizes in points. The first six are the ones every
/// deck can rely on; `display`, `big-number` and `quote` are set for the layouts that carry
/// their names.
pub(super) fn text_styles() -> BTreeMap<String, TextStyle> {
    text_styles_of(&CLASSIC)
}

/// The nine styles, set the way `kind` says.
pub(super) fn text_styles_of(kind: &Type) -> BTreeMap<String, TextStyle> {
    [
        (
            "title",
            TextStyle {
                bold: kind.title_bold,
                ..style(kind.title, "text1", "heading")
            },
        ),
        ("subtitle", style(kind.subtitle, "text2", "body")),
        // Air between lines and paragraphs keeps a list readable from the back of a room.
        (
            "body",
            TextStyle {
                line_spacing: Some(1.15),
                space_after: Some(6.0),
                ..style(kind.body, "text1", "body")
            },
        ),
        ("caption", style(14.0, "text2", "body")),
        ("code", style(16.0, "text1", "code")),
        ("citation", style(10.0, "text2", "body")),
        (
            "display",
            TextStyle {
                bold: kind.display_bold,
                ..style(kind.display, "text1", "heading")
            },
        ),
        (
            "big-number",
            TextStyle {
                bold: kind.big_number_bold,
                ..style(kind.big_number, "accent1", "heading")
            },
        ),
        (
            "quote",
            TextStyle {
                italic: kind.quote_italic,
                ..style(kind.quote, "text1", "heading")
            },
        ),
    ]
    .into_iter()
    .map(|(name, style)| (name.to_owned(), style))
    .collect()
}
