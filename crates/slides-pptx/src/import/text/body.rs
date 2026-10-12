//! The box a text sits in: where it is anchored, how far it is from the
//! edge, and whether PowerPoint shrank it to fit.

use std::sync::LazyLock;

use slides_core::{Extra, Insets, TextFit, VAlign};

use crate::import::dom::Node;
use crate::import::units::length;

/// The space between a box and its text when a file names none.
pub static DEFAULT_INSETS: LazyLock<Insets> = LazyLock::new(|| Insets {
    left: 9.6,
    top: 4.8,
    right: 9.6,
    bottom: 4.8,
    extra: Extra::new(),
});

/// What `a:bodyPr` says; None where it is silent, to be found in the layout or master.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BodyProps {
    pub anchor: Option<VAlign>,
    /// Left, top, right, bottom.
    pub insets: [Option<f64>; 4],
    /// The share the type was scaled to when it was shrunk to fit (1 is none).
    pub font_scale: Option<f64>,
    /// The share of line spacing taken away when it was shrunk to fit.
    pub line_reduction: Option<f64>,
    /// What the box does with words that do not fit: shrinks them, grows to hold them, or lets them overflow.
    pub fit: Option<TextFit>,
    /// Whether lines wrap at the box's edge.
    pub wrap: Option<bool>,
}

impl BodyProps {
    pub fn read(node: &Node) -> BodyProps {
        let inset = |name: &str| node.int(name).map(length);
        let shrink = node.child("a:normAutofit");
        let fit = if shrink.is_some() {
            Some(TextFit::Shrink)
        } else if node.child("a:spAutoFit").is_some() {
            Some(TextFit::Resize)
        } else if node.child("a:noAutofit").is_some() {
            Some(TextFit::Off)
        } else {
            None
        };
        BodyProps {
            anchor: node.attr("anchor").map(|a| match a {
                "ctr" => VAlign::Middle,
                "b" => VAlign::Bottom,
                _ => VAlign::Top,
            }),
            insets: [inset("lIns"), inset("tIns"), inset("rIns"), inset("bIns")],
            font_scale: shrink
                .and_then(|n| n.int("fontScale"))
                .map(|v| (v as f64 / 100_000.0).clamp(0.1, 1.0)),
            line_reduction: shrink
                .and_then(|n| n.int("lnSpcReduction"))
                .map(|v| (v as f64 / 100_000.0).clamp(0.0, 0.9)),
            fit,
            wrap: node.attr("wrap").map(|w| w != "none"),
        }
    }

    /// These, with what they leave open taken from `below`. The shrinking is a slide's own.
    pub fn over(&self, below: &BodyProps) -> BodyProps {
        BodyProps {
            anchor: self.anchor.clone().or_else(|| below.anchor.clone()),
            insets: std::array::from_fn(|i| self.insets[i].or(below.insets[i])),
            font_scale: self.font_scale,
            line_reduction: self.line_reduction,
            fit: self.fit.clone().or_else(|| below.fit.clone()),
            wrap: self.wrap.or(below.wrap),
        }
    }

    /// The insets, when they are not the defaults.
    pub fn insets(&self) -> Option<Insets> {
        let insets = Insets {
            left: self.insets[0].unwrap_or(DEFAULT_INSETS.left),
            top: self.insets[1].unwrap_or(DEFAULT_INSETS.top),
            right: self.insets[2].unwrap_or(DEFAULT_INSETS.right),
            bottom: self.insets[3].unwrap_or(DEFAULT_INSETS.bottom),
            extra: Extra::new(),
        };
        (insets != *DEFAULT_INSETS).then_some(insets)
    }
}
