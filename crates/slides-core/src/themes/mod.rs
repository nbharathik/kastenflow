//! The built-in themes: Light, Dark, Serif and Lecture, and the seven designed ones, Minimal, Bold,
//! Modern, Academic, Pitch, Dark Studio and Warm Paper.
//!
//! A theme is plain data. A deck copies the one it starts from, so it opens
//! the same wherever it goes and never looks this catalog up again.
//!
//! All of them offer the same twelve layouts under the same names, so a deck can
//! change theme and keep every slide's layout. They differ in colour and type,
//! in the stripes, rules and marks of their master and, in Lecture's case, in a
//! header bar with a logo that pushes content down. Every theme is drawn for a
//! 960 by 540 slide; [`by_name_sized`] refits one to the size of a deck.

mod designs;
mod fonts;
mod layouts;
mod master;
mod palette;
pub mod samples;
mod styles;
#[cfg(test)]
mod tests;

use crate::model::{Colors, Element, Extra, Fonts, Highlight, Layout, Size, Theme};
use crate::resize::{Fit, scale_theme};
use crate::units::{SLIDE_HEIGHT, SLIDE_WIDTH};

const LIGHT: &str = "Light";
const DARK: &str = "Dark";
const SERIF: &str = "Serif";
const LECTURE: &str = "Lecture";
const MINIMAL: &str = "Minimal";
const BOLD: &str = "Bold";
const MODERN: &str = "Modern";
const ACADEMIC: &str = "Academic";
const PITCH: &str = "Pitch";
const DARK_STUDIO: &str = "Dark Studio";
const WARM_PAPER: &str = "Warm Paper";

/// The theme a new deck starts from.
pub const DEFAULT: &str = LIGHT;

/// Builds one of the themes.
type Build = fn() -> Theme;

/// The built-in themes by name, in the order a picker lists them.
const BUILT_IN: [(&str, Build); 11] = [
    (LIGHT, light),
    (DARK, dark),
    (SERIF, serif),
    (LECTURE, lecture),
    (MINIMAL, designs::minimal),
    (BOLD, designs::bold),
    (MODERN, designs::modern),
    (ACADEMIC, designs::academic),
    (PITCH, designs::pitch),
    (DARK_STUDIO, designs::dark_studio),
    (WARM_PAPER, designs::warm_paper),
];

/// White paper, Inter, and the blue, red, yellow and green of Google's own slides.
pub fn light() -> Theme {
    theme(
        LIGHT,
        palette::light(),
        fonts::sans(),
        layouts::twelve(&layouts::PLAIN),
        vec![master::slide_number()],
    )
}

/// The light theme's type and layouts on near-black paper.
pub fn dark() -> Theme {
    theme(
        DARK,
        palette::dark(),
        fonts::sans(),
        layouts::twelve(&layouts::PLAIN),
        vec![master::slide_number()],
    )
}

/// Warm paper and serif headings, set in the fonts PowerPoint ships with.
pub fn serif() -> Theme {
    theme(
        SERIF,
        palette::serif(),
        fonts::serif(),
        layouts::twelve(&layouts::PLAIN),
        vec![master::slide_number()],
    )
}

/// The university look: a grey header bar across the top of every content
/// slide, with the university's logo at its right. The title and section
/// slides go without the bar, the logo and the number.
pub fn lecture() -> Theme {
    let mut layouts = layouts::twelve(&layouts::BARRED);
    for layout in layouts
        .iter_mut()
        .filter(|layout| matches!(layout.name.as_str(), "title" | "section"))
    {
        layout.hide_master = true;
    }
    let master = vec![master::header_bar(), master::logo(), master::slide_number()];
    theme(LECTURE, palette::lecture(), fonts::sans(), layouts, master)
}

/// The built-in themes, in the order a picker lists them.
pub fn all() -> Vec<Theme> {
    BUILT_IN.iter().map(|(_, build)| build()).collect()
}

/// The built-in theme called `name`, whatever the case it is written in.
pub fn by_name(name: &str) -> Option<Theme> {
    BUILT_IN
        .iter()
        .find(|(known, _)| known.eq_ignore_ascii_case(name))
        .map(|(_, build)| build())
}

/// The size of the slide every built-in theme is drawn for.
pub fn drawn_for() -> Size {
    Size {
        w: SLIDE_WIDTH,
        h: SLIDE_HEIGHT,
        extra: Extra::new(),
    }
}

/// The built-in theme called `name`, refitted to slides of `size`: its slots and master shapes
/// stand where they would on a 960 by 540 slide, stretched to the new one, and its type follows
/// the width. On a 960 by 540 slide it is the theme as it is drawn.
pub fn by_name_sized(name: &str, size: &Size) -> Option<Theme> {
    let mut found = by_name(name)?;
    scale_theme(&mut found, &Fit::between(&drawn_for(), size));
    Some(found)
}

/// What the themes share: how a dimmed element looks and the outline of a
/// highlighted one, and the text styles of the first four.
fn theme(
    name: &str,
    colors: Colors,
    fonts: Fonts,
    layouts: Vec<Layout>,
    master: Vec<Element>,
) -> Theme {
    Theme {
        name: name.to_owned(),
        colors,
        fonts,
        text_styles: styles::text_styles(),
        layouts,
        master,
        dimmed_opacity: 0.25,
        highlight: Highlight {
            color: "accent1".to_owned(),
            width: 2.0,
            extra: Extra::new(),
        },
        new_slide_layout: None,
        extra: Extra::new(),
    }
}

/// The names of the twelve layouts every built-in theme offers. A layout a person made never
/// takes one of these names, which is how an editor tells the two apart.
pub const BUILT_IN_LAYOUTS: [&str; 12] = [
    "title",
    "section",
    "title-body",
    "title-only",
    "two-columns",
    "title-image",
    "image-caption",
    "code",
    "comparison",
    "big-number",
    "quote",
    "blank",
];
