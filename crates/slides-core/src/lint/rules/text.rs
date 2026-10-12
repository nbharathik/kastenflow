//! The words: whether they fit their boxes, whether they are big enough to
//! read, and whether there are too many.

use crate::model::{Element, TextFit};
use crate::text_fit::MIN_SCALE;

use super::super::geometry::units;
use super::super::model::Measures;
use super::super::scene::{Scene, is_blank};
use super::super::texts::{
    describe_leaf, parts, sentence, shown_runs, size_of, style_name, words_in,
};
use super::{Found, Sink, element_of};

/// How much bigger than its box measured text may be before it is an error.
const SLACK: f64 = 1.05;
/// The same for text that was estimated, not measured.
const SLACK_ESTIMATED: f64 = 1.25;

/// The size, in points, below which body text is too small to read from a room.
pub const BODY_POINTS: f64 = 14.0;
/// The same for a citation, which is a reference and not to be read out.
pub const CITATION_POINTS: f64 = 8.0;
/// The most words a slide should hold.
pub const MOST_WORDS: usize = 60;

/// Composite kinds whose text is not prose for an audience to read.
const NOT_PROSE: &[&str] = &[
    "code",
    "math",
    "citation",
    "step-label",
    "embed",
    "video",
    "token-probs",
];

/// Checks the measures against the boxes. Returns how many text elements had none.
pub fn overflow(scene: &Scene, measures: &Measures, sink: &mut Sink) -> usize {
    let mut unmeasured = 0;
    let slack = if measures.estimated {
        SLACK_ESTIMATED
    } else {
        SLACK
    };
    for leaf in scene.leaves.iter().filter(|l| !l.undrawn) {
        let carries = matches!(
            leaf.el,
            Element::Text(_) | Element::Shape(_) | Element::Table(_)
        ) && parts(scene, leaf).iter().any(|p| !is_blank(p.text));
        let Some(rect) = leaf.rect.filter(|_| carries) else {
            continue;
        };
        let Some(m) = measures.of(&scene.slide.id, leaf.el.id()) else {
            unmeasured += 1;
            continue;
        };
        let area_w = m.area_width.unwrap_or(rect.w);
        let area_h = m.area_height.unwrap_or(rect.h);
        // A box that shrinks its words to fit is only too small when even the smallest size does not fit them,
        // and one that grows to fit them is never too small.
        let tall = match leaf.el.text().and_then(|t| t.fit.as_ref()) {
            Some(TextFit::Resize) => false,
            Some(TextFit::Shrink) => m.text_height * MIN_SCALE > area_h * slack + 1e-6,
            _ => m.text_height > area_h * slack + 1e-6,
        };
        let wide = m.text_width > area_w * slack + 1e-6;
        if !tall && !wide {
            continue;
        }
        let maybe = if measures.estimated { "probably " } else { "" };
        let mut what = Vec::new();
        if tall {
            what.push(format!(
                "{maybe}needs {} units of height but its box is {} tall",
                units(m.text_height),
                units(area_h)
            ));
        }
        if wide {
            what.push(format!(
                "has a word {maybe}{} units wide but its box is only {} wide",
                units(m.text_width),
                units(area_w)
            ));
        }
        let worst = (m.text_height / area_h.max(1.0)).max(m.text_width / area_w.max(1.0));
        sink.add(Found {
            rule: "text-overflow",
            order: leaf.z + 1,
            key: leaf.owner.map_or(leaf.el.id(), |o| o.id),
            rank: -worst,
            element: Some(element_of(scene, leaf.unit)),
            message: format!(
                "The text in {} {}.",
                describe_leaf(leaf),
                what.join(", and it ")
            ),
            hint: "Shorten the text, make the box bigger, or set the words in a smaller size.",
        });
    }
    unmeasured
}

pub fn min_font(scene: &Scene, sink: &mut Sink) {
    let theme = &scene.deck.theme;
    // Type is judged against the width of the slide: on one narrower than a 960-unit slide (such
    // as a square page setup, which scales type with the width) the floors shrink in proportion.
    let narrow = (scene.width / 960.0).clamp(0.05, 1.0);
    for leaf in scene.leaves.iter().filter(|l| !l.undrawn) {
        let mut body: Option<f64> = None;
        let mut citation: Option<f64> = None;
        for part in parts(scene, leaf) {
            for paragraph in &part.text.paragraphs {
                let cited = style_name(paragraph, &part.base) == "citation"
                    || leaf.owner.is_some_and(|o| o.kind == "citation");
                for run in shown_runs(paragraph) {
                    let size = size_of(theme, &part.base, paragraph, run);
                    let slot = if cited { &mut citation } else { &mut body };
                    *slot = Some(slot.map_or(size, |now| now.min(size)));
                }
            }
        }
        let who = describe_leaf(leaf);
        let key = leaf.owner.map_or(leaf.el.id(), |o| o.id);
        for (found, floor, kind) in [
            (body, BODY_POINTS * narrow, "body"),
            (citation, CITATION_POINTS * narrow, "citation"),
        ] {
            let Some(size) = found.filter(|s| *s < floor - 1e-6) else {
                continue;
            };
            let message = if kind == "body" {
                format!(
                    "The text in {who} is set at {} pt; body text should be at least {} pt to be read from the back of a room.",
                    units(size),
                    units(floor)
                )
            } else {
                format!(
                    "The citation text in {who} is set at {} pt; citations should be at least {} pt.",
                    units(size),
                    units(floor)
                )
            };
            sink.add(Found {
                rule: "min-font",
                order: leaf.z + 1,
                key: &format!("{key}|{kind}"),
                rank: size,
                element: Some(element_of(scene, leaf.unit)),
                message,
                hint: "Make the type bigger, or say less: cut words until the rest fits at a readable size.",
            });
        }
    }
}

pub fn word_count(scene: &Scene, sink: &mut Sink) {
    let total: usize = scene
        .leaves
        .iter()
        .filter(|l| l.owner.is_none_or(|o| !NOT_PROSE.contains(&o.kind)))
        .flat_map(|l| parts(scene, l))
        .map(|p| words_in(p.text))
        .sum();
    if total > MOST_WORDS {
        sink.add(Found {
            rule: "word-count",
            order: 0,
            key: "slide",
            rank: 0.0,
            element: None,
            message: sentence(&format!("this slide has {total} words; more than {MOST_WORDS} is a wall of text for an audience.")),
            hint: "Split it over two slides, cut it down to the key phrases, or move the detail into the speaker notes.",
        });
    }
}
