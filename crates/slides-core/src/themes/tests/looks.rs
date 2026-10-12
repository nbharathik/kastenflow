//! Colours, fonts and text styles: what each theme promises, that it can be
//! read, and that a theme survives being written and read back.

use crate::model::{Highlight, Theme, is_color, is_hex};
use crate::themes::{all, by_name};

/// The names of the ten colours, in the order of `PALETTES`.
const TOKENS: [&str; 10] = [
    "text1", "text2", "bg1", "bg2", "accent1", "accent2", "accent3", "accent4", "accent5",
    "accent6",
];

/// The themes whose type is the classic set below; the designed ones choose their own sizes.
const CLASSIC: [&str; 4] = ["Light", "Dark", "Serif", "Lecture"];

const PALETTES: [(&str, [&str; 10]); 11] = [
    (
        "Light",
        [
            "#202124", "#5f6368", "#ffffff", "#f1f3f4", "#1a73e8", "#ea4335", "#fbbc04", "#34a853",
            "#ff6d01", "#46bdc6",
        ],
    ),
    (
        "Dark",
        [
            "#f1f3f4", "#9aa0a6", "#0f1115", "#1b1f27", "#8ab4f8", "#f28b82", "#fdd663", "#81c995",
            "#fcad70", "#78d9ec",
        ],
    ),
    (
        "Serif",
        [
            "#2b2118", "#6b5d4d", "#fffdf8", "#f3efe6", "#8c2f39", "#1f6f8b", "#c58b1b", "#3f7d4a",
            "#b5541b", "#5b4a8a",
        ],
    ),
    (
        "Lecture",
        [
            "#1f2933", "#52606d", "#ffffff", "#e6e8eb", "#0b5cad", "#c0392b", "#d68910", "#1e8449",
            "#7d3c98", "#148f77",
        ],
    ),
    (
        "Minimal",
        [
            "#111111", "#595959", "#ffffff", "#f3f3f1", "#e4572e", "#2b6f77", "#e0a800", "#5f8f2f",
            "#6c5b7b", "#4a7fa0",
        ],
    ),
    (
        "Bold",
        [
            "#0b0b0f", "#4b4b57", "#ffffff", "#fff1d6", "#e11d48", "#0f172a", "#d97706", "#047857",
            "#6d28d9", "#0369a1",
        ],
    ),
    (
        "Modern",
        [
            "#0f172a", "#475569", "#ffffff", "#eef2f7", "#4f46e5", "#0284c7", "#d97706", "#059669",
            "#db2777", "#7c3aed",
        ],
    ),
    (
        "Academic",
        [
            "#1f2430", "#57525c", "#fbf8f1", "#efe9da", "#7a1f2b", "#1d4e6b", "#8f6a1f", "#3b6e4f",
            "#5b4a8a", "#8a5a44",
        ],
    ),
    (
        "Pitch",
        [
            "#f8fafc", "#aab6cc", "#0b1b3a", "#142a52", "#ffb703", "#3ddc97", "#ff6b6b", "#4cc9f0",
            "#b794f6", "#f4a261",
        ],
    ),
    (
        "Dark Studio",
        [
            "#f4f4f5", "#a1a1aa", "#09090b", "#18181b", "#22d3ee", "#a78bfa", "#fbbf24", "#34d399",
            "#fb7185", "#60a5fa",
        ],
    ),
    (
        "Warm Paper",
        [
            "#3a2e26", "#6b5a4c", "#f6efe0", "#eadfc8", "#b8431f", "#5c7a4a", "#b8791a", "#2f6f73",
            "#7a3b5e", "#4f5d75",
        ],
    ),
];

/// The nine text styles: name, points, colour token, font role, bold, italic.
const STYLES: [(&str, f64, &str, &str, bool, bool); 9] = [
    ("title", 36.0, "text1", "heading", true, false),
    ("subtitle", 20.0, "text2", "body", false, false),
    ("body", 22.0, "text1", "body", false, false),
    ("caption", 14.0, "text2", "body", false, false),
    ("code", 16.0, "text1", "code", false, false),
    ("citation", 10.0, "text2", "body", false, false),
    ("display", 44.0, "text1", "heading", true, false),
    ("big-number", 96.0, "accent1", "heading", true, false),
    ("quote", 32.0, "text1", "heading", false, true),
];

#[test]
fn each_theme_has_the_palette_it_promises() {
    for (name, hexes) in PALETTES {
        let theme = by_name(name).expect("a built-in theme");
        for (token, hex) in TOKENS.into_iter().zip(hexes) {
            assert_eq!(theme.colors.token(token), Some(hex), "{name}: {token}");
        }
    }
}

