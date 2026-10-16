use super::resolve::resolve;
use super::table::{Applies, RULES, lookup, route_of};
use super::*;
use crate::chat::http::Kind;

const CHATGPT: Route = Route::ChatGptResponses;
const CLAUDE: Route = Route::AnthropicMessages;
const OPENAI: Route = Route::ChatCompletions { official: true };
const LOCAL: Route = Route::ChatCompletions { official: false };

/// FNV-1a, to pin a table without writing it out twice.
fn fingerprint(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[test]
fn the_table_is_pinned_to_its_version() {
    // Changing a rule changes this number: bump CAPABILITIES_VERSION with it,
    // so an answer kept from the old table can be told apart.
    let table: Vec<String> = RULES.iter().map(|r| format!("{r:?}")).collect();
    assert_eq!(
        (CAPABILITIES_VERSION, fingerprint(&table.join("\n"))),
        (2, 7_096_765_717_702_838_565)
    );
}

#[test]
fn every_rule_is_reached_by_its_own_prefix_and_belongs_to_its_route() {
    for rule in RULES {
        let route = rule.applies.route();
        assert_eq!(Applies::of(route), rule.applies, "{}", rule.prefix);
        let model = if rule.prefix.is_empty() {
            "some-model"
        } else {
            rule.prefix
        };
        let found = lookup(route, model);
        assert_eq!(
            found.family, rule.family,
            "{} is hidden by a rule before it",
            rule.prefix
        );
        assert_eq!((found.route, found.version), (route, CAPABILITIES_VERSION));
        assert_eq!(rule.prefix, rule.prefix.to_ascii_lowercase());
    }
    // A provider's kind and address lead to the route its rules are for.
    assert_eq!(route_of(Kind::Anthropic, ""), CLAUDE);
    assert_eq!(route_of(Kind::ChatGpt, ""), CHATGPT);
    assert_eq!(
        route_of(Kind::OpenAi, "https://api.openai.com/v1/chat/completions"),
        OPENAI
    );
    assert_eq!(
        route_of(Kind::OpenAi, "http://localhost:11434/v1/chat/completions"),
        LOCAL
    );
}

#[test]
fn the_chatgpt_plan_never_gets_a_temperature_or_a_longest_answer() {
    for rule in RULES.iter().filter(|r| r.applies == Applies::ChatGpt) {
        assert!(rule.temperature.is_none() && rule.max_output.is_none() && rule.thinking.is_none());
    }
    for model in ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol", "o3", "mystery"] {
        let caps = lookup(CHATGPT, model);
        assert!(
            caps.temperature.is_none() && caps.max_output.is_none(),
            "{model}"
        );
    }
}

#[test]
fn the_plans_reasoning_families_are_offered_an_effort_to_try() {
    for model in ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol", "o4-mini"] {
        let caps = lookup(CHATGPT, model);
        assert_eq!(
            caps.reasoning_effort,
            Some(vec![Effort::Low, Effort::Medium, Effort::High]),
            "{model}"
        );
        assert!(
            !caps.verified,
            "{model}: nothing documents this route's take on it"
        );
        assert!(!caps.effort_refused);
    }
    // A name no rule has is offered nothing, and said so.
    let unknown = lookup(CHATGPT, "mystery-model");
    assert_eq!(unknown.family, "unknown");
    assert!(unknown.reasoning_effort.is_none() && !unknown.verified);
}

#[test]
fn openais_reasoning_models_take_an_effort_and_no_temperature() {
    for model in [
        "gpt-5",
        "gpt-5-mini",
        "o3-mini",
        "o4-mini",
        "o1",
        "GPT-5-Nano",
    ] {
        let caps = lookup(OPENAI, model);
        assert!(caps.reasoning_effort.is_some(), "{model}");
        assert!(caps.temperature.is_none(), "{model}");
        assert!(caps.max_output.is_some(), "{model}");
    }
    // The ones before them that do not reason.
    for model in [
        "o1-mini",
        "o1-preview",
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4.1-mini",
        "gpt-4-turbo-preview",
        "gpt-4",
        "gpt-3.5-turbo",
        "gpt-5-chat-latest",
    ] {
        assert!(lookup(OPENAI, model).reasoning_effort.is_none(), "{model}");
    }
    assert!(lookup(OPENAI, "gpt-4o").temperature.is_some());
    assert!(lookup(OPENAI, "gpt-5-chat-latest").temperature.is_some());
    assert!(lookup(OPENAI, "o1-mini").temperature.is_none());
    // Specific before general: gpt-4.1 and gpt-4-turbo are not plain gpt-4.
    assert_eq!(lookup(OPENAI, "gpt-4.1-nano").family, "gpt-4.1");
    assert_eq!(lookup(OPENAI, "gpt-4-turbo").family, "gpt-4-turbo");
    // A model the table does not know takes nothing at OpenAI.
    let unknown = lookup(OPENAI, "text-embedding-3-small");
    assert!(
        unknown.temperature.is_none()
            && unknown.max_output.is_none()
            && unknown.reasoning_effort.is_none()
    );
}

