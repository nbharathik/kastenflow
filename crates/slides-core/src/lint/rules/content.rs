//! What is on the slide and what it says: empty slots, pictures without
//! words for those who cannot see them, unknown citations, steps that do
//! not exist, and things that will not survive a trip to PowerPoint.

use crate::composites::steps_needed;
use crate::model::{Element, Text, TransitionKind};

use super::super::model::Refs;
use super::super::scene::Scene;
use super::super::texts::{describe, describe_leaf, describe_unit, sentence};
use super::{Found, Sink, each, element_of};

pub fn empty_placeholders(scene: &Scene, sink: &mut Sink) {
    for leaf in &scene.leaves {
        let Some(role) = leaf
            .el
            .base()
            .placeholder
            .as_deref()
            .filter(|_| leaf.undrawn)
        else {
            continue;
        };
        let layout = scene
            .deck
            .theme
            .layout(&scene.slide.layout)
            .map_or(scene.slide.layout.as_str(), |l| l.label.as_str());
        let fill = if matches!(leaf.el, Element::Image(_)) {
            "place_image puts a picture in it"
        } else {
            "set_text fills it"
        };
        sink.add(Found {
            rule: "empty-placeholder",
            order: leaf.z + 1,
            key: leaf.el.id(),
            rank: 0.0,
            element: Some(element_of(scene, leaf.unit)),
            message: format!("The {role} slot of the \"{layout}\" layout is empty."),
            hint: &format!("Fill it ({fill}), or delete the empty box. An empty slot shows nothing when presenting."),
        });
    }
}

pub fn missing_alt(scene: &Scene, sink: &mut Sink) {
    for leaf in &scene.leaves {
        let Element::Image(image) = leaf.el else {
            continue;
        };
        if image.src.trim().is_empty()
            || image
                .base
                .alt
                .as_deref()
                .is_some_and(|a| !a.trim().is_empty())
        {
            continue;
        }
        sink.add(Found {
            rule: "missing-alt",
            order: leaf.z + 1,
            key: leaf.owner.map_or(leaf.el.id(), |o| o.id),
            rank: 0.0,
            element: Some(element_of(scene, leaf.unit)),
            message: sentence(&format!(
                "{} has no alternative text, so a person who cannot see it is told nothing.",
                describe_leaf(leaf)
            )),
            hint: "Say in a few words what the picture shows (alt), or what the formula is.",
        });
    }
}

/// The highest step an element, or anything in it, names.
fn named_step(el: &Element) -> u32 {
    let own = el
        .base()
        .step_states
        .keys()
        .next_back()
        .copied()
        .unwrap_or(0);
    let words = texts_of(el)
        .iter()
        .flat_map(|t| t.paragraphs.iter())
        .filter_map(|p| p.step)
        .max()
        .unwrap_or(0);
    let inside = el.children().iter().map(named_step).max().unwrap_or(0);
    own.max(words).max(inside)
}

/// The texts an element holds itself.
fn texts_of(el: &Element) -> Vec<&Text> {
    match el {
        Element::Text(t) => vec![&t.text],
        Element::Shape(s) => s.text.iter().collect(),
        Element::Connector(c) => c.label.iter().collect(),
        Element::Table(t) => t
            .rows
            .iter()
            .flat_map(|r| r.cells.iter().map(|c| &c.text))
            .collect(),
        _ => Vec::new(),
    }
}

pub fn step_orphans(scene: &Scene, sink: &mut Sink) {
    let steps = scene.slide.steps;
    for (n, unit) in scene.units.iter().enumerate() {
        let composite = scene.slide.elements.get(n).map_or(0, steps_needed);
        let reach = named_step(unit.el).max(composite);
        if reach <= steps {
            continue;
        }
        let has = match steps {
            0 => "no steps".to_owned(),
            1 => "1 step".to_owned(),
            n => format!("{n} steps"),
        };
        sink.add(Found {
            rule: "step-orphan",
            order: n + 1,
            key: unit.id,
            rank: -f64::from(reach),
            element: Some(unit.id),
            message: sentence(&format!("{} changes at step {reach}, but the slide has {has}.", describe_unit(unit))),
            hint: &format!("Give the slide {reach} steps (set_slide_steps), or move the change to a step it has."),
        });
    }
}

