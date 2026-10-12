use super::*;
use crate::model::{Element, ListKind, ListStyle, TextFit};
use crate::resolve::Rect;

const AREA: Rect = Rect {
    x: 64.0,
    y: 148.0,
    w: 832.0,
    h: 344.0,
};

fn rect(e: &Element) -> (f64, f64, f64, f64) {
    e.base().rect().expect("a box")
}

#[test]
fn words_alone_are_one_text_box_that_shrinks_to_fit() {
    let made = contents(
        &blocks("## Plan\n\nOne **idea**.\n\n- a\n  - b\n1. n\n"),
        AREA,
        &Sizes::new(),
    );
    assert_eq!(made.len(), 1);
    assert_eq!(rect(&made[0]), (64.0, 148.0, 832.0, 344.0));
    let Element::Text(text) = &made[0] else {
        panic!("text")
    };
    assert_eq!(text.text.fit, Some(TextFit::Shrink));
    let paragraphs = &text.text.paragraphs;
    assert_eq!(paragraphs.len(), 5);
    assert_eq!(
        paragraphs[0].style.as_deref(),
        Some("subtitle"),
        "the shallowest heading"
    );
    assert!(paragraphs[1].list.is_none());
    assert_eq!(
        (paragraphs[2].list.clone(), paragraphs[2].level),
        (Some(ListKind::Bullet), None)
    );
    assert_eq!(paragraphs[3].level, Some(1));
    assert_eq!(paragraphs[4].list, Some(ListKind::Number));
}

#[test]
fn deeper_headings_are_bold_words_in_the_body_style() {
    let made = contents(
        &blocks("# Top\n\n## Under\n\nWords.\n"),
        AREA,
        &Sizes::new(),
    );
    let Element::Text(text) = &made[0] else {
        panic!("text")
    };
    assert_eq!(text.text.paragraphs[0].style.as_deref(), Some("subtitle"));
    assert_eq!(text.text.paragraphs[1].style.as_deref(), Some("body"));
    assert!(text.text.paragraphs[1].runs.iter().all(|r| r.bold));
}

#[test]
fn to_dos_get_a_ring_or_a_tick_for_a_bullet() {
    let made = contents(&blocks("- [ ] one\n- [x] two\n"), AREA, &Sizes::new());
    let Element::Text(text) = &made[0] else {
        panic!("text")
    };
    assert_eq!(text.text.paragraphs[0].list_style, Some(ListStyle::Circle));
    assert_eq!(text.text.paragraphs[1].list_style, Some(ListStyle::Check));
}

#[test]
fn pictures_go_beside_the_words_on_a_wide_place_and_keep_their_shape() {
    let mut sizes = Sizes::new();
    sizes.insert("assets/cat.png".to_owned(), (800.0, 400.0));
    let made = contents(
        &blocks("Some words.\n\n![A cat](assets/cat.png)\n"),
        AREA,
        &sizes,
    );
    assert_eq!(made.len(), 2);
    let (tx, _, tw, _) = rect(&made[0]);
    let (ix, _, iw, ih) = rect(&made[1]);
    assert!(tx + tw < ix, "the words are left of the picture");
    assert!((iw / ih - 2.0).abs() < 1e-6, "{iw} by {ih}");
    assert!(ix >= AREA.x && ix + iw <= AREA.x + AREA.w + 1e-6);
    let Element::Image(picture) = &made[1] else {
        panic!("a picture")
    };
    assert_eq!(
        (picture.src.as_str(), picture.base.alt.as_deref()),
        ("assets/cat.png", Some("A cat"))
    );
}

#[test]
fn on_a_tall_place_the_pictures_go_under_the_words() {
    let tall = Rect {
        x: 0.0,
        y: 0.0,
        w: 300.0,
        h: 500.0,
    };
    let made = contents(&blocks("Words.\n\n![x](a.png)\n"), tall, &Sizes::new());
    let (_, ty, _, th) = rect(&made[0]);
    let (_, iy, _, _) = rect(&made[1]);
    assert!(ty + th <= iy);
}

#[test]
fn what_is_stacked_is_made_smaller_together_until_it_fits_and_stays_inside_the_place() {
    let found = blocks("![a](a.png)\n\n![b](b.png)\n\n![c](c.png)\n");
    let made = contents(&found, AREA, &Sizes::new());
    assert_eq!(made.len(), 3);
    for e in &made {
        let (x, y, w, h) = rect(e);
        assert!(
            x >= AREA.x - 1e-6
                && y >= AREA.y - 1e-6
                && x + w <= AREA.x + AREA.w + 1e-6
                && y + h <= AREA.y + AREA.h + 1e-6,
            "{x} {y} {w} {h}"
        );
    }
    let tops: Vec<f64> = made.iter().map(|e| rect(e).1).collect();
    assert!(
        tops.windows(2).all(|p| p[0] < p[1]),
        "in reading order from the top"
    );
}

#[test]
fn tables_code_and_formulas_become_their_own_elements() {
    let made = contents(
        &blocks("| a | b |\n|---|---|\n| 1 | 2 |\n\n```py\nprint(1)\n```\n\n$$x$$\n"),
        AREA,
        &Sizes::new(),
    );
    assert_eq!(made.len(), 3);
    let Element::Table(table) = &made[0] else {
        panic!("a table")
    };
    assert_eq!(
        (table.rows.len(), table.columns.len(), table.header_row),
        (2, 2, true)
    );
    let Element::Code(code) = &made[1] else {
        panic!("code")
    };
    assert_eq!(
        (code.language.as_str(), code.code.as_str()),
        ("py", "print(1)")
    );
    assert!(matches!(&made[2], Element::Math(m) if m.latex == "x"));
}

#[test]
fn nothing_on_a_page_makes_nothing() {
    assert!(contents(&blocks("---\ntitle: T\n---\n"), AREA, &Sizes::new()).is_empty());
    assert!(contents(&blocks("---\n"), AREA, &Sizes::new()).is_empty());
}

#[test]
fn a_page_is_cut_at_the_level_that_has_several_sections() {
    let found = blocks("# Title\n\nIntro words.\n\n## A\n\none\n\n## B\n\ntwo\n\n### B1\n\ndeep\n");
    let slides = parts(&found, 0, "The page");
    let titles: Vec<String> = slides.iter().map(|p| plain(&p.title)).collect();
    assert_eq!(titles, ["Title", "A", "B"]);
    assert_eq!(slides[0].blocks.len(), 1, "the words under the title");
    assert_eq!(slides[2].blocks.len(), 3, "B1 and its words are B's");
    // Asked to cut at the top level, it is one slide.
    assert_eq!(parts(&found, 1, "The page").len(), 1);
    assert_eq!(
        parts(&found, 3, "The page").len(),
        4,
        "Title, A, B and B1 begin one each"
    );
}

#[test]
fn words_before_the_first_heading_go_on_a_slide_named_after_the_page() {
    let found = blocks("Before anything.\n\n## A\n\none\n\n## B\n\ntwo\n");
    let slides = parts(&found, 0, "The page");
    let titles: Vec<String> = slides.iter().map(|p| plain(&p.title)).collect();
    assert_eq!(titles, ["The page", "A", "B"]);
    // A page with no heading at all is one slide, and an empty page is none.
    assert_eq!(parts(&blocks("Just words.\n"), 0, "The page").len(), 1);
    assert!(parts(&blocks("---\n"), 0, "The page").is_empty());
}
