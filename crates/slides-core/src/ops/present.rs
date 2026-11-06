//! Operations on how the whole deck presents.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::slides::LONGEST_TRANSITION;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{CustomShow, Deck, Transition, TransitionKind};

/// The longest a kiosk waits on a slide, in seconds.
const LONGEST_AUTO_ADVANCE: f64 = 3600.0;
/// The most custom shows a deck keeps, and the longest name one has.
const MOST_SHOWS: usize = 32;
const LONGEST_SHOW_NAME: usize = 80;

/// Why a list of custom shows cannot be kept, or None when it can.
fn refuse_shows(deck: &Deck, shows: &[CustomShow]) -> Option<String> {
    if shows.len() > MOST_SHOWS {
        return Some(format!("A deck keeps at most {MOST_SHOWS} custom shows."));
    }
    for (at, show) in shows.iter().enumerate() {
        if show.id.trim().is_empty() || shows[..at].iter().any(|other| other.id == show.id) {
            return Some(format!("Custom show {} needs an id of its own.", at + 1));
        }
        let name = show.name.trim();
        if name.is_empty() || name.chars().count() > LONGEST_SHOW_NAME {
            return Some(format!(
                "A custom show's name is 1 to {LONGEST_SHOW_NAME} characters."
            ));
        }
        if show.slides.is_empty() {
            return Some(format!("The custom show \"{name}\" has no slides."));
        }
        for (i, id) in show.slides.iter().enumerate() {
            if deck.slide(id).is_none() {
                return Some(format!("The custom show \"{name}\" names no slide {id}."));
            }
            if show.slides[..i].contains(id) {
                return Some(format!(
                    "The custom show \"{name}\" names slide {id} twice."
                ));
            }
        }
    }
    None
}

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
        /// Whether the show goes back to the first slide after the last one.
        #[serde(default, rename = "loop", skip_serializing_if = "Option::is_none")]
        pub looped: Option<bool>,
        /// Seconds after which the show moves on by itself (a kiosk); 0 takes it away.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub auto_advance: Option<f64>,
        /// The deck's custom shows, replacing the ones it has; an empty list takes them all away.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub shows: Option<Vec<CustomShow>>,
    }
}

impl Op for SetPresent {
    type Output = ();
    const NAME: &'static str = "set_present";
    const ABOUT: &'static str = "Change how the whole deck presents. `slideNumbers` shows or hides the theme's slide number (a new deck has them off). `transition` ({kind: fade, slide or morph, duration?}) is how every slide arrives unless it names its own; kind none takes it away. `loop` goes back to the first slide after the last; `autoAdvance` (seconds, 0 for none) moves the show on by itself; `shows` replaces the deck's custom shows ({id, name, slides: [slide ids]}). Settings left out stay.";

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
        if let Some(seconds) = self.auto_advance
            && !(0.0..=LONGEST_AUTO_ADVANCE).contains(&seconds)
        {
            return Err(Error::invalid(format!(
                "A slide stays between 0 and {LONGEST_AUTO_ADVANCE} seconds before the show moves on, not {seconds}."
            )));
        }
        if let Some(why) = self
            .shows
            .as_deref()
            .and_then(|shows| refuse_shows(cx.deck, shows))
        {
            return Err(Error::invalid(why));
        }
        if let Some(on) = self.looped {
            cx.deck.present.looped = on;
        }
        if let Some(seconds) = self.auto_advance {
            cx.deck.present.auto_advance = (seconds > 0.0).then_some(seconds);
        }
        if let Some(shows) = self.shows {
            cx.deck.present.shows = shows;
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
