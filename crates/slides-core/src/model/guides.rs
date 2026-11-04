//! Drawing aids saved with a deck: the rulers, the grid and the guides a person dragged out of the
//! rulers. They help while editing; they are never drawn when presenting or exported.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Extra, is_false};

/// The smallest and largest grid, in slide units.
pub const GRID_RANGE: (f64, f64) = (4.0, 480.0);
/// The most guides a deck keeps.
pub const MOST_GUIDES: usize = 200;
/// How far from the slide's top left a guide may be, in slide units.
pub const FARTHEST_GUIDE: f64 = 20_000.0;

model! {
    /// Which way a guide runs.
    #[serde(rename_all = "camelCase")]
    pub enum GuideAxis {
        /// A vertical line, at a distance from the left edge.
        Vertical,
        /// A horizontal line, at a distance from the top edge.
        Horizontal,
    }

    /// A line that boxes snap to.
    #[serde(rename_all = "camelCase")]
    pub struct Guide {
        pub axis: GuideAxis,
        /// Slide units from the left edge (vertical) or the top edge (horizontal).
        pub at: f64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The rulers, grid and guides of a deck.
    #[derive(Default)]
    #[serde(rename_all = "camelCase")]
    pub struct Guides {
        /// Rulers show along the top and left of the slide.
        #[serde(default, skip_serializing_if = "is_false")]
        pub rulers: bool,
        /// The grid is drawn over the slide.
        #[serde(default, skip_serializing_if = "is_false")]
        pub show_grid: bool,
        /// The distance between grid lines in slide units; the grid is off when absent. Boxes snap to it while it is set.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub grid: Option<f64>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub lines: Vec<Guide>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl Guides {
    /// Whether it holds nothing worth saving.
    pub fn is_blank(&self) -> bool {
        self == &Guides::default()
    }

    /// What is wrong with the guides, said as what to change; None when they are fine.
    pub fn problem(&self) -> Option<String> {
        if let Some(grid) = self.grid
            && !(GRID_RANGE.0..=GRID_RANGE.1).contains(&grid)
        {
            return Some(format!(
                "The grid is between {} and {} slide units, not {grid}.",
                GRID_RANGE.0, GRID_RANGE.1
            ));
        }
        if self.lines.len() > MOST_GUIDES {
            return Some(format!("A deck keeps at most {MOST_GUIDES} guides."));
        }
        let bad = |g: &Guide| !g.at.is_finite() || g.at.abs() > FARTHEST_GUIDE;
        if self.lines.iter().any(bad) {
            return Some(format!(
                "A guide is within {FARTHEST_GUIDE} slide units of the slide's top left."
            ));
        }
        None
    }
}
