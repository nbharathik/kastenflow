//! The designed themes and the example slides every template brings.

use std::collections::HashSet;

use crate::lint::{Options, estimate, lint_deck_with};
use crate::model::{Element, Theme, is_color, is_hex};
use crate::ops::{Engine, NewDeck};
use crate::resize::PAGE_SIZES;
use crate::themes::{all, by_name, by_name_sized, drawn_for};
use crate::units::{SLIDE_HEIGHT, SLIDE_WIDTH};

const DESIGNED: [&str; 7] = [
    "Minimal",
    "Bold",
    "Modern",
    "Academic",
    "Pitch",
    "Dark Studio",
    "Warm Paper",
];

fn designed() -> Vec<Theme> {
    DESIGNED
        .iter()
        .map(|name| by_name(name).expect("a designed theme"))
        .collect()
}

#[test]
fn a_designed_themes_master_is_flat_marks_in_theme_colours_with_the_number_on_top() {
    for theme in designed() {
        let (last, marks) = theme.master.split_last().expect("a master");
        assert_eq!(last.id(), "master-number", "{}", theme.name);
        assert!(
            marks.len() >= 2,
            "{} has too little in its master to be a design",
            theme.name
        );
        for mark in marks {
            let at = format!("{} / {}", theme.name, mark.id());
            let Element::Shape(shape) = mark else {
                panic!("{at} is not a shape")
            };
            assert_eq!(shape.shape, "rect", "{at}");
            let style = shape.base.style.as_ref().expect("a style");
            let fill = style
                .fill
                .as_ref()
                .unwrap_or_else(|| panic!("{at} has no fill"));
            assert!(
                is_color(&fill.color) && !is_hex(&fill.color),
                "{at} is `{}`, not a theme colour",
                fill.color
            );
            assert!(
                style.stroke.is_none() && style.shadow.is_none(),
                "{at} is not flat"
            );
            let (x, y, w, h) = shape.base.rect().expect("a box");
            assert!(
                x >= 0.0 && y >= 0.0 && x + w <= SLIDE_WIDTH && y + h <= SLIDE_HEIGHT,
                "{at} is outside the slide"
            );
        }
    }
}

#[test]
fn the_designed_themes_do_not_look_alike() {
    let themes = all();
    let mut looks = HashSet::new();
    for theme in &themes {
        let look = (
            theme.colors.bg1.clone(),
            theme.colors.accent1.clone(),
            theme.fonts.heading.family.clone(),
            theme.fonts.body.family.clone(),
        );
        assert!(
            looks.insert(look),
            "{} looks like another theme",
            theme.name
        );
    }
    // The plain themes (Light, Dark, Serif) share a master of the number alone; the rest each have a master of their own.
    let drawn: Vec<&Theme> = themes
        .iter()
        .filter(|theme| theme.master.len() > 1)
        .collect();
    assert_eq!(
        drawn.len(),
        8,
        "Lecture and the seven designed themes draw something"
    );
    for (i, a) in drawn.iter().enumerate() {
        for b in &drawn[i + 1..] {
            assert_ne!(
                a.master, b.master,
                "{} and {} have the same master",
                a.name, b.name
            );
        }
    }
}

#[test]
fn a_themes_content_starts_where_its_frame_says_and_fills_to_its_bottom() {
    for theme in designed() {
        let layout = theme.layout("title-body").expect("the layout");
        let (title, body) = (
            layout.placeholder("title").expect("a title"),
            layout.placeholder("body").expect("a body"),
        );
        assert!(
            title.w >= 700.0 && body.w >= 700.0,
            "{}: the text column is narrow",
            theme.name
        );
        assert!(
            body.h >= 300.0,
            "{}: the body is only {} tall",
            theme.name,
            body.h
        );
    }
}

#[test]
fn a_theme_refitted_to_its_own_size_is_the_theme_and_to_another_is_a_stretch_of_it() {
    for theme in all() {
        assert_eq!(
            by_name_sized(&theme.name, &drawn_for()),
            Some(theme.clone())
        );
        let mut four_three = drawn_for();
        four_three.h = 720.0;
        let fitted = by_name_sized(&theme.name, &four_three).expect("a theme");
        let (a, b) = (
            theme
                .layout("title-body")
                .unwrap()
                .placeholder("body")
                .unwrap(),
            fitted
                .layout("title-body")
                .unwrap()
                .placeholder("body")
                .unwrap(),
        );
        assert_eq!((b.x, b.w), (a.x, a.w), "{}", theme.name);
        assert!((b.y - a.y * 4.0 / 3.0).abs() < 0.01 && (b.h - a.h * 4.0 / 3.0).abs() < 0.01);
        assert_eq!(
            fitted.text_styles, theme.text_styles,
            "the width did not change"
        );
    }
}

/// What lint says about a template's example slides: nothing, at every size a preset names.
#[test]
fn every_template_lints_clean_with_its_example_slides_at_every_preset_size() {
    for theme in all() {
        for (preset, w, h) in PAGE_SIZES {
            let deck = Engine::create_with(&NewDeck {
                title: "A talk about something",
                theme: &theme.name,
                size: Some((w, h)),
                examples: true,
                seed: 11,
            })
            .expect("a deck")
            .into_deck();
            let measures = estimate::measures(&deck);
            let report = lint_deck_with(
                &deck,
                &Options {
                    measures: Some(&measures),
                    refs: None,
                },
            );
            let found: Vec<String> = report
                .issues
                .iter()
                .map(|i| format!("slide {} {}: {}", i.slide, i.rule, i.message))
                .collect();
            assert!(
                found.is_empty(),
                "{} at {preset} has lint findings: {found:#?}",
                theme.name
            );
        }
    }
}

#[test]
fn the_example_slides_hold_words_in_every_slot_and_a_stand_in_where_a_picture_goes() {
    for theme in all() {
        let deck = Engine::create_with(&NewDeck {
            title: "Deck",
            theme: &theme.name,
            size: None,
            examples: true,
            seed: 2,
        })
        .expect("a deck")
        .into_deck();
        assert_eq!(deck.slides.len(), 7, "{}", theme.name);
        for slide in &deck.slides {
            for element in &slide.elements {
                if element.base().placeholder.is_some() {
                    assert!(
                        !element.text().expect("a text slot").is_blank(),
                        "{} / {}: an empty slot on an example slide",
                        theme.name,
                        slide.layout
                    );
                }
            }
        }
        let picture = &deck.slides[4];
        assert!(
            picture
                .elements
                .iter()
                .any(|e| e.base().name.as_deref() == Some("Picture slot")),
            "{}: no stand-in for a picture",
            theme.name
        );
        assert!(
            picture
                .elements
                .iter()
                .all(|e| e.base().placeholder.as_deref() != Some("image")),
            "{}: an empty picture slot is left on the example slide",
            theme.name
        );
        assert!(deck.slides[0].notes.contains("example slides"));
    }
}
