use super::*;
use crate::composites::expand as expand_element;
use crate::model::{Base, Extra};

fn embed(url: &str, poster: Option<&str>, title: Option<&str>, w: f64, h: f64) -> EmbedEl {
    EmbedEl {
        base: Base::new("e-web").place(100.0, 120.0, w, h),
        url: url.to_owned(),
        poster: poster.map(str::to_owned),
        title: title.map(str::to_owned),
        design: None,
        zoom: None,
        fit: None,
        reader: false,
        extra: Extra::new(),
    }
}

/// An embedded page of the host: no address, and the page it shows in the source.
fn page(markdown: Option<&str>, poster: Option<&str>, w: f64, h: f64) -> EmbedEl {
    let mut source =
        crate::model::PageSource::new("library/q3 plan.md", crate::model::SourceKind::Embed);
    source.title = Some("Q3 plan".to_owned());
    source.icon = Some("\u{1f4cb}".to_owned());
    source.markdown = markdown.map(str::to_owned);
    let mut el = embed("", poster, None, w, h);
    el.base.source = Some(source);
    el
}

fn parts_of(el: EmbedEl) -> Vec<Element> {
    let theme = crate::themes::light();
    expand_element(&theme, "blank", &Element::Embed(el)).unwrap_or_default()
}

fn texts(parts: &[Element]) -> Vec<String> {
    parts
        .iter()
        .filter_map(|p| p.text().map(|t| t.plain_text()))
        .collect()
}

#[test]
fn a_poster_is_the_picture_filling_the_box_with_rounded_corners() {
    let parts = parts_of(embed(
        "https://example.com/demo",
        Some("assets/poster.png"),
        Some("The demo"),
        480.0,
        270.0,
    ));
    assert_eq!(parts.len(), 1);
    let Element::Image(picture) = &parts[0] else {
        panic!("a picture")
    };
    assert_eq!(picture.src, "assets/poster.png");
    assert_eq!(picture.base.rect(), Some((100.0, 120.0, 480.0, 270.0)));
    assert_eq!(picture.mask, Some(crate::model::Mask::RoundRect));
    assert_eq!(
        picture.base.style.as_ref().and_then(|s| s.radius),
        Some(12.0)
    );
    assert_eq!(
        picture.base.link.as_deref(),
        Some("https://example.com/demo")
    );
    assert_eq!(picture.base.alt.as_deref(), Some("Web page: The demo"));
}

#[test]
fn without_a_poster_a_dashed_panel_says_what_the_page_is() {
    let parts = parts_of(embed(
        "https://www.example.com/docs/intro?x=1",
        None,
        None,
        480.0,
        270.0,
    ));
    let Element::Shape(panel) = &parts[0] else {
        panic!("a panel")
    };
    assert_eq!(panel.shape, "roundRect");
    let style = panel.base.style.as_ref().expect("a style");
    assert_eq!(style.fill.as_ref().map(|f| f.color.as_str()), Some("bg2"));
    let stroke = style.stroke.as_ref().expect("an outline");
    assert_eq!(
        (stroke.color.as_str(), stroke.dash.is_some()),
        ("text2", true)
    );
    assert_eq!(style.radius, Some(12.0));
    let all = texts(&parts);
    assert_eq!(
        all,
        ["example.com", "https://www.example.com/docs/intro?x=1"],
        "the site's name, then the address"
    );
    let address = parts.last().and_then(|p| p.text()).expect("text");
    assert_eq!(address.paragraphs[0].runs[0].font.as_deref(), Some("code"));
    // A title is used in place of the site's name.
    let titled = parts_of(embed(
        "https://example.com",
        None,
        Some("  My demo "),
        480.0,
        270.0,
    ));
    assert_eq!(texts(&titled)[0], "My demo");
}

#[test]
fn every_part_carries_the_address_and_the_first_carries_the_words() {
    let parts = parts_of(embed("https://example.com/demo", None, None, 480.0, 270.0));
    assert!(parts.len() >= 3);
    assert!(
        parts
            .iter()
            .all(|p| p.base().link.as_deref() == Some("https://example.com/demo"))
    );
    assert_eq!(
        parts[0].base().alt.as_deref(),
        Some("Web page: https://example.com/demo")
    );
    assert!(parts[1..].iter().all(|p| p.base().alt.is_none()));
}

