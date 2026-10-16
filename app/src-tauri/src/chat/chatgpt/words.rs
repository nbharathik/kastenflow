//! What ChatGPT's refusals mean, in words for the person: the codes of a
//! plan that is used up or not eligible, a sign-in that no longer holds, a
//! feature this route leaves out.

use serde_json::Value;

/// Where the person sees and sets how much of their plan apps may use.
pub const USAGE_PAGE: &str = "ChatGPT, Settings, Usage";
const SIGN_IN_AGAIN: &str = "Sign in with ChatGPT again in Settings, AI providers";

/// The code, message and parameter of an error body, in either shape
/// (`{"error": {…}}` or the fields alone).
fn parts(body: &str) -> (String, String, String) {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let error = if parsed["error"].is_object() {
        &parsed["error"]
    } else {
        &parsed
    };
    let field = |key: &str| error[key].as_str().unwrap_or_default().trim().to_owned();
    (field("code"), field("message"), field("param"))
}

/// What a code means, when it is one ChatGPT documents.
fn explain(code: &str, param: &str) -> Option<String> {
    Some(match code {
        "subscription_sharing_usage_limit_exceeded"
        | "usage_limit_reached"
        | "insufficient_quota" => {
            format!(
                "Your ChatGPT plan's usage limit is reached. Review it in {USAGE_PAGE}; KastenFlow can ask again once it resets"
            )
        }
        "rate_limit_exceeded" => {
            "ChatGPT is limiting how fast requests come in. Try again in a moment".to_owned()
        }
        "subscription_sharing_user_not_eligible" | "usage_not_included" => {
            "Your ChatGPT plan cannot be used here: this account or workspace is not eligible"
                .to_owned()
        }
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => {
            "ChatGPT cannot check your plan's usage right now. Try again in a moment".to_owned()
        }
        "subscription_sharing_unsupported_capability" => {
            let what = if param.is_empty() {
                String::new()
            } else {
                format!(" ({param})")
            };
            format!("ChatGPT does not support something this request uses{what}")
        }
        "subscription_sharing_route_not_supported" => {
            "ChatGPT does not allow this kind of request with a sign-in".to_owned()
        }
        "subscription_sharing_invalid_user"
        | "chatpass_v2_scope_not_authorized"
        | "chatpass_v2_invalid_authorization_context" => SIGN_IN_AGAIN.to_owned(),
        _ => return None,
    })
}

/// A request ChatGPT refused with `status` and `body`, with what to do.
pub fn refused(provider: &str, status: u16, body: &str) -> String {
    let (code, message, param) = parts(body);
    let said = message.trim_end_matches('.').to_owned();
    let explanation = explain(&code, &param).unwrap_or_else(|| match status {
        401 => SIGN_IN_AGAIN.to_owned(),
        403 if said.is_empty() => "ChatGPT refused this request".to_owned(),
        408 | 429 | 500..=599 if said.is_empty() => "Try again in a moment".to_owned(),
        408 | 429 | 500..=599 => format!("{said}. Try again in a moment"),
        _ if said.is_empty() => body.trim().chars().take(300).collect(),
        _ => said,
    });
    format!("{provider} answered {status}: {explanation}.")
}

/// A stream's own failure: `code` and `message` from its error event.
pub fn stream_failure(code: &str, message: &str) -> String {
    let message = message.trim().trim_end_matches('.');
    explain(code, "").unwrap_or_else(|| match (message.is_empty(), code.is_empty()) {
        (false, false) => format!("{message} ({code})"),
        (false, true) => message.to_owned(),
        (true, false) => code.to_owned(),
        (true, true) => "the stream failed".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plan_that_is_used_up_or_not_eligible_says_so() {
        let limit =
            r#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Limit."}}"#;
        let words = refused("ChatGPT", 429, limit);
        assert!(
            words.starts_with("ChatGPT answered 429: Your ChatGPT plan's usage limit is reached.")
                && words.contains("ChatGPT, Settings, Usage"),
            "{words}"
        );
        let eligible = r#"{"error":{"code":"subscription_sharing_user_not_eligible"}}"#;
        assert!(refused("ChatGPT", 403, eligible).contains("not eligible"));
        let unsupported = r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"tools[0]"}}"#;
        assert!(refused("ChatGPT", 400, unsupported).contains("(tools[0])"));
        for code in [
            "subscription_sharing_invalid_user",
            "chatpass_v2_scope_not_authorized",
        ] {
            let body = format!(r#"{{"error":{{"code":"{code}"}}}}"#);
            assert!(
                refused("ChatGPT", 401, &body).contains("Sign in with ChatGPT again"),
                "{code}"
            );
        }
    }

    #[test]
    fn other_refusals_keep_the_servers_words_and_a_hint() {
        assert_eq!(
            refused("ChatGPT", 401, ""),
            "ChatGPT answered 401: Sign in with ChatGPT again in Settings, AI providers."
        );
        assert_eq!(
            refused("ChatGPT", 400, r#"{"error":{"message":"Unknown model."}}"#),
            "ChatGPT answered 400: Unknown model."
        );
        assert_eq!(
            refused("ChatGPT", 503, r#"{"error":{"message":"Overloaded"}}"#),
            "ChatGPT answered 503: Overloaded. Try again in a moment."
        );
        assert_eq!(
            refused("ChatGPT", 503, "<html>"),
            "ChatGPT answered 503: Try again in a moment."
        );
        assert_eq!(
            refused("ChatGPT", 403, ""),
            "ChatGPT answered 403: ChatGPT refused this request."
        );
        // The fields alone, without an `error` around them.
        assert!(
            refused(
                "ChatGPT",
                429,
                r#"{"code":"subscription_sharing_usage_limit_exceeded"}"#
            )
            .contains("usage limit")
        );
    }

    #[test]
    fn a_failed_stream_names_its_cause() {
        assert!(
            stream_failure("subscription_sharing_usage_limit_exceeded", "").contains("usage limit")
        );
        assert_eq!(
            stream_failure("server_error", "Oops."),
            "Oops (server_error)"
        );
        assert_eq!(stream_failure("", "Oops"), "Oops");
        assert_eq!(stream_failure("rate_limited", ""), "rate_limited");
        assert_eq!(stream_failure("", ""), "the stream failed");
    }
}
