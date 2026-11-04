//! Steps: how many clicks a slide has, how one element looks at each of them,
//! and the builds that set many elements at once.
//!
//! A slide with `steps: N` has N + 1 states. State 0 is what shows when the slide
//! appears and each click moves one step on. An element's `stepStates` say how it
//! looks from a step onward, until the next entry.

mod order;
mod recipes;

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::util::{each_mut, element_mut, slide_mut};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Element, StepState};

use order::most_demanding;
use order::texts_mut;
pub use order::{order_of, reading_order, steps_in_use, steps_required};

/// The most clicks a slide can have.
pub const MOST_STEPS: u32 = 50;

op_types! {
    /// Sets how many clicks a slide has after it appears.
    pub struct SetSlideSteps {
        pub slide: String,
        /// From 0 (none) to 50.
        pub steps: u32,
    }
}

/// Moves what happens after step `to` onto step `to`, so the slide ends up looking as it
/// ended before: an element's last state is its state at the last step, and a paragraph
/// that came later comes with the last click. An entry that would change nothing is not made.
fn fold_into(element: &mut Element, to: u32) {
    let states = &mut element.base_mut().step_states;
    if let Some((&last, finally)) = states.iter().next_back().map(|(k, v)| (k, v.clone()))
        && last > to
    {
        states.retain(|step, _| *step <= to);
        let now = states
            .values()
            .next_back()
            .cloned()
            .unwrap_or(StepState::Normal);
        if finally != now {
            states.insert(to, finally);
        }
        // An element that starts as it would anyway needs no entry to say so.
        if states.values().next() == Some(&StepState::Normal) {
            states.pop_first();
        }
    }
    for text in texts_mut(element) {
        for paragraph in &mut text.paragraphs {
            if paragraph.step.is_some_and(|step| step > to) {
                paragraph.step = Some(to);
            }
        }
    }
}

impl Op for SetSlideSteps {
    type Output = ();
    const NAME: &'static str = "set_slide_steps";
    const ABOUT: &'static str = "Set how many clicks a slide has after it appears, from 0 to 50. State 0 is what shows when the slide appears and each click moves one step on. Raising the number adds empty steps. Lowering it moves what the removed steps did onto the last one, so the slide ends up looking as it did at the end. It cannot go below the steps a code block's lines in focus need.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if self.steps > MOST_STEPS {
            return Err(Error::bad_input(
                Self::NAME,
                format!(
                    "a slide has between 0 and {MOST_STEPS} steps, not {}",
                    self.steps
                ),
            ));
        }
        let slide = slide_mut(cx.deck, &self.slide)?;
        let asked = most_demanding(slide).map(|(e, need)| (e.kind(), e.id().to_owned(), need));
        // A slide cannot have more than the most, so a walkthrough longer than that asks for that.
        if let Some((kind, id, need)) =
            asked.map(|(kind, id, need)| (kind, id, need.min(MOST_STEPS)))
            && self.steps < need
        {
            return Err(Error::refused(format!(
                "the {kind} `{id}` has {need} steps of its own (its lines in focus), so the slide needs at least {need}; take entries out of its `focus` first, or ask for {need} or more"
            )));
        }
        slide.steps = self.steps;
        each_mut(&mut slide.elements, &mut |e| fold_into(e, self.steps));
        Ok(())
    }
}

op_types! {
    /// Sets how one element looks at some steps.
    pub struct SetStepStates {
        pub slide: String,
        pub id: String,
        /// The state from each step onward, by step number written as text: `{"0": "hidden", "2": "normal"}`.
        /// States are `hidden`, `dimmed`, `normal` and `highlighted`; `null` takes a step's entry away.
        pub states: BTreeMap<String, Option<StepState>>,
    }
}

/// A step as a key of a map of states: a whole number from 0 to 50, written plainly.
pub(super) fn parse_step(op: &str, key: &str) -> Result<u32> {
    let step = key.parse::<u32>().ok().filter(|s| s.to_string() == key);
    match step {
        Some(step) if step <= MOST_STEPS => Ok(step),
        Some(step) => Err(Error::bad_input(
            op,
            format!("step {step} is more than the {MOST_STEPS} a slide can have"),
        )),
        None => Err(Error::bad_input(
            op,
            format!(
                "a step is a whole number from 0 to {MOST_STEPS} written plainly, such as \"2\"; `{key}` is not"
            ),
        )),
    }
}

