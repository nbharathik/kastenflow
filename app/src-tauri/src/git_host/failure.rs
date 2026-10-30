//! What GitHub's refusals mean, in plain sentences. A rate limit says when it
//! lifts; nothing here ever holds a token.

use reqwest::header::HeaderMap;
use serde_json::Value;

use crate::backup::contract::BackupError;

/// What GitHub's rate-limit headers said.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Rate {
    pub remaining: Option<u64>,
    /// Seconds since the Unix epoch when the limit lifts.
    pub reset: Option<u64>,
    /// Seconds to wait, when GitHub says so directly.
    pub retry_after: Option<u64>,
}

impl Rate {
    pub fn from_headers(headers: &HeaderMap) -> Rate {
        let number = |name: &str| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok())
        };
        Rate {
            remaining: number("x-ratelimit-remaining"),
            reset: number("x-ratelimit-reset"),
            retry_after: number("retry-after"),
        }
    }

    /// When the limit lifts, in milliseconds since the Unix epoch.
    fn resets_at(&self, now_ms: u64) -> Option<u64> {
        self.retry_after
            .map(|secs| now_ms.saturating_add(secs.saturating_mul(1000)))
            .or(self.reset.map(|secs| secs.saturating_mul(1000)))
    }
}

/// "Try again in about 12 minutes."
pub fn try_again(resets_at: Option<u64>, now_ms: u64) -> String {
    let Some(at) = resets_at else {
        return "Try again in a few minutes.".to_owned();
    };
    let secs = at.saturating_sub(now_ms).div_ceil(1000);
    if secs < 60 {
        "Try again in under a minute.".to_owned()
    } else if secs < 90 * 60 {
        format!("Try again in about {} minutes.", secs.div_ceil(60))
    } else {
        format!("Try again in about {} hours.", (secs + 1800) / 3600)
    }
}

fn limited(status: u16, rate: &Rate, body: &Value) -> bool {
    if status == 429 {
        return true;
    }
    let said = body["message"].as_str().unwrap_or("").to_lowercase();
    status == 403
        && (rate.remaining == Some(0)
            || rate.retry_after.is_some()
            || said.contains("rate limit")
            || said.contains("abuse"))
}

/// The typed error for a refusal. `what` finishes "GitHub could not ..."
/// ("make the repository").
pub fn classify(status: u16, rate: &Rate, body: &Value, what: &str, now_ms: u64) -> BackupError {
    if limited(status, rate, body) {
        let resets_at = rate.resets_at(now_ms);
        return BackupError::RateLimited {
            message: format!(
                "GitHub is limiting how often KastenFlow can ask, so it has paused. {}",
                try_again(resets_at, now_ms)
            ),
            resets_at,
        };
    }
    match status {
        401 => BackupError::SignedOut {
            message: "GitHub no longer takes this sign-in; sign in again".into(),
        },
        403 => BackupError::NoAccess {
            message: format!(
                "GitHub did not let this sign-in {what}. A token needs access to the repository, with Contents set to read and write"
            ),
        },
        404 => BackupError::NotFound {
            message: format!("GitHub could not find that to {what}, or this sign-in cannot see it"),
        },
        other => BackupError::other(format!("GitHub could not {what} (it answered {other})")),
    }
}

/// The typed error for a request that never got an answer.
pub fn offline(what: &str, err: &reqwest::Error) -> BackupError {
    let message = if err.is_timeout() {
        format!("GitHub took too long to {what}; try again")
    } else {
        format!("Could not reach GitHub to {what}. Check the connection and try again")
    };
    BackupError::Offline { message }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_limit_says_when_it_lifts() {
        let rate = Rate {
            remaining: Some(0),
            reset: Some(1_000 + 12 * 60),
            retry_after: None,
        };
        let err = classify(403, &rate, &json!({}), "list", 1_000_000);
        let BackupError::RateLimited { message, resets_at } = err else {
            panic!("not a rate limit");
        };
        assert_eq!(resets_at, Some((1_000 + 12 * 60) * 1000));
        assert!(
            message.ends_with("Try again in about 12 minutes."),
            "{message}"
        );
    }

    #[test]
    fn retry_after_and_429_and_the_abuse_message_count_as_limits() {
        let after = Rate {
            retry_after: Some(30),
            ..Rate::default()
        };
        assert!(matches!(
            classify(403, &after, &json!({}), "x", 0),
            BackupError::RateLimited {
                resets_at: Some(30_000),
                ..
            }
        ));
        assert!(matches!(
            classify(429, &Rate::default(), &json!({}), "x", 0),
            BackupError::RateLimited {
                resets_at: None,
                ..
            }
        ));
        let abuse = json!({"message": "You have exceeded a secondary rate limit"});
        assert!(matches!(
            classify(403, &Rate::default(), &abuse, "x", 0),
            BackupError::RateLimited { .. }
        ));
    }

    #[test]
    fn other_refusals_have_their_own_sentences() {
        let none = Rate::default();
        let body = json!({});
        assert!(matches!(
            classify(401, &none, &body, "x", 0),
            BackupError::SignedOut { .. }
        ));
        assert!(matches!(
            classify(403, &none, &body, "x", 0),
            BackupError::NoAccess { .. }
        ));
        assert!(matches!(
            classify(404, &none, &body, "x", 0),
            BackupError::NotFound { .. }
        ));
        assert!(
            classify(500, &none, &body, "list your repositories", 0)
                .message()
                .contains("(it answered 500)")
        );
    }

    #[test]
    fn waits_read_in_minutes_then_hours() {
        assert_eq!(try_again(None, 0), "Try again in a few minutes.");
        assert_eq!(try_again(Some(20_000), 0), "Try again in under a minute.");
        assert_eq!(try_again(Some(61_000), 0), "Try again in about 2 minutes.");
        assert_eq!(
            try_again(Some(3 * 3600 * 1000), 0),
            "Try again in about 3 hours."
        );
        assert_eq!(try_again(Some(5), 10), "Try again in under a minute.");
    }
}
