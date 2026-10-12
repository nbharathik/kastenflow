//! Whether the words can be read against what is behind them.

use crate::model::Element;

use super::super::color::{Rgb, contrast as ratio_of};
use super::super::geometry::holds_point;
use super::super::scene::{Scene, is_blank, together};
use super::super::texts::{color_of, describe_leaf, parts, sentence, shown_runs, size_of};
use super::{Found, Sink, element_of};

/// The contrast ordinary text needs (WCAG AA).
pub const TEXT_RATIO: f64 = 4.5;
/// The contrast large text needs.
pub const LARGE_RATIO: f64 = 3.0;
/// Text this big, in points, counts as large.
pub const LARGE_POINTS: f64 = 24.0;

/// What is behind the leaf at `index`, at the middle of its box: the slide's
/// background with the fills of what is under it laid on in order. None when
/// a picture is there, whose colours are not known.
fn backdrop(scene: &Scene, index: usize) -> Option<Rgb> {
    let leaf = &scene.leaves[index];
    let rect = leaf.rect?;
    let (x, y) = (rect.x + rect.w / 2.0, rect.y + rect.h / 2.0);
    let mut behind = scene.paper;
    // What the slide's layout draws under everything of the slide's own.
    if let Some(layout) = crate::resolve::layout_of(&scene.deck.theme, scene.slide) {
        for under in &layout.elements {
            behind = laid_under(scene, under, x, y, behind);
        }
    }
    for lower in &scene.leaves[..=index] {
        let Some(at) = lower.rect else { continue };
        if lower.undrawn || !holds_point(at, x, y) || !together(lower.visible, leaf.visible) {
            continue;
        }
        behind = laid(scene, lower.el, behind);
    }
    behind
}

/// `behind` with `element` laid on it: a picture hides what is known of it, a fill covers it.
fn laid(scene: &Scene, element: &Element, behind: Option<Rgb>) -> Option<Rgb> {
    match element {
        Element::Image(_) | Element::Raw(_) => None,
        Element::Text(_) | Element::Shape(_) => {
            let base = element.base();
            let Some(fill) = base.style.as_ref().and_then(|s| s.fill.as_ref()) else {
                return behind;
            };
            let alpha = fill.alpha.unwrap_or(1.0)
                * base.style.as_ref().and_then(|s| s.opacity).unwrap_or(1.0);
            let Some(color) = scene
                .deck
                .theme
                .resolve_color(&fill.color)
                .and_then(|hex| Rgb::parse(&hex))
            else {
                return behind;
            };
            match behind {
                Some(under) => Some(color.over(alpha, under)),
                None if alpha >= 0.99 => Some(color),
                None => None,
            }
        }
        _ => behind,
    }
}

/// `behind` with what a layout's element draws at the point `(x, y)` laid on it: groups are
/// looked into, and an element that does not hold the point changes nothing.
fn laid_under(
    scene: &Scene,
    element: &Element,
    x: f64,
    y: f64,
    behind: Option<Rgb>,
) -> Option<Rgb> {
    if let Element::Group(group) = element {
        return group.children.iter().fold(behind, |behind, child| {
            laid_under(scene, child, x, y, behind)
        });
    }
    let Some((bx, by, bw, bh)) = element.base().rect() else {
        return behind;
    };
    let at = crate::resolve::Rect {
        x: bx,
        y: by,
        w: bw,
        h: bh,
    };
    if holds_point(at, x, y) {
        laid(scene, element, behind)
    } else {
        behind
    }
}

pub fn contrast(scene: &Scene, sink: &mut Sink) {
    let theme = &scene.deck.theme;
    for (index, leaf) in scene.leaves.iter().enumerate() {
        if leaf.undrawn {
            continue;
        }
        let Some(behind) = backdrop(scene, index) else {
            continue;
        };
        let opacity = leaf
            .el
            .base()
            .style
            .as_ref()
            .and_then(|s| s.opacity)
            .unwrap_or(1.0);
        // The worst run of the leaf: (how far below what it needs, ratio, needed, size, text colour, ground).
        let mut worst: Option<(f64, f64, f64, f64, Rgb, Rgb)> = None;
        for part in parts(scene, leaf) {
            if is_blank(part.text) {
                continue;
            }
            let ground = match part.cell_fill {
                Some(fill) => theme
                    .resolve_color(&fill.color)
                    .and_then(|hex| Rgb::parse(&hex))
                    .map_or(behind, |c| c.over(fill.alpha.unwrap_or(1.0), behind)),
                None => behind,
            };
            for paragraph in &part.text.paragraphs {
                for run in shown_runs(paragraph) {
                    let Some(ink) = color_of(theme, &part.base, paragraph, run) else {
                        continue;
                    };
                    let ink = ink.over(opacity, ground);
                    let size = size_of(theme, &part.base, paragraph, run);
                    let needs = if size >= LARGE_POINTS - 1e-6 {
                        LARGE_RATIO
                    } else {
                        TEXT_RATIO
                    };
                    let got = ratio_of(ink, ground);
                    if got + 1e-9 < needs && worst.is_none_or(|w| got / needs < w.0) {
                        worst = Some((got / needs, got, needs, size, ink, ground));
                    }
                }
            }
        }
        let Some((score, got, needs, size, ink, ground)) = worst else {
            continue;
        };
        sink.add(Found {
            rule: "contrast",
            order: leaf.z + 1,
            key: leaf.owner.map_or(leaf.el.id(), |o| o.id),
            rank: score,
            element: Some(element_of(scene, leaf.unit)),
            message: sentence(&format!(
                "{} is hard to read: {:.1}:1 contrast ({} on {}), where {:.1}:1 is needed at {} pt.",
                describe_leaf(leaf),
                got,
                ink.hex(),
                ground.hex(),
                needs,
                super::super::geometry::units(size)
            )),
            hint: "Use a darker or lighter text colour, or change the fill behind it. Text of 24 pt and up needs only 3:1.",
        });
    }
}