#[test]
fn a_local_server_gets_a_temperature_and_a_longest_answer_and_no_reasoning() {
    for model in ["llama3.1:8b", "qwen3", "gpt-5", "anything"] {
        let caps = lookup(LOCAL, model);
        assert_eq!(caps.family, "openai-compatible");
        assert_eq!(caps.temperature, Some(Range { min: 0.0, max: 2.0 }));
        assert!(
            caps.max_output.is_some() && caps.reasoning_effort.is_none() && caps.thinking.is_none(),
            "{model}"
        );
    }
}

#[test]
fn claude_models_that_think_by_themselves_take_no_budget_and_no_temperature() {
    for model in [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-fable-5-1",
        "claude-opus-4-8",
        "claude-opus-4-7",
    ] {
        let caps = lookup(CLAUDE, model);
        assert!(
            caps.thinking.is_none() && caps.temperature.is_none(),
            "{model}"
        );
        assert_eq!(
            caps.max_output,
            Some(Range {
                min: 256,
                max: 128_000
            }),
            "{model}"
        );
        assert!(caps.verified, "{model}");
    }
}

#[test]
fn claude_models_with_a_budget_take_a_temperature_only_while_not_thinking() {
    for model in [
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "claude-opus-4-5",
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
        "Claude-Sonnet-4-5",
    ] {
        let caps = lookup(CLAUDE, model);
        let budget = caps.thinking.unwrap_or_else(|| panic!("{model}"));
        assert!(
            budget.min >= 1024 && budget.default >= budget.min && budget.default <= budget.max,
            "{model}"
        );
        assert_eq!(
            caps.temperature,
            Some(Range { min: 0.0, max: 1.0 }),
            "{model}"
        );
        assert!(
            caps.max_output.is_some_and(|m| m.max > budget.max),
            "{model}: room for the answer"
        );
    }
    // Names the table does not know are offered nothing.
    for model in [
        "claude-3-5-sonnet-20241022",
        "claude-next",
        "gateway/claude",
    ] {
        let caps = lookup(CLAUDE, model);
        assert!(
            caps.thinking.is_none() && caps.temperature.is_none() && caps.max_output.is_none(),
            "{model}"
        );
        assert_eq!(caps.family, "unknown");
    }
}

fn set(f: impl FnOnce(&mut GenerationSettings)) -> GenerationSettings {
    let mut settings = GenerationSettings::default();
    f(&mut settings);
    settings
}

fn refusal(route: Route, model: &str, settings: &GenerationSettings) -> String {
    resolve(&lookup(route, model), settings).unwrap_err()
}

#[test]
fn nothing_set_applies_nothing_on_any_route() {
    for (route, model) in [
        (CHATGPT, "gpt-6.1-sol"),
        (CLAUDE, "claude-opus-5-5"),
        (OPENAI, "gpt-5"),
        (LOCAL, "llama3"),
        (LOCAL, ""),
    ] {
        assert_eq!(
            resolve(&lookup(route, model), &GenerationSettings::default()),
            Ok(Applied::default()),
            "{model}"
        );
    }
    assert!(GenerationSettings::default().is_empty());
    assert!(!set(|s| s.temperature = Some(0.5)).is_empty());
}

#[test]
fn an_effort_is_taken_where_the_table_offers_it() {
    let high = set(|s| s.reasoning_effort = Some(Effort::High));
    assert_eq!(
        resolve(&lookup(CHATGPT, "gpt-6.1-sol"), &high)
            .unwrap()
            .effort,
        Some(Effort::High)
    );
    assert_eq!(
        resolve(&lookup(OPENAI, "o3"), &high).unwrap().effort,
        Some(Effort::High)
    );
    assert!(refusal(LOCAL, "llama3", &high).contains("does not take a reasoning effort"));
    assert!(refusal(CLAUDE, "claude-opus-5-5", &high).contains("reasoning effort"));
    assert!(refusal(OPENAI, "gpt-4o", &high).contains("reasoning effort"));
    // Minimal is for OpenAI's own API; the plan's list starts at low.
    let minimal = set(|s| s.reasoning_effort = Some(Effort::Minimal));
    assert!(resolve(&lookup(OPENAI, "gpt-5"), &minimal).is_ok());
    assert!(refusal(CHATGPT, "gpt-6.1-sol", &minimal).contains("“minimal”"));
}

