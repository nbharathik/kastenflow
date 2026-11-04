use super::*;
use crate::composites::expand as expand_element;
use crate::model::{Base, Extra};

fn video(src: &str, poster: Option<&str>, w: f64, h: f64) -> VideoEl {
    VideoEl {
        base: Base::new("e-vid").place(100.0, 120.0, w, h),
        src: src.to_owned(),
        poster: poster.map(str::to_owned),
        autoplay: false,
        looped: false,
        start: None,
        end: None,
        captions: None,
        volume: None,
        extra: Extra::new(),
    }
}

#[test]
fn a_video_keeps_its_volume_and_captions_and_reads_old_files_the_same() {
    let value = serde_json::json!({
        "type": "video", "id": "v-vol", "x": 0.0, "y": 0.0, "w": 640.0, "h": 360.0,
        "src": "assets/clip.mp4", "poster": "assets/clip-poster.png", "volume": 0.25,
        "captions": "assets/clip.vtt", "start": 2.5, "end": 9.0,
    });
    let Element::Video(el) = serde_json::from_value(value.clone()).expect("a video") else {
        panic!("a video")
    };
    assert_eq!(el.volume, Some(0.25));
    assert_eq!(
        serde_json::to_value(Element::Video(el)).expect("json"),
        value
    );
    let plain = parts_of(video("assets/clip.mp4", None, 480.0, 270.0));
    assert_eq!(plain.len(), 4, "volume changes nothing that is drawn");
}

#[test]
fn a_video_with_no_start_or_end_reads_the_same_and_a_web_source_is_kept() {
    let old = serde_json::json!({
        "type": "video", "id": "v-old", "x": 0.0, "y": 0.0, "w": 640.0, "h": 360.0,
        "src": "assets/clip.mp4", "autoplay": true,
    });
    let Element::Video(el) = serde_json::from_value(old.clone()).expect("a video") else {
        panic!("a video")
    };
    assert_eq!((el.start, el.end), (None, None));
    assert_eq!(serde_json::to_value(Element::Video(el)).expect("json"), old);

    let new = serde_json::json!({
        "type": "video", "id": "v-new", "x": 0.0, "y": 0.0, "w": 640.0, "h": 360.0,
        "src": "https://example.com/media/talk.mp4", "start": 12.0, "end": 60.0,
        "futureField": true,
    });
    let Element::Video(el) = serde_json::from_value(new.clone()).expect("a video") else {
        panic!("a video")
    };
    assert_eq!(el.src, "https://example.com/media/talk.mp4");
    assert_eq!((el.start, el.end), (Some(12.0), Some(60.0)));
    assert_eq!(link_of(&el), Some("https://example.com/media/talk.mp4"));
    assert_eq!(serde_json::to_value(Element::Video(el)).expect("json"), new);
}

fn parts_of(el: VideoEl) -> Vec<Element> {
    let theme = crate::themes::light();
    expand_element(&theme, "blank", &Element::Video(el)).unwrap_or_default()
}

#[test]
fn a_poster_fills_the_box_and_a_play_button_sits_in_the_middle() {
    let parts = parts_of(video(
        "assets/clip.mp4",
        Some("assets/still.png"),
        480.0,
        270.0,
    ));
    assert_eq!(parts.len(), 3);
    let Element::Image(still) = &parts[0] else {
        panic!("the poster")
    };
    assert_eq!(
        (still.src.as_str(), still.base.rect()),
        ("assets/still.png", Some((100.0, 120.0, 480.0, 270.0)))
    );
    assert_eq!(still.mask, Some(crate::model::Mask::RoundRect));
    let Element::Shape(circle) = &parts[1] else {
        panic!("the circle")
    };
    assert_eq!(circle.shape, "ellipse");
    let (x, y, w, h) = circle.base.rect().expect("a box");
    assert_eq!((w, h), (64.8, 64.8), "a quarter of the shorter side");
    assert!(
        (x + w / 2.0 - 340.0).abs() < 0.011 && (y + h / 2.0 - 255.0).abs() < 0.011,
        "centred"
    );
    let fill = circle
        .base
        .style
        .as_ref()
        .and_then(|s| s.fill.as_ref())
        .expect("a fill");
    assert_eq!(
        (fill.color.as_str(), fill.alpha),
        ("#000000", Some(0.6)),
        "see-through"
    );
    let Element::Shape(arrow) = &parts[2] else {
        panic!("the arrow")
    };
    assert_eq!(
        (arrow.shape.as_str(), arrow.base.rotation),
        ("triangle", Some(90.0))
    );
    let (ax, ay, aw, ah) = arrow.base.rect().expect("a box");
    // Turned a quarter, the triangle is `ah` wide and `aw` tall: both inside the circle.
    let (cx, cy) = (ax + aw / 2.0, ay + ah / 2.0);
    let reach = (ah / 2.0).hypot(aw / 2.0);
    assert!(((cx - 340.0).powi(2) + (cy - 255.0).powi(2)).sqrt() + reach < w / 2.0 + 0.5);
}

