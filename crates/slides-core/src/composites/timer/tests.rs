use super::*;
use crate::composites::expand as expand_element;
use crate::model::{Base, Extra};

fn timer(seconds: u32, label: Option<&str>, w: f64, h: f64) -> TimerEl {
    TimerEl {
        base: Base::new("t-1").place(100.0, 100.0, w, h),
        seconds,
        label: label.map(str::to_owned),
        autostart: false,
        extra: Extra::new(),
    }
}

fn parts_of(el: TimerEl) -> Vec<Element> {
    expand_element(&crate::themes::light(), "blank", &Element::Timer(el)).unwrap_or_default()
}

fn texts(parts: &[Element]) -> Vec<String> {
    parts
        .iter()
        .filter_map(|p| p.text().map(|t| t.plain_text()))
        .collect()
}

#[test]
fn a_clock_shows_minutes_and_seconds_and_hours_from_an_hour() {
    assert_eq!(clock(0), "00:00");
    assert_eq!(clock(9), "00:09");
    assert_eq!(clock(300), "05:00");
    assert_eq!(clock(754), "12:34");
    assert_eq!(clock(3600), "1:00:00");
    assert_eq!(clock(5025), "1:23:45");
    assert_eq!(clock(u32::MAX), "23:59:59", "a day is the longest");
}

#[test]
fn it_is_said_in_words_for_those_who_cannot_see_it() {
    let mut el = timer(5400, None, 300.0, 150.0);
    assert_eq!(alt_of(&el), "Timer, 1 hour 30 minutes");
    el.seconds = 1;
    el.label = Some("  Questions ".to_owned());
    assert_eq!(alt_of(&el), "Timer, 1 second: Questions");
    el.seconds = 0;
    assert_eq!(alt_of(&el), "Timer, 0 seconds: Questions");
    el.seconds = 125;
    el.label = None;
    assert_eq!(alt_of(&el), "Timer, 2 minutes 5 seconds");
}

#[test]
fn it_is_a_panel_with_the_time_in_big_digits_and_the_words_over_them() {
    let parts = parts_of(timer(300, Some("Discussion"), 400.0, 240.0));
    assert_eq!(parts.len(), 3);
    assert!(matches!(&parts[0], Element::Shape(s) if s.shape == "roundRect"));
    assert_eq!(texts(&parts), ["05:00", "Discussion"]);
    let digits = parts[1].text().expect("the digits");
    let size = digits.paragraphs[0].runs[0].size.expect("a size");
    let words = parts[2].text().expect("the words").paragraphs[0].runs[0]
        .size
        .expect("a size");
    assert!(
        size > 2.0 * words,
        "the digits are much bigger: {size} and {words}"
    );
    assert!(
        digits.paragraphs[0].runs[0].bold
            && digits.paragraphs[0].runs[0].font.as_deref() == Some("code")
    );
    assert!(
        parts[2].base().y.unwrap() < parts[1].base().y.unwrap(),
        "the words are over the digits"
    );
}

#[test]
fn without_words_the_digits_have_the_whole_panel_and_the_numbers_of_the_parts_do_not_move() {
    let with = parts_of(timer(60, Some("x"), 400.0, 240.0));
    let without = parts_of(timer(60, None, 400.0, 240.0));
    assert_eq!(without.len(), 2);
    assert!(without[1].base().h > with[1].base().h);
    assert_eq!(without[1].id(), with[1].id());
}

#[test]
fn the_digits_fit_the_width_of_the_panel_however_long_the_time() {
    for (seconds, w, h) in [
        (5, 300.0, 100.0),
        (3725, 300.0, 100.0),
        (59, 60.0, 400.0),
        (0, 0.0, 0.0),
    ] {
        let parts = parts_of(timer(seconds, None, w, h));
        for p in &parts {
            let (x, y, pw, ph) = p.base().rect().expect("a box");
            assert!(
                x >= 100.0 - 0.011
                    && y >= 100.0 - 0.011
                    && x + pw <= 100.0 + w + 0.011
                    && y + ph <= 100.0 + h + 0.011
            );
        }
    }
    let wide = parts_of(timer(3725, None, 300.0, 300.0));
    let narrow = parts_of(timer(125, None, 300.0, 300.0));
    let size = |parts: &[Element]| parts[1].text().unwrap().paragraphs[0].runs[0].size.unwrap();
    assert!(size(&wide) < size(&narrow), "more digits, smaller type");
}
