use super::*;
use crate::composites::expand as expand_element;
use crate::model::{Base, Extra};

fn cite(keys: &[&str], format: Option<CitationStyle>, w: f64, h: f64) -> CitationEl {
    CitationEl {
        base: Base::new("e-cite").place(64.0, 480.0, w, h),
        keys: keys.iter().map(|k| (*k).to_owned()).collect(),
        format,
        links: false,
        extra: Extra::new(),
    }
}

fn parts_of(el: CitationEl) -> Vec<Element> {
    let theme = crate::themes::light();
    expand_element(&theme, "blank", &Element::Citation(el)).unwrap_or_default()
}

fn words(el: CitationEl) -> Vec<String> {
    let parts = parts_of(el);
    assert_eq!(parts.len(), 1, "a citation is one text box");
    parts[0]
        .text()
        .expect("text")
        .paragraphs
        .iter()
        .map(|p| p.text())
        .collect()
}

const KEYS: [&str; 3] = ["vaswani2017", "devlin2019", "brown2020"];

#[test]
fn each_format_writes_its_keys_its_own_way() {
    assert_eq!(
        words(cite(&KEYS, Some(CitationStyle::Short), 400.0, 30.0)),
        ["(vaswani2017; devlin2019; brown2020)"]
    );
    assert_eq!(
        words(cite(&KEYS, None, 400.0, 30.0)),
        ["(vaswani2017; devlin2019; brown2020)"],
        "short is the default"
    );
    assert_eq!(
        words(cite(&KEYS, Some(CitationStyle::Numbered), 400.0, 30.0)),
        ["[1][2][3]"]
    );
    assert_eq!(
        words(cite(&KEYS, Some(CitationStyle::Full), 400.0, 120.0)),
        KEYS
    );
    assert_eq!(
        words(cite(&KEYS, Some(CitationStyle::List), 400.0, 120.0)),
        ["[1] vaswani2017", "[2] devlin2019", "[3] brown2020"]
    );
    assert_eq!(
        words(cite(&["a"], Some(CitationStyle::Short), 400.0, 30.0)),
        ["(a)"]
    );
}

#[test]
fn no_keys_is_an_empty_line_and_the_box_is_still_there() {
    let parts = parts_of(cite(&[], None, 400.0, 30.0));
    assert_eq!(parts.len(), 1);
    assert_eq!(
        parts[0].text().map(|t| t.plain_text().trim().to_owned()),
        Some(String::new())
    );
}

#[test]
fn a_citation_is_small_left_and_in_the_citation_style() {
    let parts = parts_of(cite(&KEYS, Some(CitationStyle::List), 400.0, 120.0));
    let text = parts[0].text().expect("text");
    let first = &text.paragraphs[0];
    assert_eq!(first.style.as_deref(), Some("citation"));
    assert_eq!(first.align, None, "left, as the style says");
    assert_eq!(
        first.runs[0].size, None,
        "the theme's citation size stands when it fits"
    );
    assert_eq!(parts[0].base().rect(), Some((64.0, 480.0, 400.0, 120.0)));
}

#[test]
fn a_box_too_small_for_the_theme_size_shrinks_the_type_but_not_below_eight_points() {
    let many: Vec<String> = (0..12).map(|i| format!("reference{i}")).collect();
    let refs: Vec<&str> = many.iter().map(String::as_str).collect();
    let sized = |h: f64| {
        let parts = parts_of(cite(&refs, Some(CitationStyle::Full), 400.0, h));
        parts[0].text().expect("text").paragraphs[0].runs[0].size
    };
    assert_eq!(sized(300.0), None);
    let small = sized(150.0).expect("a smaller size");
    assert!((8.0..10.0).contains(&small), "{small}");
    assert_eq!(sized(20.0), Some(8.0));
}

#[test]
fn a_long_line_wraps_inside_the_box_and_makes_the_type_smaller_if_it_must() {
    let long: Vec<String> = (0..30).map(|i| format!("author{i}year")).collect();
    let refs: Vec<&str> = long.iter().map(String::as_str).collect();
    let parts = parts_of(cite(&refs, Some(CitationStyle::Short), 300.0, 60.0));
    let size = parts[0].text().expect("text").paragraphs[0].runs[0].size;
    assert!(size.is_none_or(|s| s >= 8.0));
}

#[test]
fn a_degenerate_box_gives_finite_numbers() {
    for (w, h) in [(0.0, 0.0), (5.0, 5.0), (1.0e7, 1.0e7)] {
        let p = parts_of(cite(&KEYS, None, w, h));
        let (x, y, pw, ph) = p[0].base().rect().expect("a box");
        assert!([x, y, pw, ph].iter().all(|v| v.is_finite() && *v >= 0.0));
    }
}
