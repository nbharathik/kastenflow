//! The table: for a route and a model's name, what the model takes. Rules
//! are tried in order and match by the start of the name (ignoring case), so
//! a more specific name comes before a general one. A model no rule names is
//! offered nothing, so a request to it is built as it always was.
//!
//! Where each entry comes from:
//! - Claude models: Anthropic's documentation of thinking and sampling. The
//!   newest families think by themselves and refuse a thinking budget and any
//!   temperature, so they take only a longest answer; the 4.6 and 4.5
//!   families take a budget, and a temperature while not thinking.
//! - OpenAI's own API: reasoning models (the o-series and gpt-5) take a
//!   reasoning effort and no temperature; the others a temperature.
//! - Any other OpenAI-compatible server: a temperature and a longest answer.
//! - The ChatGPT plan: never a temperature and never a longest answer (the
//!   route refuses both). A reasoning effort is offered for the reasoning
//!   families as something to try on first use: nothing documents the route's
//!   tolerance for it, so a refusal is handled when it happens.

use super::{Budget, CAPABILITIES_VERSION, Effort, ModelCapabilities, Range, Route};
use crate::chat::http::Kind;
use crate::chat::openai;

/// Which routes a rule is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Applies {
    Anthropic,
    OpenAiOfficial,
    OpenAiCompatible,
    ChatGpt,
}

impl Applies {
    pub fn of(route: Route) -> Applies {
        match route {
            Route::AnthropicMessages => Applies::Anthropic,
            Route::ChatCompletions { official: true } => Applies::OpenAiOfficial,
            Route::ChatCompletions { official: false } => Applies::OpenAiCompatible,
            Route::ChatGptResponses => Applies::ChatGpt,
        }
    }

