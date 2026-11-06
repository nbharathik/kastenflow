use super::*;
use crate::composites::expand as expand_element;
use crate::model::{Base, Extra};

fn audio(src: &str, label: Option<&str>, w: f64, h: f64) -> AudioEl {
    AudioEl {
        base: Base::new("a-1").place(100.0, 100.0, w, h),
        src: src.to_owned(),
        label: label.map(str::to_owned),
        autoplay: false,
        looped: false,
        across: None,
        hidden: false,
        volume: None,
        start: None,
        end: None,
        extra: Extra::new(),
    }
}

fn parts_of(el: AudioEl) -> Vec<Element> {
    expand_element(&crate::themes::light(), "blank", &Element::Audio(el)).unwrap_or_default()
}

#[test]
fn a_chip_has_a_panel_a_speaker_and_the_name_of_the_file() {
    let parts = parts_of(audio("assets/music/theme-song.mp3?x=1", None, 200.0, 140.0));
    assert_eq!(parts.len(), 6, "panel, box, cone, two bars, name");
    assert_eq!(
        parts[5].text().map(|t| t.plain_text()).as_deref(),
        Some("theme-song.mp3")
    );
    assert_eq!(parts[2].base().rotation, Some(270.0));
    for (i, part) in parts.iter().enumerate() {
        assert_eq!(part.id(), format!("a-1.{}", i + 1));
    }
}

#[test]
fn a_label_wins_over_the_file_name_and_a_small_chip_has_no_words() {
    let parts = parts_of(audio("assets/a.mp3", Some("  Opening  "), 200.0, 140.0));
    assert_eq!(
        parts[5].text().map(|t| t.plain_text()).as_deref(),
        Some("Opening")
    );
    let small = parts_of(audio("assets/a.mp3", None, 80.0, 80.0));
    assert_eq!(small.len(), 5, "no room for the name");
}

#[test]
fn only_a_web_file_links_and_the_first_part_says_what_it_is() {
    let web = parts_of(audio("https://example.com/a.mp3", None, 200.0, 140.0));
    assert!(
        web.iter()
            .all(|p| p.base().link.as_deref() == Some("https://example.com/a.mp3"))
    );
    assert_eq!(web[0].base().alt.as_deref(), Some("Audio: a.mp3"));
    let local = parts_of(audio("assets/a.mp3", Some("Intro"), 200.0, 140.0));
    assert!(local.iter().all(|p| p.base().link.is_none()));
    assert_eq!(local[0].base().alt.as_deref(), Some("Audio: Intro"));
}

#[test]
fn every_size_gives_finite_parts_inside_the_box() {
    for (w, h) in [
        (200.0, 140.0),
        (60.0, 40.0),
        (0.0, 0.0),
        (1000.0, 60.0),
        (10.0, 400.0),
    ] {
        for p in parts_of(audio("assets/a.mp3", None, w, h)) {
            let (x, y, pw, ph) = p.base().rect().expect("a box");
            assert!([x, y, pw, ph].iter().all(|v| v.is_finite() && *v >= 0.0));
            if p.base().rotation.is_none() {
                assert!(
                    x >= 100.0 - 0.011
                        && y >= 100.0 - 0.011
                        && x + pw <= 100.0 + w + 0.011
                        && y + ph <= 100.0 + h + 0.011,
                    "{w}x{h}: {x} {y} {pw} {ph}"
                );
            }
        }
    }
}

#[test]
fn colours_are_theme_tokens() {
    for p in parts_of(audio("assets/a.mp3", None, 200.0, 140.0)) {
        if let Some(fill) = p.base().style.as_ref().and_then(|s| s.fill.as_ref()) {
            assert!(!fill.color.starts_with('#'), "{}", p.id());
        }
    }
}

#[test]
fn the_name_of_a_source_is_the_end_of_its_path() {
    assert_eq!(name_of("assets/a/b.mp3"), "b.mp3");
    assert_eq!(name_of("C:\\sounds\\b.wav"), "b.wav");
    assert_eq!(name_of("https://x.y/s.ogg?t=3#s"), "s.ogg");
    assert_eq!(alt_of(&audio("", None, 10.0, 10.0)), "Audio");
}
