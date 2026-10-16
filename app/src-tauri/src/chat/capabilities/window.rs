//! Two more things the table says about a model, kept apart from its
//! rules so those stay as they were: how much it reads at once, and
//! whether it reads pictures. Both go by the family the table matched.
//!
//! The windows are the providers' published context sizes, held down to
//! 400,000 tokens: a chat that long is better summarised early than lost
//! to a miss. A model nothing is known about gets 100,000, a size nearly
//! every model, local ones included, reads.

use super::Route;

/// For a model the table does not know.
pub const DEFAULT_WINDOW: u32 = 100_000;

/// Past this, a window counts as this.
const MOST: u32 = 400_000;

/// Tokens the model reads at once.
pub fn context_window(route: Route, family: &str) -> u32 {
    let tokens = match route {
        Route::AnthropicMessages => 200_000,
        Route::ChatGptResponses => match family {
            "gpt-6" | "gpt-5" | "o-series" => 200_000,
            _ => DEFAULT_WINDOW,
        },
        Route::ChatCompletions { official: true } => match family {
            "gpt-6" | "gpt-5" => 400_000,
            "gpt-5-chat" | "gpt-4o" | "gpt-4-turbo" => 128_000,
            "o-series" | "o1-mini" | "o1-preview" => 128_000,
            "gpt-4.1" => 1_000_000,
            "gpt-4" => 8_192,
            "gpt-3.5" => 16_385,
            _ => DEFAULT_WINDOW,
        },
        // A local server's window is the model's own, which is not known.
        Route::ChatCompletions { official: false } => DEFAULT_WINDOW,
    };
    tokens.min(MOST)
}

/// Whether the model reads pictures, and whether that is known.
pub fn vision(route: Route, family: &str) -> (bool, bool) {
    match route {
        Route::AnthropicMessages => (true, true),
        // Nothing documents the plan's route; it is tried and a refusal said.
        Route::ChatGptResponses => (matches!(family, "gpt-6" | "gpt-5" | "o-series"), false),
        Route::ChatCompletions { official: true } => match family {
            "gpt-6" | "gpt-5" | "gpt-5-chat" | "gpt-4o" | "gpt-4.1" | "gpt-4-turbo" => (true, true),
            "o-series" => (true, true),
            "unknown" => (false, false),
            _ => (false, true),
        },
        Route::ChatCompletions { official: false } => (false, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::capabilities::lookup;

    const OPENAI: Route = Route::ChatCompletions { official: true };
    const LOCAL: Route = Route::ChatCompletions { official: false };

    #[test]
    fn a_window_is_known_by_family_and_never_past_the_most() {
        assert_eq!(
            lookup(Route::AnthropicMessages, "claude-sonnet-5").context_window,
            200_000
        );
        assert_eq!(lookup(OPENAI, "gpt-4.1-mini").context_window, 400_000);
        assert_eq!(lookup(OPENAI, "gpt-4").context_window, 8_192);
        assert_eq!(lookup(OPENAI, "gpt-4o-mini").context_window, 128_000);
        assert_eq!(
            lookup(Route::ChatGptResponses, "gpt-5.2").context_window,
            200_000
        );
        // Nothing is known about a local model or a name no rule has.
        assert_eq!(lookup(LOCAL, "llama-3.1-8b").context_window, DEFAULT_WINDOW);
        assert_eq!(lookup(OPENAI, "mystery").context_window, DEFAULT_WINDOW);
    }

    #[test]
    fn openais_known_models_get_a_roomy_answer_and_nobody_else_does() {
        use crate::chat::capabilities::resolve::{ROOMY_ANSWER, roomy_answer};
        let room = |route, model: &str| roomy_answer(&lookup(route, model));
        assert_eq!(room(OPENAI, "gpt-4o"), Some(ROOMY_ANSWER));
        assert_eq!(room(OPENAI, "gpt-5-mini"), Some(ROOMY_ANSWER));
        // Held to what the model can write, whichever is less.
        assert_eq!(room(OPENAI, "gpt-4"), Some(8_192));
        assert_eq!(room(OPENAI, "gpt-3.5-turbo"), Some(4_096));
        // A local server's small window, a name nothing is known about, and
        // the routes that set their own limit are left as they were.
        assert_eq!(room(LOCAL, "llama-3.1-8b"), None);
        assert_eq!(room(OPENAI, "mystery"), None);
        assert_eq!(room(Route::AnthropicMessages, "claude-sonnet-5"), None);
        assert_eq!(room(Route::ChatGptResponses, "gpt-5"), None);
        assert_eq!(ROOMY_ANSWER, 16_384);
    }

    #[test]
    fn pictures_are_read_where_the_documentation_says_so() {
        let sees = |route, model: &str| {
            let caps = lookup(route, model);
            (caps.vision, caps.vision_known)
        };
        assert_eq!(
            sees(Route::AnthropicMessages, "claude-opus-5"),
            (true, true)
        );
        assert_eq!(sees(OPENAI, "gpt-4o"), (true, true));
        assert_eq!(sees(OPENAI, "o1-mini"), (false, true));
        assert_eq!(sees(OPENAI, "gpt-3.5-turbo"), (false, true));
        assert_eq!(sees(OPENAI, "mystery"), (false, false));
        // The plan is tried, not known; a local server is not known at all.
        assert_eq!(sees(Route::ChatGptResponses, "gpt-5"), (true, false));
        assert_eq!(sees(LOCAL, "llava"), (false, false));
    }
}
