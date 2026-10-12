//! The size of the slides: a page setup that refits everything in the deck.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::Deck;
use crate::resize::{PAGE_SIZES, checked, scale_deck};

op_types! {
    /// Changes the size of every slide. Name a `preset` (`16:9`, `16:10`, `4:3` or `1:1`) or give
    /// the width and the height in slide units.
    pub struct SetPageSize {
        /// `16:9`, `16:10`, `4:3` or `1:1`. Left out when `w` and `h` are given.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub preset: Option<String>,
        /// Width in slide units (1/96 inch).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub w: Option<f64>,
        /// Height in slide units (1/96 inch).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub h: Option<f64>,
    }

    pub struct PageSize {
        pub w: f64,
        pub h: f64,
    }
}

impl SetPageSize {
    /// The width and height asked for, checked.
    fn target(&self) -> Result<(f64, f64)> {
        let (w, h) = match (&self.preset, self.w, self.h) {
            (Some(name), None, None) => PAGE_SIZES
                .iter()
                .find(|(known, _, _)| known.eq_ignore_ascii_case(name.trim()))
                .map(|(_, w, h)| (*w, *h))
                .ok_or_else(|| {
                    let names: Vec<&str> = PAGE_SIZES.iter().map(|(n, _, _)| *n).collect();
                    Error::bad_input(
                        Self::NAME,
                        format!(
                            "there is no preset `{name}`; the presets are {}. Or give `w` and `h`.",
                            names.join(", ")
                        ),
                    )
                })?,
            (None, Some(w), Some(h)) => (w, h),
            _ => {
                return Err(Error::bad_input(
                    Self::NAME,
                    "give either a `preset` or both `w` and `h`",
                ));
            }
        };
        checked(w, h).map_err(|message| Error::bad_input(Self::NAME, message))
    }
}

impl Op for SetPageSize {
    type Output = PageSize;
    const NAME: &'static str = "set_page_size";
    const ABOUT: &'static str = "Change the size of the slides (page setup): a preset (16:9 is 960 by 540, 16:10 960 by 600, 4:3 960 by 720, 1:1 720 by 720) or a width and height in slide units (96 to an inch). Every slide, the theme's layouts and its master are refitted: boxes stretch with the slide, type follows the width, and pictures, turned elements and circles keep their shape. Going to another size and back can leave pictures a little smaller and positions a hundredth of a unit off.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::everything()
    }

    fn run(self, cx: &mut Cx) -> Result<PageSize> {
        let (w, h) = self.target()?;
        scale_deck(cx.deck, w, h);
        Ok(PageSize { w, h })
    }
}
