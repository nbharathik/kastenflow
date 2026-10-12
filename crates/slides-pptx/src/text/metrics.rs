//! The measurements text is set with. They are the numbers of the editor's own
//! text module (`packages/slides-react/src/text/metrics.ts`), in slide units
//! and points, so a line breaks in the same place in the editor and in the file.

use std::sync::LazyLock;

use slides_core::{Extra, Insets};

/// Space between a box's edge and its text when the text names none.
pub static DEFAULT_INSETS: LazyLock<Insets> = LazyLock::new(|| Insets {
    left: 9.6,
    top: 4.8,
    right: 9.6,
    bottom: 4.8,
    extra: Extra::new(),
});

/// The line height as a multiple of the type size when a paragraph and its style name none.
pub const DEFAULT_LINE_SPACING: f64 = 1.0;

/// Superscript and subscript are set at this share of the type size, and moved by these shares of it (PowerPoint's own).
pub const SCRIPT_RAISE: f64 = 0.30;
pub const SCRIPT_LOWER: f64 = 0.25;