impl Op for SetStepStates {
    type Output = ();
    const NAME: &'static str = "set_step_states";
    const ABOUT: &'static str = "Set how one element looks from some steps onward: {\"0\": \"hidden\", \"2\": \"normal\"} hides it until the second click. The states are hidden, dimmed, normal and highlighted (the theme's outline). A state holds until the next entry, and an element with none is normal. Entries are merged into the element's own and null takes one away. The slide gets as many steps as the highest one named.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let mut changes = Vec::with_capacity(self.states.len());
        for (key, state) in self.states {
            changes.push((parse_step(Self::NAME, &key)?, state));
        }
        let reach = changes
            .iter()
            .filter(|(_, state)| state.is_some())
            .map(|(step, _)| *step)
            .max()
            .unwrap_or(0);
        let slide = slide_mut(cx.deck, &self.slide)?;
        let states = &mut element_mut(slide, &self.id)?.base_mut().step_states;
        for (step, state) in changes {
            match state {
                Some(state) => {
                    states.insert(step, state);
                }
                None => {
                    states.remove(&step);
                }
            }
        }
        slide.steps = slide.steps.max(reach);
        Ok(())
    }
}

op_types! {
    /// What a build does to the elements it is given.
    pub enum Recipe {
        /// The elements appear one by one in reading order; a single list, one item at a time.
        Reveal,
        /// Each element is highlighted in turn while the others are dimmed.
        Walkthrough,
        /// Each element is the one left as it is in turn while every other is dimmed.
        Spotlight,
        /// Takes every state and paragraph step from the elements.
        Clear,
    }

    /// Builds the steps of a set of elements in one go.
    pub struct BuildSteps {
        pub slide: String,
        /// The elements to build, in any order; at least one.
        pub ids: Vec<String>,
        pub recipe: Recipe,
    }

    pub struct BuiltSteps {
        /// The steps the slide has now.
        pub steps: u32,
        /// The elements in the order the build took them: reading order, or the order given for a clear.
        pub order: Vec<String>,
    }
}

impl Op for BuildSteps {
    type Output = BuiltSteps;
    const NAME: &'static str = "build_steps";
    const ABOUT: &'static str = "Build steps for a set of elements in one go. `reveal`: they appear one by one in reading order (top to bottom, then left to right); a single text box with a list shows one item per step. `walkthrough`: each is highlighted in turn while the others are dimmed, and the slide arrives as it is. `spotlight`: each is left as it is in turn while every other is dimmed. `clear`: takes every state and paragraph step from them. The recipes replace the states of the elements named, leave the others alone, and set the slide's steps to what it needs.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<BuiltSteps> {
        if self.ids.is_empty() {
            return Err(Error::bad_input(
                Self::NAME,
                "`ids` is empty: name the elements to build, such as the boxes of a diagram",
            ));
        }
        let Deck { theme, slides, .. } = &mut *cx.deck;
        let slide = slides
            .iter_mut()
            .find(|s| s.id == self.slide)
            .ok_or_else(|| Error::no_slide(&self.slide))?;
        let mut wanted: Vec<&String> = Vec::new();
        for id in &self.ids {
            if slide.element(id).is_none() {
                return Err(Error::no_element(&self.slide, id));
            }
            if !wanted.contains(&id) {
                wanted.push(id);
            }
        }
        let order: Vec<String> = if matches!(self.recipe, Recipe::Clear) {
            wanted.iter().map(|id| (*id).clone()).collect()
        } else {
            let found = wanted.iter().filter_map(|id| slide.element(id));
            super::access::read_in_order(theme, &slide.layout, slide.access.as_ref(), found)
                .iter()
                .map(|e| e.id().to_owned())
                .collect()
        };
        let total = u32::try_from(order.len()).unwrap_or(u32::MAX);
        if matches!(self.recipe, Recipe::Spotlight) && order.len() < 2 {
            return Err(Error::refused(
                "A spotlight dims the other elements, so it needs at least two. Choose more, or walk through a single element.",
            ));
        }
        let single_list = match (&self.recipe, order.as_slice()) {
            (Recipe::Reveal, [only]) => slide
                .element(only)
                .is_some_and(|e| recipes::items_in(e) >= 2),
            _ => false,
        };
        for (place, id) in order.iter().enumerate() {
            let position = u32::try_from(place + 1).unwrap_or(u32::MAX);
            let element = element_mut(slide, id)?;
            if single_list {
                recipes::reveal_items(element);
                continue;
            }
            recipes::reset(element);
            element.base_mut().step_states = match self.recipe {
                Recipe::Reveal => recipes::reveal(position, total),
                Recipe::Walkthrough => recipes::in_turn(position, total, StepState::Highlighted),
                Recipe::Spotlight => recipes::in_turn(position, total, StepState::Normal),
                Recipe::Clear => BTreeMap::new(),
            };
        }
        slide.steps = steps_required(slide);
        Ok(BuiltSteps {
            steps: slide.steps,
            order,
        })
    }
}
