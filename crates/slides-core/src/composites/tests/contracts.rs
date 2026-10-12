//! What every expansion promises, checked for every kind.

use std::collections::HashSet;

use serde_json::Value;

use super::samples::{self, BOX};
use crate::composites::{expand, expanded_group, slide_steps_needed, steps_needed};
use crate::model::{Element, Slide, is_color};
use crate::themes;

fn theme() -> crate::model::Theme {
    themes::light()
}

fn parts(element: &Element) -> Vec<Element> {
    expand(&theme(), "blank", element).expect("a composite with a box expands")
}

/// The colours a part names, in its style and its runs.
fn colours(part: &Element) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(style) = &part.base().style {
        out.extend(style.fill.iter().map(|f| f.color.clone()));
        out.extend(style.stroke.iter().map(|s| s.color.clone()));
    }
    if let Some(text) = part.text() {
        out.extend(
            text.paragraphs
                .iter()
                .flat_map(|p| p.runs.iter().filter_map(|r| r.color.clone())),
        );
    }
    out
}

#[test]
fn every_kind_expands_to_parts_with_ids_made_from_its_own() {
    for element in samples::all() {
        let made = parts(&element);
        assert!(!made.is_empty(), "{}", element.id());
        let prefix = format!("{}.", element.id());
        let mut seen = HashSet::new();
        for part in &made {
            assert!(
                part.id().starts_with(&prefix),
                "{}: {}",
                element.id(),
                part.id()
            );
            assert!(
                seen.insert(part.id().to_owned()),
                "{}: {} twice",
                element.id(),
                part.id()
            );
            assert!(!part.is_composite(), "parts are primitives");
        }
    }
}

#[test]
fn an_expansion_is_the_same_every_time_in_parts_ids_and_order() {
    for element in samples::all() {
        let once = serde_json::to_value(parts(&element)).expect("json");
        let again = serde_json::to_value(parts(&element.clone())).expect("json");
        assert_eq!(once, again, "{}", element.id());
    }
}

#[test]
fn ids_do_not_depend_on_where_the_composite_is_or_on_its_looks() {
    // Morph pairs parts across slides by id, so moving a block must not renumber it.
    for element in samples::all() {
        let mut moved = element.clone();
        moved.base_mut().x = Some(10.0);
        moved.base_mut().y = Some(20.0);
        let ids = |e: &Element| {
            parts(e)
                .iter()
                .map(|p| p.id().to_owned())
                .collect::<Vec<_>>()
        };
        let (a, b) = (ids(&element), ids(&moved));
        assert_eq!(a.len(), b.len(), "{}", element.id());
        assert_eq!(a, b, "{}", element.id());
    }
}

#[test]
fn every_part_lies_inside_the_box_it_was_made_for() {
    let (x, y, w, h) = BOX;
    for element in samples::all() {
        let (bx, by, bw, bh) = element.base().rect().expect("a box");
        for part in parts(&element) {
            if part.base().rotation.is_some() {
                continue;
            }
            let (px, py, pw, ph) = part.base().rect().expect("a box");
            assert!(
                px >= bx - 0.011
                    && py >= by - 0.011
                    && px + pw <= bx + bw + 0.011
                    && py + ph <= by + bh + 0.011,
                "{}: {} is {px} {py} {pw} {ph}, not in {bx} {by} {bw} {bh} ({x} {y} {w} {h})",
                element.id(),
                part.id()
            );
        }
    }
}

#[test]
fn colours_are_theme_tokens_or_hex_and_sizes_are_positive() {
    for element in samples::all() {
        for part in parts(&element) {
            for colour in colours(&part) {
                assert!(is_color(&colour), "{}: `{colour}`", part.id());
            }
            for run in part
                .text()
                .iter()
                .flat_map(|t| t.paragraphs.iter().flat_map(|p| p.runs.iter()))
            {
                assert!(
                    run.size.is_none_or(|s| s.is_finite() && s > 0.0),
                    "{}",
                    part.id()
                );
            }
        }
    }
}

#[test]
fn a_part_survives_a_trip_through_json() {
    for element in samples::all() {
        for part in parts(&element) {
            let text = serde_json::to_string(&part).expect("json");
            let back: Element = serde_json::from_str(&text).expect("an element");
            assert_eq!(back, part, "{}", part.id());
        }
    }
}

#[test]
fn recolouring_the_theme_recolours_parts_that_use_tokens() {
    // Nothing in a part is a fixed hex value unless it is a syntax colour, a code panel, a picture's overlay, or the black and white of a QR code.
    for element in samples::all() {
        if matches!(
            element,
            Element::Code(_) | Element::Video(_) | Element::Qr(_)
        ) {
            continue;
        }
        for part in parts(&element) {
            for colour in colours(&part) {
                assert!(
                    !colour.starts_with('#'),
                    "{}: `{colour}` is fixed",
                    part.id()
                );
            }
        }
    }
}

