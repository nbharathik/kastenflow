//! Which themes there are and what each layout holds.

use std::collections::HashSet;

use crate::model::{ListKind, PlaceholderKind};
use crate::themes::{DEFAULT, all, by_name, light};

use super::{each_placeholder, spot};

/// The twelve layouts in order: name, label, and the roles of their placeholders.
const CATALOG: [(&str, &str, &[&str]); 12] = [
    ("title", "Title", &["title", "subtitle"]),
    ("section", "Section", &["title", "subtitle"]),
    ("title-body", "Title + body", &["title", "body"]),
    ("title-only", "Title only", &["title"]),
    ("two-columns", "Two columns", &["title", "body", "body2"]),
    ("title-image", "Title + image", &["title", "body", "image"]),
    ("image-caption", "Image + caption", &["image", "caption"]),
    ("code", "Code", &["title", "code"]),
    (
        "comparison",
        "Comparison",
        &["title", "label", "label2", "body", "body2"],
    ),
    ("big-number", "Big number", &["number", "label"]),
    ("quote", "Quote", &["quote", "caption"]),
    ("blank", "Blank", &[]),
];

/// Every role a placeholder may have.
const ROLES: [&str; 11] = [
    "title", "subtitle", "body", "body2", "image", "caption", "code", "quote", "number", "label",
    "label2",
];

#[test]
fn all_returns_the_eleven_themes_in_order() {
    let names: Vec<String> = all().into_iter().map(|theme| theme.name).collect();
    assert_eq!(
        names,
        [
            "Light",
            "Dark",
            "Serif",
            "Lecture",
            "Minimal",
            "Bold",
            "Modern",
            "Academic",
            "Pitch",
            "Dark Studio",
            "Warm Paper"
        ]
    );
}

#[test]
fn a_theme_is_found_by_its_name_in_any_case() {
    for (asked, found) in [
        ("Light", "Light"),
        ("light", "Light"),
        ("DARK", "Dark"),
        ("sErIf", "Serif"),
        ("lecture", "Lecture"),
        ("minimal", "Minimal"),
        ("BOLD", "Bold"),
        ("dark studio", "Dark Studio"),
        ("WARM PAPER", "Warm Paper"),
    ] {
        assert_eq!(
            by_name(asked).map(|theme| theme.name).as_deref(),
            Some(found),
            "asked for {asked}"
        );
    }
    assert!(by_name("nope").is_none());
    assert!(by_name("").is_none());
}

#[test]
fn the_default_is_the_light_theme() {
    assert_eq!(DEFAULT, "Light");
    assert_eq!(by_name(DEFAULT), Some(light()));
}

#[test]
fn a_theme_looked_up_by_name_is_the_one_all_lists() {
    for theme in all() {
        assert_eq!(by_name(&theme.name), Some(theme));
    }
}

#[test]
fn every_theme_has_the_twelve_layouts_in_order() {
    let expected: Vec<(&str, &str)> = CATALOG
        .iter()
        .map(|(name, label, _)| (*name, *label))
        .collect();
    for theme in all() {
        let found: Vec<(&str, &str)> = theme
            .layouts
            .iter()
            .map(|layout| (layout.name.as_str(), layout.label.as_str()))
            .collect();
        assert_eq!(found, expected, "{}", theme.name);
        let names: HashSet<&str> = found.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            names.len(),
            found.len(),
            "{} repeats a layout name",
            theme.name
        );
    }
}

#[test]
fn every_layout_holds_its_placeholders_in_order() {
    for theme in all() {
        for (layout, (name, _, roles)) in theme.layouts.iter().zip(CATALOG) {
            let found: Vec<&str> = layout
                .placeholders
                .iter()
                .map(|placeholder| placeholder.role.as_str())
                .collect();
            assert_eq!(found, roles, "{} / {name}", theme.name);
        }
    }
}

#[test]
fn every_placeholder_has_a_known_role_a_style_an_alignment_and_a_prompt() {
    each_placeholder(|theme, layout, placeholder| {
        let at = spot(theme, layout, placeholder);
        assert!(
            ROLES.contains(&placeholder.role.as_str()),
            "{at}: unknown role"
        );
        let style = placeholder
            .style
            .as_deref()
            .unwrap_or_else(|| panic!("{at} has no style"));
        assert!(
            theme.text_style(style).is_some(),
            "{at}: there is no text style `{style}`"
        );
        assert!(
            placeholder.valign.is_some(),
            "{at} has no vertical alignment"
        );
        assert!(
            placeholder.prompt.starts_with("Click to add "),
            "{at}: its prompt is {:?}",
            placeholder.prompt
        );
    });
}

// A body's list setting is the style its words take when they are put in it; a slot that is
// still empty holds a plain paragraph (`ops::tests::empty_slots`), so it shows no bullet.
#[test]
fn only_image_placeholders_are_pictures_and_only_bodies_are_lists() {
    each_placeholder(|theme, layout, placeholder| {
        let at = spot(theme, layout, placeholder);
        assert_eq!(
            placeholder.kind == PlaceholderKind::Image,
            placeholder.role == "image",
            "{at}: its kind and role disagree"
        );
        let is_body = matches!(placeholder.role.as_str(), "body" | "body2");
        assert_eq!(
            placeholder.list,
            is_body.then_some(ListKind::Bullet),
            "{at}"
        );
    });
}

#[test]
fn the_big_layouts_use_the_big_styles() {
    let expected = [
        ("title", "title", "display"),
        ("section", "title", "display"),
        ("title-body", "title", "title"),
        ("code", "code", "code"),
        ("big-number", "number", "big-number"),
        ("quote", "quote", "quote"),
    ];
    for theme in all() {
        for (layout, role, style) in expected {
            let at = format!("{} / {layout} / {role}", theme.name);
            let placeholder = theme
                .layout(layout)
                .and_then(|l| l.placeholder(role))
                .unwrap_or_else(|| panic!("{at} is missing"));
            assert_eq!(placeholder.style.as_deref(), Some(style), "{at}");
        }
    }
}
