//! How an element's change at a step is drawn: an entrance, an exit or an effect that draws the eye.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::steps::{MOST_STEPS, parse_step};
use super::util::{element_mut, slide_mut};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, FxKind, StepFx, is_color};

/// The longest an effect or its wait may take, in seconds.
const LONGEST_FX: f64 = 10.0;
/// The farthest a motion path may begin from the element's own place, in slide units.
const FARTHEST_PATH: f64 = 20_000.0;

op_types! {
    /// Sets how one element's change is drawn at some steps.
    pub struct SetStepFx {
        pub slide: String,
        pub id: String,
        /// The effect at each step, by step number written as text: `{"1": {"kind": "fly", "direction": "left"}}`.
        /// `null` takes a step's effect away.
        pub fx: BTreeMap<String, Option<StepFx>>,
    }
}

fn check(fx: &StepFx) -> Result<()> {
    let op = SetStepFx::NAME;
    for (name, value) in [("duration", fx.duration), ("delay", fx.delay)] {
        if let Some(v) = value
            && !(0.0..=LONGEST_FX).contains(&v)
        {
            return Err(Error::bad_input(
                op,
                format!("an effect's {name} is between 0 and {LONGEST_FX} seconds, not {v}"),
            ));
        }
    }
    match fx.kind {
        FxKind::Path => {
            let (dx, dy) = (fx.dx.unwrap_or(0.0), fx.dy.unwrap_or(0.0));
            let fine = |v: f64| v.is_finite() && v.abs() <= FARTHEST_PATH;
            if !fine(dx) || !fine(dy) || (dx == 0.0 && dy == 0.0) {
                return Err(Error::bad_input(
                    op,
                    format!(
                        "a motion path needs `dx` and `dy`, where it begins, up to {FARTHEST_PATH} units away and not both 0"
                    ),
                ));
            }
        }
        FxKind::Colour if !fx.color.as_deref().is_some_and(is_color) => {
            return Err(Error::bad_input(
                op,
                "a colour effect needs `color`, a theme colour such as accent1 or #rrggbb",
            ));
        }
        _ => {}
    }
    Ok(())
}

impl Op for SetStepFx {
    type Output = ();
    const NAME: &'static str = "set_step_fx";
    const ABOUT: &'static str = "Set how one element's change is drawn at some steps: {\"1\": {\"kind\": \"fly\", \"direction\": \"left\", \"duration\": 0.5}}. Where the element appears at that step it is an entrance, where it disappears an exit; pulse and colour draw the eye to one that stays. Kinds: appear, fade, fadeUp, grow, fly, zoom, wipe, float, pop, pulse, colour (needs color), path (needs dx and dy: it comes in along a straight line from that far away; one per element). `start` is `with` (the effect before it in the click, the default) or `after`. null takes a step's effect away. The slide gets as many steps as the highest one named.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let mut changes = Vec::with_capacity(self.fx.len());
        for (key, fx) in self.fx {
            let step = parse_step(Self::NAME, &key)?;
            if step == 0 {
                return Err(Error::bad_input(
                    Self::NAME,
                    "step 0 is how the slide appears, so it plays no effect; effects begin at step 1",
                ));
            }
            if let Some(fx) = &fx {
                check(fx)?;
            }
            changes.push((step, fx));
        }
        let reach = changes
            .iter()
            .filter(|(_, fx)| fx.is_some())
            .map(|(step, _)| *step)
            .max()
            .unwrap_or(0)
            .min(MOST_STEPS);
        let slide = slide_mut(cx.deck, &self.slide)?;
        let table = &mut element_mut(slide, &self.id)?.base_mut().step_fx;
        let mut next = table.clone();
        for (step, fx) in changes {
            match fx {
                Some(fx) => {
                    next.insert(step, fx);
                }
                None => {
                    next.remove(&step);
                }
            }
        }
        if next.values().filter(|fx| fx.kind == FxKind::Path).count() > 1 {
            return Err(Error::bad_input(
                Self::NAME,
                "an element has one motion path; take the first away before adding another",
            ));
        }
        *table = next;
        slide.steps = slide.steps.max(reach);
        Ok(())
    }
}