    /// A route a rule of this kind applies to.
    #[cfg(test)]
    pub fn route(self) -> Route {
        match self {
            Applies::Anthropic => Route::AnthropicMessages,
            Applies::OpenAiOfficial => Route::ChatCompletions { official: true },
            Applies::OpenAiCompatible => Route::ChatCompletions { official: false },
            Applies::ChatGpt => Route::ChatGptResponses,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Rule {
    pub applies: Applies,
    /// The start of the model's name, in lower case.
    pub prefix: &'static str,
    pub family: &'static str,
    pub verified: bool,
    pub efforts: &'static [Effort],
    pub thinking: Option<Budget>,
    pub temperature: Option<Range<f64>>,
    pub max_output: Option<Range<u32>>,
}

const THREE: &[Effort] = &[Effort::Low, Effort::Medium, Effort::High];
const FOUR: &[Effort] = &[Effort::Minimal, Effort::Low, Effort::Medium, Effort::High];
/// A budget needs `max_tokens` above it, which the request makes room for.
const THINKS: Option<Budget> = Some(Budget {
    min: 1024,
    max: 31_999,
    default: 8_000,
});
const UP_TO_TWO: Option<Range<f64>> = Some(Range { min: 0.0, max: 2.0 });
const UP_TO_ONE: Option<Range<f64>> = Some(Range { min: 0.0, max: 1.0 });

const fn up_to(max: u32) -> Option<Range<u32>> {
    Some(Range { min: 256, max })
}

/// A rule that offers nothing, to build the others from.
const NOTHING: Rule = Rule {
    applies: Applies::Anthropic,
    prefix: "",
    family: "",
    verified: true,
    efforts: &[],
    thinking: None,
    temperature: None,
    max_output: None,
};

/// Claude models that think by themselves: no budget, no temperature.
const fn claude_adaptive(prefix: &'static str, family: &'static str) -> Rule {
    Rule {
        prefix,
        family,
        max_output: up_to(128_000),
        ..NOTHING
    }
}

// One rule to a line, so the table reads as a table.
#[rustfmt::skip]
pub const RULES: &[Rule] = &[
    // The ChatGPT plan: an effort to try on first use, nothing else.
    Rule { applies: Applies::ChatGpt, prefix: "gpt-6", family: "gpt-6", verified: false, efforts: THREE, ..NOTHING },
    Rule { applies: Applies::ChatGpt, prefix: "gpt-5", family: "gpt-5", verified: false, efforts: THREE, ..NOTHING },
    Rule { applies: Applies::ChatGpt, prefix: "o4", family: "o-series", verified: false, efforts: THREE, ..NOTHING },
    Rule { applies: Applies::ChatGpt, prefix: "o3", family: "o-series", verified: false, efforts: THREE, ..NOTHING },
    Rule { applies: Applies::ChatGpt, prefix: "o1", family: "o-series", verified: false, efforts: THREE, ..NOTHING },
    // OpenAI's own API.
    Rule { applies: Applies::OpenAiOfficial, prefix: "o1-mini", family: "o1-mini", max_output: up_to(65_536), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "o1-preview", family: "o1-preview", max_output: up_to(32_768), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "gpt-5-chat", family: "gpt-5-chat", verified: false, temperature: UP_TO_ONE, max_output: up_to(16_384), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "gpt-6", family: "gpt-6", verified: false, efforts: FOUR, max_output: up_to(100_000), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "gpt-5", family: "gpt-5", efforts: FOUR, max_output: up_to(100_000), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "o4", family: "o-series", efforts: FOUR, max_output: up_to(100_000), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "o3", family: "o-series", efforts: FOUR, max_output: up_to(100_000), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "o1", family: "o-series", efforts: FOUR, max_output: up_to(100_000), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "gpt-4.1", family: "gpt-4.1", temperature: UP_TO_TWO, max_output: up_to(32_768), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "gpt-4o", family: "gpt-4o", temperature: UP_TO_TWO, max_output: up_to(16_384), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "gpt-4-turbo", family: "gpt-4-turbo", temperature: UP_TO_TWO, max_output: up_to(4_096), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "gpt-4", family: "gpt-4", temperature: UP_TO_TWO, max_output: up_to(8_192), ..NOTHING },
    Rule { applies: Applies::OpenAiOfficial, prefix: "gpt-3.5", family: "gpt-3.5", temperature: UP_TO_TWO, max_output: up_to(4_096), ..NOTHING },
    // A local server, or any other that speaks the same API.
    Rule { applies: Applies::OpenAiCompatible, prefix: "", family: "openai-compatible", temperature: UP_TO_TWO, max_output: up_to(131_072), ..NOTHING },
    // Claude models that think by themselves.
    claude_adaptive("claude-fable-5", "claude-fable-5"),
    claude_adaptive("claude-mythos-5", "claude-mythos-5"),
    claude_adaptive("claude-opus-5", "claude-opus-5"),
    claude_adaptive("claude-sonnet-5", "claude-sonnet-5"),
    claude_adaptive("claude-haiku-5", "claude-haiku-5"),
    claude_adaptive("claude-opus-4-8", "claude-opus-4.8"),
    claude_adaptive("claude-opus-4-7", "claude-opus-4.7"),
    // Claude models that take a thinking budget (and a temperature when not thinking).
    Rule { prefix: "claude-opus-4-6", family: "claude-opus-4.6", thinking: THINKS, temperature: UP_TO_ONE, max_output: up_to(128_000), ..NOTHING },
    Rule { prefix: "claude-sonnet-4-6", family: "claude-sonnet-4.6", thinking: THINKS, temperature: UP_TO_ONE, max_output: up_to(128_000), ..NOTHING },
    Rule { prefix: "claude-opus-4-5", family: "claude-opus-4.5", thinking: THINKS, temperature: UP_TO_ONE, max_output: up_to(32_000), ..NOTHING },
    Rule { prefix: "claude-sonnet-4-5", family: "claude-sonnet-4.5", thinking: THINKS, temperature: UP_TO_ONE, max_output: up_to(32_000), ..NOTHING },
    Rule { prefix: "claude-haiku-4-5", family: "claude-haiku-4.5", thinking: THINKS, temperature: UP_TO_ONE, max_output: up_to(32_000), ..NOTHING },
];

/// What `model` takes on `route`. A model no rule names takes nothing.
pub fn lookup(route: Route, model: &str) -> ModelCapabilities {
    let model = model.trim();
    let lower = model.to_ascii_lowercase();
    let kind = Applies::of(route);
    let found = RULES
        .iter()
        .find(|r| r.applies == kind && lower.starts_with(r.prefix));
    let (family, verified, rule) = match found {
        Some(rule) => (rule.family, rule.verified, Some(rule)),
        None => ("unknown", false, None),
    };
    let (vision, vision_known) = super::window::vision(route, family);
    ModelCapabilities {
        vision,
        vision_known,
        context_window: super::window::context_window(route, family),
        version: CAPABILITIES_VERSION,
        route,
        model: model.to_owned(),
        family: family.to_owned(),
        verified,
        reasoning_effort: rule
            .filter(|r| !r.efforts.is_empty())
            .map(|r| r.efforts.to_vec()),
        thinking: rule.and_then(|r| r.thinking),
        temperature: rule.and_then(|r| r.temperature),
        max_output: rule.and_then(|r| r.max_output),
        effort_refused: false,
    }
}

/// The route of a provider's requests: its kind, and for OpenAI-compatible
/// ones whether the address is OpenAI's own.
pub fn route_of(kind: Kind, url: &str) -> Route {
    match kind {
        Kind::Anthropic => Route::AnthropicMessages,
        Kind::OpenAi => Route::ChatCompletions {
            official: openai::is_official(url),
        },
        Kind::ChatGpt => Route::ChatGptResponses,
    }
}
