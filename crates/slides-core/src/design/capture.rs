//! How a slot is meant to look, read from the words a person set in it. A slot's look is a named
//! text style of the theme, so a layout whose title is orange and centred gets a style of its
//! own, named after the layout and the slot, and its slides follow it.

use crate::model::{Text, TextStyle, Theme};

/// The text style a slot's words are set in, in the theme's own words: the one it starts from,
/// changed by what the first paragraph and its first run say for themselves. None when they say
/// nothing the style does not already say, which is the usual case.
pub(super) fn captured(theme: &Theme, start: &str, text: &Text) -> Option<TextStyle> {
    let mut style = theme
        .text_style(start)
        .or_else(|| theme.text_style("body"))?
        .clone();
    let before = style.clone();
    let paragraph = text
        .paragraphs
        .iter()
        .find(|p| p.runs.iter().any(|r| !r.t.is_empty()))
        .or_else(|| text.paragraphs.first())?;
    if let Some(align) = &paragraph.align {
        style.align = Some(align.clone());
    }
    if let Some(run) = paragraph
        .runs
        .iter()
        .find(|r| !r.t.is_empty())
        .or_else(|| paragraph.runs.first())
    {
        if let Some(size) = run.size {
            style.size = size;
        }
        if let Some(color) = run.color.as_ref().filter(|c| crate::model::is_color(c)) {
            style.color = color.clone();
        }
        style.bold |= run.bold;
        style.italic |= run.italic;
        if let Some(font) = run
            .font
            .as_deref()
            .filter(|f| matches!(*f, "heading" | "body" | "code"))
        {
            style.font = font.to_owned();
        }
    }
    (style != before).then_some(style)
}
