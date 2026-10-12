//! Checks on the built-in themes.

mod catalog;
mod designs;
mod geometry;
mod lecture;
mod looks;

use crate::model::{Layout, PlaceholderDef, Theme};
use crate::themes::all;

/// Runs `check` on every placeholder of every layout of every theme.
fn each_placeholder(mut check: impl FnMut(&Theme, &Layout, &PlaceholderDef)) {
    for theme in all() {
        for layout in &theme.layouts {
            for placeholder in &layout.placeholders {
                check(&theme, layout, placeholder);
            }
        }
    }
}

/// Names a placeholder in a failure message.
fn spot(theme: &Theme, layout: &Layout, placeholder: &PlaceholderDef) -> String {
    format!("{} / {} / {}", theme.name, layout.name, placeholder.role)
}