#[test]
fn without_a_poster_a_dark_panel_names_the_file() {
    let parts = parts_of(video("assets/talks/demo-final.mp4?x=1", None, 480.0, 270.0));
    assert_eq!(parts.len(), 4);
    let Element::Shape(panel) = &parts[0] else {
        panic!("a panel")
    };
    assert_eq!(
        panel
            .base
            .style
            .as_ref()
            .and_then(|s| s.fill.as_ref())
            .map(|f| f.color.as_str()),
        Some("#0b0d10")
    );
    assert_eq!(
        parts[3].text().map(|t| t.plain_text()).as_deref(),
        Some("demo-final.mp4")
    );
    let small = parts_of(video("assets/clip.mp4", None, 100.0, 60.0));
    assert_eq!(small.len(), 3, "no room for the name");
}

#[test]
fn every_part_carries_the_address_of_a_web_video_and_the_first_says_video() {
    let parts = parts_of(video(
        "https://example.com/v.mp4",
        Some("p.png"),
        480.0,
        270.0,
    ));
    assert!(
        parts
            .iter()
            .all(|p| p.base().link.as_deref() == Some("https://example.com/v.mp4"))
    );
    assert_eq!(parts[0].base().alt.as_deref(), Some("Video"));
    // A file in the host's store is not an address.
    let local = parts_of(video("assets/clip.mp4", Some("p.png"), 480.0, 270.0));
    assert!(local.iter().all(|p| p.base().link.is_none()));
    assert_eq!(local[0].base().alt.as_deref(), Some("Video"));
}

#[test]
fn the_button_shrinks_with_the_box_and_everything_stays_finite_and_inside() {
    for (w, h) in [
        (480.0, 270.0),
        (60.0, 40.0),
        (0.0, 0.0),
        (2000.0, 100.0),
        (10.0, 500.0),
    ] {
        for p in parts_of(video("assets/clip.mp4", None, w, h)) {
            let (x, y, pw, ph) = p.base().rect().expect("a box");
            assert!(
                [x, y, pw, ph].iter().all(|v| v.is_finite() && *v >= 0.0),
                "{w}x{h}"
            );
            if p.base().rotation.is_none() {
                assert!(
                    x >= 100.0 - 0.011
                        && y >= 120.0 - 0.011
                        && x + pw <= 100.0 + w + 0.011
                        && y + ph <= 120.0 + h + 0.011,
                    "{w}x{h}: {x} {y} {pw} {ph}"
                );
            }
        }
    }
}

#[test]
fn the_name_of_a_source_is_the_end_of_its_path() {
    assert_eq!(name_of("assets/a/b.mp4"), "b.mp4");
    assert_eq!(name_of("C:\\clips\\b.mp4"), "b.mp4");
    assert_eq!(name_of("https://x.y/v.mp4?t=3#s"), "v.mp4");
    assert_eq!(name_of(""), "");
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
    let parts = parts_of(video(
        "assets/clip.mp4",
        Some("assets/still.png"),
        480.0,
        270.0,
    ));
    let Element::Image(still) = &parts[0] else {
        panic!("the poster")
    };
    assert!(still.covers());
}

#[test]
fn the_name_of_the_file_is_set_at_14_points_and_clear_of_the_play_button() {
    for (w, h) in [(640.0, 360.0), (480.0, 270.0), (200.0, 150.0)] {
        let parts = parts_of(video("assets/talks/demo-final.mp4", None, w, h));
        assert_eq!(parts.len(), 4, "{w}x{h}: a name");
        assert_eq!(sizes(&parts), [14.0], "{w}x{h}");
        let (_, cy, _, ch) = parts[1].base().rect().expect("the button");
        let (_, ly, _, lh) = parts[3].base().rect().expect("the name");
        assert!(
            ly >= cy + ch - 0.011,
            "{w}x{h}: the name starts at {ly}, the button ends at {}",
            cy + ch
        );
        assert!(ly + lh <= 120.0 + h + 0.011, "{w}x{h}: inside the box");
    }
}

#[test]
fn a_panel_too_short_to_hold_the_name_clear_of_the_button_leaves_it_out() {
    for (w, h) in [(200.0, 100.0), (400.0, 90.0), (300.0, 60.0)] {
        assert_eq!(
            parts_of(video("assets/clip.mp4", None, w, h)).len(),
            3,
            "{w}x{h}"
        );
    }
}
