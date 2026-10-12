//! Operations on how the whole deck presents.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::slides::LONGEST_TRANSITION;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Transition, TransitionKind};

op_types! {
    /// Changes the deck's presenting settings. Only the settings given change;
    /// the ones left out stay as they are, so a later setting joins as one more
    /// optional field.
    pub struct SetPresent {
        /// Whether the slide number the theme draws on every slide shows, in the editor, when presenting and in an exported file.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub slide_numbers: Option<bool>,
        /// How a slide that names no transition of its own arrives. A transition of kind `none` takes the deck's away, so each slide arrives with a plain cut again.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub transition: Option<Transition>,
    }
}

impl Op for SetPresent {
    type Output = ();
    const NAME: &'static str = "set_present";
    const ABOUT: &'static str = "Change how the whole deck presents. `slideNumbers` shows or hides the slide number the theme draws on every slide (a new deck has them off; a number a slide carries as its own text is not affected). `transition` ({kind: fade, slide or morph, duration?}) is how every slide arrives unless it names a transition of its own; kind none takes it away. Settings left out stay as they are.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_meta()
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if let Some(duration) = self.transition.as_ref().and_then(|t| t.duration)
            && !(0.0..=LONGEST_TRANSITION).contains(&duration)
        {
            return Err(Error::invalid(format!(
                "A transition takes between 0 and {LONGEST_TRANSITION} seconds, not {duration}."
            )));
        }
        if let Some(on) = self.slide_numbers {
            cx.deck.present.slide_numbers = on;
        }
        if let Some(transition) = self.transition {
            cx.deck.present.transition =
                (transition.kind != TransitionKind::None).then_some(transition);
        }
        Ok(())
    }
}
