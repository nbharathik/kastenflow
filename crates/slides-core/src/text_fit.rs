//! Text fitting: what a box does with words that do not fit it.
//!
//! "Shrink text on overflow" sets the type, the space between lines and the indents
//! smaller until the words fit, and no smaller than half; the box's insets keep their
//! size. The editor asks the page how big words come out and finds the scale the same way
//! (`packages/slides-react/src/text/fit.ts`); a file is written with an estimate of it,
//! since there is no page to ask. "Resize shape to fit text" makes the box as tall as
//! its words, which the editor does while words are typed; a host with no page asks for
//! `needed_height`.

use crate::lint::estimate::{text_size, text_size_scaled};
use crate::model::Text;
use crate::model::Theme;

/// The least that "shrink text on overflow" sets type to, as a share of its size.
pub const MIN_SCALE: f64 = 0.5;

/// Scales are whole hundredths.
const STEPS: i32 = 100;

/// The largest scale from `MIN_SCALE` to 1, in hundredths, at which `fits` holds: 1 when it holds as
/// things stand, and `MIN_SCALE` when it does not hold even then. `fits` must hold at every scale
/// below one that holds.
pub fn largest_scale(fits: impl Fn(f64) -> bool) -> f64 {
    if fits(1.0) {
        return 1.0;
    }
    let floor = (MIN_SCALE * f64::from(STEPS)).ceil() as i32;
    if !fits(f64::from(floor) / f64::from(STEPS)) {
        return f64::from(floor) / f64::from(STEPS);
    }
    // `lo` fits and `hi` does not.
    let (mut lo, mut hi) = (floor, STEPS);
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if fits(f64::from(mid) / f64::from(STEPS)) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    f64::from(lo) / f64::from(STEPS)
}

/// How much more room than a box has the estimate of its words may ask for before they are shrunk: the
/// estimate is generous, and words it says overflow a little are, in a page that knows, likely to fit.
pub const ESTIMATE_SLACK: f64 = 1.06;

/// How much the type of `text`, set in the theme text style `base` in an area `width` by `height`
/// units, has to shrink to fit, as far as it can be told without a page to ask: the words are
/// measured by their typical widths, which is generous.
pub fn estimated_scale(theme: &Theme, base: &str, text: &Text, width: f64, height: f64) -> f64 {
    if !(width.is_finite() && height.is_finite()) || width <= 0.0 || height <= 0.0 {
        return 1.0;
    }
    largest_scale(|scale| {
        text_size_scaled(theme, base, text, width, scale).height <= height * ESTIMATE_SLACK + 0.5
    })
}

/// How tall a box `width` wide has to be to hold `text` set in `base`, insets included.
pub fn needed_height(theme: &Theme, base: &str, text: &Text, width: f64) -> f64 {
    text_size(theme, base, text, width).height
}

#[cfg(test)]
mod tests;
