//! From what the person set to what a request carries. A setting the model
//! does not take, or out of its range, is refused with a sentence, so a
//! request never carries what the provider would turn down. Nothing set means
//! nothing applied, and every body is then built exactly as it was before
//! settings existed.

use super::table::{lookup, route_of};
use super::{Effort, GenerationSettings, ModelCapabilities, Range, Route};
use crate::chat::http::{ANTHROPIC_MAX_TOKENS, HttpModel};

/// Tokens left for the answer beyond what a model may think with.
const ANSWER_ROOM: u32 = 4_096;

/// What a request carries beyond the thread: only what the model takes,
/// already checked. Each is None for the provider's own default.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Applied {
    pub effort: Option<Effort>,
    /// A Claude model's thinking budget; with it, no temperature.
    pub thinking_budget: Option<u32>,
    pub temperature: Option<f64>,
    /// The longest answer. Under a thinking budget it is always set, above it.
    pub max_output: Option<u32>,
}

fn in_range<T: PartialOrd + Copy>(range: &Range<T>, value: T) -> bool {
    value >= range.min && value <= range.max
}

/// Checks `settings` against what the model takes.
pub fn resolve(caps: &ModelCapabilities, settings: &GenerationSettings) -> Result<Applied, String> {
    let name = &caps.model;
    let mut applied = Applied::default();

    if let Some(effort) = settings.reasoning_effort {
        match &caps.reasoning_effort {
            None => return Err(format!("{name} does not take a reasoning effort")),
            // Found to be refused: it is sent without, as the model will have it.
            Some(_) if caps.effort_refused => {}
            Some(taken) if !taken.contains(&effort) => {
                return Err(format!(
                    "{name} does not take the reasoning effort “{}”",
                    effort.as_str()
                ));
            }
            Some(_) => applied.effort = Some(effort),
        }
    }

    if let Some(budget) = settings.thinking_budget {
        let Some(range) = &caps.thinking else {
            return Err(format!("{name} has no thinking budget to set"));
        };
        if budget < range.min || budget > range.max {
            return Err(format!(
                "The thinking budget of {name} is between {} and {} tokens",
                range.min, range.max
            ));
        }
        applied.thinking_budget = Some(budget);
    }

    if let Some(temperature) = settings.temperature {
        if applied.thinking_budget.is_some() {
            return Err(format!(
                "{name} takes no temperature while it is thinking: set one or the other"
            ));
        }
        let Some(range) = &caps.temperature else {
            return Err(format!("{name} takes no temperature"));
        };
        if !temperature.is_finite() || !in_range(range, temperature) {
            return Err(format!(
                "The temperature of {name} is between {} and {}",
                range.min, range.max
            ));
        }
        applied.temperature = Some(temperature);
    }

    if let Some(tokens) = settings.max_output_tokens {
        let Some(range) = &caps.max_output else {
            return Err(format!("{name} takes no limit on the length of its answer"));
        };
        if !in_range(range, tokens) {
            return Err(format!(
                "The longest answer of {name} is between {} and {} tokens",
                range.min, range.max
            ));
        }
        applied.max_output = Some(tokens);
    }

    // A thinking budget has to leave room for the answer: the request's
    // `max_tokens` must be above it.
    if let Some(budget) = applied.thinking_budget {
        let most = caps.max_output.map(|r| r.max);
        let wanted = ANTHROPIC_MAX_TOKENS.max(budget.saturating_add(ANSWER_ROOM));
        let room = applied
            .max_output
            .unwrap_or_else(|| most.map_or(wanted, |m| wanted.min(m)));
        if room <= budget {
            return Err(format!(
                "The longest answer ({room} tokens) must be more than the thinking budget ({budget} tokens)"
            ));
        }
        applied.max_output = Some(room);
    }
    Ok(applied)
}

/// `model` with the settings applied, if any are set: the settings are
/// checked against what its route and name take. `effort_refused` is whether
/// an earlier request found that this model refuses a reasoning effort.
pub fn apply(
    model: HttpModel,
    settings: Option<&GenerationSettings>,
    effort_refused: bool,
) -> Result<HttpModel, String> {
    let mut caps = lookup(route_of(model.kind(), model.url()), model.model_name());
    caps.effort_refused = effort_refused;
    let mut applied = match settings.filter(|s| !s.is_empty()) {
        Some(settings) => resolve(&caps, settings)?,
        None => Applied::default(),
    };
    if applied.max_output.is_none() {
        applied.max_output = roomy_answer(&caps);
    }
    if applied == Applied::default() {
        return Ok(model);
    }
    Ok(model.with_settings(applied))
}

/// The longest answer to ask of OpenAI's own models, which the table knows:
/// a step of real work (a slide, a section, several tool calls) does not fit
/// the 4,096 tokens a local server's small window is kept to. A local
/// server's model, and a name the table does not know, keep the smaller
/// limit.
pub const ROOMY_ANSWER: u32 = 16_384;

pub(super) fn roomy_answer(caps: &ModelCapabilities) -> Option<u32> {
    let official = matches!(caps.route, Route::ChatCompletions { official: true });
    let most = caps.max_output.map(|range| range.max)?;
    (official && caps.family != "unknown").then(|| most.min(ROOMY_ANSWER))
}