pub fn citations(scene: &Scene, refs: &Refs, sink: &mut Sink) {
    for (n, top) in scene.slide.elements.iter().enumerate() {
        let id = scene.units.get(n).map_or(top.id(), |u| u.id);
        each(std::slice::from_ref(top), &mut |e| {
            let Element::Citation(citation) = e else {
                return;
            };
            for key in &citation.keys {
                if refs.contains(key) {
                    continue;
                }
                let guess = refs
                    .closest(key)
                    .map(|k| format!(" Did you mean \"{k}\"?"))
                    .unwrap_or_default();
                sink.add(Found {
                    rule: "unresolved-citation",
                    order: n + 1,
                    key: &format!("{}|{key}", e.id()),
                    rank: 0.0,
                    element: Some(id),
                    message: format!(
                        "The citation key \"{key}\" is not in the reference list.{guess}"
                    ),
                    hint: "Fix the key, or add the entry to the bibliography.",
                });
            }
        });
    }
}

pub fn pptx_unsafe(scene: &Scene, sink: &mut Sink) {
    let slide = scene.slide;
    let morph = slide
        .transition
        .as_ref()
        .or(scene.deck.present.transition.as_ref());
    if morph.is_some_and(|t| t.kind == TransitionKind::Morph) {
        sink.add(Found {
            rule: "pptx-unsafe",
            order: 0,
            key: "morph",
            rank: 0.0,
            element: None,
            message: "This slide arrives with the Morph transition, which Google Slides does not read and PowerPoint before 2019 shows as a plain cut.".to_owned(),
            hint: "Keep Morph for showing from KastenFlow, or use fade or slide if the deck must work everywhere.",
        });
    }
    for (n, top) in slide.elements.iter().enumerate() {
        let unit = scene.units.get(n);
        let id = unit.map_or(top.id(), |u| u.id);
        let describe_top = || unit.map_or_else(|| describe(top), describe_unit);
        each(std::slice::from_ref(top), &mut |e| {
            let (kind, message, hint): (&str, String, &str) = match e {
                Element::Embed(embed)
                    if embed.poster.as_deref().is_none_or(|p| p.trim().is_empty()) =>
                {
                    if embed.base.source.is_some() && embed.url.trim().is_empty() {
                        (
                            "embed",
                            format!(
                                "{} is a page of KastenFlow, live only there; PowerPoint and Google Slides get a card with its first words, not the page.",
                                sentence(&describe_top())
                            ),
                            "Give it a snapshot picture of the page if the card is not enough.",
                        )
                    } else {
                        (
                            "embed",
                            format!(
                                "{} has no snapshot picture, so PowerPoint and Google Slides show a plain panel with its address, not the page.",
                                sentence(&describe_top())
                            ),
                            "Give it a snapshot (a picture of the page in the image store).",
                        )
                    }
                }
                Element::Video(video) => (
                    "video",
                    if video.poster.as_deref().is_none_or(|p| p.trim().is_empty()) {
                        format!(
                            "{} has no poster picture; PowerPoint and Google Slides get a plain panel and a link, and it plays only when presenting from KastenFlow.",
                            sentence(&describe_top())
                        )
                    } else {
                        format!(
                            "{} plays only when presenting from KastenFlow; PowerPoint and Google Slides get its poster picture and a link.",
                            sentence(&describe_top())
                        )
                    },
                    "Give it a poster picture, and say on the slide where the video is.",
                ),
                Element::Timer(_) => (
                    "timer",
                    format!(
                        "{} counts down only when presenting from KastenFlow; PowerPoint and Google Slides show the time it starts at.",
                        sentence(&describe_top())
                    ),
                    "Say on the slide that it counts down, or time the talk another way for a file that must work everywhere.",
                ),
                Element::Raw(raw)
                    if raw.xml.as_deref().is_none_or(|x| x.trim().is_empty())
                        && raw.preview.as_deref().is_none_or(|p| p.trim().is_empty()) =>
                {
                    (
                        "raw",
                        format!(
                            "{} has no picture and nothing to write back, so it is left out of the PowerPoint file.",
                            sentence(&describe_top())
                        ),
                        "Replace it with elements the format has, or give it a preview picture.",
                    )
                }
                other => {
                    let inline_math = texts_of(other).iter().any(|t| {
                        t.paragraphs
                            .iter()
                            .flat_map(|p| p.runs.iter())
                            .any(|r| r.math && !r.t.trim().is_empty())
                    });
                    if !inline_math {
                        return;
                    }
                    (
                        "math",
                        format!(
                            "{} holds inline math, which PowerPoint gets as its LaTeX source, not as a formula.",
                            sentence(&describe_top())
                        ),
                        "Use a formula element (math) for it: PowerPoint gets a picture.",
                    )
                }
            };
            sink.add(Found {
                rule: "pptx-unsafe",
                order: n + 1,
                key: &format!("{}|{kind}", e.id()),
                rank: 0.0,
                element: Some(id),
                message,
                hint,
            });
        });
    }
}
