use super::*;
use crate::model::{Paragraph, Run};

fn theme() -> Theme {
    crate::themes::light()
}

#[test]
fn words_that_fit_are_not_shrunk_and_words_that_never_fit_stop_at_half() {
    assert_eq!(largest_scale(|_| true), 1.0);
    assert_eq!(largest_scale(|_| false), MIN_SCALE);
}

#[test]
fn the_largest_scale_that_fits_is_found_in_hundredths() {
    assert_eq!(largest_scale(|s| s <= 0.734), 0.73);
    assert_eq!(largest_scale(|s| s <= 0.5), 0.5);
    assert_eq!(largest_scale(|s| s <= 0.99), 0.99);
    // Never above 1, whatever the test says.
    assert_eq!(largest_scale(|s| s <= 7.0), 1.0);
}

fn long(words: usize) -> Text {
    Text::plain(vec!["lorem ipsum dolor sit amet"; words].join(" "))
}

#[test]
fn a_short_text_keeps_its_size_and_a_long_one_shrinks_until_it_fits() {
    let t = theme();
    assert_eq!(
        estimated_scale(&t, "body", &Text::plain("Hello"), 400.0, 200.0),
        1.0
    );
    let text = long(12);
    let scale = estimated_scale(&t, "body", &text, 400.0, 200.0);
    assert!((MIN_SCALE..1.0).contains(&scale), "{scale}");
    // At that scale it fits the estimate, and a hundredth bigger does not (unless it is already at the floor).
    let room = 200.0 * ESTIMATE_SLACK + 0.5;
    assert!(text_size_scaled(&t, "body", &text, 400.0, scale).height <= room);
    if scale > MIN_SCALE {
        assert!(text_size_scaled(&t, "body", &text, 400.0, scale + 0.01).height > room);
    }
}

#[test]
fn a_bigger_box_never_shrinks_the_type_more() {
    let t = theme();
    let text = long(8);
    let mut last = 0.0;
    for height in [80.0, 120.0, 200.0, 320.0, 480.0] {
        let scale = estimated_scale(&t, "body", &text, 400.0, height);
        assert!(scale >= last, "{height}: {scale} < {last}");
        last = scale;
    }
}

#[test]
fn the_insets_keep_their_size_while_the_words_shrink() {
    let t = theme();
    let text = Text::plain("x");
    let whole = text_size_scaled(&t, "body", &text, 400.0, 1.0).height;
    let half = text_size_scaled(&t, "body", &text, 400.0, 0.5).height;
    let insets = 9.6;
    assert!(
        ((whole - insets) / 2.0 + insets - half).abs() < 0.01,
        "{whole} {half}"
    );
}

#[test]
fn nonsense_boxes_are_left_alone() {
    let t = theme();
    let text = long(3);
    assert_eq!(estimated_scale(&t, "body", &text, 0.0, 100.0), 1.0);
    assert_eq!(estimated_scale(&t, "body", &text, 100.0, f64::NAN), 1.0);
    assert_eq!(
        estimated_scale(&t, "body", &text, f64::INFINITY, 100.0),
        1.0
    );
}

#[test]
fn the_height_a_box_needs_grows_with_its_words_and_with_a_narrower_box() {
    let t = theme();
    let one = needed_height(&t, "body", &Text::plain("Hello"), 400.0);
    let many = needed_height(&t, "body", &long(6), 400.0);
    let narrow = needed_height(&t, "body", &long(6), 200.0);
    assert!(many > one && narrow > many, "{one} {many} {narrow}");
    let two = Text::from_paragraphs(vec![
        Paragraph::plain("a"),
        Paragraph {
            runs: vec![Run::plain("b")],
            ..Paragraph::plain("")
        },
    ]);
    assert!(needed_height(&t, "body", &two, 400.0) > one);
}