#[test]
fn every_token_resolves_to_a_six_digit_lowercase_hex_colour() {
    for theme in all() {
        for token in TOKENS {
            let hex = theme
                .colors
                .token(token)
                .unwrap_or_else(|| panic!("{}: `{token}` has no colour", theme.name));
            assert!(
                is_hex(hex) && hex.len() == 7 && hex == hex.to_lowercase(),
                "{}: {token} is `{hex}`",
                theme.name
            );
            assert_eq!(
                theme.resolve_color(token).as_deref(),
                Some(hex),
                "{}: {token}",
                theme.name
            );
        }
    }
}

#[test]
fn the_text_styles_are_the_nine_that_layouts_and_decks_rely_on() {
    for theme in all() {
        let names: Vec<&str> = theme.text_styles.keys().map(String::as_str).collect();
        let mut expected: Vec<&str> = STYLES.iter().map(|style| style.0).collect();
        expected.sort_unstable();
        assert_eq!(names, expected, "{}", theme.name);
        for (name, size, color, font, bold, italic) in STYLES {
            let style = theme
                .text_style(name)
                .unwrap_or_else(|| panic!("{}: no style `{name}`", theme.name));
            let found = (
                style.size,
                style.color.as_str(),
                style.font.as_str(),
                style.bold,
                style.italic,
            );
            if CLASSIC.contains(&theme.name.as_str()) {
                assert_eq!(
                    found,
                    (size, color, font, bold, italic),
                    "{} / {name}",
                    theme.name
                );
            } else {
                // A designed theme sets its own sizes and weights; the colours and the font roles are shared.
                assert_eq!((found.1, found.2), (color, font), "{} / {name}", theme.name);
            }
        }
    }
}

#[test]
fn a_designed_themes_type_keeps_its_order_of_sizes_and_is_big_enough_to_read() {
    for theme in all()
        .into_iter()
        .filter(|t| !CLASSIC.contains(&t.name.as_str()))
    {
        let size = |name: &str| theme.text_style(name).map_or(0.0, |s| s.size);
        let at = |what: &str| format!("{} / {what}", theme.name);
        assert!((32.0..=44.0).contains(&size("title")), "{}", at("title"));
        assert!(
            (44.0..=52.0).contains(&size("display")),
            "{}",
            at("display")
        );
        assert!(
            size("display") > size("title"),
            "{}",
            at("display over title")
        );
        assert!((20.0..=26.0).contains(&size("body")), "{}", at("body"));
        assert!(
            size("subtitle") < size("body") + 1.0 && size("subtitle") >= 20.0,
            "{}",
            at("subtitle")
        );
        assert!(
            size("caption") == 14.0 && size("code") == 16.0,
            "{}",
            at("caption and code")
        );
        assert!(
            (96.0..=128.0).contains(&size("big-number")),
            "{}",
            at("big-number")
        );
        assert!((28.0..=36.0).contains(&size("quote")), "{}", at("quote"));
    }
}

#[test]
fn only_the_body_style_sets_the_spacing_of_lines_and_paragraphs() {
    for theme in all() {
        for (name, style) in &theme.text_styles {
            let spacing = (style.line_spacing, style.space_before, style.space_after);
            let expected = if name == "body" {
                (Some(1.15), None, Some(6.0))
            } else {
                (None, None, None)
            };
            assert_eq!(spacing, expected, "{} / {name}", theme.name);
            assert_eq!(
                style.align, None,
                "{} / {name} sets an alignment",
                theme.name
            );
        }
    }
}

#[test]
fn text_styles_and_the_highlight_name_colour_tokens_not_hex_values() {
    for theme in all() {
        for (name, style) in &theme.text_styles {
            assert!(
                is_color(&style.color) && !is_hex(&style.color),
                "{} / {name} colours itself `{}`",
                theme.name,
                style.color
            );
            assert!(
                matches!(style.font.as_str(), "heading" | "body" | "code"),
                "{} / {name} is set in `{}`",
                theme.name,
                style.font
            );
        }
        let color = &theme.highlight.color;
        assert!(
            is_color(color) && !is_hex(color),
            "{}: the highlight is `{color}`",
            theme.name
        );
    }
}

#[test]
fn every_theme_dims_to_a_quarter_and_highlights_with_a_two_unit_accent_outline() {
    for theme in all() {
        assert_eq!(theme.dimmed_opacity, 0.25, "{}", theme.name);
        assert_eq!(
            theme.highlight,
            Highlight {
                color: "accent1".to_owned(),
                width: 2.0,
                extra: crate::model::Extra::new(),
            },
            "{}",
            theme.name
        );
    }
}

