//! The rulers, the grid and the guides of the editor. They are saved with the deck so they are
//! there when it is opened again, and each change is one step of undo.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Guide};

op_types! {
    /// Changes the rulers, the grid and the guides. Only what is given changes.
    pub struct SetGuides {
        /// Rulers along the top and left of the slide.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub rulers: Option<bool>,
        /// Draws the grid over the slide.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub show_grid: Option<bool>,
        /// The distance between grid lines, in slide units (4 to 480); 0 takes the grid away.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub grid: Option<f64>,
        /// All the guides, replacing the ones there are: a guide dragged out, moved or deleted is a new list.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub lines: Option<Vec<Guide>>,
    }
}

impl Op for SetGuides {
    type Output = ();
    const NAME: &'static str = "set_guides";
    const ABOUT: &'static str = "Change the editor's rulers, grid and guides, which are saved with the deck and never shown when presenting or exported. `rulers` shows the rulers; `grid` is the distance between grid lines in slide units (0 for no grid) and `showGrid` draws it; `lines` replaces the guides, each {axis: vertical or horizontal, at} in slide units from the left or top edge. Boxes snap to the guides and the grid while they are dragged.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_meta()
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let mut next = cx.deck.present.guides.clone().unwrap_or_default();
        if let Some(on) = self.rulers {
            next.rulers = on;
        }
        if let Some(on) = self.show_grid {
            next.show_grid = on;
        }
        if let Some(grid) = self.grid {
            next.grid = (grid != 0.0).then_some(grid);
        }
        if let Some(lines) = self.lines {
            next.lines = lines;
        }
        if let Some(problem) = next.problem() {
            return Err(Error::bad_input(Self::NAME, problem));
        }
        cx.deck.present.guides = (!next.is_blank()).then_some(next);
        Ok(())
    }
}
