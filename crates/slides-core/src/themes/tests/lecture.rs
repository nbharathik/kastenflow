//! Lecture's header bar, logo and slide number, and the room they take.

use crate::model::{Align, Element, Fill, Theme};
use crate::themes::{all, dark, lecture, light, serif};
use crate::units::SLIDE_WIDTH;

/// The height of the header bar.
const BAR_HEIGHT: f64 = 56.0;

/// The first row content may use under the bar: a little air below it.
const CONTENT_TOP: f64 = 72.0;

fn element<'a>(theme: &'a Theme, id: &str) -> &'a Element {
    theme
        .master
        .iter()
        .find(|element| element.id() == id)
        .unwrap_or_else(|| panic!("{}: no master element `{id}`", theme.name))
}

#[test]
fn lectures_master_holds_the_bar_the_logo_and_the_number_in_that_order() {
    let theme = lecture();
    let ids: Vec<&str> = theme.master.iter().map(Element::id).collect();
    assert_eq!(ids, ["master-bar", "master-logo", "master-number"]);
}

#[test]
fn the_bar_is_a_borderless_rectangle_in_the_second_background_across_the_top() {
    let theme = lecture();
    let Element::Shape(bar) = element(&theme, "master-bar") else {
        panic!("the bar is a shape")
    };
    assert_eq!(bar.shape, "rect");
    assert_eq!(bar.base.rect(), Some((0.0, 0.0, SLIDE_WIDTH, BAR_HEIGHT)));
    let style = bar.base.style.as_ref().expect("the bar has a style");
    assert_eq!(
        style.fill,
        Some(Fill {
            color: "bg2".to_owned(),
            alpha: None,
            extra: crate::model::Extra::new(),
        })
    );
    assert_eq!(style.stroke, None);
}

#[test]
fn the_logo_is_an_empty_image_inside_the_bar_at_its_right_end() {
    let theme = lecture();
    let Element::Image(logo) = element(&theme, "master-logo") else {
        panic!("the logo is an image")
    };
    assert_eq!(logo.src, "", "the theme ships no logo");
    assert_eq!(logo.base.alt.as_deref(), Some("Logo"));
    let (x, y, w, h) = logo.base.rect().expect("the logo has a box");
    assert_eq!((x, y, w, h), (836.0, 8.0, 100.0, 40.0));
    assert!(
        x + w <= SLIDE_WIDTH && y + h <= BAR_HEIGHT,
        "the logo pokes out of the bar"
    );
}

#[test]
fn every_theme_numbers_its_slides_the_same_way_and_the_first_four_in_the_same_place() {
    for theme in all() {
        let Element::Text(number) = element(&theme, "master-number") else {
            panic!("{}: the number is a text box", theme.name)
        };
        let (x, y, w, h) = number.base.rect().expect("the number has a box");
        if ["Light", "Dark", "Serif", "Lecture"].contains(&theme.name.as_str()) {
            assert_eq!((x, y, w, h), (860.0, 500.0, 80.0, 24.0), "{}", theme.name);
        } else {
            // A designed theme may keep the number clear of its own marks, but it stays in the
            // bottom right corner of the slide.
            assert_eq!((w, h), (80.0, 24.0), "{}", theme.name);
            assert!(
                x + w <= SLIDE_WIDTH - 16.0
                    && x >= SLIDE_WIDTH - 200.0
                    && y >= 496.0
                    && y + h <= 540.0,
                "{}: the number is at {x}, {y}",
                theme.name
            );
        }
        let [paragraph] = number.text.paragraphs.as_slice() else {
            panic!("{}: the number is one paragraph", theme.name)
        };
        assert_eq!(paragraph.align, Some(Align::Right), "{}", theme.name);
        assert_eq!(
            paragraph.style.as_deref(),
            Some("caption"),
            "{}",
            theme.name
        );
        let [run] = paragraph.runs.as_slice() else {
            panic!("{}: the number is one run", theme.name)
        };
        assert_eq!(run.t, "‹#›", "{}", theme.name);
        assert_eq!(run.field.as_deref(), Some("slideNumber"), "{}", theme.name);
    }
}

#[test]
fn the_plain_themes_have_only_the_slide_number_in_their_master() {
    for theme in [light(), dark(), serif()] {
        let ids: Vec<&str> = theme.master.iter().map(Element::id).collect();
        assert_eq!(ids, ["master-number"], "{}", theme.name);
        assert!(
            theme.layouts.iter().all(|layout| !layout.hide_master),
            "{} hides its master on some layout",
            theme.name
        );
    }
}

#[test]
fn only_lectures_title_and_section_layouts_hide_the_master() {
    let theme = lecture();
    let hiding: Vec<&str> = theme
        .layouts
        .iter()
        .filter(|layout| layout.hide_master)
        .map(|layout| layout.name.as_str())
        .collect();
    assert_eq!(hiding, ["title", "section"]);
}

#[test]
fn lecture_content_starts_below_the_header_bar() {
    let theme = lecture();
    for layout in theme.layouts.iter().filter(|layout| !layout.hide_master) {
        for placeholder in &layout.placeholders {
            let (name, y) = (&placeholder.role, placeholder.y);
            assert!(
                y >= CONTENT_TOP,
                "{} / {name} starts at {y}, too near the header bar",
                layout.name
            );
        }
    }
}
