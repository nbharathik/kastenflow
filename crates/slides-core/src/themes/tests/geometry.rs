//! Where placeholders sit: inside the slide, clear of each other and clear of
//! what the master draws.

use crate::model::PlaceholderDef;
use crate::themes::all;
use crate::units::{SLIDE_HEIGHT, SLIDE_WIDTH};

use super::{each_placeholder, spot};

/// The room every placeholder keeps from every edge of the slide.
const MARGIN: f64 = 24.0;

/// A box: x, y, width and height.
type Rect = (f64, f64, f64, f64);

fn rect(placeholder: &PlaceholderDef) -> Rect {
    (placeholder.x, placeholder.y, placeholder.w, placeholder.h)
}

/// Whether two boxes share area. Boxes that only touch do not.
fn overlap((ax, ay, aw, ah): Rect, (bx, by, bw, bh): Rect) -> bool {
    ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
}

#[test]
fn boxes_that_only_touch_do_not_overlap() {
    let a = (0.0, 0.0, 10.0, 10.0);
    assert!(!overlap(a, (10.0, 0.0, 5.0, 10.0)));
    assert!(!overlap(a, (0.0, 10.0, 10.0, 5.0)));
    assert!(overlap(a, (9.0, 9.0, 5.0, 5.0)));
    assert!(overlap(a, (2.0, 2.0, 1.0, 1.0)));
}

#[test]
fn placeholders_lie_inside_the_slide_with_a_margin_on_every_side() {
    each_placeholder(|theme, layout, placeholder| {
        let at = spot(theme, layout, placeholder);
        assert!(
            placeholder.w > 0.0 && placeholder.h > 0.0,
            "{at} has no area"
        );
        assert!(
            placeholder.x >= MARGIN && placeholder.y >= MARGIN,
            "{at} starts too near the top or left edge"
        );
        let (right, bottom) = (placeholder.x + placeholder.w, placeholder.y + placeholder.h);
        assert!(
            right <= SLIDE_WIDTH - MARGIN && bottom <= SLIDE_HEIGHT - MARGIN,
            "{at} ends too near the bottom or right edge"
        );
    });
}

#[test]
fn the_placeholders_of_a_layout_never_overlap() {
    for theme in all() {
        for layout in &theme.layouts {
            for (i, a) in layout.placeholders.iter().enumerate() {
                for b in layout.placeholders.iter().skip(i + 1) {
                    let names = format!(
                        "{} / {}: {} and {}",
                        theme.name, layout.name, a.role, b.role
                    );
                    assert!(!overlap(rect(a), rect(b)), "{names} overlap");
                }
            }
        }
    }
}

#[test]
fn placeholders_keep_clear_of_the_master_elements_they_share_a_slide_with() {
    for theme in all() {
        for layout in theme.layouts.iter().filter(|layout| !layout.hide_master) {
            for element in &theme.master {
                let Some(under) = element.base().rect() else {
                    continue;
                };
                for placeholder in &layout.placeholders {
                    let names = format!(
                        "{} / {}: {} and {}",
                        theme.name,
                        layout.name,
                        placeholder.role,
                        element.id()
                    );
                    assert!(!overlap(rect(placeholder), under), "{names} overlap");
                }
            }
        }
    }
}

#[test]
fn the_body_of_a_title_and_body_slide_fills_the_room_under_the_title() {
    for theme in all() {
        let layout = theme.layout("title-body").expect("the layout exists");
        let (title, body) = (
            layout.placeholder("title").expect("a title"),
            layout.placeholder("body").expect("a body"),
        );
        assert!(
            body.y >= title.y + title.h,
            "{}: the body starts above the end of the title",
            theme.name
        );
        assert!(
            body.y - (title.y + title.h) <= 24.0,
            "{}: the body starts far below the title",
            theme.name
        );
        assert!(
            body.y + body.h >= 480.0,
            "{}: the body stops well short of the bottom",
            theme.name
        );
        assert_eq!(
            (body.x, body.w),
            (title.x, title.w),
            "{}: the body and title do not line up",
            theme.name
        );
    }
}

/// Slide units in a point, and the height of a line as a multiple of its type size, as the lint measures.
const UNITS_PER_POINT: f64 = 4.0 / 3.0;
const LINE_HEIGHT: f64 = 1.1;

#[test]
fn the_title_box_has_room_for_a_title_that_wraps_to_two_lines() {
    for theme in all() {
        let size = theme.text_styles.get("title").expect("a title style").size;
        let needed = 2.0 * size * UNITS_PER_POINT * LINE_HEIGHT;
        for layout in &theme.layouts {
            let Some(title) = layout.placeholder("title") else {
                continue;
            };
            if title.style.as_deref() != Some("title") {
                continue;
            }
            assert!(
                title.h >= needed,
                "{} / {}: the title box is {} tall and two lines need {needed:.1}",
                theme.name,
                layout.name,
                title.h
            );
        }
    }
}

#[test]
fn a_cover_is_centred_on_the_slide_with_its_subtitle_under_its_title() {
    for theme in all() {
        for name in ["title", "section"] {
            let layout = theme.layout(name).expect("the layout exists");
            let (title, subtitle) = (
                layout.placeholder("title").expect("a title"),
                layout.placeholder("subtitle").expect("a subtitle"),
            );
            assert!(
                subtitle.y >= title.y + title.h,
                "{} / {name}: the subtitle is not under the title",
                theme.name
            );
            let middle = (title.y + subtitle.y + subtitle.h) / 2.0;
            assert!(
                (middle - SLIDE_HEIGHT / 2.0).abs() <= 8.0,
                "{} / {name}: the pair is centred on {middle}",
                theme.name
            );
        }
    }
}

#[test]
fn a_big_number_and_a_quote_are_set_in_the_middle_of_the_room() {
    for theme in all() {
        for (name, first, second) in [
            ("big-number", "number", "label"),
            ("quote", "quote", "caption"),
        ] {
            let layout = theme.layout(name).expect("the layout exists");
            let (first, second) = (
                layout.placeholder(first).expect("a first part"),
                layout.placeholder(second).expect("a second part"),
            );
            assert!(
                second.y >= first.y + first.h,
                "{} / {name}: the second part is not under the first",
                theme.name
            );
            let middle = (first.y + second.y + second.h) / 2.0;
            assert!(
                (256.0..=296.0).contains(&middle),
                "{} / {name}: the block is centred on {middle}",
                theme.name
            );
        }
    }
}
