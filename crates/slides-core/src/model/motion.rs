//! Motion: the way a transition comes from, and how an element comes in, goes out or draws the eye at a step.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

use super::Extra;

model! {
    /// The side something comes from, or is swept toward.
    #[serde(rename_all = "camelCase")]
    pub enum MotionDirection {
        Left,
        Right,
        Up,
        Down,
    }

    /// What an element does at a step. Whether it comes in or goes out follows from its state: an effect on a step where the
    /// element appears is an entrance, where it disappears an exit; the last three draw the eye to an element that stays.
    #[serde(rename_all = "camelCase")]
    pub enum FxKind {
        /// Just there (or just gone), with no motion.
        Appear,
        Fade,
        /// A fade that rises a little.
        FadeUp,
        /// A fade that grows a little.
        Grow,
        /// Flies in from (or out to) a side of the slide.
        Fly,
        Zoom,
        /// Revealed (or covered) from a side, as if wiped.
        Wipe,
        /// Drifts in with a fade, slower than a fly.
        Float,
        /// Grows from a little smaller, without a bounce.
        Pop,
        /// Swells and settles back.
        Pulse,
        /// A wash of `color` that fades.
        Colour,
        /// Comes in along a straight line from `dx`, `dy` away to its own place.
        Path,
    }

    /// Whether an effect begins with the one before it in the same click, or when that one ends.
    #[serde(rename_all = "camelCase")]
    pub enum FxStart {
        With,
        After,
    }

    /// How one element's change at a step is drawn.
    #[serde(rename_all = "camelCase")]
    pub struct StepFx {
        pub kind: FxKind,
        /// The side a fly, wipe or float comes from; below (`down`) when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub direction: Option<MotionDirection>,
        /// Seconds; 0.4 when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub duration: Option<f64>,
        /// Seconds to wait after the effect's start; 0 when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub delay: Option<f64>,
        /// With the effect before it (the first of a click starts the click), or after it; with when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub start: Option<FxStart>,
        /// The colour of a `colour` effect: a theme token or `#rrggbb`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<String>,
        /// Where a `path` begins, across, in slide units from the element's own place.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub dx: Option<f64>,
        /// Where a `path` begins, down, in slide units from the element's own place.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub dy: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

/// Reads a map of effects keyed by step numbers (see `steps::step_keys`: JSON keys are text).
pub(super) fn fx_keys<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<u32, StepFx>, D::Error> {
    BTreeMap::<String, StepFx>::deserialize(deserializer)?
        .into_iter()
        .map(|(key, fx)| {
            key.parse::<u32>()
                .map(|step| (step, fx))
                .map_err(|_| D::Error::custom(format!("a step is a whole number, not {key:?}")))
        })
        .collect()
}

impl StepFx {
    pub fn new(kind: FxKind) -> StepFx {
        StepFx {
            kind,
            direction: None,
            duration: None,
            delay: None,
            start: None,
            color: None,
            dx: None,
            dy: None,
            extra: Extra::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Element;

    #[test]
    fn effects_read_inside_an_element_by_step_and_write_back_the_same() {
        let text = r#"{"type":"text","id":"e-1","x":0,"y":0,"w":10,"h":10,"stepFx":{"2":{"kind":"fly","direction":"up"},"11":{"kind":"pulse"}},"text":{"paragraphs":[]}}"#;
        let element: Element = serde_json::from_str(text).unwrap();
        let fx = &element.base().step_fx;
        assert_eq!(fx[&2].kind, FxKind::Fly);
        assert_eq!(fx[&2].direction, Some(MotionDirection::Up));
        assert_eq!(fx[&11].kind, FxKind::Pulse);
        let again: Element =
            serde_json::from_str(&serde_json::to_string(&element).unwrap()).unwrap();
        assert_eq!(again, element);
    }

    #[test]
    fn a_step_that_is_not_a_number_is_refused_with_a_reason() {
        let text = r#"{"type":"text","id":"e-1","x":0,"y":0,"w":10,"h":10,"stepFx":{"one":{"kind":"fade"}},"text":{"paragraphs":[]}}"#;
        let error = serde_json::from_str::<Element>(text)
            .unwrap_err()
            .to_string();
        assert!(error.contains("a step is a whole number"), "{error}");
    }
}