#[test]
fn an_address_that_could_run_a_script_or_read_a_file_is_shown_but_not_linked() {
    for url in [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,hi",
    ] {
        let parts = parts_of(embed(url, None, None, 480.0, 270.0));
        assert!(parts.iter().all(|p| p.base().link.is_none()), "{url}");
        assert!(
            texts(&parts).iter().any(|t| t == url),
            "the address still shows: {url}"
        );
    }
}

#[test]
fn the_globe_needs_room_and_keeps_the_numbers_of_the_other_parts() {
    let big = parts_of(embed("https://example.com", None, None, 480.0, 270.0));
    let small = parts_of(embed("https://example.com", None, None, 300.0, 90.0));
    assert_eq!(
        big.len(),
        6,
        "panel, three parts of the globe, title, address"
    );
    assert_eq!(small.len(), 3, "panel, title, address");
    assert_eq!(
        big.last().map(|p| p.id().to_owned()),
        small.last().map(|p| p.id().to_owned()),
        "the address keeps its number"
    );
}

#[test]
fn a_long_address_is_cut_in_the_middle_to_two_lines() {
    let url = format!("https://example.com/{}", "segment/".repeat(60));
    let parts = parts_of(embed(&url, None, None, 300.0, 200.0));
    let shown = texts(&parts).pop().expect("an address");
    assert!(shown.contains('\u{2026}') && shown.len() < url.len());
    assert!(shown.starts_with("https://example.com/") && shown.ends_with("segment/"));
}

#[test]
fn the_words_fit_the_panel_by_the_estimate_and_the_parts_stay_inside_it() {
    for (w, h) in [
        (480.0, 270.0),
        (300.0, 100.0),
        (200.0, 60.0),
        (0.0, 0.0),
        (10.0, 400.0),
    ] {
        for p in parts_of(embed(
            "https://example.com/a/very/long/path/to/some/page.html",
            None,
            Some("A rather long title for the embedded page"),
            w,
            h,
        )) {
            let (x, y, pw, ph) = p.base().rect().expect("a box");
            assert!(
                x >= 100.0 - 0.011
                    && y >= 120.0 - 0.011
                    && x + pw <= 100.0 + w + 0.011
                    && y + ph <= 120.0 + h + 0.011
                    && [x, y, pw, ph].iter().all(|v| v.is_finite()),
                "{w}x{h}"
            );
        }
    }
}

/// The size, in points, of every run of words in the parts.
fn sizes(parts: &[Element]) -> Vec<f64> {
    parts
        .iter()
        .filter_map(Element::text)
        .flat_map(|t| t.paragraphs.iter())
        .flat_map(|p| p.runs.iter())
        .filter_map(|r| r.size)
        .collect()
}

#[test]
fn the_poster_says_it_fills_the_box_so_that_a_still_of_another_shape_is_not_stretched() {
    let parts = parts_of(embed(
        "https://example.com/demo",
        Some("assets/poster.png"),
        None,
        480.0,
        270.0,
    ));
    let Element::Image(picture) = &parts[0] else {
        panic!("a picture")
    };
    assert!(picture.covers());
}

#[test]
fn without_a_poster_no_word_is_below_14_points_where_the_panel_has_room() {
    let long = format!("https://example.com/{}", "segment/".repeat(12));
    for (w, h) in [
        (640.0, 360.0),
        (480.0, 270.0),
        (400.0, 220.0),
        (300.0, 200.0),
    ] {
        for url in [
            "https://example.com",
            "https://www.example.com/docs/intro?x=1",
            &long,
        ] {
            let all = sizes(&parts_of(embed(url, None, None, w, h)));
            assert!(
                all.len() == 2 && all.iter().all(|s| *s >= 14.0),
                "{w}x{h} {url}: {all:?}"
            );
        }
    }
}

#[test]
fn a_page_of_the_host_is_a_card_with_its_name_over_a_line_and_its_words_under_it() {
    let parts = parts_of(page(
        Some("## Plan\n\nOne **idea** per card.\n\n- first\n- second\n"),
        None,
        480.0,
        270.0,
    ));
    let Element::Shape(card) = &parts[0] else {
        panic!("a card")
    };
    assert_eq!(card.shape, "roundRect");
    assert_eq!(
        card.base
            .style
            .as_ref()
            .and_then(|s| s.fill.as_ref())
            .map(|f| f.color.as_str()),
        Some("bg1")
    );
    assert!(
        matches!(&parts[2], Element::Line(_)),
        "the line under the name"
    );
    let all = texts(&parts);
    assert_eq!(all[0], "\u{1f4cb} Q3 plan", "the icon and the title");
    assert!(
        all[1].contains("One idea per card.") && all[1].contains("first"),
        "{all:?}"
    );
    let words = parts.last().and_then(|p| p.text()).expect("words");
    assert_eq!(words.fit, Some(crate::model::TextFit::Shrink));
    assert!(!words.paragraphs.is_empty());
}