#[test]
fn each_theme_is_set_in_the_fonts_it_promises() {
    for theme in all() {
        let fonts = &theme.fonts;
        let families = (
            fonts.heading.family.as_str(),
            fonts.body.family.as_str(),
            fonts.code.family.as_str(),
        );
        let expected = match theme.name.as_str() {
            "Serif" => ("Cambria", "Calibri", "Courier New"),
            "Minimal" => ("Lato", "Lato", "Roboto Mono"),
            "Bold" => ("Roboto", "Roboto", "Roboto Mono"),
            "Modern" => ("Inter", "Lato", "Roboto Mono"),
            "Academic" => ("Times New Roman", "Arial", "Courier New"),
            "Pitch" => ("Roboto", "Lato", "Roboto Mono"),
            "Warm Paper" => ("Cambria", "Lato", "Roboto Mono"),
            _ => ("Inter", "Inter", "Roboto Mono"),
        };
        assert_eq!(families, expected, "{}", theme.name);
    }
}

#[test]
fn every_family_a_theme_names_is_one_the_editor_bundles_or_that_one_it_does_stands_in_for() {
    for theme in all() {
        let fonts = &theme.fonts;
        for family in [
            &fonts.heading.family,
            &fonts.body.family,
            &fonts.code.family,
        ] {
            assert!(
                crate::lint::BUNDLED
                    .iter()
                    .any(|bundled| bundled.eq_ignore_ascii_case(family)),
                "{} names `{family}`, which nothing draws the same everywhere",
                theme.name
            );
        }
    }
}

#[test]
fn every_font_falls_back_to_a_generic_family_of_its_kind() {
    for theme in all() {
        let fonts = &theme.fonts;
        for (role, font) in [
            ("heading", &fonts.heading),
            ("body", &fonts.body),
            ("code", &fonts.code),
        ] {
            let allowed: &[&str] = if role == "code" {
                &["monospace"]
            } else {
                &["sans-serif", "serif"]
            };
            let last = font.fallback.last().map(String::as_str);
            assert!(
                last.is_some_and(|name| allowed.contains(&name)),
                "{} / {role}: {:?} ends with no generic family",
                theme.name,
                font.fallback
            );
        }
    }
}

#[test]
fn serifs_proprietary_fonts_fall_back_first_to_the_open_ones_that_measure_the_same() {
    let fonts = by_name("Serif").expect("a built-in theme").fonts;
    let first = |font: &crate::model::FontSpec| font.fallback.first().cloned();
    assert_eq!(first(&fonts.heading).as_deref(), Some("Caladea"));
    assert_eq!(first(&fonts.body).as_deref(), Some("Carlito"));
    assert_eq!(first(&fonts.code).as_deref(), Some("Liberation Mono"));
}

#[test]
fn every_theme_survives_a_trip_through_json() {
    for theme in all() {
        let json = serde_json::to_string(&theme).expect("a theme serializes");
        let back: Theme = serde_json::from_str(&json).expect("what was written reads back");
        assert_eq!(back, theme, "{}", theme.name);
    }
}

/// The relative luminance of a `#rrggbb` colour, as WCAG 2 defines it.
fn luminance(hex: &str) -> f64 {
    let channel = |at: usize| {
        let value =
            f64::from(u8::from_str_radix(&hex[at..at + 2], 16).expect("two hex digits")) / 255.0;
        if value <= 0.03928 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/// The WCAG 2 contrast ratio of two colours, from 1 to 21.
fn contrast(a: &str, b: &str) -> f64 {
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

#[test]
fn the_contrast_helper_agrees_with_wcags_own_examples() {
    assert!((contrast("#000000", "#ffffff") - 21.0).abs() < 1e-9);
    assert!((contrast("#777777", "#777777") - 1.0).abs() < 1e-9);
    // #767676 is the lightest grey that reaches 4.5:1 on white.
    assert!(contrast("#767676", "#ffffff") >= 4.5);
    assert!(contrast("#777777", "#ffffff") < 4.5);
}

#[test]
fn text_reads_easily_on_both_backgrounds() {
    for theme in all() {
        let colors = &theme.colors;
        for (ground, hex) in [("bg1", &colors.bg1), ("bg2", &colors.bg2)] {
            let (main, muted) = (contrast(&colors.text1, hex), contrast(&colors.text2, hex));
            assert!(
                main >= 7.0,
                "{}: text1 on {ground} is {main:.2}:1",
                theme.name
            );
            assert!(
                muted >= 4.5,
                "{}: text2 on {ground} is {muted:.2}:1",
                theme.name
            );
        }
    }
}

#[test]
fn every_text_style_is_legible_on_the_background() {
    for theme in all() {
        for (name, style) in &theme.text_styles {
            let hex = theme.colors.token(&style.color).expect("a colour token");
            let ratio = contrast(hex, &theme.colors.bg1);
            // From 24 points up text counts as large, which needs less contrast.
            let needed = if style.size >= 24.0 { 3.0 } else { 4.5 };
            assert!(
                ratio >= needed,
                "{} / {name}: {ratio:.2}:1 on bg1, wanted {needed}:1",
                theme.name
            );
        }
    }
}
