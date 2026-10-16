//! Asking again: a request that failed for a reason that passes (a busy
//! server, a dropped connection, a stream that broke) is sent again, up to
//! four tries in all, after a wait that grows from half a second to eight
//! and is never shorter than what the server asked. The wait ends the moment
//! the person presses Stop.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::header::HeaderMap;

/// How long and how often to wait between tries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// Tries a request gets, the first included.
    pub attempts: u32,
    /// The wait before the second try.
    pub first: Duration,
    /// The longest wait of our own.
    pub most: Duration,
}

impl Policy {
    pub const STANDARD: Policy = Policy {
        attempts: 4,
        first: Duration::from_millis(500),
        most: Duration::from_secs(8),
    };

    /// The same four tries with waits too short to notice, for tests.
    #[cfg(test)]
    pub const QUICK: Policy = Policy {
        attempts: 4,
        first: Duration::from_millis(5),
        most: Duration::from_millis(40),
    };

    /// The wait before try number `next` (2 is the first one again): half a
    /// second, one, two, four, eight, spread by a fifth either way by
    /// `unit` (0 to 1), and never less than `asked`.
    pub fn wait(&self, next: u32, asked: Option<Duration>, unit: f64) -> Duration {
        let doublings = next.saturating_sub(2).min(16);
        let grown = self.first.saturating_mul(1 << doublings).min(self.most);
        let own = grown
            .mul_f64(0.8 + 0.4 * unit.clamp(0.0, 1.0))
            .min(self.most);
        own.max(asked.unwrap_or_default())
    }
}

impl Default for Policy {
    fn default() -> Policy {
        #[cfg(test)]
        {
            Policy::QUICK
        }
        #[cfg(not(test))]
        {
            Policy::STANDARD
        }
    }
}

/// A wait a server asks for that is longer than this ends the request
/// instead: nobody should watch a chat sit for a minute.
pub const LONGEST_ASKED: Duration = Duration::from_secs(30);

/// A number between 0 and 1 that differs from try to try.
pub fn unit() -> f64 {
    let mut bytes = [0u8; 2];
    match getrandom::fill(&mut bytes) {
        Ok(()) => f64::from(u16::from_le_bytes(bytes)) / 65_536.0,
        Err(_) => 0.5,
    }
}

/// Statuses after which the same request may well work: asked too soon,
/// a conflict that clears, a server that is busy or down.
pub fn status_passes(status: u16) -> bool {
    matches!(status, 408 | 409 | 425 | 429 | 500 | 502 | 503 | 504 | 529)
}

/// Whether, and how, a failed try may be repeated.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Again {
    /// The failure is one that passes.
    pub passes: bool,
    /// What the server asked for as a wait.
    pub asked: Option<Duration>,
    /// The connection itself is suspect (reset, closed, timed out): the
    /// pool is made again so the next try uses a fresh one.
    pub stale: bool,
    /// The failure was a silence that went on until it was given up.
    pub silent: bool,
}

impl Again {
    /// A failure that will not change by asking again.
    pub fn never() -> Again {
        Again::default()
    }
}

/// How long the server's headers ask to wait: `retry-after-ms`, or
/// `retry-after` as seconds (they may have a fraction) or as a date.
pub fn asked_wait(headers: &HeaderMap) -> Option<Duration> {
    let text = |name: &str| headers.get(name)?.to_str().ok().map(str::trim);
    if let Some(ms) = text("retry-after-ms").and_then(|v| v.parse::<f64>().ok()) {
        return Some(Duration::from_secs_f64((ms / 1000.0).clamp(0.0, 86_400.0)));
    }
    let value = text("retry-after")?;
    if let Ok(seconds) = value.parse::<f64>() {
        return Some(Duration::from_secs_f64(seconds.clamp(0.0, 86_400.0)));
    }
    // An HTTP date is an RFC 2822 date with GMT for its zone.
    let when = jiff::fmt::rfc2822::parse(value).ok()?.timestamp();
    let ahead = when.as_second() - jiff::Timestamp::now().as_second();
    Some(Duration::from_secs(u64::try_from(ahead).unwrap_or(0)))
}

/// Waits `total`, looking at `cancel` every 50 ms; whether the person
/// stopped it.
pub async fn pause(total: Duration, cancel: &AtomicBool) -> bool {
    const TICK: Duration = Duration::from_millis(50);
    let mut left = total;
    while !left.is_zero() {
        if cancel.load(Ordering::SeqCst) {
            return true;
        }
        let step = left.min(TICK);
        tokio::time::sleep(step).await;
        left -= step;
    }
    cancel.load(Ordering::SeqCst)
}

#[cfg(test)]
#[path = "retry_tests.rs"]
mod tests;