#[test]
fn a_page_card_links_to_the_page_and_says_what_it_is() {
    let parts = parts_of(page(Some("Words."), None, 480.0, 270.0));
    assert!(
        parts
            .iter()
            .all(|p| p.base().link.as_deref() == Some("page:library/q3%20plan.md"))
    );
    assert_eq!(parts[0].base().alt.as_deref(), Some("Page: Q3 plan"));
    let mut section = page(Some("Words."), None, 480.0, 270.0);
    if let Some(source) = section.base.source.as_mut() {
        source.section = Some("Risks and more".to_owned());
    }
    let parts = parts_of(section);
    assert_eq!(
        parts[0].base().link.as_deref(),
        Some("page:library/q3%20plan.md#Risks%20and%20more")
    );
}

#[test]
fn a_page_with_a_poster_is_the_picture_and_a_page_with_no_words_is_a_name_alone() {
    let parts = parts_of(page(Some("Words."), Some("assets/page.png"), 480.0, 270.0));
    assert_eq!(parts.len(), 1);
    assert!(matches!(&parts[0], Element::Image(p) if p.src == "assets/page.png" && p.covers()));
    let bare = parts_of(page(None, None, 480.0, 270.0));
    assert_eq!(texts(&bare), ["\u{1f4cb} Q3 plan"]);
    assert_eq!(bare.len(), 3, "the card, the name and the line");
}

#[test]
fn a_page_card_stays_inside_its_box_however_small() {
    for (w, h) in [(480.0, 270.0), (200.0, 60.0), (30.0, 400.0), (0.0, 0.0)] {
        for p in parts_of(page(
            Some("## A\n\nwords words words\n\n- one\n- two\n"),
            None,
            w,
            h,
        )) {
            let (x, y, pw, ph) = p.base().rect().expect("a box");
            assert!(
                x >= 100.0 - 0.011
                    && y >= 120.0 - 0.011
                    && x + pw <= 100.0 + w + 0.011
                    && y + ph <= 120.0 + h + 0.011,
                "{w}x{h}"
            );
        }
    }
}

#[test]
fn the_window_zoom_and_fit_of_a_web_page_are_kept_and_change_nothing_about_how_it_is_drawn() {
    let plain = parts_of(embed("https://example.com", None, None, 480.0, 270.0));
    let mut set = embed("https://example.com", None, None, 480.0, 270.0);
    set.design = Some(crate::model::Viewport {
        w: 390.0,
        h: 844.0,
        extra: Extra::new(),
    });
    set.zoom = Some(0.5);
    set.fit = Some(crate::model::EmbedFit::Fill);
    set.reader = true;
    assert_eq!(parts_of(set.clone()), plain);
    let text = serde_json::to_string(&Element::Embed(set)).expect("json");
    assert!(
        text.contains("\"design\":{\"w\":390.0,\"h\":844.0}"),
        "{text}"
    );
    assert!(
        text.contains("\"zoom\":0.5")
            && text.contains("\"fit\":\"fill\"")
            && text.contains("\"reader\":true")
    );
    let bare = serde_json::to_string(&Element::Embed(embed(
        "https://example.com",
        None,
        None,
        1.0,
        1.0,
    )))
    .expect("json");
    assert!(
        !bare.contains("design")
            && !bare.contains("zoom")
            && !bare.contains("reader")
            && !bare.contains("fit"),
        "{bare}"
    );
}

#[test]
fn a_panel_with_no_room_for_14_points_sets_the_words_smaller_and_they_still_fit() {
    let parts = parts_of(embed(
        "https://www.example.com/docs/intro?x=1",
        None,
        None,
        260.0,
        80.0,
    ));
    let all = sizes(&parts);
    assert!(all.iter().any(|s| *s < 14.0), "{all:?}");
    assert!(all.iter().all(|s| *s >= 9.0), "{all:?}");
}