#[test]
fn an_effort_found_to_be_refused_is_left_out_without_a_fuss() {
    let mut caps = lookup(CHATGPT, "gpt-6.1-sol");
    caps.effort_refused = true;
    let applied = resolve(&caps, &set(|s| s.reasoning_effort = Some(Effort::High))).unwrap();
    assert_eq!(applied, Applied::default());
}

#[test]
fn the_plan_refuses_a_temperature_and_a_longest_answer_in_words() {
    let hot = set(|s| s.temperature = Some(0.5));
    assert_eq!(
        refusal(CHATGPT, "gpt-6.1-sol", &hot),
        "gpt-6.1-sol takes no temperature"
    );
    let long = set(|s| s.max_output_tokens = Some(1000));
    assert!(refusal(CHATGPT, "gpt-6.1-sol", &long).contains("takes no limit"));
    assert!(refusal(OPENAI, "gpt-5", &hot).contains("takes no temperature"));
    assert!(refusal(CLAUDE, "claude-opus-5-5", &hot).contains("takes no temperature"));
}

#[test]
fn a_temperature_and_a_longest_answer_are_held_to_their_ranges() {
    let at = |t: f64| set(|s| s.temperature = Some(t));
    assert_eq!(
        resolve(&lookup(LOCAL, "m"), &at(1.5)).unwrap().temperature,
        Some(1.5)
    );
    assert_eq!(
        resolve(&lookup(LOCAL, "m"), &at(0.0)).unwrap().temperature,
        Some(0.0)
    );
    for bad in [2.1, -0.1, f64::NAN, f64::INFINITY] {
        assert!(
            refusal(LOCAL, "m", &at(bad)).contains("between 0 and 2"),
            "{bad}"
        );
    }
    assert!(refusal(CLAUDE, "claude-sonnet-4-5", &at(1.5)).contains("between 0 and 1"));
    let up_to = |n: u32| set(|s| s.max_output_tokens = Some(n));
    assert_eq!(
        resolve(&lookup(LOCAL, "m"), &up_to(8000))
            .unwrap()
            .max_output,
        Some(8000)
    );
    assert!(refusal(LOCAL, "m", &up_to(10)).contains("between 256 and 131072"));
    assert!(refusal(LOCAL, "m", &up_to(500_000)).contains("longest answer"));
    assert_eq!(
        resolve(&lookup(OPENAI, "gpt-5"), &up_to(50_000))
            .unwrap()
            .max_output,
        Some(50_000)
    );
}

#[test]
fn a_thinking_budget_leaves_room_for_the_answer_and_no_temperature() {
    let caps = lookup(CLAUDE, "claude-sonnet-4-5");
    let think = |b: u32| set(|s| s.thinking_budget = Some(b));
    // Room for the answer is made: the default 16,000, or the budget and a margin.
    let applied = resolve(&caps, &think(4000)).unwrap();
    assert_eq!(
        (applied.thinking_budget, applied.max_output),
        (Some(4000), Some(16_000))
    );
    let applied = resolve(&caps, &think(20_000)).unwrap();
    assert_eq!(applied.max_output, Some(24_096));
    // Never past what the model's answer may be, and still above the budget.
    let applied = resolve(&caps, &think(31_999)).unwrap();
    assert_eq!(applied.max_output, Some(32_000));
    // A longest answer set by the person is kept when it is above the budget.
    let both = set(|s| {
        s.thinking_budget = Some(2000);
        s.max_output_tokens = Some(3000);
    });
    assert_eq!(resolve(&caps, &both).unwrap().max_output, Some(3000));
    let low = set(|s| {
        s.thinking_budget = Some(4000);
        s.max_output_tokens = Some(4000);
    });
    assert!(
        resolve(&caps, &low)
            .unwrap_err()
            .contains("must be more than the thinking budget")
    );
    // Range and support.
    assert!(
        resolve(&caps, &think(500))
            .unwrap_err()
            .contains("between 1024 and 31999")
    );
    assert!(resolve(&caps, &think(40_000)).is_err());
    assert!(refusal(CLAUDE, "claude-opus-5-5", &think(4000)).contains("no thinking budget"));
    assert!(refusal(OPENAI, "gpt-5", &think(4000)).contains("no thinking budget"));
    // A temperature alone is fine; with thinking on, it is one or the other.
    assert_eq!(
        resolve(&caps, &set(|s| s.temperature = Some(0.4)))
            .unwrap()
            .temperature,
        Some(0.4)
    );
    let both = set(|s| {
        s.thinking_budget = Some(4000);
        s.temperature = Some(0.4);
    });
    assert!(
        resolve(&caps, &both)
            .unwrap_err()
            .contains("while it is thinking")
    );
}
