//! How a picture is touched up: the adjustments the renderer draws as filters and the export
//! writes as the nearest thing PowerPoint has. Transparency is the element's `opacity`, which
//! every element already has.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Extra, is_false};

/// The most a picture is blurred, in slide units.
pub const MOST_BLUR: f64 = 60.0;

model! {
    /// Brightness, contrast, saturation, greyscale and blur of a picture.
    #[derive(Default)]
    #[serde(rename_all = "camelCase")]
    pub struct Adjust {
        /// -1 (black) to 1 (white); 0 leaves it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub brightness: Option<f64>,
        /// -1 (flat grey) to 1 (as harsh as can be); 0 leaves it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub contrast: Option<f64>,
        /// -1 (no colour) to 1 (twice the colour); 0 leaves it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub saturation: Option<f64>,
        /// Drawn in shades of grey.
        #[serde(default, skip_serializing_if = "is_false")]
        pub greyscale: bool,
        /// Slide units of blur; 0 or absent for sharp.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub blur: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl Adjust {
    /// Whether it changes nothing about the picture.
    pub fn is_neutral(&self) -> bool {
        let none = |v: Option<f64>| v.is_none_or(|v| v == 0.0);
        none(self.brightness)
            && none(self.contrast)
            && none(self.saturation)
            && none(self.blur)
            && !self.greyscale
    }

    /// What is wrong with the numbers, said as what to change; None when they are fine.
    pub fn problem(&self) -> Option<String> {
        for (name, v) in [
            ("brightness", self.brightness),
            ("contrast", self.contrast),
            ("saturation", self.saturation),
        ] {
            if v.is_some_and(|v| !(-1.0..=1.0).contains(&v)) {
                return Some(format!("{name} is between -1 and 1."));
            }
        }
        if self
            .blur
            .is_some_and(|b| !b.is_finite() || !(0.0..=MOST_BLUR).contains(&b))
        {
            return Some(format!("blur is between 0 and {MOST_BLUR}."));
        }
        None
    }
}

/// Whether `name` can be a preset shape name: letters and digits, and not long.
pub fn is_shape_name(name: &str) -> bool {
    (1..=40).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_out_of_range_are_named() {
        let loud = Adjust {
            contrast: Some(1.5),
            ..Adjust::default()
        };
        assert!(loud.problem().unwrap().contains("contrast"));
        let blurred = Adjust {
            blur: Some(-1.0),
            ..Adjust::default()
        };
        assert!(blurred.problem().unwrap().contains("blur"));
        assert_eq!(Adjust::default().problem(), None);
    }

    #[test]
    fn an_adjustment_of_nothing_is_neutral() {
        assert!(Adjust::default().is_neutral());
        let zero = Adjust {
            brightness: Some(0.0),
            ..Adjust::default()
        };
        assert!(zero.is_neutral());
        let grey = Adjust {
            greyscale: true,
            ..Adjust::default()
        };
        assert!(!grey.is_neutral());
    }

    #[test]
    fn shape_names_are_plain() {
        assert!(is_shape_name("star5"));
        assert!(!is_shape_name(""));
        assert!(!is_shape_name("a b"));
    }
}
