//! A gradient fill: two or more colours that blend along a line or from the middle outward.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Extra;

/// The most colours a gradient holds.
pub const MOST_STOPS: usize = 8;

model! {
    #[serde(rename_all = "camelCase")]
    pub enum GradientKind {
        /// Along a line at `angle`.
        Linear,
        /// From the middle of the shape out to its corners.
        Radial,
    }

    /// One colour of a gradient and where it is.
    #[serde(rename_all = "camelCase")]
    pub struct GradientStop {
        /// From 0 (the start) to 1 (the end).
        pub pos: f64,
        /// A theme token or `#rrggbb`.
        pub color: String,
        /// 0 (clear) to 1 (solid); solid when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub alpha: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// Colours that blend. It paints a shape in place of its fill's colour, which stays as what a program that
    /// knows no gradients draws (the nearest solid colour).
    #[serde(rename_all = "camelCase")]
    pub struct Gradient {
        pub kind: GradientKind,
        /// Degrees clockwise from left to right, as PowerPoint counts: 0 runs across, 90 runs down. A linear gradient only; 90 when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub angle: Option<f64>,
        /// Two to eight, by position.
        pub stops: Vec<GradientStop>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl GradientStop {
    pub fn new(pos: f64, color: impl Into<String>) -> GradientStop {
        GradientStop {
            pos,
            color: color.into(),
            alpha: None,
            extra: Extra::new(),
        }
    }
}

impl Gradient {
    pub fn linear(angle: f64, stops: Vec<GradientStop>) -> Gradient {
        Gradient {
            kind: GradientKind::Linear,
            angle: Some(angle),
            stops,
            extra: Extra::new(),
        }
    }

    /// The gradient as it should be drawn: two to eight stops, each position between 0 and 1, in order. None when it holds
    /// fewer than two colours.
    pub fn tidy(&self) -> Option<Gradient> {
        let mut stops: Vec<GradientStop> = self
            .stops
            .iter()
            .take(MOST_STOPS)
            .map(|s| GradientStop {
                pos: if s.pos.is_finite() {
                    s.pos.clamp(0.0, 1.0)
                } else {
                    0.0
                },
                ..s.clone()
            })
            .collect();
        if stops.len() < 2 {
            return None;
        }
        stops.sort_by(|a, b| a.pos.total_cmp(&b.pos));
        Some(Gradient {
            stops,
            ..self.clone()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gradient_reads_and_writes_the_same_and_keeps_unknown_fields() {
        let text = r##"{"kind":"linear","angle":45.0,"stops":[{"pos":0.0,"color":"accent1"},{"pos":1.0,"color":"#ffffff","alpha":0.5}],"later":true}"##;
        let g: Gradient = serde_json::from_str(text).unwrap();
        assert_eq!(g.stops.len(), 2);
        assert_eq!(serde_json::to_string(&g).unwrap(), text);
    }

    #[test]
    fn tidy_orders_the_stops_clamps_them_and_refuses_one_colour() {
        let g = Gradient::linear(
            0.0,
            vec![
                GradientStop::new(1.4, "accent2"),
                GradientStop::new(-1.0, "accent1"),
            ],
        );
        let t = g.tidy().unwrap();
        assert_eq!(t.stops[0].color, "accent1");
        assert_eq!((t.stops[0].pos, t.stops[1].pos), (0.0, 1.0));
        let one = Gradient::linear(0.0, vec![GradientStop::new(0.0, "accent1")]);
        assert!(one.tidy().is_none());
    }
}
