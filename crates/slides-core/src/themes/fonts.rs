//! The typefaces of each theme, and what stands in for one that is missing.

use crate::model::{FontSpec, Fonts};

fn font(family: &str, fallback: &[&str]) -> FontSpec {
    FontSpec {
        family: family.to_owned(),
        fallback: fallback.iter().copied().map(str::to_owned).collect(),
        extra: crate::model::Extra::new(),
    }
}

/// Inter and Roboto Mono are open fonts the editor bundles, so a deck set in
/// them looks the same on every machine. Google Slides offers them too.
pub(super) fn sans() -> Fonts {
    let text = ["Helvetica Neue", "Arial", "sans-serif"];
    Fonts {
        heading: font("Inter", &text),
        body: font("Inter", &text),
        code: font("Roboto Mono", &["Consolas", "monospace"]),
        extra: crate::model::Extra::new(),
    }
}

const SANS_FALLBACK: [&str; 3] = ["Helvetica Neue", "Arial", "sans-serif"];

/// The mono face every theme but the serif ones uses for code.
fn roboto_mono() -> FontSpec {
    font("Roboto Mono", &["Consolas", "monospace"])
}

/// Lato throughout: friendly and light, a Google Slides font the editor bundles.
pub(super) fn lato() -> Fonts {
    Fonts {
        heading: font("Lato", &SANS_FALLBACK),
        body: font("Lato", &SANS_FALLBACK),
        code: roboto_mono(),
        extra: crate::model::Extra::new(),
    }
}

/// Roboto throughout: square and sturdy, set in bold it carries a poster.
pub(super) fn roboto() -> Fonts {
    Fonts {
        heading: font("Roboto", &SANS_FALLBACK),
        body: font("Roboto", &SANS_FALLBACK),
        code: roboto_mono(),
        extra: crate::model::Extra::new(),
    }
}

/// Inter for the headings and Lato for the text under them.
pub(super) fn inter_lato() -> Fonts {
    Fonts {
        heading: font("Inter", &SANS_FALLBACK),
        body: font("Lato", &SANS_FALLBACK),
        code: roboto_mono(),
        extra: crate::model::Extra::new(),
    }
}

/// Roboto for the headings and Lato for the text under them.
pub(super) fn roboto_lato() -> Fonts {
    Fonts {
        heading: font("Roboto", &SANS_FALLBACK),
        body: font("Lato", &SANS_FALLBACK),
        code: roboto_mono(),
        extra: crate::model::Extra::new(),
    }
}

/// Times New Roman for the headings and Arial for the text, the pair a paper is set in. Both are
/// written to PPTX as they are; the open faces that measure the same lead the fallbacks.
pub(super) fn academic() -> Fonts {
    Fonts {
        heading: font(
            "Times New Roman",
            &["Tinos", "Liberation Serif", "Times", "serif"],
        ),
        body: font(
            "Arial",
            &["Arimo", "Liberation Sans", "Helvetica", "sans-serif"],
        ),
        code: font("Courier New", &["Liberation Mono", "monospace"]),
        extra: crate::model::Extra::new(),
    }
}

/// Cambria for the headings and Lato for the text under them.
pub(super) fn paper() -> Fonts {
    Fonts {
        heading: font("Cambria", &["Caladea", "Georgia", "serif"]),
        body: font("Lato", &SANS_FALLBACK),
        code: roboto_mono(),
        extra: crate::model::Extra::new(),
    }
}

/// Cambria, Calibri and Courier New are written to PPTX as they are, so
/// PowerPoint finds them. The open fonts that lead each fallback list measure
/// the same, so lines break in the same places when a deck is drawn without them.
pub(super) fn serif() -> Fonts {
    Fonts {
        heading: font("Cambria", &["Caladea", "Georgia", "serif"]),
        body: font("Calibri", &["Carlito", "Arial", "sans-serif"]),
        code: font("Courier New", &["Liberation Mono", "monospace"]),
        extra: crate::model::Extra::new(),
    }
}