#[test]
fn a_group_keeps_the_composites_identity_and_box() {
    for element in samples::all() {
        let Some(Element::Group(group)) = expanded_group(&theme(), "blank", &element) else {
            panic!("a group")
        };
        assert_eq!(group.base.id, element.id());
        assert_eq!(group.base.rect(), element.base().rect());
        assert!(group.base.style.is_none() && group.base.placeholder.is_none());
        assert!(!group.children.is_empty());
    }
}

#[test]
fn an_embed_and_a_video_give_their_group_a_link_and_words() {
    let all = samples::all();
    let group_of = |id: &str| {
        let e = all.iter().find(|e| e.id() == id).expect("a sample");
        expanded_group(&theme(), "blank", e).expect("a group")
    };
    let embed = group_of("embed-1");
    assert_eq!(
        embed.base().link.as_deref(),
        Some("https://example.com/demo")
    );
    assert_eq!(embed.base().alt.as_deref(), Some("Web page: The demo"));
    let local = group_of("video-1");
    assert_eq!(
        (local.base().link.as_deref(), local.base().alt.as_deref()),
        (None, Some("Video"))
    );
    assert_eq!(
        group_of("video-2").base().link.as_deref(),
        Some("https://example.com/v.mp4")
    );
    // What the composite says itself wins.
    let mut own = all
        .iter()
        .find(|e| e.id() == "embed-1")
        .expect("a sample")
        .clone();
    own.base_mut().link = Some("https://mine.example".into());
    assert_eq!(
        expanded_group(&theme(), "blank", &own)
            .expect("a group")
            .base()
            .link
            .as_deref(),
        Some("https://mine.example")
    );
}

#[test]
fn a_turned_composite_has_its_parts_turned_about_its_middle() {
    let mut block = samples::all().remove(0);
    block.base_mut().rotation = Some(90.0);
    let plain = samples::all().remove(0);
    let Some(Element::Group(turned)) = expanded_group(&theme(), "blank", &block) else {
        panic!("a group")
    };
    let Some(Element::Group(upright)) = expanded_group(&theme(), "blank", &plain) else {
        panic!("a group")
    };
    assert_eq!(
        turned.base.rotation, None,
        "a group keeps no turn of its own"
    );
    let panel = |g: &crate::model::GroupEl| g.children[0].base().clone();
    let (a, b) = (panel(&turned), panel(&upright));
    assert_eq!(a.rotation, Some(90.0));
    // The panel keeps its middle: (64 + 416, 148 + 172).
    let middle = |b: &crate::model::Base| {
        (
            b.x.unwrap_or(0.0) + b.w.unwrap_or(0.0) / 2.0,
            b.y.unwrap_or(0.0) + b.h.unwrap_or(0.0) / 2.0,
        )
    };
    assert_eq!(middle(&a), middle(&b));
    // A part off the middle goes round it: the code text was near the top, and is now on the right.
    let text_a = turned.children[1].base().clone();
    let text_b = upright.children[1].base().clone();
    assert_ne!(middle(&text_a), middle(&text_b));
    assert!(
        middle(&text_a).0 > middle(&text_b).0,
        "a quarter turn clockwise moves the top to the right"
    );
    assert_eq!(text_a.rotation, Some(90.0));
}

#[test]
fn a_composite_needs_as_many_steps_as_its_focus_list_and_a_group_what_it_holds() {
    let all = samples::all();
    let with_focus = all
        .iter()
        .find(|e| e.id() == "code-3")
        .expect("a sample")
        .clone();
    assert_eq!(steps_needed(&with_focus), 3);
    assert_eq!(steps_needed(&all[0]), 0);
    let group: Element = serde_json::from_value(serde_json::json!({
        "type": "group", "id": "g", "x": 0, "y": 0, "w": 10, "h": 10,
        "children": [serde_json::to_value(&with_focus).expect("json")]
    }))
    .expect("a group");
    assert_eq!(steps_needed(&group), 3);
    let mut slide = Slide::new("s-1", "blank");
    assert_eq!(slide_steps_needed(&slide), 0);
    slide.elements = vec![all[0].clone(), group, with_focus];
    assert_eq!(slide_steps_needed(&slide), 3);
}

#[test]
fn a_composite_without_a_box_or_a_composite_that_is_not_one_does_not_expand() {
    let mut no_box = samples::all().remove(0);
    no_box.base_mut().w = None;
    assert!(expand(&theme(), "blank", &no_box).is_none());
    assert!(expanded_group(&theme(), "blank", &no_box).is_none());
    let text: Element = serde_json::from_value(serde_json::json!({
        "type": "text", "id": "t", "x": 0, "y": 0, "w": 5, "h": 5, "text": { "paragraphs": [] } }))
    .expect("text");
    assert!(expand(&theme(), "blank", &text).is_none());
}

#[test]
fn every_sample_is_valid_json_a_deck_could_hold() {
    for element in samples::all() {
        let value: Value = serde_json::to_value(&element).expect("json");
        assert_eq!(value["type"], element.kind());
    }
}
